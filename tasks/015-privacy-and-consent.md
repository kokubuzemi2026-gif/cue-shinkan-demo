# Task 015: プライバシー・同意・利用規約（draft）

## Goal（目的）

新入生と団体担当者が、登録前に「何が誰に見えるか」「いつ消せるか」を理解できるようにする。
利用規約とプライバシーポリシーのdraftを用意し、同意のバージョンを記録する。

**法令適合を断定しない。運営者による最終確認が必要なdraftとして作る。**

## Source of truth（正本）

- `docs/decisions.md`: D007・D029・D036〜D039
- `docs/matching_and_safety.md`: §2（収集する/しない項目）、§7、§8
- `docs/product_spec.md`: §5（差別化: 許可制・匿名性・説明可能性・低圧）
- `docs/launch_plan.md`: §2.4

## In scope

- `docs/legal/terms_draft.md`（新規）、`docs/legal/privacy_draft.md`（新規）
- `app/supabase/migrations/2026*_0015_*.sql`（同意バージョンの記録）
- `app/supabase/tests/32_*.sql`
- `app/src/legal/`（表示画面）、同意取得の導線
- `docs/decisions.md`、`docs/launch_plan.md`
- `tasks/015-privacy-and-consent.md`

## Out of scope

- 法的な最終承認（人間の判断。`docs/launch_plan.md` §7 H4）
- 実際の事業者情報・連絡先の確定（プレースホルダーとして明示する）

## Acceptance criteria

- [ ] 利用目的が書かれている
- [ ] 団体へ見える情報・見えない情報が具体的に書かれている（実装と一致している）
- [ ] メール通知の内容と止め方が書かれている
- [ ] 保存期間が書かれている
- [ ] 削除方法が書かれている
- [ ] 問い合わせ先が書かれている（未確定ならプレースホルダーであることを明示する）
- [ ] 利用規約のdraftがある
- [ ] プライバシーポリシーのdraftがある
- [ ] **要確認箇所（法的判断が必要な部分）が文書内で明示されている**
- [ ] 同意バージョンが記録され、バージョンが上がったら再同意を求められる
- [ ] 同意前にパスポートを登録できない
- [ ] 文書の記述と実装が食い違っていないことを確認した対応表がある
- [ ] pgTAP / lint / test / build がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 同意バージョンの記録と再同意 | pgTAP | `supabase/tests/32_consent_test.sql` |
| 同意前の書込拒否 | pgTAP | 同上 |
| 文書と実装の対応 | 手動レビュー（対応表をタスクファイルへ残す） | 本ファイル |

## Rollback

- 本PRのrevert。同意記録テーブルのdrop。

## Verification record

実装後に記入する。
