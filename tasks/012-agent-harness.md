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
| guard_git の拒否判定（短縮形・ラッパー・シェル・alias・NUL・ヒアドキュメント回避・危険な `-c` 設定を含む） | 模擬コマンド82件で `evaluate()` を実行 | `.claude/hooks/test_hooks.py` |
| guard_git の誤検知 | 通常の開発コマンド39件で許可されることを検証 | 同上 |
| guard_git の拒否理由 | 代表14件で、どの規則により拒否したかを検証 | 同上 |
| guard_git の現在ブランチ依存判定 | 一時gitリポジトリ（main / feature）で8件を検証 | 同上 |
| guard_git のヒアドキュメント誤検知 | 本文にコマンド例を含むPR作成コマンドが許可されること | 同上 |
| guard_git の判定時間 | 解析不能な巨大入力（約120KB）が2秒以内に判定されること | 同上 |
| guard_git の入出力契約とsecret非露出 | hookをsubprocessで起動し、stdout JSON・exit code・URL埋め込みトークンの非露出を検証 | 同上 |
| quality_gate のループ防止 | `stop_hook_active: true` で即終了することを検証 | 同上 |
| quality_gate の変更検出 | 一時gitリポジトリで app/ 変更あり・なしの分岐を検証 | 同上 |
| quality_gate の失敗報告とマスク | 失敗するnpm scriptを用意し、報告文とsecretマスクを検証 | 同上 |
| secretマスクの網羅 | 20形式（GitHub / Supabase / Resend / Anthropic / AWS / Slack / JWT / Bearer / URL埋め込み / 秘密鍵ほか）を `redact()` へ投入 | 同上 |
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
- subagentのfrontmatter: `claude plugin validate .claude/agents` → Validation passed（4件）
- hookテスト: `python3 .claude/hooks/test_hooks.py` → **193 checks passed**
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
| Non-blocker | fallback正規表現の判定時間が入力長に対して急激に増加し（レビュー時の実測で125KB入力が41秒。別の追試ではさらに遅く、増加の次数は特定していない）、hook timeout（30秒）超過でfail-openする経路があった | 量指定子を有界化し、入力長を20000文字で打ち切り。約120KBの入力が2秒以内に判定されることをテストで固定 |
| Non-blocker | NUL文字で引数を切り詰めると判定を回避できる | NUL以降のトークンを落としてから判定。テスト2件追加 |
| Non-blocker | 独立レビューの要否が `CLAUDE.md` / `AGENTS.md`（無条件）と本ハーネス（Standard以上）で矛盾 | 両方へ「Standard以上で必須、Fastは自己レビュー」を明記 |
| Non-blocker | `permissions.deny` に `.env.*.local` / 再帰パターン / `.git/config` の穴。文書にも未記載 | deny一覧を修正し、`docs/agent_harness.md` §6 とREADMEへ「Readツール限定でBash経由は防げない」を明記 |
| Non-blocker | subagentの「編集権限なし」は `Bash` があるため強制されていない | 表を「編集方針」に改め、規約であって強制ではない旨を明記 |
| Non-blocker | `quality_gate` の判定はセッション単位ではなくブランチ単位 | docstringと `docs/agent_harness.md` §6 を実装に合わせて修正 |
| Non-blocker | `prompts/002-execution-sequence.md` に承認待ち指示が残存 | Phase 1の記録である旨の注記を冒頭へ追加 |
| Nit | `git clean -f -n`（ドライラン）まで拒否していた | `--dry-run` / `-n` 併用時は許可。テスト3件追加 |
| Nit | ヒアドキュメント本文のコマンド例を誤検知（PR作成を塞ぐ） | 判定前にヒアドキュメント本文を除去。テスト1件追加 |
| 対応せず | `xargs` や変数展開など、実行時の値に依存する経路 | 原理的に検出できないため `docs/agent_harness.md` §6・§9 へ限界として明記 |

3本目として、5観点（判定漏れ・誤検知・quality_gate・設定と文書整合・スコープと記載の正確さ）で並列に探索し、各指摘を別エージェントが反証する敵対的レビューを実施した。33件の指摘のうち反証を通過したものを修正した。

| 重大度 | 指摘 | 対応 |
|---|---|---|
| Blocker | ヒアドキュメント除去が引用符・算術シフトを区別せず、終端語が無い場合に以降の全行を判定対象から捨てるため、`echo "<<EOF"` 1行でガードが丸ごと無効化された | トークン列上の `<<` 演算子だけをヒアドキュメントと認識し、終端語が実在する場合のみ本文を読み飛ばす方式へ変更 |
| Blocker | `git -c push.default=matching push origin` / `-c remote.*.push` / `-c remote.*.mirror` は、refspecを書かずに保護ブランチを更新できるため素通りしていた（実gitで再現確認） | 該当する設定キーを伴うpushを拒否 |
| Blocker | `git clean -f -e -n` の `-n` は `-e`（--exclude）の値であり実際には削除されるのに、dry-runと誤認して許可していた | オプションの値を走査対象から除外 |
| Non-blocker | 引用符が改行をまたぐ引数（複数行のcommit message）が必ず解析失敗し、本文の文字列だけで誤って拒否されていた | 解析に失敗した行は次行以降を連結して解析し直す方式へ変更 |
| Non-blocker | lint/test/buildが不正なUTF-8バイトを出力すると `UnicodeDecodeError` でhookがクラッシュした | `errors="replace"` で読む |
| Non-blocker | タイムアウト時にnpmの孫プロセスが孤児として残り、途中までの出力も捨てられて診断情報がゼロだった | プロセスグループごと停止し、途中出力をマスクして返す |
| Non-blocker | Stop hookの発火タイミングの記述が公式仕様と食い違っていた（「セッション終了時」「1セッション1回」） | 「応答を終えるたび」「1回の継続につき1回」へ修正 |
| Blocker（記載） | Test plan表のテスト件数が実物と不一致だった | 実数（拒否82件・許可39件・理由14件・secret 20形式）へ修正 |
| Non-blocker（記載） | 「O(n²)・41秒」という計算量の断定が追試で再現しなかった | 実測値の引用と「次数は特定していない」旨へ修正 |
| Nit | D032に `permissions.deny` の記載漏れ／完了報告テンプレートに独立レビュー欄がない／Best-of-Nの適用条件が不一致／`$CLAUDE_PROJECT_DIR` の波括弧なし形式 | すべて修正 |
| 棄却 | 13件（既知の限界として明記済み・実出力では到達しない経路・修正が回帰を生むもの） | 反証結果を根拠に対応せず |

### 実装中に判明した制約（記録）

- GitHubのpush protectionは、テスト用のダミートークンでも実トークン形式に一致すると
  pushを拒否する（本タスクではSupabase PAT形式とSlack token形式が該当）。
  unblock URLでの許可は使わず、`test_hooks.py` のダミートークンは文字列連結で組み立て、
  ファイル内に完全な形の文字列を置かない方針とした。今後secretのマスクを検証するテストを
  追加するときも同じ方針にすること。

- 残るリスク: `docs/agent_harness.md` §9「既知の限界」に記載
