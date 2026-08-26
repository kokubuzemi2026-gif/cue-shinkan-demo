#!/usr/bin/env python3
"""PreToolUse hook: 破壊的なgit操作を機械的に拒否する。

対象は Bash ツールの `command` 文字列だけで、次の操作を拒否する。

1. 保護ブランチ（main / develop）への直接push
2. force push（--force / -f / --force-with-lease / --force-if-includes / +refspec）
3. `git reset --hard`
4. `git clean -f`（-fd などの結合短オプションを含む）
5. `git branch -D`（--delete --force を含む）

安全上の設計:

- tool inputをshellへ展開しない。判定は `shlex` によるトークン解析で行い、
  内部で起動するgitは引数配列（shell=False）で実行する。
- 拒否理由にコマンド全文を含めない。URLへ埋め込まれたトークンなどの
  secretをログ・transcriptへ出さないため、違反した規則名だけを返す。
- 標準入力のJSONを解釈できない場合は判定を行わず、通常の権限フローへ委ねる
  （hookの不具合でセッション全体を止めないため）。

出力仕様（Claude Code公式）:
- 拒否は exit 0 + stdout JSON の `hookSpecificOutput.permissionDecision = "deny"`
- 許可（判定なし）は exit 0 かつ標準出力なし
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys

# 直接pushを禁止するブランチ。CLAUDE.md「Git運用」と揃える。
PROTECTED_BRANCHES = ("main", "develop")

# シェル演算子とみなす文字（shlexのpunctuation_charsと対応させる）
_PUNCTUATION = ";|&<>()"

# 値を次のトークンで受け取るgitのグローバルオプション
_GLOBAL_OPTS_WITH_VALUE = frozenset(
    {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"}
)

# 値を次のトークンで受け取る `git push` のオプション
# （--force-with-lease は `=` 形式でしか値を取らないため含めない）
_PUSH_OPTS_WITH_VALUE = frozenset({"--repo", "--receive-pack", "--exec", "--push-option"})

# shlexで解析できなかった場合だけ使う保険の正規表現。
# 解析不能なコマンドは稀なので、ここでは安全側（拒否）に倒す。
_FALLBACK_PATTERNS = (
    (
        re.compile(r"\bgit\b[^;|&\n]*\bpush\b[^;|&\n]*(--force\b|--force-with-lease|--force-if-includes|\s-[A-Za-z]*f)"),
        "force pushは禁止されています",
    ),
    (
        re.compile(r"\bgit\b[^;|&\n]*\bpush\b[^;|&\n]*\b(main|develop)\b"),
        "保護ブランチ（main / develop）への直接pushは禁止されています",
    ),
    (re.compile(r"\bgit\b[^;|&\n]*\breset\b[^;|&\n]*--hard"), "`git reset --hard` は禁止されています"),
    (
        re.compile(r"\bgit\b[^;|&\n]*\bclean\b[^;|&\n]*(--force\b|\s-[A-Za-z]*f)"),
        "`git clean -f` は禁止されています",
    ),
    (
        re.compile(r"\bgit\b[^;|&\n]*\bbranch\b[^;|&\n]*(\s-[A-Za-z]*D|--delete\s+--force)"),
        "`git branch -D` は禁止されています",
    ),
)

_HOW_TO_PROCEED = (
    "feature branch（feat/NNN-*, fix/NNN-*）へpushし、developへのPRで統合してください。"
    " 取り消しが必要な場合はrevert commitを使ってください。"
)


def _is_operator(token: str) -> bool:
    """トークンがシェル演算子（&&, ||, ;, | など）だけで構成されるか。"""
    return bool(token) and all(char in _PUNCTUATION for char in token)


def split_segments(command: str) -> list[list[str]] | None:
    """コマンド文字列を、演算子で区切った「1コマンド＝トークン列」の一覧へ分解する。

    解析できない場合（引用符の不一致など）は None を返す。
    """
    # 行継続（バックスラッシュ+改行）を結合してから、行ごとに解析する。
    normalized = re.sub(r"\\\r?\n", " ", command)
    segments: list[list[str]] = []
    current: list[str] = []

    for line in normalized.splitlines():
        if not line.strip():
            continue
        lexer = shlex.shlex(line, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        try:
            tokens = list(lexer)
        except ValueError:
            return None
        for token in tokens:
            if _is_operator(token):
                if current:
                    segments.append(current)
                    current = []
            else:
                current.append(token)
        if current:
            segments.append(current)
            current = []

    return segments


def _strip_git_globals(tokens: list[str]) -> tuple[list[str], str | None]:
    """`git` の後ろのグローバルオプションを取り除き、(残りのトークン, -Cの値) を返す。"""
    index = 0
    chdir: str | None = None
    while index < len(tokens):
        token = tokens[index]
        if not token.startswith("-"):
            break
        name = token.split("=", 1)[0]
        if name in _GLOBAL_OPTS_WITH_VALUE and "=" not in token:
            if name == "-C" and index + 1 < len(tokens):
                chdir = tokens[index + 1]
            index += 2
            continue
        index += 1
    return tokens[index:], chdir


def _current_branch(cwd: str) -> str | None:
    """作業ディレクトリの現在ブランチ名を返す（detached HEADなどはNone）。"""
    for argv in (
        ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    ):
        try:
            result = subprocess.run(
                argv, cwd=cwd, capture_output=True, text=True, timeout=5, check=False
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode == 0:
            branch = result.stdout.strip()
            if branch and branch != "HEAD":
                return branch
    return None


def _destination_branch(refspec: str) -> str | None:
    """refspecからpush先ブランチ名を取り出す（`src:dst` / `dst` / `:dst` に対応）。"""
    spec = refspec[1:] if refspec.startswith("+") else refspec
    destination = spec.split(":", 1)[1] if ":" in spec else spec
    destination = destination.strip()
    if destination.startswith("refs/heads/"):
        destination = destination[len("refs/heads/") :]
    return destination or None


def _check_push(args: list[str], cwd: str) -> str | None:
    force = False
    push_all = False
    positionals: list[str] = []

    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            positionals.extend(args[index + 1 :])
            break
        if token.startswith("--"):
            name = token.split("=", 1)[0]
            if name in ("--force", "--force-with-lease", "--force-if-includes"):
                force = True
            elif name in ("--all", "--mirror"):
                push_all = True
            if name in _PUSH_OPTS_WITH_VALUE and "=" not in token:
                index += 1
        elif token.startswith("-") and len(token) > 1:
            letters = token[1:]
            if "f" in letters:
                force = True
            if letters == "o":
                index += 1
        else:
            positionals.append(token)
        index += 1

    if force:
        return "force pushは禁止されています"
    if push_all:
        return "`git push --all` / `--mirror` は保護ブランチを含むため禁止されています"

    # 先頭のpositionalはremote。残りをrefspecとして扱う。
    refspecs = positionals[1:]
    for refspec in refspecs:
        if refspec.startswith("+"):
            return "force push（`+refspec`）は禁止されています"
        destination = _destination_branch(refspec)
        if destination == "HEAD":
            # `git push origin HEAD` は現在ブランチへのpush
            destination = _current_branch(cwd)
        if destination in PROTECTED_BRANCHES:
            return f"保護ブランチ `{destination}` への直接pushは禁止されています"

    if not refspecs:
        branch = _current_branch(cwd)
        if branch in PROTECTED_BRANCHES:
            return f"保護ブランチ `{branch}` からの直接pushは禁止されています"
    return None


def _check_reset(args: list[str]) -> str | None:
    for token in args:
        if token == "--hard" or token.startswith("--hard="):
            return "`git reset --hard` は禁止されています"
    return None


def _check_clean(args: list[str]) -> str | None:
    for token in args:
        if token == "--force" or re.fullmatch(r"-[A-Za-z]*f[A-Za-z]*", token):
            return "`git clean -f` は禁止されています"
    return None


def _check_branch(args: list[str]) -> str | None:
    forced = any(
        token == "--force" or re.fullmatch(r"-[A-Za-z]*f[A-Za-z]*", token) for token in args
    )
    for token in args:
        if re.fullmatch(r"-[A-Za-z]*D[A-Za-z]*", token):
            return "`git branch -D`（強制削除）は禁止されています"
    deleting = any(
        token == "--delete" or re.fullmatch(r"-[A-Za-z]*d[A-Za-z]*", token) for token in args
    )
    if deleting and forced:
        return "`git branch --delete --force`（強制削除）は禁止されています"
    return None


def _check_segment(tokens: list[str], cwd: str) -> str | None:
    """1コマンド分のトークン列を判定し、拒否理由があれば返す。"""
    index = 0
    # 先頭の環境変数代入（KEY=value）を読み飛ばす
    while index < len(tokens) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", tokens[index]):
        index += 1
    if index >= len(tokens):
        return None

    executable = os.path.basename(tokens[index])
    if executable not in ("git", "git.exe"):
        return None

    rest, chdir = _strip_git_globals(tokens[index + 1 :])
    if not rest:
        return None

    subcommand, args = rest[0], rest[1:]
    target_cwd = cwd
    if chdir:
        target_cwd = chdir if os.path.isabs(chdir) else os.path.join(cwd, chdir)

    if subcommand == "push":
        return _check_push(args, target_cwd)
    if subcommand == "reset":
        return _check_reset(args)
    if subcommand == "clean":
        return _check_clean(args)
    if subcommand == "branch":
        return _check_branch(args)
    return None


def evaluate(command: str, cwd: str) -> str | None:
    """コマンド文字列を判定する。拒否する場合は理由、許可する場合は None を返す。"""
    segments = split_segments(command)
    if segments is None:
        # 解析できないコマンドは、既知の危険パターンだけを安全側で拒否する。
        for pattern, reason in _FALLBACK_PATTERNS:
            if pattern.search(command):
                return reason
        return None

    for tokens in segments:
        reason = _check_segment(tokens, cwd)
        if reason:
            return reason
    return None


def _deny(reason: str) -> None:
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": f"{reason} {_HOW_TO_PROCEED}",
        }
    }
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except (ValueError, UnicodeDecodeError):
        return 0
    if not isinstance(payload, dict):
        return 0
    if payload.get("tool_name") != "Bash":
        return 0

    tool_input = payload.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str) or not command.strip():
        return 0

    cwd = payload.get("cwd")
    if not isinstance(cwd, str) or not cwd:
        cwd = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

    reason = evaluate(command, cwd)
    if reason:
        _deny(reason)
    return 0


if __name__ == "__main__":
    sys.exit(main())
