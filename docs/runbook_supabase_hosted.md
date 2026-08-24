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

## 3. Auth設定（ダッシュボード・人間タスク）

1. Authentication → Sign In / Providers → Email: 有効・signup許可のまま。**Email OTP expiryを600秒**へ変更。
2. Email Templates: **「Magic Link」と「Confirm signup」の両テンプレート**を、リンク（`{{ .ConfirmationURL }}`）でなく**6桁コード`{{ .Token }}`だけを表示する本文**へ差し替える（signInWithOtpは既存ユーザーにMagic Link、新規ユーザーにConfirm signupテンプレートを使うため両方必要。ローカルの`app/supabase/templates/otp_code.html`と同等の文面にする）。
3. **Site URL: ローカル確認用URL `http://localhost:5173/cue-shinkan-demo/` を設定する。凍結中のGitHub Pages公開デモURLへは向けない。**本番URL・新実運用URLへの変更はTask 011の公開判断時に行う。Redirect URLsは追加しない（OTPコード方式でリダイレクト不使用）。
4. Attack protection（CAPTCHA・レート強化）は既定のまま（最終化はTask 011）。

## 4. migrationの手動適用（開発者・ローカル端末から）

```bash
cd app
npx supabase link --project-ref <stagingのproject ref>   # アクセストークンは個人環境のみ
npx supabase db push                                      # app/supabase/migrations/ を適用
```

- CIからremote Supabaseへ自動適用するworkflowは作らない（Task 008の対象外）。
- 適用後、Project Settings → Data API の **Exposed schemas に`private`が含まれていない**ことを確認する（既定の`public, graphql_public`のまま）。

## 5. 接続情報の配布

- Project Settings → API の **URL** と **publishable key** を各開発者へ手渡しし、`app/.env.local`へ設定する（この2値以外は配布しない）。

## 6. Phase B チェックリスト（人間+実装者）

**記録上の注意: 実在メールアドレス・OTPコード・招待トークンをスクリーンショット・PR・ログへ残さない。**結果はPR本文へチェックリストとして記録する。

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

## 7. 料金・運用上の注意（残余リスク）

- **Free projectは約1週間非アクティブでpauseされ得る**。Phase B実施前にプロジェクトが稼働中か確認し、停止時はダッシュボードからRestoreする。
- **Authログの保持期間は短い**（Freeは短期）。認証まわりの障害調査は発生当日中に行う。
- **Before User Created Hookを使わないため、ドメイン外のauth identityが`auth.users`へ残り得る**。定期的にダッシュボードのUsersを確認し、ドメイン外identityを削除する運用とする。恒久対策（CAPTCHA・Authレート制限・必要なら有償プラン/Hook再検討）は**Task 011へ引き継ぐ**。
- 組込みSMTPは低レートの開発用途向け。多人数での試用が始まる前（Task 010）にカスタムSMTP（Resend等）へ移行する。

## 8. ロールバック

- コード: PRのrevert（`main`は無傷・Pagesは不変）。
- ローカルDB: `npm run db:reset`で常に再現。
- staging DB: 実データ投入前は**プロジェクトの削除・再作成が最も確実**。部分的に戻す場合はmigrationの逆順drop（policy→function→trigger→table→type→schema）を手動適用し、`supabase migration repair`で履歴を整合させる。
- Auth設定: テンプレート・OTP設定を既定へ戻し、テストで作成したauthユーザーを削除する。
