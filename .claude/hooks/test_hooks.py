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

SECRET_SAMPLES = (
    ("sb_secret_abcdef123456", "sb_secret_abcdef123456"),
    ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.QWxpY2VTaWduYXR1cmU", "eyJhbGciOiJIUzI1NiJ9"),
    ("postgresql://postgres:supersecret@127.0.0.1:54322/postgres", "supersecret"),
    ("SUPABASE_SERVICE_ROLE_KEY=xyz123abc", "xyz123abc"),
    ('{"password": "hunter2"}', "hunter2"),
)
for sample, secret in SECRET_SAMPLES:
    check(secret not in quality_gate.redact(sample), f"secretがマスクされていない: {sample!r}")

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
