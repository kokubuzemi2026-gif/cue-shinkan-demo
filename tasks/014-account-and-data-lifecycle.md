# Task 014: アカウント・データライフサイクル

## Goal（目的）

新入生と団体担当者が、自分のデータを自分で消せるようにする。
削除したあとに、復元可能な個人情報や孤児データが残らないことをテストで保証する。

## Source of truth（正本）

- `docs/decisions.md`: D026（権限分離）、D029（PIIサーフェス）、D032〜D034
- `docs/auth_and_authorization.md`: §4（所属行を作る経路は2つだけ・メンバー管理は未実装）
- `docs/server_data_model.md`: §2（テーブルとFK）、§10
- `docs/launch_plan.md`: §2.1・§2.2

## In scope

- `app/supabase/migrations/2026*_0014_*.sql`
- `app/supabase/tests/29_*.sql`〜`31_*.sql`
- `app/src/account/`・`app/src/student/`・`app/src/org/`（削除・脱退の導線）
- `app/e2e/task014-lifecycle.spec.ts`
- `docs/decisions.md`、`docs/server_data_model.md`、`docs/launch_plan.md`
- `tasks/014-account-and-data-lifecycle.md`

## Out of scope

- 団体そのものの削除（最終ownerガードとの整合を別途設計する必要があるため。理由を記録して次タスクへ）
- 法的文書（Task 015）

## Acceptance criteria

- [ ] ログアウトできる（既存機能の維持を確認する）
- [ ] 通知設定を変更できる（Task 010の導線を確認する）
- [ ] 興味パスポートを削除できる。削除後は新規配信の対象にならない
- [ ] パスポート削除で、受信済みオファーの履歴（snapshot）がどうなるかが決まっており、画面で説明されている
- [ ] アカウントを削除または無効化できる
- [ ] 団体から脱退できる。最後のownerは脱退できない（既存ガードと整合する）
- [ ] 削除後に、復元可能な個人情報が`public`・`private`スキーマに残っていないことをテストで確認する
- [ ] 孤児データ（親を失った受信者行・既読・返答・quota・outbox）が残らない
- [ ] 削除操作の必要最小限の監査記録が残る（誰の何を消したかをPIIなしで）
- [ ] 削除は取り消せないことが操作前に明示される
- [ ] pgTAP / lint / test / build / E2E がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| パスポート削除と配信対象からの除外 | pgTAP | `supabase/tests/29_passport_delete_test.sql` |
| アカウント削除後の残存データ検査（全テーブル走査） | pgTAP | `supabase/tests/30_account_delete_test.sql` |
| 脱退と最終ownerガード | pgTAP | `supabase/tests/31_membership_leave_test.sql` |
| 画面導線 | E2E | `e2e/task014-lifecycle.spec.ts` |

## Rollback

- 本PRのrevert。**削除は不可逆**のため、実データ投入後の切り戻しはデータを戻さない。

## Verification record

実装後に記入する。
