#!/usr/bin/env python3
"""Stop hook: `app/` に変更があるセッションだけローカル品質ゲートを実行する。

実行内容（`app/` で順に実行し、最初の失敗で停止する）:

1. `npm run lint`
2. `npm run test -- --run`
3. `npm run build`

失敗した場合は exit 2 でStopをブロックし、失敗コマンドと出力の末尾をstderrへ返す。
Claude Codeはstderrをそのまま読み、原因分析・修正・再検証へ進む。

設計上の約束:

- `stop_hook_active` が true のとき（直前のStopブロックによる継続中）は即座に終了し、
  無限ループを防ぐ。
- 重いDBテスト（pgTAP）やE2Eはここでは実行しない。それらはタスクのDoDとCIで担保する。
- 出力はsecretをマスクしてから返す。
- 判定に必要な情報が取れない場合（gitがない・npmがない等）は実行せずに終了する。
  ローカルゲートはCIの代替ではなく、早期発見のための手段である。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys

# app/ で実行するコマンド（表示名, 引数配列）
GATE_COMMANDS: tuple[tuple[str, list[str]], ...] = (
    ("npm run lint", ["npm", "run", "lint"]),
    ("npm run test -- --run", ["npm", "run", "test", "--", "--run"]),
    ("npm run build", ["npm", "run", "build"]),
)

# 変更検出の基準にする候補ref（先に見つかったものを使う）
BASE_REF_CANDIDATES = ("origin/develop", "origin/main", "develop", "main")

COMMAND_TIMEOUT_SECONDS = 420
MAX_OUTPUT_LINES = 40
MAX_LINE_LENGTH = 500

_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"sb_secret_[A-Za-z0-9_\-]+"), "sb_secret_***"),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]+"), "***JWT***"),
    (
        # 直前が `_` でも効くよう `\b` ではなく英数字の否定後読みを使う
        # （例: SUPABASE_SERVICE_ROLE_KEY=...）
        re.compile(
            r"(?i)(?<![A-Za-z0-9])(service[_-]?role[_-]?key|secret[_-]?key|access[_-]?key|api[_-]?key"
            r"|password|passwd|secret|token)([\"']?\s*[:=]\s*[\"']?)([^\s\"',;]+)"
        ),
        r"\1\2***",
    ),
    (re.compile(r"://([^:/@\s]+):([^@\s]+)@"), r"://\1:***@"),
)


def redact(text: str) -> str:
    """出力からsecretらしき値を取り除く。"""
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def should_skip_for_loop(payload: dict) -> bool:
    """直前のStopブロックによる継続中かどうか（無限ループ防止）。"""
    return bool(payload.get("stop_hook_active"))


def _git(args: list[str], cwd: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=30, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def _base_ref(project_dir: str) -> str | None:
    for ref in BASE_REF_CANDIDATES:
        if _git(["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], project_dir):
            return ref
    return None


def app_changed(project_dir: str) -> bool:
    """`app/` に未コミット変更、またはベースrefからの差分があるか。"""
    status = _git(["status", "--porcelain", "--", "app"], project_dir)
    if status is None:
        return False
    if status.strip():
        return True

    ref = _base_ref(project_dir)
    if ref is None:
        return False
    merge_base = _git(["merge-base", "HEAD", ref], project_dir)
    if not merge_base or not merge_base.strip():
        return False
    diff = _git(["diff", "--name-only", f"{merge_base.strip()}..HEAD", "--", "app"], project_dir)
    return bool(diff and diff.strip())


def _tail(text: str) -> str:
    lines = redact(text).splitlines()
    trimmed = [line[:MAX_LINE_LENGTH] for line in lines if line.strip()][-MAX_OUTPUT_LINES:]
    return "\n".join(trimmed)


def _block(message: str) -> int:
    sys.stderr.write(message.rstrip() + "\n")
    return 2


def run_gate(app_dir: str) -> tuple[bool, str]:
    """品質ゲートを実行し、(成功したか, 失敗時メッセージ) を返す。"""
    for label, argv in GATE_COMMANDS:
        try:
            result = subprocess.run(
                argv,
                cwd=app_dir,
                capture_output=True,
                text=True,
                timeout=COMMAND_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return False, (
                f"[quality gate] `{label}` が {COMMAND_TIMEOUT_SECONDS} 秒でタイムアウトしました。\n"
                "無限ループ・未終了のwatchプロセス・巨大な入力を疑って原因を特定してください。"
            )
        except OSError as error:
            return False, f"[quality gate] `{label}` を起動できませんでした: {error}"

        if result.returncode != 0:
            output = _tail(f"{result.stdout}\n{result.stderr}")
            return False, (
                f"[quality gate] `{label}` が失敗しました（exit {result.returncode}）。\n"
                f"--- 出力の末尾（最大{MAX_OUTPUT_LINES}行 / secretはマスク済み） ---\n"
                f"{output}\n"
                "--- ここまで ---\n"
                "原因を特定して修正し、lint → test → build をすべて通してから終了してください。\n"
                "テストのスキップ・削除・期待値の緩和で通さないでください。"
            )
    return True, ""


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except (ValueError, UnicodeDecodeError):
        return 0
    if not isinstance(payload, dict):
        return 0

    # 直前のStopブロックによる継続中は、再度ブロックしない（無限ループ防止）。
    if should_skip_for_loop(payload):
        return 0

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()
    if not isinstance(project_dir, str) or not os.path.isdir(project_dir):
        return 0

    app_dir = os.path.join(project_dir, "app")
    if not os.path.isdir(app_dir):
        return 0
    if not app_changed(project_dir):
        return 0

    if shutil.which("npm") is None:
        sys.stderr.write("[quality gate] npmが見つからないためローカル品質ゲートを省略しました。\n")
        return 0
    if not os.path.isdir(os.path.join(app_dir, "node_modules")):
        return _block(
            "[quality gate] `app/node_modules` がないため lint / test / build を実行できません。\n"
            "`cd app && npm ci` を実行してから、再度 lint → test → build を通してください。"
        )

    passed, message = run_gate(app_dir)
    if passed:
        return 0
    return _block(message)


if __name__ == "__main__":
    sys.exit(main())
