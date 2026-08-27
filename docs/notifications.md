# メール通知設計（Task 010正本）

- Status: 実装完了・hosted検証待ち（2026-08-27）
- 決定: `docs/decisions.md` D040〜D042
- 実装: `app/supabase/migrations/20260827080000〜20260827080002_0010_*.sql`（DB正本）、
  `app/supabase/functions/send-notifications/`（送信ワーカー）、
  `app/src/serverdata/notificationApi.ts`・`app/src/student/NotificationSettings.tsx`（クライアント）

## 1. 何を送るか

新入生へ「新しい案内が届いた」ことだけを知らせる。**案内の中身はメールに書かない。**

| 載せるもの | 載せないもの |
|---|---|
| 新しい案内が届いた事実 | 学生の希望条件（興味・予算・曜日・本気度） |
| まとめの場合はその日の件数 | 団体名・イベント名・団体の内部情報 |
| 受信箱へのリンク | 返答状態（行ってみたい／あとで考える／見送る） |
| 通知設定へのリンク | マッチ度・理由文・対象人数 |

メールボックスが共有・漏えいしても、その学生がどの団体から誘われ、どう返答したかが
分からないようにする（`matching_and_safety.md` §7「個人特定」）。

## 2. 受け取り方（D040）

| 値 | 動作 |
|---|---|
| `each` | オファーが届くたびに1通（**既定**） |
| `daily` | その日に届いた件数を、Asia/Tokyoの18時に1通だけ |
| `off` | メールを送らない（案内は受信箱で確認できる） |

- 保存先は `public.student_notification_settings`。**行が無い学生の既定は `each`**で、
  サーバー（enqueueの`coalesce`）とクライアント（`DEFAULT_NOTIFICATION_MODE`）で同じ値を持つ。
- 興味パスポートとは別テーブルにする。パスポートを削除しても通知設定は本人の管理下に残り、
  Task 014でどちらをいつ消すかを独立に決められる。
- 学生本人だけがRLSで自分の行を読める。書込は `save_notification_settings` RPCのみ。

## 3. outbox（D041）

`private.email_outbox` は**送信の予定と結果だけ**を持つ。

- **宛先メールアドレスを保存しない。** 送信時に `auth.users` から引く（D029: メールを
  `auth.users` 以外へコピーしない）。
- **本文を保存しない。** テンプレートIDに相当する `kind` と、まとめの件数だけから組み立てる。
- `unique (kind, user_id, dedupe_key)` で二重に積まれない。
  `dedupe_key` は `offer_arrival` が配信ID、`daily_digest` がAsia/Tokyoの暦日。
- 失敗理由は**40文字までの分類コード**のみ（`smtp_auth` / `smtp_timeout` など）。
  SMTPの生メッセージは保存しない。

### 積む契機

`private.offer_recipients` への挿入をトリガ（文レベル・遷移テーブル）にする。
`send_offer` を書き換えないため、Task 011で確定した送信の判定・原子性・並行制御に
手を入れずに済む。

同一トランザクションで積むので、送信が後段で失敗（5人未満など）すればoutboxも
一緒にrollbackされる。**メール送信そのものはここでは行わないため、SMTP障害が
配信トランザクションを壊すことはない。**

### 再試行

| 試行 | 次の再試行まで |
|---|---|
| 1 | 1分 |
| 2 | 5分 |
| 3 | 25分 |
| 4 | 125分 |
| 5 | 625分（約10時間） |

5回を超えたら `failed` で止める。無限に再試行しない。

## 4. 送信ワーカー（D042）

`app/supabase/functions/send-notifications/`（Supabase Edge Function）。

| RPC | 権限 | 内容 |
|---|---|---|
| `claim_email_batch(batch_size)` | **service_role専用** | 期限が来た`pending`を`sending`へ進めて取り出す。`FOR UPDATE SKIP LOCKED`でワーカーが並んでも二重に掴まない。**宛先メールを返す唯一の経路** |
| `complete_email(id, succeeded, error_code)` | **service_role専用** | 成功→`sent` / 失敗→backoffして`pending` / 上限超過→`failed` |
| `email_outbox_health()` | **service_role専用** | 件数と最古のpending時刻だけを返す |

`authenticated`・`anon` にはこの3本を一切grantしない。

### 層の分担

| 層 | 責務 | 検証 |
|---|---|---|
| DB | 対象の決定・冪等化・backoff・試行上限・状態遷移 | pgTAP `24`・`25` |
| `emailTemplate.ts`（純粋関数） | 件名・本文・例外の分類・ログ行 | Vitest |
| `index.ts` | SMTPへの接続と送信、DBとの往復 | **hosted検証待ち** |

## 5. secretの扱い

| 変数 | 置き場所 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabaseが自動注入 |
| `CUE_SMTP_HOST` / `PORT` / `USER` / `PASSWORD` / `FROM` | **SupabaseのFunction secretへ直接入力** |
| `CUE_APP_URL` | 同上 |

**リポジトリ・CI・PR・チャット・ログへ置かない。**
設定不足は `missing_env:<名前>` として名前だけを出し、値は出さない。

## 6. 「配信停止」の導線

メール本文から**通知設定画面へのリンク**を置く。ワンクリック解除にはしない。

理由: 解除用トークンをメールへ埋めると、トークンの漏えい・誤操作・なりすましで
第三者が学生の通知を止められる経路になる。本人のログインを経由させるほうが安全で、
同じ画面で `off` 以外（まとめへ変更）も選べる。

## 7. 検証

- 単体: `emailTemplate.test.ts`（本文にPII・団体情報・返答状態が入らないこと、例外の分類、
  ログ行に宛先が出ないこと）、`notificationApi.test.ts`
- DB: pgTAP `24_notification_outbox_test.sql`（冪等性・状態遷移・backoff・上限・
  daily digestの時刻）、`25_notification_privacy_test.sql`（権限・PIIサーフェス）
- E2E: `e2e/task010-notifications.spec.ts`（設定の3択・永続化・設定に応じた積まれ方・
  `off`で積まれないこと・通知を止めてもオファーは届くこと）
- **実メール送信は未検証**。hosted stagingでの実機確認は `docs/launch_plan.md` §7 の人間タスク

## 8. 未実施・今後

- 送信ワーカーのデプロイとスケジュール設定（人間タスク）
- 送信済み・失敗の運用確認手順の整備（Task 017）
- 古いoutbox行の削除（Task 017）
