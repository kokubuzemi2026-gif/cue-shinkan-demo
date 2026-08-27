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
- `app/supabase/tests/33_*.sql`（32はTask 014が使用済み）
- `app/src/legal/`（表示画面）、同意取得の導線
- `docs/decisions.md`、`docs/launch_plan.md`
- `tasks/015-privacy-and-consent.md`

## Out of scope

- 法的な最終承認（人間の判断。`docs/launch_plan.md` §7 H4）
- 実際の事業者情報・連絡先の確定（プレースホルダーとして明示する）

## Acceptance criteria

- [x] 利用目的が書かれている
- [x] 団体へ見える情報・見えない情報が具体的に書かれている（実装と一致している）
- [x] メール通知の内容と止め方が書かれている
- [x] 保存期間が書かれている
- [x] 削除方法が書かれている
- [x] 問い合わせ先が書かれている（未確定ならプレースホルダーであることを明示する）
- [x] 利用規約のdraftがある
- [x] プライバシーポリシーのdraftがある
- [x] **要確認箇所（法的判断が必要な部分）が文書内で明示されている**
- [x] 同意バージョンが記録され、バージョンが上がったら再同意を求められる
- [x] 同意前にパスポートを登録できない
- [x] 文書の記述と実装が食い違っていないことを確認した対応表がある
- [x] pgTAP / lint / test / build がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| 同意バージョンの記録と再同意 | pgTAP | `supabase/tests/33_consent_test.sql` |
| 同意前の書込拒否 | pgTAP | 同上 |
| 文書と実装の対応 | 手動レビュー（対応表をタスクファイルへ残す） | 本ファイル |

## Rollback

- 本PRのrevert。同意記録テーブルのdrop。

## 文書と実装の対応表

ドラフトの記述が、実際のコード・スキーマと食い違っていないことを確認した。

| ドラフトの記述 | 実装の裏付け |
|---|---|
| 大学メールは認証にのみ使い、団体に見えない | `is_university_user()`（`auth.users.email`のみ保持）・団体向けRPCにメール列なし（D029・`08_pii_surface_test.sql`・`16_org_funnel_pii_test.sql`） |
| 収集しない項目（氏名・顔写真・学籍番号・性別・国籍…） | `student_passports`にそれらの列が存在しない（`10_last_owner_test.sql`ほかのPII検査） |
| 団体に見えるのは人数の区分だけ | `preview_offer_audience`が区分のみ返す（D036・`18_preview_band_test.sql`） |
| 5人未満へは配信できない | `send_offer`が`insufficient_audience`（D036・`17_min_audience_test.sql`） |
| ファネルは10人未満非開示・5人単位丸め | `list_org_campaigns`（D037・`21_funnel_suppression_test.sql`） |
| 「行ってみたい」の後だけ公式窓口が見える | `list_my_inbox`（D033・`15_inbox_isolation_test.sql`） |
| メールに希望条件・団体名・返答を載せない | `email_outbox`に本文・宛先列なし（D041・`25_notification_privacy_test.sql`） |
| 通知はいつでも止められる | `save_notification_settings`（D040・`26_notification_control_test.sql`） |
| 興味パスポート・アカウントを自分で削除できる | `delete_student_passport`・`delete_my_account`（D046・`30`・`31`） |
| 削除したパスポートの案内は受信箱に残る | D023（`30_passport_delete_test.sql`） |
| 大学メールでのログイン情報は運営が別途削除する | `admin_delete_auth_identity`（D047・`docs/operations.md` §9） |
| 唯一の代表者は団体から脱退できない | `protect_last_owner`（D048・`32_membership_leave_test.sql`） |
| 削除の記録は個人を特定できない日次集計 | `deletion_audit_log`（D046・`31`） |
| 同意前は登録できない・版更新で再同意 | `save_student_passport`/`create_organization`の`consent_required`・`my_consent`（D050・`33_consent_test.sql`） |
| 団体担当者も規約に拘束される（§3・§5） | 担当者になる経路と団体側の書込・プレビュー計8 RPCが`consent_required`（D050・`33_consent_test.sql` T2） |
| 断る・止める・消す操作は妨げられない | `respond_to_offer`・`save_notification_settings`・`delete_student_passport`・`leave_organization`は同意ゲート対象外（D050・`33` T2） |

## Verification record

実装日: 2026-08-27 / ブランチ: `feat/015-privacy-consent`

### 設計の要点

- 同意は単調増加の整数版1本で管理し、規約とポリシーを画面で同時に提示してまとめて
  再同意させる。「同意前は登録できない」を画面の出し分けだけに頼らず、
  `save_student_passport`・`create_organization`のRPC内で構造的に止める
- 利用規約は新入生と団体担当者の両方に及ぶため、パスポート保存と団体作成の両方を
  同意必須にした（AC「同意前にパスポートを登録できない」の honest な拡張。報告に明記）。
  独立レビューの指摘を受けて、**担当者になる経路と団体側の書込・プレビュー計8 RPC**へ広げた
  （下記「独立レビューの結論と対応」）
- アカウント削除で同意記録も消す。`student_consents`は`auth.users`を参照するため
  `student_accounts`のcascadeでは落ちず、`delete_my_account`の全テーブル走査が
  これを検出した（走査型テストが意図どおり機能した実例）→ 明示的に削除する

### 実行した検証

| 検証 | 結果 |
|---|---|
| pgTAP | 33ファイル **591テスト PASS**（Task 014時点の555から+36） |
| 並行テスト | 10件 PASS |
| oxlint / tsc / vitest / vite build | すべてgreen（ユニット362テスト。同意画面の要点4件を追加） |
| E2E typecheck | green（既存6specのログイン後に同意通過を追加。実行はCI） |

### mutation test

| 壊した箇所 | 落ちたテスト |
|---|---|
| `save_student_passport`の同意ゲートを削除 | 33: 2件 |
| `record_consent`の版一致チェックを削除 | 33: 3件 |
| `send_offer`の同意ゲートを削除 | 33: 2件（うち1件はゲート一覧の固定テスト） |
| `accept_invitation`の同意ゲートを削除 | 33: 3件 |
| `has_current_consent`が常にtrueを返す | 33: **10件** |

### CIで見つけて直したもの

- e2e 6specが「登録後の画面が出ない」で失敗。**実装の配置ミスだった**:
  同意ゲートを `AuthenticatedShell` へ置いていたが、`利用方法を選ぶ`（RoleOnboarding）と
  最初の団体作成は **`AppRoot` が権限判定の前にレンダリングする**ため、
  新規利用者は「役割を選んで登録 → その後に同意画面」という順序になっていた。
  受入条件「同意前にパスポートを登録できない」を画面側で満たしていない
  （DB側のゲートは効いていたので、団体作成は `consent_required` で失敗していた）
  → 同意ゲートを `AppRoot` の権限分岐より前へ移動した。招待の承諾よりも前に出る

### 独立レビューの結論と対応

**reviewer / security-reviewer の指摘を自分で再現したうえで修正した。**
両者が独立に同じ一貫性ギャップ（NB-2 / Medium-1）を指摘した。

| 指摘 | 深刻度 | 再現内容 | 対応 |
|---|---|---|---|
| Medium-1 / NB-2（団体側が同意ゲートの外） | Medium | 未同意の利用者が招待を`accept_invitation`で承諾し、`update_organization_profile`で団体名を、`update_organization_contact`で公式窓口を書き換え、`create_invitation`で新しい招待まで発行できることを、ローカルDBで実際に成功させた。画面は同意を最前段に置いているが、authenticatedはPostgREST経由でRPCを直接呼べるためUIの順序は防御にならない。版更新時の再同意も、団体側は一切かからなかった | 同意ゲートを**8 RPC**へ広げた（担当者になる経路＋団体側の書込・プレビュー）。本文はカタログ定義（`pg_get_functiondef`）から生成し、差分をガード4行だけに限定した。ゲート対象の一覧を`set_eq`で固定（増減どちらでも落ちる）。D050を更新 |
| Low-1（権限固定テストの穴） | Low | `private`の同意2関数について、PUBLIC・anonのEXECUTE不在は検査していたが**authenticated不在を検査していない**。本番Supabaseは`ALTER DEFAULT PRIVILEGES`で新規関数へauthenticatedを付けうる | 33へauthenticated不在の検査を追加 |
| NB-1（E2E未コミット） | Non-blocker | 指摘時点でE2E修正が未コミット | コミット済み（`c24f2b0`）。CIで確認 |

**ゲートしない側を意図的に決めた**（D050）。断る・止める・消す操作
（`respond_to_offer`・`mark_offer_read`・`save_notification_settings`・
`delete_student_passport`・`leave_organization`・`delete_my_account`・`revoke_invitation`）は、
版が上がっても同意を条件にしない。同意を人質にして「見送る」「受信を止める」を
妨げることは、CUEの約束そのものを壊すため。33のT2でこれを**明示的に検査**している。

なお受信の**一時停止**は`save_student_passport`経由のため、版更新後は再同意しないと
変更できない。ただし`delete_student_passport`（完全停止）は常に開いているので、
止める手段は失われない（D050に記録）。

### 残る課題

- **法令適合は未確認**（ドラフト。`【要確認】`で明示）。運営者の最終確認が必要（H4）
- **事業者情報・連絡先・準拠法・委託先はプレースホルダー**（公開判断時に確定）
- 保存期間の上限（無操作・卒業後）、監査・ログの保持期間は未定（Task 017）
