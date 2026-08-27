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

- [ ] structured loggingの方針が決まっている（何を出す・何を出さない）
- [ ] 監査ログにPIIが含まれない（テストで確認する）
- [ ] health checkがある（DB・認証・メール送信の生存確認）
- [ ] メール送信失敗を確認する手順がある
- [ ] quota異常（想定外の消費・詰まり）を確認する手順がある
- [ ] migration適用手順がある
- [ ] rollback手順がある（drop→createで置き換えた関数の注意を含む）
- [ ] backup / restore手順がある
- [ ] incident response手順がある（誰が何を止めるか。kill switchへの導線）
- [ ] production / staging の環境変数一覧がある（値は書かない）
- [ ] secret rotation手順がある
- [ ] dependency / security check がCIで回る
- [ ] 既知リスク一覧がある
- [ ] 公開停止手順がある
- [ ] pgTAP / lint / test / build / CI がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 監査ログのPII非混入 | pgTAP | `supabase/tests/34_ops_health_test.sql` |
| health check | pgTAP | 同上 |
| runbookの手順 | 手動（stagingで実行して結果を記録） | 本ファイル |

## Rollback

- 本PRのrevert。文書と運用ビューのみで、アプリの動作に影響しない。

## Verification record

実装後に記入する。
