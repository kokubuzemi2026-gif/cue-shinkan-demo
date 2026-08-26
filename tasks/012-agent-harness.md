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
- [x] `.claude/hooks/quality_gate.py` が、`app/` に変更があるセッションでだけ
      lint → unit test → build を実行し、失敗時にStopをブロックする。
      `stop_hook_active` が true のときは即座に終了する
- [x] hookが入力JSONを安全に解釈し、tool inputをshellへ展開しない。secretを出力しない
- [x] `.claude/settings.json` が有効なJSONで、`.env`系のReadを拒否し、`app/.env.example` は読める
- [x] `prompts/autonomous_task.md` と `prompts/task_prompt_template.md` が自律実行用になっている
- [x] `app/` を変更していない。`npm run lint` / `npm run test -- --run` / `npm run build` がgreen

## Test plan（テスト計画）

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| guard_git の拒否・許可判定 | 模擬コマンドの単体検証（35件の拒否・23件の許可・現在ブランチ依存7件） | `.claude/hooks/test_hooks.py` |
| guard_git の入出力契約 | hookをsubprocessで起動し、stdout JSONとexit codeを検証 | 同上 |
| quality_gate のループ防止 | `stop_hook_active: true` で即終了することを検証 | 同上 |
| quality_gate の変更検出 | 一時gitリポジトリで app/ 変更あり・なしの分岐を検証 | 同上 |
| quality_gate の失敗報告とマスク | 失敗するnpm scriptを用意し、報告文とsecretマスクを検証 | 同上 |
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
- settings.jsonのparse: OK（deny 12件 / PreToolUse matcher `Bash` / Stopはmatcherなし / timeout 30秒・1500秒）
- hookテスト: `python3 .claude/hooks/test_hooks.py` → **93 checks passed**
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
- 独立レビュー: `reviewer` subagentによる独立レビューを実施し、指摘への対応を本PRへ反映
- 残るリスク: `docs/agent_harness.md` §9「既知の限界」に記載
