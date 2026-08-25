# Task 008: 認証・権限基盤

## 目的

Phase 2の土台として、大学メール（メールOTP）による登録・ログインと、新入生／団体担当者の権限分離をSupabase Auth + PostgreSQL + RLSで実装する。既存のlocalStorageデモは壊さず隔離する。

正本: `docs/auth_and_authorization.md`（設計）、`docs/decisions.md` D026〜D031（決定）、`docs/runbook_supabase_hosted.md`（hosted手順）。

## 前提（人間タスク）

- 実装開始前に`main`へbranch ruleset（PR必須・force push禁止・削除禁止）を設定済みであること。`develop`は作成直後に同等を設定。
- PRのbaseは`develop`。`main`と公開デモ（GitHub Pages）は凍結し、`deploy-pages.yml`は変更しない。

## 変更してよい範囲

- `docs/**`（Phase 2文書の整合）、`tasks/008-*.md`、`README.md`、`CLAUDE.md`、`AGENTS.md`
- `app/supabase/**`（CLI構成・migration・pgTAP・メールテンプレート）
- `app/src/**`の新設ディレクトリ（`lib/ auth/ account/ org/ shell/ demo/`）と`main.tsx`、`styles/auth.css`、`vite-env.d.ts`
- `app/package.json` / `package-lock.json` / `.gitignore` / `.env.example`
- `.github/workflows/ci.yml`（developトリガ+db-testsジョブ）

## 変更してはいけない範囲

- `.github/workflows/deploy-pages.yml`
- `app/src/domain/** features/** storage/** data/** components/**`と既存CSS・既存テスト（`App.tsx`の`demo/DemoApp.tsx`への移設を除く）
- `app/vite.config.ts`・`app/index.html`・`tasks/000〜007`・`prompts/**`

## 実装要件（要約）

1. 認証境界: クライアント正規化+事前拒否 / `is_university_user()`（現在の`auth.users.email`+`email_confirmed_at`）/ 全RLS・全RPCの必須条件（Hook不採用・D030）
2. メールOTP専用（6桁・両テンプレート差替え・Magic Link/パスワード不使用・存在有無非開示）
3. `student_accounts` / `organizations` / `organization_memberships`（行の存在＝権限の正本）+ `private.organization_invitations`（ハッシュのみ・Data API非公開）
4. SECURITY DEFINER RPC 9本（作成・更新・招待・一覧・承諾・担当者ラベル一覧）と最終ownerガードtrigger
5. deny by defaultのRLS/grant（新規オブジェクト限定の明示revoke/grant・anonゼロ・関数はPUBLIC/anon剥奪）
6. 一回限り招待リンク（#invite= hash・即URL除去・7日・単一使用・取消）
7. 認証済みシェル（コンテキスト切替・準備中画面）とデモ隔離（`demo/DemoApp.tsx`・実運用グラフからimport 0本・`cue-demo:*`不使用）
8. env未設定時はSetupNotice（クラッシュ・デモフォールバックなし）
9. CI: 既存qualityジョブ維持+developトリガ+ローカルSupabaseによるdb-testsジョブ（remote secretなし）

## 受入条件

### Phase A（ローカル実装）

- [x] `npm run lint` / `npm run test -- --run`（既存224件+新規が全green）/ `npm run build`（envなしで成功）
- [x] `npm run db:test`（pgTAP）が全green。少なくとも以下T1〜T18を検証している:
  T1 正ドメインだけが認証境界を通過 / T2 サブドメイン・類似・別ドメイン・空・plus付きの拒否 / T3 anonは読めない / T4 自分のstudent accountだけ読める / T5 他人のstudent account不可視 / T6 所属団体だけ読める / T7 団体外ユーザー不可視 / T8 新入生+団体所属の両立 / T9 一団体に複数アカウント / T10 一人が複数団体 / T11 一般利用者はverified化不可 / T12 direct DMLで迂回不可 / T13 団体作成+owner登録が原子的 / T14 招待の単一使用・期限・取消 / T15 他団体admin/ownerの招待操作不可 / T16 団体向けサーフェスに学生PII・学生一覧なし / T17 ドメイン外へ変更された既存ユーザーの遮断 / T18 最終owner喪失の拒否
- [x] MailpitでOTPメール（6桁）を受信し、登録→ログイン→権限登録→団体作成→招待承諾→切替の手動QAが通る（幅390px）
- [x] Playwright E2E（`npm run e2e` / CIの`e2e` check）が全green。`app/e2e/task008-auth.spec.ts`が上記の主要導線（クライアント側ドメイン拒否・正規化・OTPメール本文・セッション復元・団体作成/pending/owner・プロフィール保存後のコンテキスト維持・切替・招待の一度きり表示/承諾/hash即除去/再利用不可・担当者一覧のPIIなし・`cue-demo:*`不使用・390px横スクロールなし）を自動検証する
- [x] 認証済みシェルが`cue-demo:*`を読み書きしない・distにデモ画面が含まれない・認証迂回経路がない
- [x] リポジトリ・CI・ビルドにsecret・実在メール・トークンが含まれない（`.env.local`はgit外）

### Phase B（hosted staging確認）

- [x] `docs/runbook_supabase_hosted.md` §6のチェックリストを完了し、結果を記録（下記「Phase B 検証記録」）
- [x] **Phase B完了までは「実装完了・hosted検証待ち」とし、Task 008の最終完了と判定しない**（2026-08-25: カスタムSMTP経由の実メール6桁ログインまで全項目完了し、**Task 008最終完了**）

### Phase B 検証記録（2026-08-24 自動実行）

- **staging構築**: `cue-shinkan-staging`（project ref `cyjmduaijtdihfesawvd`・region `ap-northeast-1`・組織 `cue-shinkan-staging`）。組織はAPI読み戻しで`plan: free`（0円）を確認。project status `ACTIVE_HEALTHY`
- **migration適用**: 実行環境から直結Postgres（直結ホストはIPv6のみ・poolerへの生TCPは不可）へ到達できないため、`db push`と同等のManagement API SQLエンドポイント（postgres権限・HTTPS）で4migration（`20260824111223`〜`20260824111230`）を番号順に適用し、CLI互換の`supabase_migrations.schema_migrations`へ履歴を記録。適用後の読み戻しで、テーブル4・全RLS有効・policy構成・関数EXECUTE（PUBLIC/anon残存ゼロ・authenticated付与は公開RPC 9本のみ）・スキーマ/テーブル権限マトリクスを確認
- **Auth設定**: site_url=`http://localhost:5173/cue-shinkan-demo/`・OTP有効期限600秒・6桁・signup有効（PATCH後にGET読み戻しで確認）。**メールテンプレート・件名は変更不可**: 2026-06-03以降に作成された新規Freeプロジェクト+標準メールプロバイダではプラットフォーム側でロックされる（公式changelog #46599。対照実験: 同一トークン・同一エンドポイントで非テンプレ項目PATCH=200／テンプレ項目のみ=400）。6桁コードのメール本文化はカスタムSMTP設定で解禁される → 2026-08-25: staging専用Gmailアカウント（2段階認証+アプリパスワード。資格情報はDashboardのSMTP設定へ直接入力し、リポジトリ・チャットへは置かない）を`smtp.gmail.com:587`のカスタムSMTPとして設定してロックを解除し、両テンプレートを`{{ .Token }}`の6桁形式へ変更（読み戻しで`{{ .Token }}`あり・リンクなしを機械確認）
- **APIキー移行**: 新形式`sb_publishable_...`（アプリ接続用）と`sb_secret_...`（テストユーザー管理のみの一時利用）の動作確認後、legacy `anon`/`service_role`キーを無効化（無効化後legacy=401・新形式正常を確認）。作業中にセッション画面へ露出したlegacy HS256 JWT secretは署名キーとしてrevoke済み（主署名はES256・ユーザーゼロ時点のため影響なし）
- **自動検証: 33項目すべて合格**: 架空`@stu.kobe-u.ac.jp`2名+ドメイン外1名を管理APIで作成し（メール送信なし。6桁OTPは`generate_link`の`email_otp`を実際の`verifyOtp`で検証してsession確立）、staging接続のローカルアプリ（390×844）をPlaywrightで駆動。合格範囲: クライアント第一ゲート（plus・別ドメイン拒否）／正規化（前後空白+大文字入力が小文字trim済みで送信・送信失敗時の安全表示）／session成立・リロード復元／新入生登録／団体作成（審査待ち・owner匿名ラベル・自分バッジ）／プロフィール保存後のコンテキスト維持と保存内容の永続化／新入生⇄団体切替／招待リンク（一度きり表示・hash即時除去・団体名/役割の事前表示・別ユーザー承諾・担当者2人・PII非表示・使用済み/取消済み/期限切れの汎用エラー・UIからの取消）／RLS・権限RESTプローブ12件（自行のみ可視・他ユーザー団体の不可視・直接UPDATE/INSERT拒否・anonゼロ・privateスキーマ406・ドメイン外ユーザーの全遮断）／accessBlocked表示とログアウト導線／無効・期限切れsessionの拒否／ログアウト後に保護画面へ戻れない／localStorageは`sb-*`のみ／横スクロールなし／予期しない失敗リクエスト・console errorゼロ
- **既知の制約（修正せず記録）**: サインイン済みタブで同一URLのhashのみを`#invite=`へ変更しても招待処理は走らない（hosted実機で再現確認。同じURLを再読込すれば処理される。Task 008の受入条件外のため修正しない）
- **実メールOTP実配信（2026-08-25完了）**: カスタムSMTP設定後、本人所有の大学メール1件でアプリUIから送信→実受信（件名【CUE】登録コード・本文に6桁コードあり・リンクなしを本人確認）→受信した6桁コードでログイン成立→リロード後のsession復元まで実機確認（390px・localStorageは`sb-*`のみ・横スクロールなし）。Gmail SMTPは個人アカウント上限500宛先/日のstaging暫定構成で、本番向けは独自ドメイン+専用プロバイダをTask 010で導入する
- **後片付け**: 作成した団体・membership・招待・student_accounts・authユーザーを削除し、`organizations`/`organization_memberships`/`student_accounts`/`private.organization_invitations`/`auth.users`のcount=0を確認。実配信検証後も、検証用authユーザー2件（大学メール1件・SMTP疎通確認用Gmail1件）を削除して全5系統count=0を再確認。secret key・DBパスワード・session・メールアドレス・OTPの一時ファイルは破棄済み（`.env.local`はURL+publishable keyの2行のみ）

## 対象外

- localStorageデータの移行・興味パスポート/オファー等のSupabase接続（→009）
- Resend・通知・Edge Function（→010）
- CAPTCHA・本番レート制限・ドメイン外identity対策の恒久化・運営管理画面（→011）
- 招待承諾以外のメンバー追加、メンバー削除（脱退含む）、role変更のUI/RPC
- 本番Supabaseへの自動デプロイ・Pages公開内容の変更・`main`へのマージ
