#!/usr/bin/env python3
"""Stop hook: `app/` に変更があるときだけローカル品質ゲートを実行する。

変更の判定は「`app/` の未コミット変更（未追跡ファイルを含む）」または
「ベースref（origin/develop → origin/main → develop → main の順で最初に見つかったもの）からの
差分に `app/` が含まれること」で行う。セッション単位ではなくブランチ単位の判定なので、
`app/` を触ったブランチでは文書だけを編集したセッションでもゲートが走る（安全側）。

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
- 出力は既知形式のsecretをマスクしてから返す（網羅は保証しない。`redact()` を参照）。
- 判定に必要な情報が取れない場合（gitがない・npmがない等）は実行せずに終了する。
  ローカルゲートはCIの代替ではなく、早期発見のための手段である。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
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

def _mask_value(match: re.Match[str]) -> str:
    """`名前 区切り 値` の「値」だけを伏せる。"""
    return f"{match.group(1)}{match.group(2)}***"


# 既知のsecret形式。網羅は保証しない（`_tail()` の注意書きと揃えること）。
_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], object], ...] = (
    # 値そのもので識別できるトークン（区切り文字に依存しない）
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}"), "***TOKEN***"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), "***TOKEN***"),
    (re.compile(r"\bsb_(?:secret|publishable)_[A-Za-z0-9_\-]+"), "***TOKEN***"),
    (re.compile(r"\bsbp_[A-Za-z0-9]{16,}"), "***TOKEN***"),
    (re.compile(r"\bre_[A-Za-z0-9_\-]{16,}"), "***TOKEN***"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"), "***TOKEN***"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "***TOKEN***"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"), "***TOKEN***"),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]+"), "***JWT***"),
    (
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
        "***PRIVATE KEY***",
    ),
    # 認証ヘッダ
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._\-+/=]{12,}"), r"\1 ***"),
    # `名前=値` / `名前: 値`。直前が `_` でも効くよう `\b` ではなく否定後読みを使い、
    # `//registry.npmjs.org/:_authToken=...` のような接頭辞付きの名前も拾う。
    (
        re.compile(
            r"(?i)(?<![A-Za-z0-9])([A-Za-z0-9_.-]*(?:service[_-]?role[_-]?key|service[_-]?role"
            r"|secret[_-]?key|secret|api[_-]?key|access[_-]?key|passwd|password"
            r"|auth[_-]?token|token))([\"']?\s*[:=]\s*[\"']?)([^\s\"',;]+)"
        ),
        _mask_value,
    ),
    # `名前 値`（空白区切り）。誤爆を避けるため、値がトークンらしい場合だけ伏せる。
    (
        re.compile(
            r"(?i)(?<![A-Za-z0-9])(service[_-]?role|secret|passwd|password|api[_-]?key"
            r"|access[_-]?key|auth[_-]?token|token)(\s+)([A-Za-z0-9_\-./+=]{12,})"
        ),
        _mask_value,
    ),
    # URLへ埋め込んだ資格情報（`user:pass@` と `token@` の両方）
    (re.compile(r"://([^:/@\s]+):([^@\s]+)@"), r"://\1:***@"),
    (re.compile(r"://([^/@\s]+)@"), "://***@"),
)


def redact(text: str) -> str:
    """出力から既知の形式のsecretを取り除く。

    網羅は保証しない。新しい形式のトークンは通り抜けうるため、この出力を
    PRやタスクファイルへ転記する前には必ず目視で確認すること。
    """
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)  # type: ignore[arg-type]
    return text


def should_skip_for_loop(payload: dict) -> bool:
    """直前のStopブロックによる継続中かどうか（無限ループ防止）。"""
    return bool(payload.get("stop_hook_active"))


def _git(args: list[str], cwd: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=30,
            check=False,
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


def _terminate_group(process: subprocess.Popen) -> None:
    """プロセスグループごと終了させる（npmが起動した孫プロセスを残さない）。"""
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (OSError, AttributeError):
        try:
            process.kill()
        except OSError:
            pass


def _run_command(argv: list[str], cwd: str) -> tuple[int, str]:
    """コマンドを引数配列で実行し、(終了コード, 標準出力+標準エラー) を返す。

    - 不正なバイト列を出力してもクラッシュしないよう `errors="replace"` で読む
    - タイムアウト時はプロセスグループごと停止し、途中までの出力を例外へ載せる
    """
    process = subprocess.Popen(
        argv,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        start_new_session=True,
    )
    try:
        output, _ = process.communicate(timeout=COMMAND_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        _terminate_group(process)
        try:
            output, _ = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            output = ""
        raise subprocess.TimeoutExpired(argv, COMMAND_TIMEOUT_SECONDS, output=output)
    return process.returncode, output


def run_gate(app_dir: str) -> tuple[bool, str]:
    """品質ゲートを実行し、(成功したか, 失敗時メッセージ) を返す。"""
    for label, argv in GATE_COMMANDS:
        try:
            returncode, command_output = _run_command(argv, app_dir)
        except subprocess.TimeoutExpired as error:
            partial = _tail(error.output or "")
            return False, (
                f"[quality gate] `{label}` が {COMMAND_TIMEOUT_SECONDS} 秒でタイムアウトしました。\n"
                f"--- 出力の末尾（最大{MAX_OUTPUT_LINES}行 / 既知形式のsecretはマスク済み。"
                "転記する前に必ず目視で確認すること） ---\n"
                f"{partial}\n"
                "--- ここまで ---\n"
                "無限ループ・未終了のwatchプロセス・巨大な入力を疑って原因を特定してください。"
            )
        except OSError as error:
            return False, f"[quality gate] `{label}` を起動できませんでした: {error}"

        if returncode != 0:
            output = _tail(command_output)
            return False, (
                f"[quality gate] `{label}` が失敗しました（exit {returncode}）。\n"
                f"--- 出力の末尾（最大{MAX_OUTPUT_LINES}行 / 既知形式のsecretはマスク済み。"
                "転記する前に必ず目視で確認すること） ---\n"
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
