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
- `app/supabase/tests/24_*.sql`〜`26_*.sql`（新規。`23_` はTask 011で使用済み）
- `app/src/serverdata/notificationApi.ts`（新規）
- `app/src/student/NotificationSettings.tsx`（新規）
- `app/src/student/StudentArea.tsx`（通知設定への導線と、メールのリンク着地）
- `app/src/styles/passport.css`（通知設定の3択の見た目）
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

- [x] 学生が通知設定を3種類（毎回 / 1日1回 / 通知しない）から選べ、いつでも変更できる
- [x] 設定が`off`の学生にはoutboxへ積まれない
- [x] オファー配信と同じトランザクションでoutboxへ積まれる
- [x] メール送信の失敗がオファー配信をrollbackさせない（送信はトランザクション外）
- [x] 同じオファー・同じ学生の通知が二重に積まれない（idempotent）
- [x] 送信失敗はbackoff付きで再試行され、上限を超えたら`failed`として残る
- [x] `sent` / `failed` / 再試行中の状態を運用が確認できる（`email_outbox_health()`）
- [x] daily digestが1日1回だけ送られる（1人1日1行・Asia/Tokyo 18時）
- [x] メール本文・件名・ログに、希望条件・団体の内部情報・返答状態・メールアドレス・secretが含まれない
- [x] outboxテーブルに宛先メールアドレスと本文が保存されない
- [x] 通知設定画面から通知を止められる導線が、メールからも辿れる
- [x] mockによる自動テストがある（`emailTemplate.test.ts` / pgTAP 24・25）
- [ ] **設定済み環境での実メールE2E**（hosted staging・人間タスク。`docs/runbook_supabase_hosted.md` §6.1）
- [x] 運用runbookがある（`docs/runbook_supabase_hosted.md` §6.1・`docs/notifications.md`）
- [x] anon・他の学生・団体からoutboxへ到達できない（pgTAP 25で検査）
- [x] `npm run lint` / `npm run test -- --run` / `npm run build` / pgTAP がgreen

## Test plan（テスト計画）

| 受入条件 | 検証手段 | 場所 |
|---|---|---|
| outboxのidempotency・状態遷移・backoff | pgTAP | `supabase/tests/24_notification_outbox_test.sql` |
| outboxの権限・PIIサーフェス | pgTAP | `supabase/tests/25_notification_privacy_test.sql` |
| 利用者コントロール（停止・変更が未送信分に効く）・滞留の回収・まとめの日境界 | pgTAP | `supabase/tests/26_notification_control_test.sql` |
| メール本文の最小性・例外の分類・ログ | unit test | `supabase/functions/send-notifications/emailTemplate.test.ts` |
| 通知設定の表示モデル | unit test | `src/serverdata/notificationApi.test.ts` |
| 設定の3択・永続化・設定に応じた積まれ方 | E2E | `e2e/task010-notifications.spec.ts` |
| 送信失敗が配信を壊さない | pgTAP | `24_` / `26_` |
| 実メール送信 | hosted staging（人間タスク） | `docs/runbook_supabase_hosted.md` §6.1 |

## Rollback（切り戻し）

- コード: 本PRのrevert。
- DB: outboxとその関数のdrop。`send_offer`はTask 011版へ戻す（drop→createのため定義の再適用が必要）。
- Edge Function: デプロイ済みの関数を削除する。未送信のoutboxは残るが、配信の正本は失われない。

## Verification record（検証記録）

- 実行モード: **Deep**（`app/supabase/**`・通知・PII・外部サービス連携に触れるため）
- ブランチ: `feat/010-email-notifications`（`develop` の `ee08d12` から作成）
- lint: green（指摘0件）
- unit test: **345件 / 28ファイル**（Task 011後は335 / 27）
- build: 成功
- pgTAP: **377件 / 25ファイル**（Task 011後は337 / 23）
- 並行テスト: 8件pass（回帰なし）
- E2E: **ローカル未実施**（Dockerデーモンが無い）。`e2e/task010-notifications.spec.ts` をCIで担保
- 送信ワーカーの実送信: **未検証**。DockerとDenoが無く `supabase functions serve` を起動できない

### 設計上の判断

- **`send_offer` を書き換えない**: `offer_recipients` への挿入を文レベルトリガにした。
  Task 011で確定した送信の判定・原子性・並行制御（D036・D037）に手を入れずに済み、
  既存のpgTAP 337件が無改修で通ることを確認した。
- **outboxに宛先も本文も置かない**: 宛先は送信時に `auth.users` から引く。
  outboxが漏えいしても、誰のどのアドレスへ何を送ったかが分からない。
- **配信停止はワンクリック解除にしない**: 解除トークンをメールへ埋めると、
  漏えい・誤操作・なりすましで第三者が通知を止められる。本人のログインを経由させる。
- **既定値を2か所に持つ**: サーバー（enqueueの`coalesce`）とクライアント
  （`DEFAULT_NOTIFICATION_MODE`）。片方だけ変えると通知が復活する事故を防ぐため、
  単体テストで両者が `each` であることを固定した。

### 残るリスク・未実施事項

- **実メール送信が未検証**。`index.ts` はhosted stagingでの実機確認が必要
  （`docs/runbook_supabase_hosted.md` §6.1）。純粋関数部分（本文・例外分類・ログ）は
  Vitestで検証済み。
- **denomailer 1.6.0 のSTARTTLS挙動が未確認**（Denoも `deno.land` への到達も無い）。
  ポート465以外では昇格を前提にしているため、hosted検証時に実際に暗号化されることを確認する。
- ワーカーが並んだときの `for update skip locked` の実証は未実施（pgTAPは単一セッション）。
- Edge Functionの外部依存（`denomailer`）はバージョン固定したが、実行での確認は未実施。
- staging SMTPはGmailの個人アカウント（500宛先/日）。閉鎖βの規模では足りるが、
  本番は独自ドメイン+専用プロバイダが必要。
- 古いoutbox行の削除経路が無い（Task 017へ引き継ぐ）。
- 送信ワーカーのスケジュール設定は人間タスク。
### 独立レビューと対応

reviewer と security-reviewer を独立に実施した。**両者が独立に「通知を止めても
積まれ済みは送られる」を検出**し、reviewerはさらに滞留とまとめの日境界を検出した。

#### Blocker（実証済み・修正済み）

| # | 内容 | 対応 |
|---|---|---|
| B1 | **「通知しない」にしても、積まれ済みのメールが送られる。** `claim_email_batch` が設定を再確認せず、`save_notification_settings` も未送信分を消さない。`daily` では**最大約18時間**（00:05配信→18:00まとめ）offが無視される | **送信時を権威ある関門にした**。取り出しの前に現在の設定を再確認し、合わない行を`cancelled`にする。設定変更時にも未送信分をその場で取り消す（二段構え） |
| B2 | **ワーカーが落ちた行が二度と拾われない。** `sending`のまま永久に残り、再試行も`failed`化もされない。宛先がNULLの行は「掴んだのに返らない」経路でも同じことが起きる | 15分のリースで拾い直す。上限を使い切った滞留行は`failed`（`worker_lost`）。宛先が取れない行は`failed`（`no_recipient_address`）で止める。`email_outbox_health()`へ`oldest_sending_at`を追加 |
| B3 | **まとめが同じ18時に2通届く。** `dedupe_key`が配信日、`next_attempt_at`が次の18時で単位がずれており、日境界をまたぐ2つのキーが同時にdueになる。しかも両方が「今日」と書く | `dedupe_key`を**まとめを送る日**にして、鍵とスケジュールを1対1にした |
| B4 | **18時以降に届いたオファーがどのまとめにも載らない。** 当日キーが`sent`済みだと`on conflict do nothing`に吸収され、翌日は翌日キーしか数えない | B3と同じ修正で解消。件数を数える窓（`private.digest_window`）も同じ基準にそろえた |
| B5(sec) | `tls: false` がハードコードで、SMTPの資格情報と全学生の宛先が平文接続に載り得る | 465は暗黙TLS、それ以外はSTARTTLSでの昇格を要求。平文へ落とす設定は用意しない |

#### Non-blocker（対応したもの）

| 内容 | 対応 |
|---|---|
| backoffが正本（1/5/25/125/625分）と実装（5/25/125/625/3125分）で1段ずれ | 実装を正本へ合わせた（1回目の失敗＝1分後） |
| `complete_email`が`sent`の行を`pending`へ戻せる。`succeeded=NULL`も失敗扱い | `status='sending'`のみ進める。`succeeded is true`で明示判定。エラーは`outbox_not_claimed` |
| メール本文のリンク（`#inbox`/`#notifications`）が着地しない（hashルーティングが無い） | 起動時に一度だけhashを読んでタブを決め、直ちにURLから取り除く（招待トークンと同じ扱い） |
| `index.ts`で`CUE_SMTP_FROM`/`CUE_APP_URL`だけtry/catchの外。setupのcatchが生メッセージを出力 | try内へ移し、`missing_env:`/`invalid_env:`以外は固定文言へ落とす |
| `complete_email`のRPCエラーを見ていない | エラーを検査してログへ残す（宛先・本文は出さない） |
| 通知設定の`headingRef`が未使用。矢印キー移動が無い。保存中にフォーカスが飛ぶ。保存エラーが`status`で読み上げられない | 見出しへフォーカス移動、roving tabindex + 矢印キー、`aria-disabled`でフォーカス維持、`role="alert"` |
| トリガの`security definer`が不要（将来fail-openになる） | 外した |
| E2E step 5が目的の分岐を検査できない（dedupeで件数が変わらないだけでも通る） | `pending`が0・`cancelled`が1であることを検査する形へ |
| タスクのTest plan表のファイル名が実体と不一致。`passport.css`がIn scopeに無い | 両方修正 |
| `emailTemplate.test.ts`のテスト名と内容が矛盾 | 名前を実際の検査内容へ |

#### テストの実効性（変異テスト）

reviewerが「壊しても落ちない」箇所を3つ指摘したため、`26_notification_control_test.sql`
を新設し、**変異で必ず落ちること**を確認した。

| 変異 | 落ちたアサーション |
|---|---|
| 送信時の設定再確認を外す（B1） | 2件 |
| `sending`の拾い直しを外す（B2） | 2件 |
| `dedupe_key`を配信日へ戻す（B3/B4） | 2件 |
| `complete_email`のbackoffを固定値にする | 1件 |
| claimで試行回数を増やさない | 1件 |

#### 対応せず

| 内容 | 理由 |
|---|---|
| `claim_email_batch`の`recipient_email`がクライアント向け生成型に載る | `gen types`の自然な結果で、`service_role`専用のため実行時に到達不能。`dist/`にも出ないことを確認済み。privateスキーマへ移す案はTask 017で検討 |
| ワーカー並行（`for update skip locked`）の実証テストが無い | pgTAPは単一セッション。Task 011の`concurrency_test.sh`と同じ形の追加はTask 017へ |

### 残るリスク・未実施事項
