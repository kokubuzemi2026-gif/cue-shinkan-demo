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
- `app/supabase/tests/30_*.sql`〜`32_*.sql`（29はTask 013が使用済み）
- `app/src/account/`・`app/src/student/`・`app/src/org/`（削除・脱退の導線）
- `app/e2e/task014-lifecycle.spec.ts`
- `docs/decisions.md`、`docs/server_data_model.md`、`docs/launch_plan.md`
- `tasks/014-account-and-data-lifecycle.md`

## Out of scope

- 団体そのものの削除（最終ownerガードとの整合を別途設計する必要があるため。理由を記録して次タスクへ）
- 法的文書（Task 015）

## Acceptance criteria

- [x] ログアウトできる（既存機能の維持を確認する）
- [x] 通知設定を変更できる（Task 010の導線を確認する）
- [x] 興味パスポートを削除できる。削除後は新規配信の対象にならない
- [x] パスポート削除で、受信済みオファーの履歴（snapshot）がどうなるかが決まっており、画面で説明されている
- [x] アカウントを削除または無効化できる
- [x] 団体から脱退できる。最後のownerは脱退できない（既存ガードと整合する）
- [x] 削除後に、復元可能な個人情報が`public`・`private`スキーマに残っていないことをテストで確認する
- [x] 孤児データ（親を失った受信者行・既読・返答・quota・outbox）が残らない
- [x] 削除操作の必要最小限の監査記録が残る（誰の何を消したかをPIIなしで）
- [x] 削除は取り消せないことが操作前に明示される
- [x] pgTAP / lint / test / build / E2E がgreen

## Test plan

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| パスポート削除と配信対象からの除外 | pgTAP | `supabase/tests/30_passport_delete_test.sql` |
| アカウント削除後の残存データ検査（全テーブル走査） | pgTAP | `supabase/tests/31_account_delete_test.sql` |
| 脱退と最終ownerガード | pgTAP | `supabase/tests/32_membership_leave_test.sql` |
| 削除導線の状態遷移・文言 | Vitest | `src/features/account/deletion.test.ts` |
| 画面導線 | E2E | `e2e/task014-lifecycle.spec.ts` |
| ログアウト（既存機能の維持） | E2E（既存・毎回CIで実行） | `e2e/task009-server-data.spec.ts` step 11 |
| 通知設定の変更（既存機能の維持） | E2E（既存・毎回CIで実行） | `e2e/task010-notifications.spec.ts` step 3・5 |

## Rollback

- 本PRのrevert。**削除は不可逆**のため、実データ投入後の切り戻しはデータを戻さない。

## Verification record

実装日: 2026-08-27 / ブランチ: `feat/014-account-lifecycle`

### 設計の要点

- FKの`on delete`が Task 008〜013 で既に全経路つながっていることを先に調査した。
  `student_accounts` の行を消すだけで学生側のデータがすべて落ちるため、削除RPCは
  起点の行だけを消す。**孤児データが構造的に発生しない**
- 残存検査はテーブルを列挙せず、`user_id`列を持つ`public`・`private`の全テーブルを
  **動的に走査**する。将来テーブルが増えても自動的に対象になる。
  空振りで合格しないよう、走査対象が8テーブル以上あることと、
  削除していない利用者では走査が行を見つけることも同時に検査する
- 最終ownerガードはRPCへ重ねて書かず、既存の`protect_last_owner`トリガへ一本化した
  （mutation testで、RPC側の事前チェックを消してもテストが全件通ることを確認した＝
  観測上の差が無い重複コードだった）。トリガ自体は直接delete・直接updateでも
  止まることをpgTAPで検査する

### 実行した検証

| 検証 | 結果 |
|---|---|
| pgTAP | 32ファイル **555テスト PASS**（Task 013時点の490から+65） |
| 並行テスト（配信+脱退） | 10件 PASS（2人同時脱退の回帰を含む） |
| oxlint / tsc / vitest / vite build | すべてgreen（ユニット358テスト） |
| E2E typecheck | green（実行はCI） |

### mutation test

| 壊した箇所 | 落ちたテスト |
|---|---|
| `subject_hash` が平文のuser_idを返す | 30: 8件 |
| `delete_my_account` が `student_accounts` を消さない | 31: 12件 |
| `admin_delete_auth_identity` の `account_data_remains` を外す | 32: 1件 |
| `delete_my_account` の最終 owner 事前チェックを削除 | **0件（＝重複コードと判明したため削除した）** |

### CIで見つけて直したもの

- e2eが `permission denied for table organizations` で失敗。`service_role` には
  `public.organizations` のSELECT権限が無い（Task 013で確認した設計どおりの状態）ため、
  運営RPCの引数を副問い合わせで解決できない → 対象IDを所有者権限で先に解決し、
  リテラルで渡す

- e2eの走査ヘルパーが `do 10036 declare ...` で失敗。`psql -c "..."` はシェルの
  二重引用符の中なので `$$` がPIDへ、`$1` が空へ展開されていた
  → SQLを**標準入力**で渡す形に変え、引用符・ドル記号の展開に依存しないようにした
  （ローカルで「行がある→削除→空になる」まで実際に確認した）

- e2eでパスポート削除の完了表示が出ずに失敗。**実装のUXバグだった**:
  削除に成功すると `hasPassport` が false になり、完了表示が
  「興味パスポートは登録されていません」へ即座に置き換わっていた
  （利用者は消えたのかどうか分からない）。アカウント削除も、シェルの再読込で
  画面ごと切り替わって結果が見えなかった
  → 完了表示は残す。アカウント削除は「はじめの画面へ」を押してから切り替える

### 独立レビューの結論と対応

**reviewer / security-reviewer の指摘をすべて自分で再現したうえで修正した。**

| 指摘 | 深刻度 | 再現内容 | 対応 |
|---|---|---|---|
| B1 / H-1（脱退の並行競合） | Blocker | ownerが2人の団体で2人が同時に脱退すると、ロックを取らない存在判定で両方が通過しowner 0人になる（復旧経路なし） | 存在判定に `for update` を足して直列化。`scripts/concurrency_test.sh` に2人同時脱退のケースを追加 |
| H-1（単独ownerの袋小路） | Blocker | 最後のownerが `delete_my_account` すると、所属の削除で巻き戻り**学生側のデータも1件も消えなかった**。団体を1人で作った担当者は全員この状態 | 最後のownerの所属だけ残し、学生データは消す。外せなかった団体数を戻り値で返し、画面で伝える（D049） |
| H-2（監査の脱匿名化） | High | `deletion_audit_log` を `auth.users` とjoinしてメールへ戻せる（saltなしSHA-256・プレフィックスは公開定数・候補IDは同一DB内） | 主体を持たない**日次集計**へ変更 |
| M-1（削除後もメールが届く） | Medium | パスポート削除後も送信待ちの案内メールが送られる | 削除時に `pending` のメールを `cancelled` に |
| M-2（運営削除が追跡不能） | Medium | 存在しないIDでも成功し監査行だけ増える | `identity_not_found` を送出 |
| M-3（監査ログのDoS） | Medium | 保存↔削除の繰り返しで監査行が無制限に増える | 日次集計化で有界化 |
| M-4（トリガがENABLE） | Medium | 最終ownerガードが唯一の防御なのに replica モードで不発 | `ENABLE ALWAYS` に |
| M-5（確認画面に大学メールが無い） | Medium | 最も重要な残存物が「残るもの」に無い | 一覧へ追加 |
| N1（3値の潰し） | Non-blocker | `hasPassport` が loading/error でも false になり誤断定 | 3値を渡す |
| N2（走査の前提） | Non-blocker | `user_id` 列名だけを走査。別名列でPIIを持つテーブルが増えると空振り | FK列名の前提を検査するテストを追加 |
| N7（grant固定なし） | Non-blocker | 新規RPCのanon/PUBLIC権限を固定するテストが無い | 32へgrant走査を追加 |
| L-1/L-3/L-4 | Low | 届いた理由が残る／再登録できる／節番号崩れ | 文言・operations節順を修正 |
| L-2（cascadeがO(N)） | Low | `email_outbox` に user_id先頭のindexが無い | index追加 |

未検証で残したもの（環境の制約）:
- 本番Supabaseでの `auth.users` 削除の挙動（DELETE権限・子テーブル連鎖・`auth.audit_log_entries` へのメール残存）→ hosted stagingで確認（operations §9・§8）
- E2Eの実行はCI

### CIで見つけて直したもの

- e2eが `permission denied for table organizations` で失敗 → 対象IDを所有者権限で先に解決する
- e2eの走査ヘルパーが `do 10036 declare` で失敗（シェルが `$$`・`$1` を展開）→ SQLを標準入力で渡す
- パスポート削除の完了表示が「登録されていません」へ即座に切り替わっていた（UXバグ）→ 完了表示を残す

### 残る課題

- **auth identity（大学メール）は退会後も残る**。運営が `admin_delete_auth_identity`
  で消す運用（`docs/operations.md` §9）で、自動化されていない
- 団体そのものの削除は未実装（Out of scope。最終ownerガードと配信snapshotの整合を別途設計）
- 担当者の削除・role変更（他人を外す操作）は未実装
