# Task 017: 運用・可観測性

## Goal（目的）

運営者が、障害・メール送信失敗・quota異常に気づき、復旧できる状態にする。
バックアップ・復旧・ロールバック・インシデント対応の手順を文書化する。

**外部の有料監視サービスや有料プランは、承認なしに追加しない。**

## Source of truth（正本）

- `docs/runbook_supabase_hosted.md`
- `docs/decisions.md`: D027（secretを持ち込まない）、D037（quota）
- `docs/auth_and_authorization.md`: §9
- `docs/launch_plan.md`: §2.3

## In scope

- `docs/runbook_operations.md`（新規）、`docs/runbook_incident.md`（新規）
- `docs/runbook_supabase_hosted.md`（追記）
- `app/supabase/migrations/2026*_0017_*.sql`（health check・運用ビュー）
- `app/supabase/tests/34_*.sql`（33はTask 015が使用済み）
- `.github/workflows/`（dependency/security checkの追加。無料の範囲で）
- `docs/launch_plan.md`、`tasks/017-operations-and-observability.md`

## Out of scope

- 有料の監視・APM・ログ集約サービスの導入
- production環境の作成（Task 018の判断）

## Acceptance criteria

- [x] structured loggingの方針が決まっている（何を出す・何を出さない）
- [x] 監査ログにPIIが含まれない（テストで確認する）
- [x] health checkがある（DB・認証・メール送信の生存確認）
- [x] メール送信失敗を確認する手順がある
- [x] quota異常（想定外の消費・詰まり）を確認する手順がある
- [x] migration適用手順がある
- [x] rollback手順がある（drop→createで置き換えた関数の注意を含む）
- [x] backup / restore手順がある
- [x] incident response手順がある（誰が何を止めるか。kill switchへの導線）
- [x] production / staging の環境変数一覧がある（値は書かない）
- [x] secret rotation手順がある
- [x] dependency / security check がCIで回る
- [x] 既知リスク一覧がある
- [x] 公開停止手順がある
- [x] pgTAP / lint / test / build / CI がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 監査ログのPII非混入 | pgTAP | `supabase/tests/34_ops_health_test.sql` |
| health check | pgTAP | 同上 |
| runbookの手順 | 手動（stagingで実行して結果を記録） | 本ファイル |

## Rollback

- 本PRのrevert。文書と運用ビューのみで、アプリの動作に影響しない。

## Verification record

実装日: 2026-08-27 / ブランチ: `feat/017-operations`

### 番号の衝突（着手時に直したもの）

本ファイルのIn scopeとTest planが `app/supabase/tests/33_*.sql` を指していたが、
**33はTask 015が使用済み**だったため `34_ops_health_test.sql` へ直した。
migrationの連番は0016を飛ばして**0017**にする（Task 016はmigrationを持たない。
連番とタスク番号を一致させたほうが追跡しやすい）。decisionは**D052**
（D051は `fix/e2e-artifact-secrets-and-typecheck` が使用）。

### 作ったもの

| 対象 | 内容 |
|---|---|
| `20260827220000_0017_operations.sql` | `public.platform_health()`（service_role専用）・`private.prune_audit_logs(days)`・`private.prune_preview_cache(hours)` |
| `34_ops_health_test.sql` | 16テスト（権限固定・返す列の固定・監査ログの列の固定・保持期間の境界・実際の状態の反映） |
| `docs/runbook_operations.md`（新規・227行） | 環境と役割 / 環境変数（値は書かない）/ migration適用 / rollback / backup・restore / secret rotation / 公開停止 / 定期作業 / **ログの方針** |
| `docs/runbook_incident.md`（新規・132行） | 最初の3つ / health check の読み方 / メールが届かない / quota異常 / 差分攻撃の疑い / 監査の確認 / 状況別の初手 / 事後 |
| `docs/runbook_supabase_hosted.md` §6.3 | Task 014・015・017 のPhase B人間タスク（同意ゲート・削除・auth identity・health check） |
| `docs/launch_plan.md` §7 | **H6〜H10を追加**（公開用Supabaseプロジェクト・Actions variables・Auth Site URL・Edge Functionデプロイ・auth.users削除の確認） |
| `docs/launch_plan.md` §7.1 | **既知リスク一覧25件**（法務4 / プライバシー・セキュリティ6 / a11y・UX4 / 機能の穴6 / 運用4、A1〜E4） |
| `.github/workflows/ci.yml` | `audit` ジョブ（`npm audit --audit-level=high` で落とし、moderate以下は警告） |

### 設計の要点

- **健全性の確認を1本のRPCへ集約した。** 外部の有料監視を使わない方針の下では、
  「1本のSQLを毎日見る」が現実的な最小構成になる。返すのは件数と時刻だけ（D029）
- **剪定関数はservice_roleからも呼べない。** 監査は消しにくいほうがよい。
  誤操作で消えると運営操作の追跡ができなくなる。DashboardのSQL Editorのみで実行する
- **保持期間の下限を関数内で強制する**（監査30日未満・preview 24時間未満は拒否）。
  「0日で全部消す」を事故で実行できないようにするため
- `quota_over_limit` は**設計上0**。1以上は枠確保（`FOR UPDATE`）が壊れている合図として使う
- **ログの方針は既に実装されていた**（送信ワーカーの `logSafe()`）。
  017では**明文化**し、「そのログを第三者が見たときに特定の学生を指せるか」という
  判断基準を書いた

### 実行した検証

| 検証 | 結果 |
|---|---|
| pgTAP | 34ファイル **607テスト PASS**（Task 016時点の591から+16） |
| 並行テスト | 10件 PASS |
| oxlint / tsc / vitest / vite build | すべてgreen（ユニット362テスト） |
| `npm audit --audit-level=high` | **found 0 vulnerabilities** |
| CI workflow のYAML構文 | `yaml.safe_load` でパースできることを確認（jobs: quality / db-tests / e2e / audit） |

### mutation test

| 壊した箇所 | 落ちたテスト |
|---|---|
| `platform_health` を authenticated へも grant | 34: 1件 |
| `prune_audit_logs` の保持期間の下限チェックを外す | 34: 2件 |
| `prune_audit_logs` が保持期間を無視して全部消す | 34: 2件 |
| `platform_health` が審査待ち団体を数えない | 34: 1件 |

### 残る課題

- **runbookの手順をstagingで実行していない**（H1・H9が未実施のため）。
  migration適用・backup・restore・secret rotation・公開停止の各手順は
  **文書としては用意したが、実行しての確認は未実施**
- `platform_health()` を**定期的に見る仕組みは無い**。人間が毎日見る運用に依存する
  （外部の有料監視サービスは承認なしに追加しない、というGoalの制約）
- 剪定（`prune_audit_logs`）は**自動実行しない**。年1回の手作業
- `npm audit` は**npmレジストリの既知脆弱性だけ**を見る。
  自分たちのコードの脆弱性は検出しない
