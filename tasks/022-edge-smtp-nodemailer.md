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
5. 会話の途中で切れる系を `smtp_stream` として独立分類する（`unknown`に埋もれさせない）。
   **部分一致の食い合いを起こさない判定順序**にする（`Error upgrading connection with STARTTLS`
   は 'connect' を含むためTLSを先に、`response=421` も 'connect' を含むためrateを先に見る）
5b. 1バッチを1接続で送る（`pool`）。denomailerは1接続を再利用しており、非pool構成だと
   1バッチ最大50回のGmailログインになる
6. 既存のunit testが全green、追加テストは変異テストで検出力を確認する
6b. 例外の分類が**宛先アドレスの綴りに左右されない**（550バウンスの局所部に 'rate' /
   'quota' / 'tls' / 'auth' / 'starttls' が含まれても `recipient_rejected` のままである）
6c. Gmailの**送信元側**の上限・評判ブロック（`550-5.7.1 ... unusual rate of unsolicited
   mail ...` / `550-5.7.1 Daily sending quota exceeded`）が `rate_limited` に入る
   （§7.1 E6の監視シグナルを、宛先拒否と読み違えさせない）
7. DB・アプリ本体・依存関係に差分が無い

## 検証

| 検証 | 結果 |
|---|---|
| unit（emailTemplate） | **20件 PASS**（developの10件から+10本: 分岐ごとの分類33ケース / 宛先の綴りで分類が変わらないこと / 長大な応答文でcode・responseCodeが届くこと / 長大な応答文でも現実的な時間で終わること / 返り値の集合固定7ケース） |
| 変異テスト | **30変異すべて検出**: (a) アドレス除去を外す / (b) `code`・`responseCode` を見ない旧実装 / (c) 素の rate・quota を550の上へ戻す / (d) `was closed` を削る / (e) 広いtls分岐の削除 / (f) `wrong version` の削除 / (g) `smtp_stream` 分岐の削除 / (h) 先頭の `etls|starttls` 規則の削除 / (i) `enotfound|edns` の削除 / (j) 上限系トークンの削除 / (k) 広いtlsを550の上へ移動 / (l) `unsolicited|unusual rate` の削除 / (m) `sending quota|relay limit` の削除 / (n) 応答文の長さ上限を外す / (o) 切り詰めをjoin後へ移す / (p)〜(u) 上限系トークン（`relay limit`・`sending quota`・`sending limit`・`unsolicited`・`unusual rate`・`5.4.5`）の単独削除 / (v) 切り詰め時の末尾トークン除去を外す / (w) 末尾トークン除去を無条件にする / (x)(y) `code`・`responseCode` の上限を外す / (z1) 境界の語判定を無視して常に末尾を落とす / (z2) 境界の語判定を反転 / (z3) 境界の判定位置を1字ずらす / (z4) アドレス除去の量指定子を束縛する / (z5) 上限を200へ縮める |
| 全体unit / lint / build | （実施結果は下の「実行した検証」に記録） |
| hosted実送信 | **未検証**。デプロイ後にsmoke test Bの再送で確認する（下記手順） |

## hosted再検証の手順（運営者）

1. Dashboard → Edge Functions → `send-notifications` → エディタで
   `index.ts` と `emailTemplate.ts` を本ブランチの内容へ更新してDeploy
2. SQL Editorで失敗行を再送待ちへ戻す:
   `update private.email_outbox set status='pending', attempts=0, next_attempt_at=now(), last_error_code=null where status='failed';`
3. 5分以内にメールが届くことを確認。届かない場合は同じ診断SQLで
   `last_error_code` を見る（`smtp_auth` / `smtp_tls` / `smtp_stream` 等で原因が切り分けられる）

> **`logger` / `debug` を有効にしないこと。** 有効にするとSMTP会話がそのままFunctionログへ出て、
> `RCPT TO` の宛先と本文全文が残る（D042違反）。資格情報はマスクされるがPIIは出る。

## 残るリスク（本タスクで閉じていないもの）

- 応答文の切り詰め（先頭2000字）の副作用（2000字目が宛先アドレスの `@` の手前に落ちると
  局所部の断片が残り、アドレス除去をすり抜ける）は、**切り詰めたときだけ末尾の途切れた語を
  落とすことで閉じた**（境界61通りをテストで固定）。落とすのは**途切れた語だけ**で、
  境界が語の直後に落ちた場合はその語を残す（完結した手掛かりを捨てて `unknown` に
  しないため）。ただし「上限系トークンが2000字目より後ろにしか無い応答」と
  「上限系トークンが2000字目を**またぐ**応答」は、依然 `recipient_rejected`
  （`responseCode` が無ければ `unknown`）へ落ちる。独立レビューの実測では201アライメント
  中1通り。Gmailは上限の理由を先頭行に置くため実害はないが、上限値を変える場合は
  ここを再確認する

- **hostedでの実送信は未検証**。nodemailerがSupabase Edge Runtime（Deno 2.1.4の
  node互換層）で動くか、`npm:` 指定子がDashboardエディタ経由のデプロイで解決されるかは、
  実機でしか確認できない。失敗しても平文送信にはならず（`requireTLS`でfail-closed）、
  `smtp_tls` / `smtp_stream` として記録される
- **`app/supabase/functions/**` は `tsc -b` の対象外**（`tsconfig.app.json` の `include` は `src` のみ）で、
  CIにも含まれない。今回の `send`→`sendMail`・`content`→`text` のようなAPI差し替えを
  自動検出する仕組みが無く、`emailTemplate.test.ts` 以外の防御が無い（既存の穴）
- **`npm:nodemailer` は `npm audit` / Dependabot の対象外**（Deno側依存）。
  週次の手動確認へ寄せる（`docs/runbook_operations.md` §8）
