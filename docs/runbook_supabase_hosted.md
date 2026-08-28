# Runbook: hosted Supabase（staging）と人間が行う設定

- 対象: Task 008 Phase B（hosted staging確認）以降
- 前提: Task 008はPhase A（ローカル）とPhase B（hosted staging）の二段階で完了判定する（D031）。**Phase Bが完了するまでは「Task 008実装完了・hosted検証待ち」であり、最終完了とは判定しない。**

## 1. GitHub設定（実装開始前・人間タスク）

1. **実装開始前の必須条件**: 凍結対象の`main`へbranch ruleset（**PR必須・force push禁止・削除禁止**）を設定する。未設定の間はTask実装セッションを開始しない。
2. `develop`は作成・push直後に同等のrulesetを設定する。
3. default branchは`main`のまま。Pages workflow（`deploy-pages.yml`）は`main`限定のまま変更しない。
4. Task 008〜011のPRのbaseは`develop`。`main`へマージしない。

## 2. stagingプロジェクトの作成（人間タスク）

1. Supabase（FreeまたはPro）で**staging用プロジェクト**を新規作成する。リージョンは任意（東京推奨）。
2. DBパスワード・アクセストークンは個人管理とし、リポジトリ・CI・チャットへ長期残置しない。

> 実績（2026-08-24）: `cue-shinkan-staging`（project ref `cyjmduaijtdihfesawvd`・`ap-northeast-1`・Free組織`cue-shinkan-staging`）をManagement API経由で作成済み。DBパスワードは保存していない（必要時はDashboardのDatabase設定からリセットする）。

## 3. Auth設定（ダッシュボード・人間タスク）

1. Authentication → Sign In / Providers → Email: 有効・signup許可のまま。**Email OTP expiryを600秒**へ変更。
2. Email Templates: **「Magic Link」と「Confirm signup」の両テンプレート**を、リンク（`{{ .ConfirmationURL }}`）でなく**6桁コード`{{ .Token }}`だけを表示する本文**へ差し替える（signInWithOtpは既存ユーザーにMagic Link、新規ユーザーにConfirm signupテンプレートを使うため両方必要。ローカルの`app/supabase/templates/otp_code.html`と同等の文面にする）。
   **重要（2026-08-24確認）**: **2026-06-03以降に作成された新規Freeプロジェクトは、標準メールプロバイダのままだと本文・件名とも変更できない**（プラットフォーム制約。公式changelog #46599。Dashboard/Management API共通で、テンプレ項目のPATCHのみ400になることを対照実験で確認済み）。該当プロジェクトでは、カスタムSMTPを設定するとロックが解除される。標準SMTPは**組織メンバーのアドレス宛にしか配信されない**点にも注意。
   → stagingでは2026-08-25に、**staging専用Gmailアカウント**（2段階認証+アプリパスワード。資格情報はDashboardのSMTP設定へ直接入力し、リポジトリ・チャット・CIへは置かない）を`smtp.gmail.com`:`587`のカスタムSMTPとして設定し、テンプレートを6桁形式へ変更済み。**宛先制限・テンプレートロックとも解除済み**。Gmail SMTPは個人アカウント上限500宛先/日のstaging暫定構成であり、本番向けは独自ドメイン+専用プロバイダ（Resend等）をTask 010で導入する。
3. **Site URL: ローカル確認用URL `http://localhost:5173/cue-shinkan-demo/` を設定する。凍結中のGitHub Pages公開デモURLへは向けない。**本番URLへの変更は公開判断時に行う（`docs/launch_plan.md` §7 H8）。Redirect URLsは追加しない（OTPコード方式でリダイレクト不使用）。
4. Attack protection（CAPTCHA・レート強化）は既定のまま（最終化はTask 011）。

## 4. migrationの手動適用（開発者・ローカル端末から）

```bash
cd app
npx supabase link --project-ref <stagingのproject ref>   # アクセストークンは個人環境のみ
npx supabase db push                                      # app/supabase/migrations/ を適用
```

- CIからremote Supabaseへ自動適用するworkflowは作らない（Task 008の対象外）。
- 適用後、Project Settings → Data API の **Exposed schemas に`private`が含まれていない**ことを確認する（既定の`public, graphql_public`のまま）。
- 代替手順（直結Postgresへ到達できない実行環境向け・2026-08-24に実施）: Management APIのSQL実行エンドポイント`POST /v1/projects/{ref}/database/query`（postgres権限・HTTPS）で`app/supabase/migrations/`を番号順にそのまま実行し、あわせて`supabase_migrations.schema_migrations`へ`(version, name)`を記録するとCLIの`migration list`/`db push`と整合する。2026-08-24のstagingへは4migration（`20260824111223`〜`20260824111230`）を適用済み。
- Task 009の4migration（`20260825054000`〜`20260825054008`）も同じ手順で番号順に適用する。適用後はschema・RLS有効・policy・テーブル/関数grant（新規公開RPCは8本のみ）を読み戻しで確認する（検証記録は`tasks/009-server-data-migration.md`）。
  → **2026-08-28に、この0009の4本を含む未適用16本（0009〜0019）をDashboard SQL Editorから同方式で適用し、stagingは全20本になった**（各ファイル個別の`begin`〜記帳〜`commit`。詳細読み戻しの残りは同検証記録の追記を参照）。

## 5. 接続情報の配布

- Project Settings → API の **URL** と **publishable key** を各開発者へ手渡しし、`app/.env.local`へ設定する（配布するのはこの2値のみ。CAPTCHAの動作確認が必要な開発者にはTurnstileの**Site Key**＝公開値も渡してよいが、**Secret Keyは配布しない**・D057）。
- キーは**新形式（`sb_publishable_...` / `sb_secret_...`）を使用**する。stagingでは2026-08-24にlegacy `anon`/`service_role`キーを無効化済み（legacyキーでのアクセスは401になる）。`sb_secret_...`は配布せず、管理処理（テストユーザー作成・削除等）での一時利用に限る。

## 6. Phase B チェックリスト（人間+実装者）

**記録上の注意: 実在メールアドレス・OTPコード・招待トークンをスクリーンショット・PR・ログへ残さない。**結果はPR本文へチェックリストとして記録する。

> 2026-08-24: 下記2（実メール実配信）を除く全項目+追加の否定系（使用済み/取消/期限切れ招待・無効session・ログアウト後アクセス・RLS越権プローブ12件）を、staging接続のPlaywright自動検証33項目として完了（記録は`tasks/008-auth-and-authorization.md`「Phase B 検証記録」）。
> 2026-08-25: カスタムSMTP設定（§3）後に、本人所有の大学メールで「実配信→6桁コード確認→アプリ入力→ログイン成立→リロード復元」まで実機確認し、**全項目完了（Task 008最終完了）**。検証用authユーザーは削除済み。

1. [ ] ローカルの`npm run dev`をstagingへ接続（`.env.local`をstaging値へ）
2. [ ] **本人所有の大学メール1件だけ**でOTP送信→6桁コード検証が成功する
3. [ ] リロードでセッションが復元される
4. [ ] 新入生権限を作成できる（student_accounts）
5. [ ] 団体を作成できる（pending表示・自分がowner・プロフィール更新可）
6. [ ] 複数権限（同一人物が新入生+団体）でコンテキスト切替が機能する
7. [ ] 招待リンクの作成→承諾が機能する（第2アカウントは本人管理の別大学メール1件。用意できない場合はローカルで代替検証済みである旨を記録）
8. [ ] **ドメイン外identityがCUEデータへアクセスできない**: 本人管理のドメイン外メールでOTP認証→アプリがaccessBlocked表示になり、`is_university_user()`=false・全SELECT/RPCが失敗することを確認。**確認後、当該identityとテストデータをダッシュボードから削除する**
9. [ ] Data APIのExposed schemasに`private`が無いことを確認
10. [ ] 完了: PRへ「Phase B完了」を記録（ここで初めてTask 008最終完了）

## 6.1 Task 010（メール通知）の人間タスク

送信ワーカー（Edge Function）のデプロイとsecret設定は、Supabaseアクセストークンが
必要なため人間が行う。**secretはDashboardまたはCLIへ直接入力し、リポジトリ・CI・
PR・チャットへ置かない。**

1. Function secretを設定する（値はチャットへ貼らない）

   ```bash
   cd app
   npx supabase link --project-ref <stagingのproject ref>
   npx supabase secrets set CUE_SMTP_HOST=... CUE_SMTP_PORT=465 \
     CUE_SMTP_USER=... CUE_SMTP_PASSWORD=... CUE_SMTP_FROM=... \
     CUE_APP_URL=http://localhost:5173/cue-shinkan-demo/
   ```

   `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` はSupabaseが自動注入するため設定不要。

   **2026-08-28の実施記録（CLI不使用・Dashboardのみ）**: 上記1〜3をすべてDashboardで実施した
   （Edge Functions → Secrets／エディタで `index.ts`+`emailTemplate.ts` の2ファイルをデプロイ／
   Integrations → Cron `*/5 * * * *`）。実測で確定した2点:
   - **`CUE_SMTP_PORT` は `465`（暗黙TLS）を使う**。587のSTARTTLSはEdgeランタイムで
     `invalid cmd at SMTPConnection.assertCode` となり接続できない（launch_plan §7.1 E7）
   - 関数の「**Verify JWT with legacy secret**」は**OFF**にする。本プロジェクトはlegacyキーを
     無効化済み（§5）のため、ONだとCronからの呼び出しが恒常的に401になる。ワーカーの権限は
     DB側のservice_role専用RPCが握っており、OFFにしても呼び出し元へ権限は渡らない

2. デプロイする

   ```bash
   npx supabase functions deploy send-notifications
   ```

3. スケジュールを設定する（現行UIでは **Dashboard → Integrations → Cron**。
   初回は `pg_net` 拡張のインストールを求められるので有効化する）。
   5〜10分間隔を目安にする。まとめ（Asia/Tokyo 18時）を落とさない間隔にすること。

4. 確認する

   - 本人所有の大学メールで学生登録し、通知設定を「オファーごと」にする
   - 別アカウントの団体から配信し、**実際にメールが届く**ことを確認する
   - 件名・本文に団体名・イベント名・希望条件・返答状態が**含まれない**ことを目視で確認する
   - 本文の「通知の受け取り方の変更・停止」リンクから設定画面へ着地することを確認する
   - 「通知しない」にして再配信し、メールが届かないことを確認する
   - `email_outbox_health()` をservice_roleで呼び、`failed_count` が0であることを確認する
   - 確認後、検証用のauthユーザーとデータを削除する

## 6.2 Task 013（運営操作）の人間タスク

運営RPCは**service_role専用**のため、Dashboardの SQL Editor から実行する。
手順とSQLは`docs/operations.md`が正本。

1. staging/本番で、**閉鎖βに参加する団体を確認して`verified`にする**
   （`docs/operations.md` §2）。確認手順（部室・代表者・大学の団体登録など）は
   運営が定める。`actor_label`・`reason`に氏名・メールを書かない。
2. 緊急停止が効くことを、**公開前に一度試す**（`docs/operations.md` §5）。
   止める → 団体側から送信して`delivery_paused`になる → 戻す → 送信できる、まで確認し、
   確認後は必ず戻す。
3. `select * from public.admin_list_audit(100);` で、1・2の操作が記録されていることを確認する。

## 6.3 Task 014・015・017 の人間タスク（追加分）

Task 013時点のチェックリストに加えて、次を確認する。

1. [ ] **同意画面が登録より前に出る**（Task 015・D050）。新規の大学メールでログインし、
   「はじめる前に」が権限選択より先に出ること、同意しないと先へ進めないことを確認する
2. [ ] **未同意では団体側の操作ができない**。同意前に PostgREST から
   `accept_invitation` / `send_offer` を直接呼び、`consent_required` になることを
   SQL Editor か curl で確認する（8 RPCすべてを試す必要はない。2〜3本で足りる）
3. [ ] **本人によるデータ削除**（Task 014）。合成アカウントで
   興味パスポート削除 → アカウント削除まで通し、`public`・`private` に本人の行が
   残らないことを確認する（`docs/operations.md` §9 の抽出SQLを使う）
4. [ ] **退会後のauth identity削除**（H10）。`admin_delete_auth_identity` を実行し、
   `auth.users` から実際に消えるか、`auth.identities` / `auth.sessions` /
   `auth.refresh_tokens` が連鎖して消えるか、`auth.audit_log_entries` の
   JSON payload にメールが残り続けないかを確認する。
   **残る場合はAdmin API（`auth.admin.deleteUser`）へ寄せることを検討する**
5. [ ] **health check**（Task 017）。`select * from public.platform_health();` を
   service_role で実行し、1行返ること・値が実態と合っていることを確認する。
   とくに `auth.users` から作る4列（`confirmed_identities` /
   `identities_created_last_7d` / `non_university_identities` /
   `orphan_identities`）が `permission denied` にならず**値を返す**ことを見る。
   hosted は `auth` スキーマの権限がローカルスタックと同じとは限らないため、
   ここだけはローカルのpgTAPで担保できない
6. [ ] **緊急停止の往復**（Task 013 §6.2の2と同じ）を、公開直前にもう一度行う

## 7. 料金・運用上の注意（残余リスク）

- **Free projectは約1週間非アクティブでpauseされ得る**。Phase B実施前にプロジェクトが稼働中か確認し、停止時はダッシュボードからRestoreする。
- **Authログの保持期間は短い**（Freeは短期）。認証まわりの障害調査は発生当日中に行う。
- **Before User Created Hookを使わないため、ドメイン外のauth identityが`auth.users`へ残り得る**。定期的にダッシュボードのUsersを確認し、ドメイン外identityを削除する運用とする。恒久対策（CAPTCHA・Authレート制限・必要なら有償プラン/Hook再検討）は**Task 011へ引き継ぐ**。
- 組込みSMTPは低レートの開発用途向けで、**組織メンバーのアドレス宛にしか配信されず**、**新規Freeプロジェクト（2026-06-03以降作成）ではテンプレート変更も不可**（§3）。stagingでは2026-08-25にカスタムSMTP（staging専用Gmail）へ移行済み。
- **Task 010の通知メールもこのSMTPを共有する。** Gmailの個人アカウント上限（500宛先/日）は
  閉鎖βの規模では足りるが、本番では独自ドメイン+専用プロバイダへの移行が必要。
  上限に当たると `email_outbox` の `last_error_code` が `rate_limited` で積み上がるため、
  `email_outbox_health()` の `failed_count` を運用で監視する（Task 017）。

## 8. ロールバック

- コード: PRのrevert（`main`は無傷・Pagesは不変）。
- ローカルDB: `npm run db:reset`で常に再現。
- staging DB: 実データ投入前は**プロジェクトの削除・再作成が最も確実**。部分的に戻す場合はmigrationの逆順drop（policy→function→trigger→table→type→schema）を手動適用し、`supabase migration repair`で履歴を整合させる。
- Task 011のmigrationだけを戻す場合は注意が必要: `preview_offer_audience` / `send_offer` / `list_org_campaigns` を
  **drop→create で置き換えている**ため、単純なdropでは関数が消えるだけで前の版に戻らない。
  切り戻しには`20260825054005_0009_offer_rpcs.sql`の該当3関数の定義を再適用したうえで、
  0011で追加した3テーブル（`student_delivery_quota` / `offer_preview_cache` / `offer_funnel_snapshots`）と
  ヘルパー関数をdropする。3テーブルはいずれも再生成可能な派生データで、正本（配信・受信者・既読・返答）は失われない。
- Task 013のmigrationも同様に注意が必要: `list_my_inbox` / `list_org_campaigns` /
  `respond_to_offer` を**drop→create（または create or replace）で置き換えている**ため、
  単純なdropでは前の版に戻らない。切り戻しには`20260827040004_0011_funnel_suppression.sql`の
  `list_org_campaigns`、`20260825054005_0009_offer_rpcs.sql`の`list_my_inbox`・`respond_to_offer`を
  再適用したうえで、0013で追加した運営RPC 4本・`private.cancel_offer_mail`・
  `private.assert_delivery_allowed()`とトリガ・2テーブル（`platform_controls` / `admin_audit_log`）・
  `offer_deliveries`の2列をdropする。**停止済みのオファーは`stopped_at`列とともに消えるため、
  切り戻し前に停止対象を控えておく**（正本の配信・受信者・既読・返答は失われない）。
- **data-only restore（`pg_restore --data-only --disable-triggers`・論理レプリケーションのapply）を
  行うときは注意する**: Task 013の2つのトリガは`ENABLE ALWAYS`のため、
  `session_replication_role='replica'`でも発火する。復元前に
  ①`private.platform_controls`の`delivery_paused`を`false`に戻す
  ②`public.organizations`を先に復元する（未確認のまま配信行を入れると`org_not_verified`で失敗する）
  のいずれかを行うか、`alter table ... disable trigger`で一時的に外して復元後に戻す。
  `ENABLE ALWAYS`にしているのは、将来のレプリカ経路で安全装置が黙って外れないようにするため。
- Auth設定: テンプレート・OTP設定を既定へ戻し、テストで作成したauthユーザーを削除する。
