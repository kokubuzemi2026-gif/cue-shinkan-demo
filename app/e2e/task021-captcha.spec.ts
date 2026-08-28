import { expect, test } from '@playwright/test'

// Task 021 CAPTCHA（Turnstile）のE2E（tasks/021-turnstile-captcha.md）。
//
// ローカルスタック・CIは VITE_TURNSTILE_SITE_KEY 未設定＝CAPTCHA不活性で動く。
// ここで固定するのは「未設定なら従来どおり」の側:
// ウィジェットも外部スクリプトも現れず、送信ボタンがCAPTCHAに関係なく有効になる。
// sitekey設定時の実挙動（ウィジェット表示・token送信）はhosted環境の
// smoke test Aで確認する（実CAPTCHAは外部サービスのためCIで自動化しない）

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const RUN = Date.now().toString(36)
const EMAIL = `demo-captcha-${RUN}@stu.kobe-u.ac.jp`

test('C1: sitekey未設定ではウィジェットが出ず、OTP送信は従来どおり進む', async ({ page }) => {
  await page.goto(BASE)
  await page.getByRole('button', { name: '新入生としてはじめる' }).click()
  await expect(page.getByRole('heading', { name: '大学メールでログイン' })).toBeVisible()

  // ウィジェットのコンテナも、Cloudflareの外部iframe・scriptも存在しない
  await expect(page.locator('.turnstile-widget')).toHaveCount(0)
  await expect(page.locator('iframe[src*="challenges.cloudflare.com"]')).toHaveCount(0)
  const scriptCount = await page
    .locator('script[src*="challenges.cloudflare.com"]')
    .count()
  expect(scriptCount).toBe(0)

  // CAPTCHAのゲートが無い＝メールが正しければ送信ボタンが有効になる
  const sendButton = page.getByRole('button', { name: '6桁コードを送る' })
  await expect(sendButton).toBeDisabled()
  await page.getByLabel('大学メールアドレス').fill(EMAIL)
  await expect(sendButton).toBeEnabled()

  // 実際に送信してコード画面へ進める（従来フローが壊れていないこと）
  await sendButton.click()
  await expect(page.getByRole('textbox', { name: '6桁コード' })).toBeVisible({ timeout: 15_000 })
  // コード画面（再送側）にもウィジェットは出ない
  await expect(page.locator('.turnstile-widget')).toHaveCount(0)
})
