#!/usr/bin/env python3
"""PreToolUse hook: 破壊的なgit操作を機械的に拒否する。

対象は Bash ツールの `command` 文字列だけで、次の操作を拒否する。

1. 保護ブランチ（main / develop）への直接push
2. force push（--force / -f / --force-with-lease / --force-if-includes / +refspec）
3. `git reset --hard`
4. `git clean -f`（-fd などの結合短オプションを含む。--dry-run 併用時は許可）
5. `git branch -D`（--delete --force を含む）

判定の設計:

- gitは長オプションの一意な短縮形を受理する（`--har` は `--hard`）。そのため
  完全一致ではなく「対象オプションの前方一致」で判定する。
- `env` / `sudo` / `nohup` などのラッパー経由でも効くよう、セグメント内の
  すべてのトークンを走査し、`git` が現れた位置から解析する。
- `bash -c "..."` / `sh -c "..."` / `eval "..."` は中身を再帰的に判定する。
- `git -c alias.x=push x` とリポジトリ設定のaliasを展開してから判定する。
- ヒアドキュメントの本文は判定対象から除く（文書へコマンド例を書けるようにする）。

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
_PUNCTUATION = ";|&<>()`"

# 再帰（alias展開・`bash -c`・`eval`）の深さ上限
_MAX_DEPTH = 5

_ENV_ASSIGN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=.*", re.DOTALL)

# 中身を再帰的に判定するシェル
_SHELL_EXECUTABLES = frozenset({"sh", "bash", "zsh", "dash", "ksh", "ash", "busybox"})

# 値を次のトークンで受け取るgitのグローバルオプション
_GLOBAL_OPTS_WITH_VALUE = frozenset(
    {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"}
)

# 値を次のトークンで受け取る `git push` のオプション
# （--force-with-lease は `=` 形式でしか値を取らないため含めない）
_PUSH_OPTS_WITH_VALUE = frozenset({"--repo", "--receive-pack", "--exec", "--push-option"})

# alias探索をスキップしてよい既知のサブコマンド（設定参照の回数を抑えるため）
_KNOWN_SUBCOMMANDS = frozenset(
    {
        "add", "am", "annotate", "apply", "archive", "bisect", "blame", "branch",
        "cat-file", "check-ignore", "checkout", "cherry-pick", "clean", "clone",
        "commit", "config", "describe", "diff", "difftool", "fetch", "fsck", "gc",
        "grep", "help", "init", "log", "ls-files", "ls-remote", "ls-tree", "merge",
        "merge-base", "mv", "notes", "pull", "push", "rebase", "reflog", "remote",
        "reset", "restore", "revert", "rm", "shortlog", "show", "show-ref", "stash",
        "status", "submodule", "switch", "symbolic-ref", "tag", "update-ref",
        "rev-list", "rev-parse", "version", "whatchanged", "worktree",
    }
)

# shlexで解析できなかった場合だけ使う保険の正規表現。
# 解析不能なコマンドは稀なので、ここでは安全側（拒否）に倒す。
# 量指定子は有界にする（`[^;|&\n]*` のままだと入力長に対して二次関数的に遅くなり、
# hookのtimeoutを超えてfail-openする経路になるため）。
_FALLBACK_SPAN = r"[^;|&\n]{0,200}"
_FALLBACK_PATTERNS = (
    (
        re.compile(rf"\bgit\b{_FALLBACK_SPAN}\bpush\b{_FALLBACK_SPAN}(--f[a-z-]*|\s-[A-Za-z]*f)"),
        "force pushは禁止されています",
    ),
    (
        re.compile(rf"\bgit\b{_FALLBACK_SPAN}\bpush\b{_FALLBACK_SPAN}\b(main|develop)\b"),
        "保護ブランチ（main / develop）への直接pushは禁止されています",
    ),
    (
        re.compile(rf"\bgit\b{_FALLBACK_SPAN}\breset\b{_FALLBACK_SPAN}--h"),
        "`git reset --hard` は禁止されています",
    ),
    (
        re.compile(rf"\bgit\b{_FALLBACK_SPAN}\bclean\b{_FALLBACK_SPAN}(--f|\s-[A-Za-z]*f)"),
        "`git clean -f` は禁止されています",
    ),
    (
        re.compile(rf"\bgit\b{_FALLBACK_SPAN}\bbranch\b{_FALLBACK_SPAN}(\s-[A-Za-z]*D|--d[a-z-]*\s+--f)"),
        "`git branch -D` は禁止されています",
    ),
)

# 解析にかける長さの上限（これを超える入力は先頭だけを見る）。
# 判定時間を入力長に対して有界にし、timeoutによるfail-openを防ぐ。
_MAX_COMMAND_LENGTH = 20000

_HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")

_HOW_TO_PROCEED = (
    "feature branch（feat/NNN-*, fix/NNN-*）へpushし、developへのPRで統合してください。"
    " 取り消しが必要な場合はrevert commitを使ってください。"
)


def _is_operator(token: str) -> bool:
    """トークンがシェル演算子（&&, ||, ;, | など）だけで構成されるか。"""
    return bool(token) and all(char in _PUNCTUATION for char in token)


def _is_long_option(token: str, *candidates: str) -> bool:
    """トークンが候補オプションの前方一致（gitが受理する短縮形）か。

    gitはparse-optionsにより一意な短縮形を受理するため、`--hard` は `--ha` でも通る。
    曖昧な短縮形はgit側がエラーにするので、ここでは安全側に倒して前方一致で拾う。
    """
    name = token.split("=", 1)[0]
    if not name.startswith("--") or len(name) < 3:
        return False
    return any(candidate.startswith(name) for candidate in candidates)


def _strip_heredocs(command: str) -> str:
    """ヒアドキュメントの本文を取り除く（文書へコマンド例を書けるようにする）。"""
    lines = command.splitlines()
    kept: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        kept.append(line)
        terminators = [terminator for _, terminator in _HEREDOC_RE.findall(line)]
        index += 1
        for terminator in terminators:
            while index < len(lines) and lines[index].strip() != terminator:
                index += 1
            if index < len(lines):
                index += 1
    return "\n".join(kept)


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
        lexer = shlex.shlex(line, posix=True, punctuation_chars=_PUNCTUATION)
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


def _record_alias(aliases: dict[str, str], config_value: str) -> None:
    """`-c alias.name=command` 形式の設定をaliasとして記録する。"""
    if not config_value.startswith("alias."):
        return
    name, separator, value = config_value[len("alias.") :].partition("=")
    if separator and name:
        aliases[name] = value


def _strip_git_globals(tokens: list[str]) -> tuple[list[str], str | None, dict[str, str]]:
    """`git` の後ろのグローバルオプションを取り除く。

    戻り値は (残りのトークン, -Cの値, インライン定義されたalias)。
    """
    index = 0
    chdir: str | None = None
    aliases: dict[str, str] = {}
    while index < len(tokens):
        token = tokens[index]
        if not token.startswith("-"):
            break
        name = token.split("=", 1)[0]
        inline_value = token.split("=", 1)[1] if "=" in token else None

        # `-calias.p=push` のように値が連結された形
        if name.startswith("-c") and name != "-c" and not name.startswith("--"):
            _record_alias(aliases, token[2:])
            index += 1
            continue
        if name == "--config-env":
            # 環境変数経由の設定は解決できないため、以降のalias展開を諦める
            if inline_value is None:
                index += 1
            index += 1
            continue
        if name in _GLOBAL_OPTS_WITH_VALUE and inline_value is None:
            value = tokens[index + 1] if index + 1 < len(tokens) else ""
            if name == "-C":
                chdir = value
            elif name == "-c":
                _record_alias(aliases, value)
            index += 2
            continue
        index += 1
    return tokens[index:], chdir, aliases


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


def _config_alias(name: str, cwd: str) -> str | None:
    """リポジトリ設定に定義されたgit aliasを取得する。"""
    try:
        result = subprocess.run(
            ["git", "config", "--get", f"alias.{name}"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


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
            if _is_long_option(token, "--force", "--force-with-lease", "--force-if-includes"):
                force = True
            elif _is_long_option(token, "--all", "--mirror"):
                push_all = True
            name = token.split("=", 1)[0]
            if "=" not in token and any(
                option.startswith(name) for option in _PUSH_OPTS_WITH_VALUE
            ):
                index += 1
        elif token.startswith("-") and len(token) > 1:
            letters = token[1:]
            if "f" in letters:
                force = True
            if letters.endswith("o"):
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
        if _is_long_option(token, "--hard"):
            return "`git reset --hard` は禁止されています"
    return None


def _check_clean(args: list[str]) -> str | None:
    # --dry-run（-n）付きは実際には削除しないため許可する
    for token in args:
        if _is_long_option(token, "--dry-run") or re.fullmatch(r"-[A-Za-z]*n[A-Za-z]*", token):
            return None
    for token in args:
        if _is_long_option(token, "--force") or re.fullmatch(r"-[A-Za-z]*f[A-Za-z]*", token):
            return "`git clean -f` は禁止されています"
    return None


def _check_branch(args: list[str]) -> str | None:
    forced = any(
        _is_long_option(token, "--force") or re.fullmatch(r"-[A-Za-z]*f[A-Za-z]*", token)
        for token in args
    )
    for token in args:
        if re.fullmatch(r"-[A-Za-z]*D[A-Za-z]*", token):
            return "`git branch -D`（強制削除）は禁止されています"
    deleting = any(
        _is_long_option(token, "--delete") or re.fullmatch(r"-[A-Za-z]*d[A-Za-z]*", token)
        for token in args
    )
    if deleting and forced:
        return "`git branch --delete --force`（強制削除）は禁止されています"
    return None


def _dispatch(
    subcommand: str, args: list[str], cwd: str, aliases: dict[str, str], depth: int
) -> str | None:
    """gitサブコマンドを判定する。未知のサブコマンドはaliasとして展開を試みる。"""
    if subcommand == "push":
        return _check_push(args, cwd)
    if subcommand == "reset":
        return _check_reset(args)
    if subcommand == "clean":
        return _check_clean(args)
    if subcommand == "branch":
        return _check_branch(args)

    if depth >= _MAX_DEPTH:
        return None

    alias = aliases.get(subcommand)
    if alias is None and subcommand not in _KNOWN_SUBCOMMANDS:
        alias = _config_alias(subcommand, cwd)
    if not alias:
        return None

    if alias.startswith("!"):
        # シェルコマンド形式のalias
        return evaluate(alias[1:], cwd, depth + 1)
    try:
        expanded = shlex.split(alias)
    except ValueError:
        return None
    if not expanded:
        return None
    rest, chdir, inline_aliases = _strip_git_globals(expanded)
    if not rest:
        return None
    merged = dict(aliases)
    merged.update(inline_aliases)
    target_cwd = _resolve_cwd(cwd, chdir)
    return _dispatch(rest[0], rest[1:] + args, target_cwd, merged, depth + 1)


def _resolve_cwd(cwd: str, chdir: str | None) -> str:
    if not chdir:
        return cwd
    return chdir if os.path.isabs(chdir) else os.path.join(cwd, chdir)


def _check_git_invocation(tokens: list[str], cwd: str, depth: int) -> str | None:
    rest, chdir, aliases = _strip_git_globals(tokens)
    if not rest:
        return None
    return _dispatch(rest[0], rest[1:], _resolve_cwd(cwd, chdir), aliases, depth)


def _check_shell_invocation(base: str, rest: list[str], cwd: str, depth: int) -> str | None:
    """`bash -c "..."` / `eval "..."` の中身を再帰的に判定する。"""
    if depth >= _MAX_DEPTH:
        return None
    if base == "eval":
        return evaluate(" ".join(rest), cwd, depth + 1)
    for index, token in enumerate(rest):
        if re.fullmatch(r"-[A-Za-z]*c", token) and index + 1 < len(rest):
            return evaluate(rest[index + 1], cwd, depth + 1)
    return None


def _check_segment(tokens: list[str], cwd: str, depth: int) -> str | None:
    """1コマンド分のトークン列を判定し、拒否理由があれば返す。

    `env` / `sudo` / `nohup` などのラッパー経由でも効くよう、先頭だけでなく
    すべてのトークンを走査して `git` の出現位置から解析する。
    """
    for index, token in enumerate(tokens):
        if _ENV_ASSIGN_RE.fullmatch(token):
            continue
        base = os.path.basename(token)
        if base in ("git", "git.exe"):
            reason = _check_git_invocation(tokens[index + 1 :], cwd, depth)
            if reason:
                return reason
        elif base in _SHELL_EXECUTABLES or base == "eval":
            reason = _check_shell_invocation(base, tokens[index + 1 :], cwd, depth)
            if reason:
                return reason
    return None


def evaluate(command: str, cwd: str, depth: int = 0) -> str | None:
    """コマンド文字列を判定する。拒否する場合は理由、許可する場合は None を返す。"""
    if depth > _MAX_DEPTH:
        return None
    # NUL文字は実行時にその位置で引数が切り詰められるため、
    # 「NUL以降のトークン」を落としてから判定する（`main\0-suffix` は `main` と等価）
    command = re.sub(r"\x00\S*", "", command)[:_MAX_COMMAND_LENGTH]
    stripped = _strip_heredocs(command)
    segments = split_segments(stripped)
    if segments is None:
        # 解析できないコマンドは、既知の危険パターンだけを安全側で拒否する。
        for pattern, reason in _FALLBACK_PATTERNS:
            if pattern.search(stripped):
                return reason
        return None

    for tokens in segments:
        reason = _check_segment(tokens, cwd, depth)
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

    try:
        reason = evaluate(command, cwd)
    except RecursionError:
        return 0
    if reason:
        _deny(reason)
    return 0


if __name__ == "__main__":
    sys.exit(main())
