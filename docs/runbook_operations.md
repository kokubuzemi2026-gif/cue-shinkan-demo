# 運用手順書（migration・backup・secret・公開停止）

対象: CUE（仮）の運営者と実装者。**この文書に実際の値（キー・パスワード・URL）を書かない。**

- 障害・事故の対応は `docs/runbook_incident.md`
- 運営操作（団体の確認・停止・緊急停止）は `docs/operations.md`
- hosted環境の構築は `docs/runbook_supabase_hosted.md`

## 1. 環境と役割

| 環境 | 用途 | 公開範囲 |
|---|---|---|
| local | 開発・自動テスト | 開発者の端末とCIのみ。`supabase start` の使い捨てスタック |
| staging | hosted検証（Phase B） | 運営者と実装者のみ |
| production | 閉鎖β | 神戸大学の学生（`@stu.kobe-u.ac.jp`） |

**productionはまだ存在しない。** 作成は人間の操作（`docs/launch_plan.md` §7 H6）。

## 2. 環境変数（**値は書かない**）

| 変数 | 置き場所 | 誰が見るか | 用途 |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ローカル: `app/.env.local` / 公開: GitHub Actions **secrets**（D054） | **ブラウザへ出る** | Supabaseへの接続先 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 同上 | **ブラウザへ出る** | 公開してよい鍵 |
| `CUE_SMTP_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_FROM` | Supabase Function secrets | サーバーのみ | 通知メールの送信 |
| `CUE_APP_URL` | Supabase Function secrets | メール本文に出る | 受信箱へのリンク |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabaseが自動注入 | サーバーのみ | 送信ワーカー |
| `CUE_DB_URL` | 開発者の端末のみ | 開発者のみ | 並行テスト |
| `E2E_BASE_URL` / `E2E_MAILPIT_URL` / `E2E_DB_URL` | CI・開発者の端末 | 開発者のみ | E2E |

原則（D027）:

- **`VITE_` で始まる変数はすべてブラウザのバンドルへ埋め込まれる。** secret key・service-role key・DBパスワード・アクセストークンを入れない
- `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY` はブラウザへ出る値だが、
  GitHubでは **variable ではなく secret** へ置く（**D054**）。値を隠すためではなく
  **貼り間違いを封じ込めるため**: runnerは各stepの冒頭に `env:` マップを値ごと出力し、
  `secrets.*` はマスクされるが **`vars.*` はマスクされない**。本リポジトリは公開なので
  Actionsログは誰でも読める。`sb_secret_*` を貼ると検証ステップが止める前に世界へ出る
- 実値ファイル（`.env`・`.env.local`）はgit管理外。`app/.env.example` にプレースホルダーだけを置く

### 公開ビルドに設定が入っているかの確認

`.github/workflows/deploy-pages.yml` の build に `VITE_SUPABASE_*` を渡していないと、
公開URLは「接続設定が必要です」の案内画面になる（`src/lib/supabaseClient.ts` が
`null` を返し、`AppRoot` が `SetupNotice` を出す）。**動いていた公開デモを壊す**ので、
`main` へmergeする前に必ず確認する（`docs/launch_plan.md` §7 H7）。

## 3. migrationの適用

### ローカル

```bash
cd app
npm run db:reset   # 全migrationを最初から適用し直す（使い捨て）
npm run db:test    # pgTAP
npm run db:test:concurrency
```

### staging / production

**Supabaseアクセストークンが要るため人間が行う**（`docs/launch_plan.md` §7 H1）。

```bash
cd app
npx supabase link --project-ref <project ref>
npx supabase db push          # 未適用のmigrationだけが流れる
```

適用前に必ず確認する。

1. `npx supabase migration list` で、ローカルとリモートの差分を見る
2. **適用するmigrationを実際に読む**。`drop function` を含むものは §4 の注意を読む
3. バックアップを取る（§5）
4. 適用後、`select * from public.platform_health();` を service_role で実行し、
   異常が出ていないことを確認する

### 適用順の前提

migrationはファイル名の昇順で1度だけ適用される。**適用済みのファイルを後から編集しない。**
編集が必要なら新しいmigrationを足す。

## 4. rollback

**履歴を破壊するrollbackを行わない**（`git reset --hard`・force push・`supabase db reset` を
本番へ実行しない）。

| 状況 | 戻し方 |
|---|---|
| アプリのコードだけ戻したい | revert PR を作って `main` へmerge。Pagesが自動で再deployする |
| migrationを戻したい | **逆migrationを新しく書いて適用する**（`drop` した関数は前の定義で `create` し直す） |
| すぐ止めたい | 緊急停止（`docs/operations.md` §5）。migrationを戻すより速く、データを壊さない |

### `drop function` → `create` で置き換えた関数の注意

戻り値の型や列を変えるとき、`create or replace` が使えず `drop` → `create` になる。このとき:

- **`grant` が失われる**。逆migrationでも `grant execute ... to authenticated` を書き直す
- **依存するビュー・関数があると `drop` が失敗する**。依存側も同じmigrationで作り直す
- **対象の完全な一覧は `docs/runbook_supabase_hosted.md` §8 が正本**。ここに写しを置くと
  必ずずれるので置かない（実際、当初この節は0011の `send_offer`・`preview_offer_audience` を
  落としていた。団体側の中核RPCなので、その一覧で切り戻すと送信もプレビューもできなくなる）
- 逆migrationを書くときは、対象migrationの直前の定義を `git show` で取り出して使う

### データを消すrollbackはしない

削除系RPC（`delete_my_account` など）で消えたデータは戻らない。
**実データ投入後は、削除に関わるmigrationのrevertでデータが復元されない**ことを前提にする。

## 5. backup と restore

### backup

Supabaseのプロジェクト設定でバックアップが有効なことを確認する（Freeプランは日次・保持期間が短い）。
それとは別に、**migration適用の直前**には手元でもダンプを取る。

```bash
# 出力先は**リポジトリの外**へ固定する。カレントディレクトリへ出すと、
# 直後の `git add -A` で本番のPIIがそのままステージされる
mkdir -p ~/cue-backup && chmod 700 ~/cue-backup
npx supabase db dump --db-url "<connection string>" -f ~/cue-backup/backup_$(date +%Y%m%d).sql
```

**ダンプには実在する学生の大学メールが含まれる。** リポジトリ・チャット・共有ドライブへ置かない。
不要になったら端末から削除する。

### restore

```bash
psql "<connection string>" -f ~/cue-backup/backup_YYYYMMDD.sql
```

restoreは**最後の手段**。実行前に、緊急停止（`docs/operations.md` §5）で
新規配信を止めてから行う。

## 6. secret rotation

対象と手順。**値はDashboardまたはCLIへ直接入力し、リポジトリ・CI・PR・チャットへ置かない。**

| secret | 交換手順 | 交換後の確認 |
|---|---|---|
| SMTPパスワード | メール送信元のサービスで再発行 → `npx supabase secrets set CUE_SMTP_PASSWORD=...` | 送信ワーカーを1回動かし、`email_outbox_health()` の `failed_count` が増えないこと |
| Supabase publishable key | Dashboard → API Keys で再発行 → GitHub Actions **secret** を更新 → 再deploy | 公開URLでログイン画面が出ること |
| Supabase secret key（`sb_secret_`） | Dashboard → API Keys で再発行 | 使っているのは運用時の一時利用のみ。配布しない |
| Supabaseアクセストークン（`sbp_`） | Dashboard → Account → Access Tokens | `npx supabase link` が通ること |
| GitHubのトークン | 使用していない（CIはGITHUB_TOKENのみ） | — |

**交換のきっかけ**: 漏えいの疑い、担当者の交代、公開前の一斉更新、年1回の定期。

漏えいが疑われる場合は、交換より先に**緊急停止**（`docs/operations.md` §5）を行う。

## 7. 公開停止の手順

「公開をやめる」は段階がある。**下ほど強い。**

| 段階 | 操作 | 効果 | 戻し方 |
|---|---|---|---|
| 1. 配信だけ止める | `admin_set_delivery_paused(true, ...)` | 新規配信とpreviewが止まる。受信済みは見られる | 同RPCで `false` |
| 2. 特定の団体を止める | `admin_set_organization_status(..., 'suspended', ...)` | その団体の配信・オファーが止まる | `'verified'` へ戻す |
| 3. ログインを止める | Supabase Dashboard → Authentication → Providers → Email を無効化 | 新規ログインができなくなる。既存セッションは残る | 再度有効化 |
| 4. 公開ページを下ろす | GitHub → Settings → Pages → Source を「None」へ | 公開URLが404になる | Sourceを「GitHub Actions」へ戻す |
| 5. データを消す | 個別の削除RPC / Dashboard | **不可逆** | 戻せない |

**1と2で足りるかを先に判断する。** 3以降は利用者から見て「サービスが消えた」ことになるため、
実行前に何が起きているかを整理し、可能なら告知する。

`main` へのpushを止めれば再deployは起きないが、**すでに公開されているページは残る**。
下ろすには4が要る。

## 8. 定期作業

| 頻度 | 作業 | 手順 |
|---|---|---|
| 毎日（β期間中） | health check | `select * from public.platform_health();`（`docs/runbook_incident.md` §1） |
| 週1 | 依存関係の警告確認 | GitHubのDependabot alerts / CIの `audit` ジョブ。**`npm audit` はnpmレジストリの既知脆弱性だけ**を見る。Edge Functionの Deno 依存（`denomailer`）とGitHub Actionsは対象外 |
| 週1 | ドメイン外identityの掃除 | `docs/runbook_supabase_hosted.md` §7 |
| 週1 | ログインの生存確認 | 合成アカウントの大学メールでOTPを1往復させる。**`platform_health()` ではAuthの生存を確認できない**（DBからAuth APIを叩けない）ので、人間が実際に通す（`docs/runbook_incident.md` §2.5） |
| 月1 | 退会済みauth identityの掃除 | `docs/operations.md` §9 |
| 月1 | 送信し終えたメール行の掃除 | `select private.prune_email_outbox(90);`（DB管理者権限）。**pending・sending は消えない**（消すと通知が届かなくなる・D053） |
| 月1 | 期限切れpreviewの掃除 | `select private.prune_preview_cache(48);`（DB管理者権限）。24時間で無効になる行を残し続けないため（D052） |
| 年1 | 監査ログの剪定 | `select * from private.prune_audit_logs(365);`（DB管理者権限） |
| 年1 | secret rotation | §6 |

`prune_audit_logs`・`prune_preview_cache`・`prune_email_outbox` は
**service_role からも呼べない**（DB管理者＝Dashboard の SQL Editor でのみ実行できる）。
誤操作で監査や送信待ちを消させないため。

## 9. ログの方針（structured logging）

**何を出すか・何を出さないかを先に決める。** 出してしまったものは後から消せない。

### 出してよいもの

| 種類 | 例 |
|---|---|
| 時刻 | ログ基盤が付ける |
| 操作の種類 | `kind`（`offer_arrival` / `daily_digest`）、`action`（`delivery_paused` 等） |
| 内部の識別子 | `outboxId`（`private.email_outbox.id`）、`delivery_id`、`organization_id` |
| 結果 | `sent` / `failed` / `cancelled` |
| 試行回数 | `attempt` |
| エラーの分類 | `errorCode`（`smtp_timeout` / `smtp_auth` / `missing_env:CUE_SMTP_HOST` 等） |
| 件数 | 処理した行数、失敗した行数 |

### 出してはいけないもの

- **メールアドレス**（学生・団体担当者のどちらも）
- 氏名・学籍番号・電話番号
- **OTPコード・招待トークン・セッショントークン**
- **学生の希望条件**（興味・目的・曜日・予算・経験）と、それを推測できる組み合わせ
- 団体名・イベント名・オファー本文（メールに載せないのと同じ理由・D041）
- 誰がどう返答したか
- SMTPのユーザー名・パスワード、service-role key、接続文字列
- ライブラリの例外メッセージをそのまま（URLや資格情報を含み得る）

### 実装

送信ワーカー（`app/supabase/functions/send-notifications/index.ts`）は
`logSafe()` を通してこの方針を実装している。

- 出しているのは `outboxId` / `kind` / `attempt` / `result` / `errorCode` だけ
- 設定エラーは `missing_env:` / `invalid_env:` / `setup_failed` の3種へ落とし、
  ライブラリの例外文をそのまま出さない
- 応答（HTTP body）にも宛先・本文を含めない

DB側の監査は `private.admin_audit_log`（運営操作）と
`private.deletion_audit_log`（削除の日次集計）だけで、どちらも学生を指す列を持たない。
列が増えていないことは `34_ops_health_test.sql` が固定している。

### 出力先と保持

- Edge Function のログ: Supabase Dashboard（**Freeプランは保持期間が短い**。
  障害調査は発生当日中に行う）
- CIのログ: GitHub Actions（`docs/agent_harness.md` のマスク処理を通す）
- ブラウザの `console`: E2Eが「予期しないconsoleエラーが無いこと」を検査している。
  アプリから意図的にログを出さない

### 迷ったとき

**「そのログを第三者が見たときに、特定の学生を指せるか」**で判断する。
指せるなら出さない。件数と分類だけにする。
