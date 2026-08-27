# 認証・権限設計（Phase 2正本）

- Status: Accepted（2026-08-24承認。決定はdocs/decisions.md D026〜D031）
- 対象: Task 008（認証・権限基盤）以降のPhase 2全体
- 実装: `app/supabase/migrations/`（DB正本）、`app/src/`（クライアント）

## 1. 認証境界

Before User Created Hookは採用しない（現行プランではTeam以上限定のため。D030）。認証境界は次の3層で構成する。

1. **クライアント（UX兼第一ゲート）**: `normalizeUniversityEmail()`で正規化した値が判定を通らない限り、OTP送信リクエスト自体を行わない（`app/src/auth/universityEmail.ts`）。
2. **サーバー正本**: `public.is_university_user()`が、`auth.uid()`に対応する**現在の`auth.users.email`**（正規化判定）と**`email_confirmed_at IS NOT NULL`**（OTP検証済み）を確認する。JWTクレームやuser_metadataは使わない。
3. **適用範囲**: `student_accounts`の作成・参照、団体の作成・参照・更新、団体招待の作成・承諾——**すべてのRLS policyとSECURITY DEFINER RPC**が`is_university_user() = true`を必須条件とする。

**受容する残余リスク**: 悪意ある利用者がSupabase Auth APIを直接呼び、ドメイン外メールのauth identityを作成し得る（OTPメール送信も発生し得る）。ただしそのidentityは**CUEのアプリケーションアカウント・学生データ・団体データを一切作成・参照・変更できない**。対応する受入条件は「ドメイン外のメールではCUEのアプリケーションアカウントを作成できず、CUEの全データ・RPCへアクセスできない」である。緩和策（CAPTCHA・Authレート制限・identity掃除運用）はTask 011で実施する。

メール変更でドメイン外になった既存アカウントも、`is_university_user()`が現在値を読むため同様に全遮断される（アプリはaccessBlocked画面を表示し、ログアウトのみ提供する）。

## 2. メール許可規則と正規化（D028）

- 正規化: クライアントは`normalizeUniversityEmail(raw) = raw.trim().toLowerCase()`を唯一の正規化関数とし、**検証と`signInWithOtp()`・`verifyOtp()`の双方へ正規化済み値を渡す**。SQL側は`lower(btrim(email))`を前段適用する。
- 判定（正規化後）: ローカル部は空でなく「@」「+」「空白」を含まない。ドメインは`stu.kobe-u.ac.jp`へ完全一致。学籍番号の文字種など、これ以上に狭い形式は推測しない。
- 参照実装: TS `/^[^@+\s]+@stu\.kobe-u\.ac\.jp$/`、SQL `lower(btrim(email)) ~ '^[^@+[:space:]]+@stu\.kobe-u\.ac\.jp$'`。
- 判定表は`app/src/auth/universityEmail.test.ts`と`app/supabase/tests/02_domain_functions_test.sql`で**同一ケース**を検証する（plus addressing・サブドメイン・類似ドメイン・後置ドメイン・空・@二重・内部空白などの拒否を含む）。

## 3. 認証フロー（メールOTP）

- 登録とログインは`signInWithOtp({ email, options: { shouldCreateUser: true } })`の一導線に統合する。`emailRedirectTo`は渡さない＝Magic Link不使用。検証は`verifyOtp({ email, token, type: 'email' })`。
- メールテンプレートは`{{ .Token }}`（6桁コード）のみを表示する。signInWithOtpは既存ユーザーにmagic_link、新規ユーザーにconfirmationテンプレートを使うため**両方**を差し替える（ローカル: `app/supabase/config.toml` + `app/supabase/templates/otp_code.html`。hosted: runbook参照）。
- OTP有効期限は600秒、再送はクライアント側60秒クールダウン。
- **アカウントの存在有無を判別できる表現を出さない**: 新規・既存で成功表示を変えない。送信失敗はレート制限/汎用の2分類の定型文のみ。コード検証失敗は「正しくないか期限切れ」の単一文言。
- エラー表示・ログへメールアドレス・コード・トークンを出さない（画面はメールのエコーバックもしない）。
- セッションはauth-jsが自身のキー（`sb-*`）で永続化・復元する。ログアウトは`signOut()`。

## 4. 権限モデル（D026）

- **単一roleカラム・選択中のUIモードを認可根拠にしない。**
- 新入生権限の正本 = `public.student_accounts`の**行の存在**（PII列なし）。
- 団体権限の正本 = `public.organization_memberships`の**行の存在**（Task 008では行の存在＝有効な所属。有効フラグ・期限は持たない）。
- 一人が新入生権限と団体所属を同時に持てる。一人が複数団体へ所属できる。一団体に複数の人間アカウントが所属できる（共有アカウント禁止）。
- 団体内権限は`owner / admin / member`、団体状態は`pending / verified / suspended`。作成直後はpending。**verified化は運営専用経路（ダッシュボード/SQL）のみ**で、クライアントから変更する経路は存在しない。
- 所属行を作る経路は「団体作成時のowner登録（create_organization）」と「招待承諾（accept_invitation）」の2つだけ。**それ以外のメンバー追加・削除（脱退含む）・role変更はTask 008の対象外**（UI・RPCとも存在しない。DB側は直接DML遮断と最終ownerガードのみ）。
- 最後のownerを失う操作（demote・削除・付替え）はtrigger（`private.protect_last_owner`）が拒否する。団体ごとのcascade削除は許容する。
- コンテキスト切替（新入生⇄団体）はUI状態のみで、リロード後は既定へ戻る。認可は常にサーバーが判定する。

## 5. データベース構成

| スキーマ | 内容 | 公開 |
|---|---|---|
| `public` | enum（`org_role`・`org_status`）、`student_accounts`・`organizations`・`organization_memberships`、クライアント公開RPC | Data API公開対象。grantは§7の最小限のみ |
| `private` | `organization_invitations`、内部関数（メール判定・orgヘルパ・ラベル生成・trigger関数） | **Data API非公開**。anon/authenticatedへschema usageを含む一切の権限なし |

Task 009はこの構成に従い、興味パスポート（`public.student_passports`）と配信・受信者・既読・返答（`private.offer_*` 4テーブル）を追加した。詳細は`docs/server_data_model.md`を正本とする。

- enumをpublicへ置く理由: public表とRPCの引数・戻り値に現れ、`supabase gen types`の生成型（`app/src/lib/database.types.ts`）へenumリテラル型として含める必要があるため。
- 招待テーブルは生トークンを保存せず**SHA-256ハッシュのみ**。メール指定招待を行わないため招待先メール列は存在しない。
- migrationは`app/supabase/migrations/`の4本（schema→domain functions→RPC→RLS/grant）。ロールバックは逆順のdrop（policy→function→trigger→table→type→schema）で行う。実データ投入前はstagingプロジェクトの削除・再作成が最も確実。

## 6. RPC一覧（クライアント公開はこの9本のみ）

| RPC | 権限条件（関数内で検証） | 内容 |
|---|---|---|
| `is_university_user()` | authenticated | 認証境界の判定（accessBlocked表示にも使用） |
| `create_organization(org_name, org_description)` | 大学ユーザー | 団体（pending固定）+ owner所属を単一トランザクションで作成 |
| `update_organization_profile(org_id, new_name, new_description)` | 対象団体のowner/admin | 名称・紹介文の検証付き更新。**statusは引数に存在せず変更不能** |
| `create_invitation(org_id, invited_role)` | 対象団体のowner/admin | 一回限り招待を作成。**生トークンはこの戻り値で一度だけ返す**。invited_roleはmember/adminのみ |
| `revoke_invitation(invitation_id)` | 対象団体のowner/admin | 未使用招待の取消。不存在と権限不足を区別しない単一エラー |
| `list_invitations(org_id)` | 対象団体のowner/admin | 招待一覧（token_hash・作成者user_idは返さない） |
| `preview_invitation(invitation_token)` | 大学ユーザー | 承諾前に団体名・付与role・期限を開示。無効理由は区別しない |
| `accept_invitation(invitation_token)` | 大学ユーザー | FOR UPDATEで単一使用を原子的に消費し所属を作成。既メンバーはトークン不消費 |
| `org_member_directory(org_id)` | 対象団体のメンバー | 担当者一覧。**返す列はラベル・権限・参加日時・自分かどうかの4列のみ** |

関数権限の原則: **全作成関数はCREATE直後に`PUBLIC`と`anon`のEXECUTEを明示剥奪**し、上記9本だけを`authenticated`へ個別grantする。内部ヘルパー・メール判定・trigger関数はprivateスキーマにありクライアントから実行できない。想定外のEXECUTE残存はpgTAP（`01_grants_anon_test.sql`）がカタログ走査で検査する。

## 7. RLS・grant方針

- deny by default。grant/revokeは**Task 008で新規作成したオブジェクトだけをスキーマ修飾で明示指定**する（`revoke ... on all tables`や`alter default privileges`は使わない。後続Taskの新テーブルは各migrationで個別にdeny by defaultを設定する）。
- すべてのpolicyは`(select public.is_university_user())`を必須条件に含める。policyはヘルパー関数でなく**インラインEXISTS副問い合わせ**を使う。
- テーブルgrant: `student_accounts` = authenticatedへSELECT/INSERTのみ（自分の行のみのpolicy）。`organizations` = SELECTのみ（所属団体のみ。書込はRPC経由）。`organization_memberships` = SELECTのみ（自分の所属行のみ）。`organization_invitations` = grantゼロ+RLS有効policyゼロ（RPC経由のみ）。anonはすべてゼロ。
- `auth.users`はSupabase既定どおりanon/authenticatedから読めない（変更しない）。service_role相当のキーはフロントエンド・CI・リポジトリへ一切置かない。

## 8. 団体招待（一回限りリンク）

- リンク形式: `<アプリURL>#invite=<hex64トークン>`。hashフラグメントのためサーバー・アクセスログへ送信されない。
- アプリは起動時（createRoot前）にトークンを1回だけ取り出し、**直ちに`history.replaceState`でURLから除去**する。以後トークンはメモリにのみ存在し、storage・ログ・画面へ出さない（招待URL表示は作成直後の一度きり表示のみ）。
- 生成: `gen_random_bytes(32)`（256bit）。DBはSHA-256 hexのみ保存。総当たり・DB漏えい耐性の根拠。
- 有効期限7日・単一使用（`for update`で原子的に消費）・owner/adminによる取消。
- 承諾者は大学メール認証済みであること。承諾前に`preview_invitation`で団体名・役割を確認し、明示ボタンで承諾する。
- 失敗応答は無効/期限切れ/取消済み/使用済みを区別しない単一エラー。既メンバーのみ`already_member`（トークンは消費しない）。
- サインイン前にリンクを開いた場合はログイン後に承諾へ合流する。タブを閉じても未使用・期限内なら同じリンクで再開できる。
- 招待の大量発行抑止（レート制限）はTask 011。

## 9. 個人情報・secretの絶対条件（D029）

- メールは`auth.users`以外へコピーしない。`public`スキーマ・ログ・テスト出力・PR・スクリーンショットへ出さない（ローカル部は学籍番号相当の機密）。
- 氏名・学籍番号はTask 008では収集しない。raw user metadataへ権限・氏名を保存しない。
- 団体向けのtable・view・RPC・生成型に、学生のメール・氏名・学籍番号・`auth.users.id`・配信対象学生ID一覧を含めない。Task 009の集計APIも匿名件数のみを返す。
- ブラウザ・`VITE_*`・リポジトリ・CIへ置いてよいのは`VITE_SUPABASE_URL`と`VITE_SUPABASE_PUBLISHABLE_KEY`（実値は`.env.local`のみ、コミットは`.env.example`のプレースホルダーのみ）。secret key・legacy service-role key・DBパスワード・Supabaseアクセストークン・Resend APIキーは絶対に置かない。
- テストデータは架空の`demo-*@stu.kobe-u.ac.jp`のみ。実在の学生・団体・連絡先を使わない。

## 10. localStorageデモとの境界

- 旧デモ本体は`app/src/demo/DemoApp.tsx`へ隔離した。実運用グラフ（`main.tsx`→`AppRoot`）からのimportは0本で、本番バンドルに含まれない（`tsc -b`と既存テストで品質は維持）。
- 認証済みシェルは`cue-demo:*`のlocalStorageキーを読み・書き・削除しない。移行・削除の判断はTask 009。
- 認証を迂回してデモへ到達する隠しURL・クエリ・ビルドフラグを作らない。env未設定時はSetupNotice（案内画面）でありデモへフォールバックしない。公開デモの正本はmain（GitHub Pages・凍結中）。

## 11. Task 009へ引き継ぐ契約

1. 学生の正本ID = `auth.uid()`（= `student_accounts.user_id`）、団体 = `organizations.id`。新テーブルはこれらへFKする。
2. 全新テーブルのRLSに`(select public.is_university_user())`を必須条件として含める。policyはインラインEXISTS、RPC内部は`private.is_org_member` / `private.org_role_at_least`を再利用する。
3. 団体向けAPIは個人単位データを返さず、SECURITY DEFINER RPCで匿名件数のみ返す（PIIサーフェスのpgTAPを009でも必須化）。
4. grantは新規オブジェクト単位の明示revoke→最小grant（008のmigrationを規範例とする）。非公開データはprivateスキーマ+RPC限定パターン。
5. migration・pgTAP・生成型（`npm run db:types`）・CI `db-tests`ジョブの構成を踏襲する。
6. 残余リスク（ドメイン外identity・OTP送信悪用・招待スパム）への恒久対策はTask 011のスコープ。
