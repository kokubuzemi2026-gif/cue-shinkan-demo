# Task 013: 団体確認・不正利用対策・kill switch

## Goal（目的）

運営者が、団体を確認（verified化）し、問題があれば停止でき、
誤配信・不正利用が起きたときに配信を止められる状態にする。
団体側から権限を越えた操作ができないことを、テストで保証する。

## Source of truth（正本）

- `docs/decisions.md`: D026（権限分離）、D029（PIIサーフェス）、D030（残余リスクはTask 011/013へ）、D036〜D039
- `docs/auth_and_authorization.md`: §4（権限モデル）、§7（RLS・grant方針）
- `docs/matching_and_safety.md`: §7（偽団体・危険な勧誘）、§9（受入条件）
- `docs/launch_plan.md`: §2.3（運営者の完成像）

## In scope

- `app/supabase/migrations/2026*_0013_*.sql`
- `app/supabase/tests/26_*.sql`〜`28_*.sql`
- `app/src/org/`（停止状態の表示）
- `docs/operations.md`（新規・運営操作の正本）、`docs/decisions.md`、`docs/launch_plan.md`
- `tasks/013-org-verification-and-killswitch.md`

## Out of scope

- 運営者向けの管理画面UI（本タスクでは安全なadmin経路とSQL手順まで。UIはスコープ外）
- メール通知（Task 010）、アカウント削除（Task 014）

## Acceptance criteria

- [ ] 団体状態が `pending` / `verified` / `suspended` の3値で管理されている
- [ ] `verified` 以外の団体はオファーを配信できない（既存の`org_not_verified`を維持）
- [ ] 状態変更は service role または安全なadmin経路だけが行える。クライアント経路が存在しない
- [ ] 団体を `suspended` にすると、その団体の新規配信が止まる
- [ ] 個別のofferを停止でき、停止後は学生の受信箱に「募集終了」等が反映される
- [ ] 全団体の配信を止める緊急停止（kill switch）があり、1操作で有効化・解除できる
- [ ] kill switch有効中は `send_offer` が明確な理由で拒否される
- [ ] 他団体への越権操作（状態変更・offer停止）ができないことのnegative testがある
- [ ] admin権限をクライアント側の判定だけに依存させていない
- [ ] 認証・配信・通知・権限変更の必要最小限の監査記録が残る（PIIを含まない）
- [ ] 監査記録に学生の希望条件・メール・氏名が含まれない
- [ ] pgTAP / lint / test / build がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 状態遷移と配信可否 | pgTAP | `supabase/tests/26_org_status_test.sql` |
| kill switch | pgTAP | `supabase/tests/27_kill_switch_test.sql` |
| 越権操作の拒否・監査記録のPII | pgTAP | `supabase/tests/28_admin_boundary_test.sql` |

## Rollback

- 本PRのrevert + 追加オブジェクトのdrop。既存の配信データは変更しない。

## Verification record

実装後に記入する。
