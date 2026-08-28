# Task 022: 送信ワーカーのSMTPをnodemailerへ置き換える

- Status: 実装完了・hosted再検証待ち
- 作成: 2026-08-28
- 正本: `docs/launch_plan.md` §7.1 E7 / `docs/decisions.md` D058 /
  `docs/runbook_supabase_hosted.md` §6.1

## 背景（実測）

smoke test B（hosted staging・2026-08-28）で、実メールが1通も届かなかった。
DBの`private.email_outbox`を読むと次の状態だった。

- `kind=offer_arrival` / `status=failed` / `attempts=5`（上限）/ `last_error_code=unknown`
- 再試行・指数バックオフ・上限5回はいずれも**仕様どおり動作**（18:47積み → 21:35で上限）

Edge Functionのログに出ていた実際の例外は次のとおり。

```text
event loop error: Interrupted: operation canceled
    at async Object.pull (ext:deno_web/06_streams.js:994:27)
```

接続拒否でも認証失敗でもなく、**SMTP会話の途中でストリームが切られている**。
`denomailer@1.6.0` はDeno向けの生SMTP実装で、Supabase Edge Runtime
（`supabase-edge-runtime-1.74.3` / Deno 2.1.4）上での同種の不具合が報告されている。
Supabase公式のEdge Function SMTPサンプルは **nodemailer** を使っている。

これは`docs/launch_plan.md` §7.1 **E7**（「denomailer 1.6.0 のSTARTTLS挙動が未確認」）
として記録していたリスクが実体化したもの。H9（ワーカー設置）の時点ではキューが空で
`smtp.send()` を一度も通っておらず、**smoke test Bで初めて実送信経路が動いて露見した**。

## In scope

- `app/supabase/functions/send-notifications/index.ts`
  （denomailer → `npm:nodemailer@9.0.6`。接続・送信・切断の3箇所のみ）
- `app/supabase/functions/send-notifications/emailTemplate.ts`
  （`classifyError` が `code` / `responseCode` も見るようにし、`smtp_stream` / `smtp_tls` を追加）
- 同 `emailTemplate.test.ts`（上記の分類テスト。変異テストで検出力を確認済み）
- 同 `README.md` / `docs/decisions.md` D058 / `docs/launch_plan.md` §7.1 E7 /
  `docs/runbook_supabase_hosted.md` §6.1

## Out of scope

- `claim_email_batch` / `complete_email` / outboxスキーマ（**DBは一切変更しない**）
- 本文テンプレート・件名・PII方針（`buildEmail` は無変更）
- 外部サービスの新規契約（Resend等への移行は行わない。既存のGmail SMTPをそのまま使う）
- アプリ本体（`app/src/`）・CI・依存関係（`package.json`）

## 受入条件

1. denomailerへの参照が実行コードから無くなる
2. 465は暗黙TLS（`secure`）、それ以外はSTARTTLSを必須（`requireTLS`）にし、
   平文へ落ちる経路を作らない
3. secret・宛先・本文をログ・応答へ出さない（既存の方針を維持）
4. `classifyError` が nodemailer の `code`（EAUTH等）・`responseCode`（535等）も見る
5. 会話の途中で切れる系を `smtp_stream` として独立分類する（`unknown`に埋もれさせない）
6. 既存のunit testが全green、追加テストは変異テストで検出力を確認する
7. DB・アプリ本体・依存関係に差分が無い

## 検証

| 検証 | 結果 |
|---|---|
| unit（emailTemplate） | **11件 PASS**（+2ケース群） |
| 変異テスト | `code`/`responseCode` を見ない旧実装へ戻すと新テストが**落ちる**ことを確認 |
| 全体unit / lint / build | （実施結果は下の「実行した検証」に記録） |
| hosted実送信 | **未検証**。デプロイ後にsmoke test Bの再送で確認する（下記手順） |

## hosted再検証の手順（運営者）

1. Dashboard → Edge Functions → `send-notifications` → エディタで
   `index.ts` と `emailTemplate.ts` を本ブランチの内容へ更新してDeploy
2. SQL Editorで失敗行を再送待ちへ戻す:
   `update private.email_outbox set status='pending', attempts=0, next_attempt_at=now(), last_error_code=null where status='failed';`
3. 5分以内にメールが届くことを確認。届かない場合は同じ診断SQLで
   `last_error_code` を見る（`smtp_auth` / `smtp_stream` 等で原因が切り分けられる）
