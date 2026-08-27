# Task 010: メール通知

## Goal（目的）

新入生が、オファーの到着をアプリを開かなくても知れるようにする。
通知の量は本人が3段階（毎回 / 1日1回のまとめ / 通知しない）から選べ、
いつでも変更・停止できる。メールには希望条件・団体の内部情報・返答状態を載せない。

## Source of truth（正本）

- `docs/decisions.md`: D026⑥（オファー到着時の通知）、D027（Edge Functions + 通知はTask 010）、
  D029（PIIサーフェス）、D036〜D039（Task 011で確定した匿名性）、本タスクでD040〜D042を追加
- `docs/launch_plan.md`: §3（依存関係）
- `docs/server_data_model.md`: §10（`offer_recipients`への挿入が通知のトリガー点）
- `docs/auth_and_authorization.md`: §9（secretの絶対条件）
- `docs/runbook_supabase_hosted.md`: §3（stagingのカスタムSMTPは設定済み）
- `docs/matching_and_safety.md`: §5（オファー量の制御）

## In scope（変更してよい範囲）

- `app/supabase/migrations/2026*_0010_*.sql`（新規）
- `app/supabase/functions/send-notifications/`（新規。Edge Function）
- `app/supabase/tests/23_*.sql`〜`25_*.sql`（新規）
- `app/src/serverdata/notificationApi.ts`（新規）
- `app/src/student/NotificationSettings.tsx`（新規）
- `app/src/student/StudentArea.tsx`（通知設定への導線）
- `app/src/lib/database.types.ts`
- `app/e2e/task010-notifications.spec.ts`（新規）
- `docs/decisions.md` / `docs/notifications.md`（新規・正本）/ `docs/runbook_supabase_hosted.md` / `docs/launch_plan.md`
- `tasks/010-email-notifications.md`

## Out of scope（変更してはいけない範囲）

- 新しい有料サービス・有料プランの契約（既存のSMTP構成を使う）
- プッシュ通知・SMS・LINE等の追加チャネル
- 団体側への通知（学生への通知のみ）
- 団体確認・kill switch（Task 013）、アカウント削除（Task 014）
- `app/src/demo/**`、`main`・GitHub Pagesの公開物

## 設計の骨子（実装前に確定させること）

1. **送信経路**: 既存構成に合わせる。新しい有料サービスは導入しない。
   ローカルはMailpitのSMTP（`config.toml`の`local_smtp`）、hostedは既に設定済みのカスタムSMTP。
   資格情報はSupabaseのsecret管理だけに置き、コード・PR・ログ・CIへ出さない。
2. **outbox**: `private.email_outbox`。`(kind, user_id, dedupe_key)`に一意制約を置き、
   同じ通知が二重に積まれない（idempotent）。状態は`pending / sending / sent / failed`。
   `attempts`・`next_attempt_at`・`last_error_code`を持つ。**本文・宛先メールは保存しない**
   （宛先は送信時に`auth.users`から引く。本文はテンプレートIDと最小の変数から組み立てる）。
3. **積む契機**: `send_offer`が`offer_recipients`を挿入したのと**同じトランザクション内**で
   outboxへ積む。ただし**メール送信そのものは配信トランザクションの外**で行うため、
   SMTP障害が配信をrollbackさせない。
4. **設定**: `each`（オファーごと）/ `daily`（1日1回のまとめ）/ `off`（通知しない）。
   既定値を決め、decisionへ記録する。
5. **daily digest**: 1日1回、前回送信以降の未通知オファー件数だけを知らせる。
   **件数以外の内容（団体名・イベント名）を載せるかどうかを決めてdecisionへ記録する**。
6. **retryとbackoff**: 指数バックオフ。最大試行回数を決め、超えたら`failed`にして運用が気づけるようにする。
7. **unsubscribe相当**: メール本文から通知設定画面へ直行できる導線。
   ワンクリック解除にする場合は、トークンの安全性（推測不能・失効・単一用途）を設計してからにする。
8. **メール本文**: 件名と本文は必要最小限。アプリの受信箱へのリンクを中心にする。
   **希望条件・団体の内部情報・返答状態・マッチ度・理由文を載せない。**

## Acceptance criteria（受入条件）

- [ ] 学生が通知設定を3種類（毎回 / 1日1回 / 通知しない）から選べ、いつでも変更できる
- [ ] 設定が`off`の学生にはoutboxへ積まれない
- [ ] オファー配信と同じトランザクションでoutboxへ積まれる
- [ ] メール送信の失敗がオファー配信をrollbackさせない
- [ ] 同じオファー・同じ学生の通知が二重に積まれない（idempotent）
- [ ] 送信失敗はbackoff付きで再試行され、上限を超えたら`failed`として残る
- [ ] `sent` / `failed` / 再試行中の状態を運用が確認できる
- [ ] daily digestが1日1回だけ送られる
- [ ] メール本文・件名・ログに、希望条件・団体の内部情報・返答状態・メールアドレス・secretが含まれない
- [ ] outboxテーブルに宛先メールアドレスと本文が保存されない
- [ ] 通知設定画面から通知を止められる導線が、メールからも辿れる
- [ ] fake SMTP（Mailpit）またはmockによる自動テストがある
- [ ] 設定済み環境での実メールE2Eがある（hostedはPhase Bで実施）
- [ ] 運用runbookがある（送信失敗の確認・再送・停止）
- [ ] anon・他の学生・団体からoutboxへ到達できない（pgTAPで検査）
- [ ] `npm run lint` / `npm run test -- --run` / `npm run build` / pgTAP がgreen

## Test plan（テスト計画）

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| outboxのidempotency・状態遷移・backoff | pgTAP | `supabase/tests/23_email_outbox_test.sql` |
| 通知設定の3種と`off`の抑止 | pgTAP | `supabase/tests/24_notification_settings_test.sql` |
| outboxの権限・PIIサーフェス | pgTAP | `supabase/tests/25_notification_privacy_test.sql` |
| メール本文の最小性 | unit test | `src/serverdata/notificationApi.test.ts` ほか |
| Mailpitでの実送信 | E2E | `e2e/task010-notifications.spec.ts` |
| 送信失敗が配信を壊さない | pgTAP + E2E | 同上 |

## Rollback（切り戻し）

- コード: 本PRのrevert。
- DB: outboxとその関数のdrop。`send_offer`はTask 011版へ戻す（drop→createのため定義の再適用が必要）。
- Edge Function: デプロイ済みの関数を削除する。未送信のoutboxは残るが、配信の正本は失われない。

## Verification record（検証記録）

実装後に記入する。
