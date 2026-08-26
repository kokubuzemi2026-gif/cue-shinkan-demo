#!/usr/bin/env python3
"""hookの回帰テスト。標準ライブラリだけで動く。

実行:

    python3 .claude/hooks/test_hooks.py

`guard_git.py` と `quality_gate.py` を変更したら必ず実行し、結果をPRへ記録する。
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))


def _load(module_name: str):
    spec = importlib.util.spec_from_file_location(
        module_name, os.path.join(HOOKS_DIR, f"{module_name}.py")
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard_git = _load("guard_git")
quality_gate = _load("quality_gate")

_failures: list[str] = []
_checks = 0


def check(condition: bool, label: str) -> None:
    global _checks
    _checks += 1
    if not condition:
        _failures.append(label)


def _init_repo(path: str, branch: str) -> None:
    subprocess.run(
        ["git", "init", "--quiet", "-b", branch, path], check=True, capture_output=True, text=True
    )


def _run_hook(script: str, payload: dict, env_overrides: dict | None = None):
    env = dict(os.environ)
    env.pop("CLAUDE_PROJECT_DIR", None)
    env.update(env_overrides or {})
    return subprocess.run(
        [sys.executable, os.path.join(HOOKS_DIR, script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
        check=False,
    )


# --------------------------------------------------------------------------
# guard_git: 拒否すべきコマンド
# --------------------------------------------------------------------------

DENY_CASES = (
    "git push origin main",
    "git push origin develop",
    "git push origin HEAD:main",
    "git push origin feat/012-x:develop",
    "git push origin refs/heads/main",
    "git push --force origin feat/012-x",
    "git push -f origin feat/012-x",
    "git push -uf origin feat/012-x",
    "git push --force-with-lease origin feat/012-x",
    "git push --force-with-lease=feat/012-x origin feat/012-x",
    "git push --force-if-includes origin feat/012-x",
    "git push origin +feat/012-x:feat/012-x",
    "git push --all origin",
    "git push --mirror origin",
    "git push origin :main",
    "git push origin --delete develop",
    "git push -d origin main",
    "git reset --hard HEAD~1",
    "git reset --hard",
    "git clean -f",
    "git clean -fd",
    "git clean -xfd",
    "git clean --force",
    "git branch -D feat/012-x",
    "git branch -Dr origin/feat/012-x",
    "git branch --delete --force feat/012-x",
    "git branch -d -f feat/012-x",
    "npm run lint && git push origin main",
    "git add -A; git push origin develop",
    "git status\ngit push origin main",
    "git push \\\n  --force origin feat/012-x",
    "GIT_SSH_COMMAND='ssh -i /tmp/key' git push origin main",
    "/usr/bin/git push origin main",
    "git -c core.pager=cat push origin main",
    "echo start | git push origin main",
    # gitが受理する長オプションの短縮形（`--har` は `--hard` として解釈される）
    "git reset --har HEAD~1",
    "git reset --ha",
    "git reset --h",
    "git clean --fo",
    "git clean --for -d",
    "git push --force-w origin feat/012-x",
    "git push --force-with-le origin feat/012-x",
    "git push --forc origin feat/012-x",
    "git push --fo origin feat/012-x",
    "git branch --delete --forc feat/012-x",
    "git branch --del --force feat/012-x",
    # ラッパーコマンド経由
    "env git push origin main",
    "env GIT_TRACE=1 git push origin main",
    "sudo git push origin main",
    "sudo -u someone git push origin main",
    "nohup git push origin main",
    "time git push origin main",
    "command git push origin main",
    "timeout 60 git push origin main",
    "nice -n 10 git reset --hard",
    "true && env git push origin main",
    # シェル経由（-c の中身を再帰的に判定する）
    "bash -c 'git push origin main'",
    'sh -c "git push --force origin feat/012-x"',
    "bash -lc 'git reset --hard'",
    'eval "git push origin main"',
    "bash -c 'npm run lint && git clean -fd'",
    # シェル制御構文
    "if true; then git push origin main; fi",
    "for x in 1; do git push origin main; done",
    "{ git push origin main; }",
    "`git push origin main`",
    # git alias
    "git -c alias.p=push p origin main",
    "git -c 'alias.yolo=push --force' yolo origin feat/012-x",
    "git -c alias.nuke='reset --hard' nuke",
    "git -c 'alias.sh=!git push origin main' sh",
    # NUL文字による切り詰め回避
    "git push origin main\x00-suffix",
    "git reset --hard\x00x",
)

for command in DENY_CASES:
    reason = guard_git.evaluate(command, os.getcwd())
    check(reason is not None, f"deny期待だが許可された: {command!r}")


# --------------------------------------------------------------------------
# guard_git: 許可すべきコマンド（誤検知の確認）
# --------------------------------------------------------------------------

ALLOW_CASES = (
    "git push -u origin feat/012-agent-harness",
    "git push origin feat/012-x:feat/012-x",
    "git push origin HEAD:feat/012-x",
    "git push origin --tags",
    "git status",
    "git status --porcelain",
    "git log --oneline -5",
    "git fetch origin develop",
    "git diff --check",
    "git checkout -b feat/013-x origin/develop",
    "git branch -d feat/012-x",
    "git branch -a",
    "git branch --list",
    "git reset --soft HEAD~1",
    "git reset HEAD app/src/App.tsx",
    "git clean -n",
    "git clean --dry-run",
    'git commit -m "docs: mainへ直接pushしない方針とforce push禁止を明記"',
    'echo "git push origin main"',
    'grep -rn "git push origin main" docs/',
    "npm run test -- --run",
    "npm ci && npm run build",
    "cd app && npm run lint",
    # 短縮形の前方一致で、無関係なオプションを巻き込まないこと
    "git push --follow-tags origin feat/012-x",
    "git push --atomic origin feat/012-x",
    "git push --no-verify origin feat/012-x",
    "git branch --list --all",
    "git clean --dry-run",
    # --dry-run 併用のcleanは実際には削除しないので許可する
    "git clean -f -n",
    "git clean -nfd",
    "git clean --dry-run --force",
    # 引用された文字列の中身は判定しない
    'git commit -m "fix: git push --force と git reset --hard を禁止する"',
    'python3 -c "print(\'git push origin main\')"',
    # シェル経由でも、中身が危険でなければ許可する
    "bash -c 'npm run lint && npm run build'",
    'sh -c "git status"',
)

for command in ALLOW_CASES:
    reason = guard_git.evaluate(command, os.getcwd())
    check(reason is None, f"allow期待だが拒否された: {command!r} -> {reason}")


# --------------------------------------------------------------------------
# guard_git: 現在ブランチに依存する判定（refspecなしのpush）
# --------------------------------------------------------------------------

with tempfile.TemporaryDirectory() as tmpdir:
    protected_repo = os.path.join(tmpdir, "protected")
    feature_repo = os.path.join(tmpdir, "feature")
    os.makedirs(protected_repo)
    os.makedirs(feature_repo)
    _init_repo(protected_repo, "main")
    _init_repo(feature_repo, "feat/012-agent-harness")

    check(
        guard_git.evaluate("git push", protected_repo) is not None,
        "mainブランチでのrefspecなしpushが拒否されない",
    )
    check(
        guard_git.evaluate("git push origin", protected_repo) is not None,
        "mainブランチでの `git push origin` が拒否されない",
    )
    check(
        guard_git.evaluate("git push -u origin", protected_repo) is not None,
        "mainブランチでの `git push -u origin` が拒否されない",
    )
    check(
        guard_git.evaluate("git push origin HEAD", protected_repo) is not None,
        "mainブランチでの `git push origin HEAD` が拒否されない",
    )
    check(
        guard_git.evaluate("git push", feature_repo) is None,
        "feature branchでのpushが誤って拒否された",
    )
    check(
        guard_git.evaluate("git push origin HEAD", feature_repo) is None,
        "feature branchでの `git push origin HEAD` が誤って拒否された",
    )
    check(
        guard_git.evaluate(f"git -C {protected_repo} push", feature_repo) is not None,
        "`git -C <mainのrepo>` 経由のpushが拒否されない",
    )

    # リポジトリ設定のaliasを展開してから判定する
    subprocess.run(
        ["git", "-C", feature_repo, "config", "alias.pp", "push origin main"],
        check=True,
        capture_output=True,
        text=True,
    )
    check(
        guard_git.evaluate("git pp", feature_repo) is not None,
        "設定されたgit aliasを展開して判定していない",
    )


# --------------------------------------------------------------------------
# guard_git: ヒアドキュメント本文の誤検知と、解析時間の上限
# --------------------------------------------------------------------------

HEREDOC_BODY = """gh pr create --title "Task 012" --body "$(cat <<'EOF'
このPRでは git push origin main を拒否します。
`git reset --hard` と `git clean -fd` も拒否します。
EOF
)"
"""
check(
    guard_git.evaluate(HEREDOC_BODY, os.getcwd()) is None,
    "ヒアドキュメント本文のコマンド例を誤って拒否している",
)

# 解析不能かつ巨大な入力で、判定時間が発散しないこと（timeoutによるfail-open防止）
_huge = 'echo "' + ("git push origin main " * 6000)
_started = time.monotonic()
guard_git.evaluate(_huge, os.getcwd())
_elapsed = time.monotonic() - _started
check(_elapsed < 2.0, f"巨大な入力の判定に時間がかかりすぎる（{_elapsed:.1f}秒）")


# --------------------------------------------------------------------------
# guard_git: hookとしての入出力契約
# --------------------------------------------------------------------------

denied = _run_hook(
    "guard_git.py",
    {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "git push origin main"}, "cwd": os.getcwd()},
)
check(denied.returncode == 0, "拒否時のexit codeが0でない")
try:
    denied_payload = json.loads(denied.stdout)
except ValueError:
    denied_payload = {}
    check(False, "拒否時のstdoutがJSONではない")
specific = denied_payload.get("hookSpecificOutput", {})
check(specific.get("hookEventName") == "PreToolUse", "hookEventNameがPreToolUseでない")
check(specific.get("permissionDecision") == "deny", "permissionDecisionがdenyでない")
check(bool(specific.get("permissionDecisionReason")), "permissionDecisionReasonが空")
check(
    "git push origin main" not in denied.stdout,
    "拒否理由にコマンド全文が含まれている（secret露出の恐れ）",
)

# URLへ埋め込まれたトークンを拒否理由へ出さないこと
# （ダミートークンは連結で組み立てる。理由はSECRET_SAMPLESのコメントを参照）
_URL_TOKEN = "ghp" + "_TESTTOKENabcdefghij0123456789"
token_push = _run_hook(
    "guard_git.py",
    {
        "hook_event_name": "PreToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": f"git push https://{_URL_TOKEN}@github.com/o/r.git main"},
        "cwd": os.getcwd(),
    },
)
check(token_push.returncode == 0, "URL付きpushの拒否でexit codeが0でない")
check(
    "deny" in token_push.stdout,
    "URLで指定したremoteへの保護ブランチpushが拒否されない",
)
check(
    _URL_TOKEN not in token_push.stdout and _URL_TOKEN not in token_push.stderr,
    "拒否理由へURL埋め込みトークンが漏れている",
)

allowed = _run_hook(
    "guard_git.py",
    {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "git status"}, "cwd": os.getcwd()},
)
check(allowed.returncode == 0 and allowed.stdout.strip() == "", "許可時に出力がある")

other_tool = _run_hook(
    "guard_git.py",
    {"hook_event_name": "PreToolUse", "tool_name": "Read", "tool_input": {"file_path": "git push origin main"}, "cwd": os.getcwd()},
)
check(other_tool.returncode == 0 and other_tool.stdout.strip() == "", "Bash以外のツールを判定している")

broken = _run_hook("guard_git.py", {"tool_name": "Bash"})
check(broken.returncode == 0 and broken.stdout.strip() == "", "不正な入力で異常終了している")


# --------------------------------------------------------------------------
# quality_gate: ループ防止とマスク
# --------------------------------------------------------------------------

check(quality_gate.should_skip_for_loop({"stop_hook_active": True}), "stop_hook_activeを検出できない")
check(not quality_gate.should_skip_for_loop({"stop_hook_active": False}), "stop_hook_active falseを誤検出")
check(not quality_gate.should_skip_for_loop({}), "stop_hook_active未指定を誤検出")

# テスト用のダミートークンは、GitHubのpush protectionが実トークンと誤認しないよう
# 連結で組み立てる（ファイル内に完全な形の文字列を置かない）。
# 実際にSupabase PAT形式とSlack token形式がpushをブロックしたため、この形にしている。
_GITHUB_PAT = "ghp" + "_1234567890abcdefghijABCDEFGHIJ1234"
_GITHUB_OAUTH = "gho" + "_16C7e42F292c6912E7710c838347Ae178B4a"
_GITHUB_FINE = "github" + "_pat_11ABCDEFG0aBcDeFgHiJkL_LmNoPqRsTuVwXyZ01234"
_SUPABASE_PAT = "sbp" + "_0102030405060708090a0b0c0d0e0f1011121314"
_SUPABASE_SECRET = "sb_secret" + "_abcdef123456"
_SUPABASE_PUBLISHABLE = "sb_publishable" + "_abcdef123456"
_RESEND_KEY = "re" + "_123456789_abcdefghijklmnopqrstuv"
_ANTHROPIC_KEY = "sk-ant" + "-api03-abcdefghijklmnopqrstuvwxyz0123456789"
_AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE"
_SLACK_TOKEN = "xox" + "b-123456789012-abcdefghijklmnop"
_NPM_TOKEN = "npm" + "_abcdefghijklmnop0123"
_JWT = "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiJ0ZXN0In0.QWxpY2VTaWduYXR1cmU"
_PRIVATE_KEY = (
    "-----BEGIN OPENSSH PRIVATE" + " KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n"
    "-----END OPENSSH PRIVATE" + " KEY-----"
)

SECRET_SAMPLES = (
    (_SUPABASE_SECRET, _SUPABASE_SECRET),
    (_SUPABASE_PUBLISHABLE, _SUPABASE_PUBLISHABLE),
    (_JWT, _JWT),
    ("postgresql://postgres:supersecret@127.0.0.1:54322/postgres", "supersecret"),
    ("SUPABASE_SERVICE_ROLE_KEY=xyz123abc", "xyz123abc"),
    ('{"password": "hunter2"}', "hunter2"),
    # 値そのものが秘密になる形式（区切り文字に依存しない）
    (f"remote: {_GITHUB_PAT}", _GITHUB_PAT),
    (_GITHUB_FINE, _GITHUB_FINE),
    (_GITHUB_OAUTH, _GITHUB_OAUTH),
    (_SUPABASE_PAT, _SUPABASE_PAT),
    (f"RESEND_API_KEY {_RESEND_KEY}", _RESEND_KEY),
    (_ANTHROPIC_KEY, _ANTHROPIC_KEY),
    (f"AWS key {_AWS_KEY} used", _AWS_KEY),
    (_SLACK_TOKEN, _SLACK_TOKEN),
    # ヘッダとURL埋め込み（userinfoが1要素の形も含む）
    (f"Authorization: Bearer {_GITHUB_PAT}", _GITHUB_PAT),
    ("Authorization: Bearer opaque-token-value-1234567890", "opaque-token-value-1234567890"),
    (f"https://{_GITHUB_FINE}@github.com/o/r.git", _GITHUB_FINE),
    (f"//registry.npmjs.org/:_authToken={_NPM_TOKEN}", _NPM_TOKEN),
    (f"machine github.com login me password {_GITHUB_PAT}", _GITHUB_PAT),
    (_PRIVATE_KEY, "b3BlbnNzaC1rZXktdjEAAAAA"),
)
for sample, secret in SECRET_SAMPLES:
    check(secret not in quality_gate.redact(sample), f"secretがマスクされていない: {sample[:40]!r}")

check("VITE_SUPABASE_URL" in quality_gate.redact("VITE_SUPABASE_URL=http://127.0.0.1:54321"), "通常の出力まで壊している")


# --------------------------------------------------------------------------
# quality_gate: 変更検出とStopブロック
# --------------------------------------------------------------------------

with tempfile.TemporaryDirectory() as tmpdir:
    repo = os.path.join(tmpdir, "repo")
    os.makedirs(os.path.join(repo, "app"))
    _init_repo(repo, "feat/012-agent-harness")

    check(not quality_gate.app_changed(repo), "変更がないのにapp_changedがTrue")

    with open(os.path.join(repo, "app", "sample.ts"), "w", encoding="utf-8") as handle:
        handle.write("export const sample = 1;\n")
    check(quality_gate.app_changed(repo), "app/配下の変更を検出できない")

    skipped = _run_hook(
        "quality_gate.py",
        {"hook_event_name": "Stop", "stop_hook_active": True, "cwd": repo},
        {"CLAUDE_PROJECT_DIR": repo},
    )
    check(skipped.returncode == 0, "stop_hook_active時にexit 0で終了しない")
    check(skipped.stderr.strip() == "", "stop_hook_active時に出力している")

    blocked = _run_hook(
        "quality_gate.py",
        {"hook_event_name": "Stop", "stop_hook_active": False, "cwd": repo},
        {"CLAUDE_PROJECT_DIR": repo},
    )
    check(blocked.returncode == 2, "app/変更ありでStopをブロックしない")
    check("npm ci" in blocked.stderr, "node_modules未導入の案内が出ない")

    no_app_repo = os.path.join(tmpdir, "docs-only")
    os.makedirs(os.path.join(no_app_repo, "docs"))
    _init_repo(no_app_repo, "feat/012-agent-harness")
    with open(os.path.join(no_app_repo, "docs", "note.md"), "w", encoding="utf-8") as handle:
        handle.write("# note\n")
    docs_only = _run_hook(
        "quality_gate.py",
        {"hook_event_name": "Stop", "stop_hook_active": False, "cwd": no_app_repo},
        {"CLAUDE_PROJECT_DIR": no_app_repo},
    )
    check(docs_only.returncode == 0, "app/変更なしのセッションでStopをブロックしている")


# --------------------------------------------------------------------------
# quality_gate: 失敗コマンドの報告（出力のマスクを含む）
# --------------------------------------------------------------------------

if shutil.which("npm") is None:
    print("警告: npmが見つからないため run_gate の失敗パスを検証していません", file=sys.stderr)
else:
    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "package.json"), "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "name": "gate-fixture",
                    "private": True,
                    "scripts": {
                        "lint": "node -e \"console.error('SUPABASE_SERVICE_ROLE_KEY=leaked123'); process.exit(1)\""
                    },
                },
                handle,
            )
        passed, message = quality_gate.run_gate(tmpdir)
        check(not passed, "失敗するコマンドをゲートが検出できない")
        check("npm run lint" in message, "失敗したコマンド名が報告されない")
        check("leaked123" not in message, "失敗出力のsecretがマスクされていない")
        check("テスト" in message, "テストを弱体化しない旨の指示が含まれない")


# --------------------------------------------------------------------------

if _failures:
    print(f"FAILED: {len(_failures)} / {_checks} checks")
    for failure in _failures:
        print(f"  - {failure}")
    sys.exit(1)

print(f"OK: {_checks} checks passed")
