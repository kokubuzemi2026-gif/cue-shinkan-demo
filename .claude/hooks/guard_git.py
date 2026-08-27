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

# push先やforceの有無をrefspec以外の場所で決めてしまう設定キー。
# `git -c push.default=matching push origin` のように、コマンドラインに
# refspecが無くても保護ブランチを更新できるため、pushでは拒否する。
_RISKY_PUSH_CONFIG_RE = re.compile(
    r"^(push\.default|remote\.[^.]+\.(push|mirror))$", re.IGNORECASE
)

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


def _lex(text: str) -> list[str]:
    """シェルに近い規則でトークン化する（引用符が閉じていなければ ValueError）。"""
    lexer = shlex.shlex(text, posix=True, punctuation_chars=_PUNCTUATION)
    lexer.whitespace_split = True
    return list(lexer)


def _extract_heredocs(tokens: list[str]) -> tuple[list[str], list[str]]:
    """`<<` 演算子とその終端語をトークン列から取り除き、終端語の一覧を返す。

    引用符の中の `<<EOF` や、算術の `1 << 8` は演算子トークンにならないため、
    ここでヒアドキュメントと誤認することはない。
    """
    kept: list[str] = []
    terminators: list[str] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token == "<<" and index + 1 < len(tokens):
            word = tokens[index + 1].lstrip("-")
            if word:
                terminators.append(word)
                index += 2
                continue
        kept.append(token)
        index += 1
    return kept, terminators


def _read_heredoc_body(
    lines: list[str], start: int, terminator: str
) -> tuple[int, str] | None:
    """終端語が見つかれば (次の行番号, 本文) を返す。見つからなければ None。

    None を返した場合、呼び出し側は行を1つも捨てない。終端語が無いときに
    残りの行を捨てると、ガードが丸ごと無効化されてしまうため。
    """
    for offset in range(start, len(lines)):
        if lines[offset].strip() == terminator:
            return offset + 1, "\n".join(lines[start:offset])
    return None


def split_segments(command: str) -> list[list[str]] | None:
    """コマンド文字列を、演算子で区切った「1コマンド＝トークン列」の一覧へ分解する。

    - 行ごとに解析し、引用符が改行をまたぐ場合は次の行を連結して解析し直す
      （複数行のcommit messageなどを誤って解析不能にしないため）
    - ヒアドキュメントの本文は、終端語が実在するときだけ判定対象から外す
      （終端語が無いときに残りの行を捨てると、ガードが丸ごと無効化されてしまう）

    解析できない場合は None を返す。
    """
    # 行継続（バックスラッシュ+改行）を結合してから、行ごとに解析する。
    normalized = re.sub(r"\\\r?\n", " ", command)
    lines = normalized.splitlines()
    segments: list[list[str]] = []
    index = 0

    while index < len(lines):
        if not lines[index].strip():
            index += 1
            continue

        tokens: list[str] | None = None
        consumed = 0
        for end in range(index, len(lines)):
            try:
                tokens = _lex("\n".join(lines[index : end + 1]))
            except ValueError:
                continue
            consumed = end - index + 1
            break
        if tokens is None:
            return None
        index += consumed

        tokens, terminators = _extract_heredocs(tokens)
        bodies: list[str] = []
        for terminator in terminators:
            found = _read_heredoc_body(lines, index, terminator)
            if found is not None:
                index, body = found
                bodies.append(body)

        current: list[str] = []
        for token in tokens:
            if _is_operator(token):
                if current:
                    segments.append(current)
                    current = []
            else:
                current.append(token)
        if current:
            segments.append(current)

        # `bash -s <<EOF` のようにヒアドキュメントがシェルの標準入力になる場合、
        # 本文はコマンドとして実行される。捨てずに中身も判定対象へ加える。
        if bodies and any(
            os.path.basename(token) in _SHELL_EXECUTABLES
            or os.path.basename(token) == "eval"
            for token in tokens
        ):
            for body in bodies:
                nested = split_segments(body)
                if nested:
                    segments.extend(nested)

    return segments


def _record_alias(aliases: dict[str, str], config_value: str) -> None:
    """`-c alias.name=command` 形式の設定をaliasとして記録する。"""
    if not config_value.startswith("alias."):
        return
    name, separator, value = config_value[len("alias.") :].partition("=")
    if separator and name:
        aliases[name] = value


def _strip_git_globals(
    tokens: list[str],
) -> tuple[list[str], str | None, dict[str, str], bool]:
    """`git` の後ろのグローバルオプションを取り除く。

    戻り値は (残りのトークン, -Cの値, インライン定義されたalias)。
    """
    index = 0
    chdir: str | None = None
    aliases: dict[str, str] = {}
    risky_push_config = False

    def record(config_value: str) -> None:
        nonlocal risky_push_config
        _record_alias(aliases, config_value)
        if _RISKY_PUSH_CONFIG_RE.match(config_value.split("=", 1)[0]):
            risky_push_config = True

    while index < len(tokens):
        token = tokens[index]
        if not token.startswith("-"):
            break
        name = token.split("=", 1)[0]
        inline_value = token.split("=", 1)[1] if "=" in token else None

        # `-calias.p=push` のように値が連結された形
        if name.startswith("-c") and name != "-c" and not name.startswith("--"):
            record(token[2:])
            index += 1
            continue
        if name == "--config-env":
            # 環境変数経由の設定は値を解決できない。キー名だけは判定する
            record(inline_value if inline_value is not None else "")
            if inline_value is None:
                index += 1
            index += 1
            continue
        if name in _GLOBAL_OPTS_WITH_VALUE and inline_value is None:
            value = tokens[index + 1] if index + 1 < len(tokens) else ""
            if name == "-C":
                chdir = value
            elif name == "-c":
                record(value)
            index += 2
            continue
        index += 1
    return tokens[index:], chdir, aliases, risky_push_config


def _current_branch(cwd: str) -> str | None:
    """作業ディレクトリの現在ブランチ名を返す（detached HEADなどはNone）。"""
    for argv in (
        ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    ):
        try:
            result = subprocess.run(
                argv,
                cwd=cwd,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=5,
                check=False,
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
            errors="replace",
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
    tags_only = False
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
            elif token.split("=", 1)[0] == "--tags":
                tags_only = True
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

    if not refspecs and not tags_only:
        # refspecなしの `git push` は現在ブランチを送る。
        # ただし `--tags` だけの場合はタグrefのみを送るため対象外
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
    """`git clean -f` を拒否する（--dry-run 併用時は実際に削除しないので許可）。

    `-e <pattern>` / `--exclude <pattern>` の「値」は走査対象から外す。
    値として現れた `-n` をdry-runと誤認すると、実際には削除されるコマンドを
    許可してしまう（例: `git clean -f -e -n`）。
    """
    dry_run = False
    forced = False
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            break
        if _is_long_option(token, "--exclude"):
            if "=" not in token:
                index += 1
            index += 1
            continue
        if re.fullmatch(r"-[A-Za-z]*e", token):
            # 短オプションの束ね（-fe など）。値は次のトークンにある
            if "f" in token[1:]:
                forced = True
            if "n" in token[1:]:
                dry_run = True
            index += 2
            continue
        if _is_long_option(token, "--dry-run") or re.fullmatch(r"-[A-Za-z]*n[A-Za-z]*", token):
            dry_run = True
        if _is_long_option(token, "--force") or re.fullmatch(r"-[A-Za-z]*f[A-Za-z]*", token):
            forced = True
        index += 1

    if dry_run:
        return None
    if forced:
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
    subcommand: str,
    args: list[str],
    cwd: str,
    aliases: dict[str, str],
    depth: int,
    risky_push_config: bool = False,
) -> str | None:
    """gitサブコマンドを判定する。未知のサブコマンドはaliasとして展開を試みる。"""
    if subcommand == "push":
        if risky_push_config:
            return (
                "`-c push.default` / `-c remote.*.push` / `-c remote.*.mirror` を伴うpushは、"
                "refspecを書かずに保護ブランチを更新できるため禁止されています"
            )
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
    rest, chdir, inline_aliases, alias_risky_config = _strip_git_globals(expanded)
    if not rest:
        return None
    merged = dict(aliases)
    merged.update(inline_aliases)
    target_cwd = _resolve_cwd(cwd, chdir)
    return _dispatch(
        rest[0],
        rest[1:] + args,
        target_cwd,
        merged,
        depth + 1,
        risky_push_config or alias_risky_config,
    )


def _resolve_cwd(cwd: str, chdir: str | None) -> str:
    if not chdir:
        return cwd
    return chdir if os.path.isabs(chdir) else os.path.join(cwd, chdir)


def _check_git_invocation(tokens: list[str], cwd: str, depth: int) -> str | None:
    rest, chdir, aliases, risky_push_config = _strip_git_globals(tokens)
    if not rest:
        return None
    return _dispatch(
        rest[0], rest[1:], _resolve_cwd(cwd, chdir), aliases, depth, risky_push_config
    )


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
    segments = split_segments(command)
    if segments is None:
        # 解析できないコマンドは、既知の危険パターンだけを安全側で拒否する。
        for pattern, reason in _FALLBACK_PATTERNS:
            if pattern.search(command):
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
