# Task 021: OTP送信へのCAPTCHA（Cloudflare Turnstile）導入

## 目的

公開バンドルのpublishable keyで誰でもAuth APIを直接呼べるため、CAPTCHAが無いと
第三者の実在大学アドレスへ勝手にOTPメールを送りつける嫌がらせと、送信元アカウントの
停止（§7.1 B7・E6）が可能なままになる。D030がTask 011へ委ねたまま未実施だった
CAPTCHA導入を、Cloudflare Turnstileで実装する（H11bの実装側・D057）。

## 正本

- `docs/launch_plan.md` §7.1 B7（P1）・§7.2 H11
- `docs/decisions.md` D030・D057
- `docs/auth_and_authorization.md` §3（OTP導線）
- GoTrue v2.195.0 実装（`verifyCaptcha` middlewareは `/otp`・`/signup` 等に付き、
  `/verify` には付かない — 検証エンドポイントはCAPTCHA対象外）

## 確定要件

1. sitekey（`VITE_TURNSTILE_SITE_KEY`）**未設定なら完全に従来どおり**:
   ウィジェットを描画せず、外部スクリプトを読み込まず、captchaTokenも送らない。
   ローカルスタック・CI・E2EはSupabase側CAPTCHA無効のままこの経路で動く
2. sitekey設定時: メール入力画面とコード画面（再送用）にTurnstileウィジェットを表示し、
   トークン取得まで「6桁コードを送る」「コードを再送する」を無効化する
3. トークンは `/otp` 呼び出し1回ごとの単回使用として扱い、送信のたび（成功・失敗とも）に
   破棄してウィジェットをリセットする
4. トークンの期限切れ・エラー時は安全にnullへ戻し、再取得できる。
   スクリプト読み込み失敗時はエラーを表示する（黙って無効化しない）
5. OTP処理の他の性質（ドメイン判定・再送クールダウン・エラー文言・
   新規/既存の無差別表示・verifyOtp）は変更しない
6. secret keyはアプリ・リポジトリ・CIへ置かない（Supabase Dashboardのみ）。
   外部スクリプトは `challenges.cloudflare.com` のみ
7. `deploy-pages.yml` の検証ステップが、sitekey未設定・空白・形式異常（`0x`以外）・
   ビルド成果物への不在でdeployを止める（本番はCAPTCHA有効前提のため必須値）
8. 既存E2E・unit・buildがすべてgreen（ローカルはウィジェット不在のまま）

## In scope

- `app/src/auth/turnstile.ts`（新規: sitekey読み取り・スクリプト読み込み）
- `app/src/auth/TurnstileWidget.tsx`（新規: 描画・トークン通知・リセット）
- `app/src/auth/SignInScreen.tsx`（ゲートとトークン受け渡しのみ）
- `app/src/styles/auth.css`（ウィジェットの余白）
- `app/e2e/task021-captcha.spec.ts`（新規: 未設定時の不活性を固定）
- `.github/workflows/deploy-pages.yml`（sitekeyの受け渡しと検証）
- 文書: 本ファイル / D057 / `docs/launch_plan.md` / `docs/auth_and_authorization.md`

## Out of scope（禁止事項）

- Supabase側のCAPTCHA有効化（人間の操作。merge後にH11bとして実施）
- 認証・認可モデル・RLS・RPC・DB・migrationの変更
- 新しいnpm依存の追加（Turnstileはスクリプトタグで読み込む。公式型パッケージも入れない）
- ローカルスタック `config.toml` のCAPTCHA有効化

## 受入条件

1. sitekey未設定: `.turnstile-widget`・cloudflare iframe/scriptが存在せず、
   メールが正しければ送信ボタンが有効（E2E C1で固定）
2. sitekey未設定: `signInWithOtp` のoptionsに `captchaToken` キー自体が入らない
3. sitekey設定時: トークン取得まで送信・再送ボタンが無効
4. 送信のたびにトークンを破棄しウィジェットをリセットする（単回使用）
5. スクリプト読み込み失敗でエラーメッセージ表示（`role="alert"`）
6. 期限切れ・エラーのcallbackでトークンがnullへ戻る
7. `deploy-pages.yml` が sitekey 未設定/空白/非`0x`/成果物不在 でfailする
8. 既存suite（unit / E2E / build / lint / tsc）全green
9. secret key・実在PIIがリポジトリに無い
10. 文書（D057・launch_plan H11・auth_and_authorization §3）が実装と一致

## Test plan

- unit: `readTurnstileSiteKey`（未設定/空/空白/trim）
- E2E: `task021-captcha.spec.ts` C1（未設定時の不活性＋従来フロー到達）
- sitekey設定時の実挙動: **hosted smoke test A で確認**（実CAPTCHAは外部サービスのため
  CIで自動化しない。ローカルでの手動確認は `.env.local` に sitekey を置けば可能）

## Rollback

- UI層＋CI検証のみの変更。revert PRで戻せる（DB・migrationに触れない）。
  revert時はSupabase側のCAPTCHAを先に無効化する（アプリがトークンを送らなくなるため）

## Verification record

### 実行した検証（2026-08-28・実測）

| 検証 | 結果 |
|---|---|
| unit（vitest） | **32ファイル 373件 PASS**（`turnstile.test.ts` +3: 未設定null / 空・空白null / trim） |
| tsc -b / oxlint / vite build | すべてgreen（e2e含む全tsconfig） |
| pgTAP・並行テスト | **対象外**（DB・RPC・migrationに一切触れない） |
| E2E | 新規 `task021-captcha.spec.ts` C1（未設定時の不活性＋従来フロー到達）。既存17本と合わせ**CIで実行**（ローカルにDocker無し） |
| 実機確認（読み込み失敗パス・AC5） | **実施**: テスト用sitekey＋devサーバー＋chromiumで、スクリプト読み込みが遮断される環境（実行環境のproxyが `challenges.cloudflare.com` を遮断）を利用し、エラー文言表示・送信ボタン無効維持・390px幅でレイアウト崩れなしを目視（スクリーンショット2枚） |
| 実ウィジェット描画（sitekey設定時） | **未検証**（外部スクリプトへ到達できる環境が無い）。**公開後smoke test Aで確認する** |
| GoTrue側の仕様確認 | v2.195.0ソースで `verifyCaptcha` middlewareの適用先を確認（`/otp` 等のみ・`/verify` 無し）。auth-js 2.112.4の `VerifyEmailOtpParams.options.captchaToken` が@deprecatedであることも確認 |

### 受入条件の消化

1・2: E2E C1 + 実装（optionsへの条件付き展開） / 3: 実装（`sendOtp` 内で常に破棄・リセット）
/ 4〜6: 実装 + 実機確認（AC5は上記の目視） / 7: `deploy-pages.yml` 検証ステップ
（実際の発火はCIでなくdeploy実行時のため、**mergeの後のdry_run空撃ちで確認する**）
/ 8: unit・build・lintはローカルgreen、E2EはCI判定 / 9: 差分にsecret・PIIなし
/ 10: D057・launch_plan §7表・§7.2 H11・auth_and_authorization §3を更新済み

### 独立レビューの結論と対応（2026-08-28）

- **reviewer**: 「修正後に再レビュー」— Blocker B1（auth正本§9の許可リストが
  `VITE_TURNSTILE_SITE_KEY` を含まず実装と矛盾）+ N1〜N5 + Nit
- **security-reviewer**: 「承認可・Blockerなし」— Non-blocker 6件（B1と同件の§9・
  vite-env.d.ts・supply chain明文化・editEmail時のトークン残存・
  読み込み失敗キャッシュ・H11b文言）
- 対応（すべて本ブランチで修正）: §9許可リストへ3値目を追記しTurnstile Secret Keyを
  禁止側へ明記 / `vite-env.d.ts`・`.env.example`・README・hosted runbook §5の
  許可リスト記述を更新 / ウィジェットunmount時にトークンを破棄（画面とトークンの一致）/
  `turnstile_unavailable` でも読み込み失敗をキャッシュしない / E2E C1へ
  `/otp` リクエストボディの `captcha_token` 不在検査（受入条件2の直接固定）と
  コード画面のスクリプト不在検査を追加 / D057へsupply chain残余リスクの受容を明記 /
  launch_plan H11b手順1の条件を精密化（merge≠deploy）

### 残る課題

- sitekey設定時の実挙動（ウィジェット表示・token送信・Supabase側検証）は
  **H11b有効化後の公開後smoke test A**が最終確認
- deploy検証ステップの新規検査は、merge後に `dry_run` 空撃ちで発火確認する
- **supply chain（受容・D057）**: sitekey設定時は `challenges.cloudflare.com` の
  スクリプトがログイン画面で実行される（CAPTCHA製品共通の構造）。
  CSP metaによる `script-src` 限定は将来のhardening候補
