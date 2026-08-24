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

- [ ] `npm run lint` / `npm run test -- --run`（既存224件+新規が全green）/ `npm run build`（envなしで成功）
- [ ] `npm run db:test`（pgTAP）が全green。少なくとも以下T1〜T18を検証している:
  T1 正ドメインだけが認証境界を通過 / T2 サブドメイン・類似・別ドメイン・空・plus付きの拒否 / T3 anonは読めない / T4 自分のstudent accountだけ読める / T5 他人のstudent account不可視 / T6 所属団体だけ読める / T7 団体外ユーザー不可視 / T8 新入生+団体所属の両立 / T9 一団体に複数アカウント / T10 一人が複数団体 / T11 一般利用者はverified化不可 / T12 direct DMLで迂回不可 / T13 団体作成+owner登録が原子的 / T14 招待の単一使用・期限・取消 / T15 他団体admin/ownerの招待操作不可 / T16 団体向けサーフェスに学生PII・学生一覧なし / T17 ドメイン外へ変更された既存ユーザーの遮断 / T18 最終owner喪失の拒否
- [ ] MailpitでOTPメール（6桁）を受信し、登録→ログイン→権限登録→団体作成→招待承諾→切替の手動QAが通る（幅390px）
- [ ] 認証済みシェルが`cue-demo:*`を読み書きしない・distにデモ画面が含まれない・認証迂回経路がない
- [ ] リポジトリ・CI・ビルドにsecret・実在メール・トークンが含まれない（`.env.local`はgit外）

### Phase B（hosted staging確認）

- [ ] `docs/runbook_supabase_hosted.md` §6のチェックリストを完了し、結果をPRへ記録
- [ ] **Phase B完了までは「実装完了・hosted検証待ち」とし、Task 008の最終完了と判定しない**

## 対象外

- localStorageデータの移行・興味パスポート/オファー等のSupabase接続（→009）
- Resend・通知・Edge Function（→010）
- CAPTCHA・本番レート制限・ドメイン外identity対策の恒久化・運営管理画面（→011）
- 招待承諾以外のメンバー追加、メンバー削除（脱退含む）、role変更のUI/RPC
- 本番Supabaseへの自動デプロイ・Pages公開内容の変更・`main`へのマージ
