# send-notifications（メール送信ワーカー）

Task 010 のメール送信ワーカーです。outbox を1バッチ取り出して送り、結果を書き戻します。

## 役割の分担

| 層 | 責務 |
|---|---|
| DB（`claim_email_batch` / `complete_email`） | 対象の決定・冪等化・backoff・試行上限・状態遷移 |
| `emailTemplate.ts` | 件名と本文の組み立て、例外の分類、ログ行の整形（**純粋関数・Vitestでテスト済み**） |
| `index.ts` | SMTPへの接続と送信、DBとの往復（**hosted検証待ち**） |

## 必要な環境変数

値は Supabase の secret 管理へ直接設定します。**リポジトリ・CI・PR・チャットへ置きません。**

| 変数 | 内容 |
|---|---|
| `SUPABASE_URL` | Supabaseが自動注入 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseが自動注入。`claim_email_batch` / `complete_email` はservice_role専用 |
| `CUE_SMTP_HOST` / `CUE_SMTP_PORT` | SMTPサーバー |
| `CUE_SMTP_USER` / `CUE_SMTP_PASSWORD` | SMTP認証 |
| `CUE_SMTP_FROM` | 差出人アドレス |
| `CUE_APP_URL` | 受信箱・通知設定へのリンクの基点 |

## 検証の状態

- `emailTemplate.ts`: Vitest で検証済み（本文にPII・団体情報・返答状態が入らないこと、
  例外の分類、ログ行に宛先が出ないことを固定）
- `index.ts`: **ローカル・CIとも未実行**。Docker と Deno が無く `supabase functions serve` を
  起動できないため。hosted staging での実機確認は `docs/launch_plan.md` §7 の人間タスク

## ローカルでの動かし方（Dockerがある環境）

```bash
cd app
npm run db:start
npx supabase functions serve send-notifications --env-file supabase/functions/.env.local
```

`supabase/functions/.env.local` は **git管理外**です（`app/supabase/.gitignore`）。
