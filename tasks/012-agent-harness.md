# Task 012: 自律開発ハーネスの導入

## Goal（目的）

短い指示（例:「Task 010やって」）で、AIエージェントが調査 → 設計 → 実装 → テスト → 独立レビュー → 修正 → PR → CI追跡まで自走できる状態にする。人間の確認を、本当に人間の判断が必要な場面へ限定し、逐次承認が実装の律速になっている状態を解消する。

プロダクトの機能は変更しない。`app/` は一切触らない。

## Source of truth（正本）

- `docs/decisions.md`: D026〜D031（Phase 2の前提）、本タスクでD032を追加
- `CLAUDE.md` / `AGENTS.md`: 既存の作業規則（プロダクト仕様・技術制約・安全要件は保持する）
- Claude Code公式ドキュメント: settings / hooks / subagents の現行構文
  - hookの `timeout` は秒（ミリ秒ではない）
  - PreToolUseの拒否は exit 0 + `hookSpecificOutput.permissionDecision = "deny"`
  - Stopのブロックは exit 2（stderrがエージェントへ渡る）
  - subagentは `.claude/agents/*.md`、frontmatterは `name` / `description` 必須

## In scope（変更してよい範囲）

- `CLAUDE.md`、`AGENTS.md`、`README.md`、`.gitignore`
- `docs/agent_harness.md`（新規）、`docs/decisions.md`（D032の追記）
- `tasks/_template.md`（新規）、`tasks/012-agent-harness.md`（新規）
- `prompts/autonomous_task.md`（新規）、`prompts/task_prompt_template.md`
- `prompts/002-execution-sequence.md`（Phase 1の記録である旨の注記のみ。手順本体は変更しない）
- `.claude/settings.json`、`.claude/agents/**`、`.claude/hooks/**`（すべて新規）

## Out of scope（変更してはいけない範囲）

- `app/**`（アプリ実装・テスト・依存関係）
- `.github/workflows/**`（CIの構成は変更しない）
- `tasks/000-*.md`〜`tasks/009-*.md`、`docs/` の既存文書（D032の追記を除く）
- Task 009のPR（PR #9）とそのブランチ、staging環境の状態
- `main` / `develop` への直接push、自動マージ

## Acceptance criteria（受入条件）

- [x] `CLAUDE.md` が自律実行型になっている（承認待ちで停止しない／停止条件が明示されている）。
      プロダクトの目的・技術構成・UI要件・禁止事項は保持されている
- [x] `AGENTS.md` に Human escalation policy・Definition of Done・独立レビューが定義されている
- [x] `docs/agent_harness.md` に Fast / Standard / Deep、Plan→Implement→Verify→Review→Repair、
      Best-of-N、ハーネス改善ルールが定義されている
- [x] `tasks/_template.md` が Goal / Source of truth / In scope / Out of scope /
      Acceptance criteria / Test plan / Rollback / Verification record を持つ
- [x] `.claude/agents/` に architect / test-engineer / reviewer / security-reviewer がある。
      レビュー系は編集権限を持たない
- [x] `.claude/hooks/guard_git.py` が、保護ブランチ（main / develop）への直接push・force push・
      `git reset --hard`・`git clean -f`・`git branch -D` を拒否し、通常のgit操作を拒否しない
- [x] guard_gitが、長オプションの短縮形（`--har`）・ラッパーコマンド（`env` / `sudo` / `nohup` /
      `timeout` など）・`bash -c` / `eval`・シェル制御構文・git alias・NUL文字による回避を検出する
- [x] guard_gitの判定時間が入力長に対して有界で、hookのtimeoutによるfail-openを起こさない
- [x] `.claude/hooks/quality_gate.py` が、`app/` に変更があるセッションでだけ
      lint → unit test → build を実行し、失敗時にStopをブロックする。
      `stop_hook_active` が true のときは即座に終了する
- [x] hookが入力JSONを安全に解釈し、tool inputをshellへ展開しない。secretを出力しない
      （guard_gitは拒否理由にコマンド全文を含めない。quality_gateは既知形式のsecretをマスクし、
      マスクの網羅を断定しない文言にする）
- [x] `.claude/settings.json` が有効なJSONで、`.env`系のReadを拒否し、`app/.env.example` は読める
- [x] `prompts/autonomous_task.md` と `prompts/task_prompt_template.md` が自律実行用になっている
- [x] `app/` を変更していない。`npm run lint` / `npm run test -- --run` / `npm run build` がgreen

## Test plan（テスト計画）

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| guard_git の拒否判定（短縮形・ラッパー・シェル・alias・NULを含む） | 模擬コマンド73件で `evaluate()` を実行 | `.claude/hooks/test_hooks.py` |
| guard_git の誤検知 | 通常の開発コマンド38件で許可されることを検証 | 同上 |
| guard_git の現在ブランチ依存判定 | 一時gitリポジトリ（main / feature）で8件を検証 | 同上 |
| guard_git のヒアドキュメント誤検知 | 本文にコマンド例を含むPR作成コマンドが許可されること | 同上 |
| guard_git の判定時間 | 解析不能な巨大入力（約120KB）が2秒以内に判定されること | 同上 |
| guard_git の入出力契約とsecret非露出 | hookをsubprocessで起動し、stdout JSON・exit code・URL埋め込みトークンの非露出を検証 | 同上 |
| quality_gate のループ防止 | `stop_hook_active: true` で即終了することを検証 | 同上 |
| quality_gate の変更検出 | 一時gitリポジトリで app/ 変更あり・なしの分岐を検証 | 同上 |
| quality_gate の失敗報告とマスク | 失敗するnpm scriptを用意し、報告文とsecretマスクを検証 | 同上 |
| secretマスクの網羅 | 21形式（GitHub / Supabase / Resend / Anthropic / AWS / Slack / JWT / Bearer / URL埋め込み / 秘密鍵ほか）を `redact()` へ投入 | 同上 |
| Python構文 | `python3 -m py_compile` | 手動 |
| settings.json | `json.load` によるparse | 手動 |
| 既存アプリへの無影響 | `npm run lint` / `npm run test -- --run` / `npm run build` | 手動 |

## Rollback（切り戻し）

- 本PRのrevert commitだけで元へ戻せる。生成物・保存データ・migrationを持たない。
- `.claude/` を削除すればhookとsubagentは無効になる。アプリの動作には影響しない。
- hookが誤検知して作業を妨げる場合は、`.claude/settings.json` の該当hookを一時的に外し、
  `docs/agent_harness.md` §8 に従って原因をテスト付きで修正する。

## Verification record（検証記録）

- 実行モード: Standard（`app/` を変更せず、認証・DB・PIIに触れないためDeep条件に非該当）
- ブランチ: `feat/012-agent-harness`（`develop` の最新 `b28d0ba` から作成）
- Python構文チェック: `python3 -m py_compile .claude/hooks/{guard_git,quality_gate,test_hooks}.py` → OK
- settings.jsonのparse: OK（deny 10件 / PreToolUse matcher `Bash` / Stopはmatcherなし / timeout 30秒・1500秒）
- hookテスト: `python3 .claude/hooks/test_hooks.py` → **162 checks passed**
- Stop hookの実挙動（本リポジトリ）:
  - `app/` 変更なし → exit 0（ゲート未実行）
  - `app/` に未追跡ファイルあり → lint / test / build を実行し7秒でexit 0
  - `app/node_modules` なし → exit 2（`npm ci` を案内）
- lint: `npm run lint` → green（指摘0件）
- unit test: `npm run test -- --run` → 21ファイル / **281件すべてpass**（既存と同数。減っていない）
- build: `npm run build` → 成功（`tsc -b && vite build`）
- `git diff --check`: 問題なし
- pgTAP / E2E: **未実施**（`app/` と `app/supabase/` を変更していないため対象外）
- 手動QA（390px）: **未実施**（UI変更なし）

### 独立レビューと対応

一般レビューとセキュリティレビューを独立に実施し、実証されたBlocker 4件をすべて修正した。

| 指摘 | 内容 | 対応 |
|---|---|---|
| Blocker | gitが長オプションの短縮形を受理するため `git reset --har` / `git clean --fo` / `git push --force-w` が素通り | `_is_long_option()` による前方一致判定へ変更。テスト10件追加 |
| Blocker | `env` / `sudo` / `bash -c` / `eval` / シェル制御構文 / `git -c alias.x=push x` 経由で素通り | セグメント内の全トークンを走査する方式へ変更。シェル `-c` と alias を再帰的に展開。テスト22件追加 |
| Blocker | `AGENTS.md` の節番号繰り下げにより、subagent 3ファイルの「§4」参照がプライバシー節ではなくエスカレーション節を指していた | 節番号参照をやめ、見出し名参照へ変更。security-reviewerの決定参照をD007・D026〜D032へ更新 |
| Blocker | `redact()` が `ghp_` / `github_pat_` / `sbp_` / `re_` / `Bearer` / `https://<token>@host` を素通しするのに「secretはマスク済み」と断定していた | パターンを11形式追加し、文言を「既知形式のみ。転記前に目視確認」へ変更。テスト21形式へ拡充 |
| Non-blocker | fallback正規表現が O(n²) で、125KB入力が41秒 → hook timeout（30秒）超過でfail-open | 量指定子を有界化し、入力長を20000文字で打ち切り。判定時間のテストを追加 |
| Non-blocker | NUL文字で引数を切り詰めると判定を回避できる | NUL以降のトークンを落としてから判定。テスト2件追加 |
| Non-blocker | 独立レビューの要否が `CLAUDE.md` / `AGENTS.md`（無条件）と本ハーネス（Standard以上）で矛盾 | 両方へ「Standard以上で必須、Fastは自己レビュー」を明記 |
| Non-blocker | `permissions.deny` に `.env.*.local` / 再帰パターン / `.git/config` の穴。文書にも未記載 | deny一覧を修正し、`docs/agent_harness.md` §6 とREADMEへ「Readツール限定でBash経由は防げない」を明記 |
| Non-blocker | subagentの「編集権限なし」は `Bash` があるため強制されていない | 表を「編集方針」に改め、規約であって強制ではない旨を明記 |
| Non-blocker | `quality_gate` の判定はセッション単位ではなくブランチ単位 | docstringと `docs/agent_harness.md` §6 を実装に合わせて修正 |
| Non-blocker | `prompts/002-execution-sequence.md` に承認待ち指示が残存 | Phase 1の記録である旨の注記を冒頭へ追加 |
| Nit | `git clean -f -n`（ドライラン）まで拒否していた | `--dry-run` / `-n` 併用時は許可。テスト3件追加 |
| Nit | ヒアドキュメント本文のコマンド例を誤検知（PR作成を塞ぐ） | 判定前にヒアドキュメント本文を除去。テスト1件追加 |
| 対応せず | `xargs` や変数展開など、実行時の値に依存する経路 | 原理的に検出できないため `docs/agent_harness.md` §6・§9 へ限界として明記 |

- 残るリスク: `docs/agent_harness.md` §9「既知の限界」に記載
