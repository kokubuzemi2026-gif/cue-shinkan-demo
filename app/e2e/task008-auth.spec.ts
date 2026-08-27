import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Task 008 認証・権限基盤のE2E（tasks/008-auth-and-authorization.md Phase A手動QAの自動化）。
//
// 前提: ローカルSupabaseスタックが起動済み（npm run db:start）。メールはMailpitが捕捉する。
// テストデータは架空の大学ドメインメールのみを使い、実行ごとに一意のローカル部を用いて
// テスト間・実行間の衝突を防ぐ。
//
// 機密対策: OTPコード・招待トークンをconsole・失敗メッセージへ出さないため、
// 秘密値に触れるassertionはboolean化する（値そのものを期待値比較に使わない）。
// trace/video/screenshotはplaywright.config.tsで無効化済み。

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'

// 実行ごとに一意（衝突防止）。架空ドメインのため実在者へ届くことはない
const RUN = Date.now().toString(36)
const EMAIL_A = `demo-a-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_B = `demo-b-${RUN}@stu.kobe-u.ac.jp`
// 前後空白+大文字の生入力（正規化されてEMAIL_Aとして送信されることを検証する）
const RAW_INPUT_A = `  ${EMAIL_A.toUpperCase()}  `
const ORG_NAME = `六甲E2E会-${RUN}`

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const MEMBER_LABEL_PATTERN = /^担当者-[0-9A-F]{6}$/

test.describe.configure({ mode: 'serial' })

async function expectNoHorizontalScroll(page: Page, situation: string) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(fits, `${situation}: 横スクロールが発生しない`).toBe(true)
}

type MailpitSearchResult = { messages?: { ID: string }[] }
type MailpitMessage = {
  To?: { Address: string }[]
  Subject?: string
  HTML?: string
  Text?: string
}

// Mailpitから対象アドレス宛の最新メールを取得し、6桁コードを抜き出す。
// 戻り値のcodeは呼び出し側でも表示・比較出力しないこと
async function fetchOtpMail(
  request: APIRequestContext,
  address: string,
): Promise<{ code: string; toAddress: string; subject: string; body: string }> {
  let messageId = ''
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: address },
        })
        if (!res.ok()) return 0
        const body = (await res.json()) as MailpitSearchResult
        messageId = body.messages?.[0]?.ID ?? ''
        return body.messages?.length ?? 0
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)

  const detailRes = await request.get(`${MAILPIT}/api/v1/message/${messageId}`)
  expect(detailRes.ok()).toBe(true)
  const detail = (await detailRes.json()) as MailpitMessage
  const body = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`
  const otpMatch = /\b(\d{6})\b/.exec(body)
  // 6桁OTPが本文に存在する（値は失敗メッセージへ出さない）
  expect(otpMatch !== null).toBe(true)
  return {
    code: otpMatch![1],
    toAddress: detail.To?.[0]?.Address ?? '',
    subject: detail.Subject ?? '',
    body,
  }
}

// メール入力→OTP受信→検証ログインまで（登録とログインの統合導線）
// Task 015: 同意画面が出たら同意して進む（初回・版更新時）
async function passConsentIfPresent(page: Page) {
  const consentCheck = page.getByRole('checkbox', { name: /同意します/u })
  // Task 020: 初回ログインは入口で絞った見出し（新入生／団体担当者としてはじめる）になる。
  // 意図が無いセッション復元では従来の「利用方法を選ぶ」
  const onboarding = page.getByRole('heading', {
    name: /利用方法を選ぶ|新入生としてはじめる|団体担当者としてはじめる/,
  })
  const signedIn = page.getByRole('button', { name: 'ログアウト' })
  // locator.isVisible() は待たない（即時判定）。ログイン直後はまだ遷移中で
  // 必ずfalseになるため、まず「同意画面 / 権限選択 / シェル」のどれかが
  // 出るまで待ってから判定する
  await expect(consentCheck.or(onboarding).or(signedIn).first()).toBeVisible({
    timeout: 20_000,
  })
  if (await consentCheck.isVisible()) {
    await consentCheck.check()
    await page.getByRole('button', { name: '同意して進む', exact: true }).click()
    await expect(consentCheck).toBeHidden({ timeout: 15_000 })
  }
}

// Task 020: 未ログイン時は入口選択が先に出る。テストの人物像に合う入口を選ぶ。
// 権限ゼロの新規ユーザー前提（ログイン後は入口で絞った登録画面が出る）
const ENTRY_CTA = {
  student: '新入生としてはじめる',
  organization: '団体担当者としてはじめる',
} as const

async function signInWithOtp(
  page: Page,
  request: APIRequestContext,
  rawEmailInput: string,
  expectedAddress: string,
  entry: keyof typeof ENTRY_CTA = 'student',
): Promise<{ toAddress: string; subject: string; body: string }> {
  await page.goto(BASE)
  await page.getByRole('button', { name: ENTRY_CTA[entry] }).click()
  await page.getByLabel('大学メールアドレス').fill(rawEmailInput)
  const sendButton = page.getByRole('button', { name: '6桁コードを送る' })
  await expect(sendButton).toBeEnabled()
  await sendButton.click()
  // section側のaria-label「6桁コードの入力」と部分一致しないよう、textboxロールで特定する
  const codeInput = page.getByRole('textbox', { name: '6桁コード' })
  await expect(codeInput).toBeVisible()

  const mail = await fetchOtpMail(request, expectedAddress)
  await codeInput.fill(mail.code)
  await page.getByRole('button', { name: 'ログインする' }).click()
  // Task 015: 登録の前に同意画面を通す（D050）
  await passConsentIfPresent(page)
  // Task 020: 権限ゼロの初回ログインは、選んだ入口で絞った登録画面になる
  await expect(page.getByRole('heading', { name: ENTRY_CTA[entry] })).toBeVisible({
    timeout: 15_000,
  })
  return { toAddress: mail.toAddress, subject: mail.subject, body: mail.body }
}

test('1-2: ドメイン外・plus付きメールはクライアント側で送信不可', async ({ page }) => {
  await page.goto(BASE)
  // Task 020: 入口選択を通ってから同一のログイン画面へ（どちらの入口でも同じ検証）
  await page.getByRole('button', { name: '新入生としてはじめる' }).click()
  const emailInput = page.getByLabel('大学メールアドレス')
  const sendButton = page.getByRole('button', { name: '6桁コードを送る' })

  await test.step('1: plus addressingは拒否される', async () => {
    await emailInput.fill('demo-a+test@stu.kobe-u.ac.jp')
    await expect(sendButton).toBeDisabled()
    await expect(page.getByRole('alert')).toBeVisible()
  })

  await test.step('2: 別ドメインは拒否される', async () => {
    await emailInput.fill('demo-a@gmail.com')
    await expect(sendButton).toBeDisabled()
    await expect(page.getByRole('alert')).toBeVisible()
  })

  await expectNoHorizontalScroll(page, 'ログイン画面(390px)')
})

test('3-25: 登録→権限→団体→招待→切替の一連フロー', async ({ browser, request }) => {
  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pageA = await contextA.newPage()
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pageB = await contextB.newPage()

  let inviteUrl = ''

  try {
    await test.step('3-7: 正規化・OTPメール・ログイン（demo-a）', async () => {
      const mail = await signInWithOtp(pageA, request, RAW_INPUT_A, EMAIL_A)
      // 4: Mailpitの宛先が小文字へ正規化されている
      expect(mail.toAddress).toBe(EMAIL_A)
      expect(mail.subject).toContain('コード')
      // 6: 本文にMagic Link・ログイン用URLが存在しない（6桁コードの存在はfetchOtpMailで検証済み）
      expect(/https?:\/\//i.test(mail.body)).toBe(false)
      expect(mail.body.includes('href')).toBe(false)
      await expectNoHorizontalScroll(pageA, '入口別の初回登録画面(390px)')
    })

    await test.step('8: リロード後もセッションが復元される', async () => {
      await pageA.reload()
      // Task 020: 入口意図は永続化しないため、リロード後は従来の全選択肢
      // 「利用方法を選ぶ」へ安全に戻る（誤った画面へは進まない）
      await expect(pageA.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
    })

    await test.step('9: 新入生権限を登録できる', async () => {
      await pageA.getByRole('button', { name: '新入生として登録する' }).click()
      await expect(pageA.getByRole('heading', { name: '新入生ホーム' })).toBeVisible()
      await expectNoHorizontalScroll(pageA, '新入生ホーム(390px)')
    })

    await test.step('23-24: Local Storageはsb-*のみでcue-demo:*が無い', async () => {
      const keys = await pageA.evaluate(() => Object.keys(window.localStorage))
      expect(keys.filter((key) => key.startsWith('cue-demo:'))).toEqual([])
      expect(keys.some((key) => key.startsWith('sb-'))).toBe(true)
      expect(keys.filter((key) => !key.startsWith('sb-'))).toEqual([])
    })

    await test.step('10-12: 団体作成→審査待ち→ownerが匿名ラベルで表示', async () => {
      await pageA.getByRole('button', { name: '新しい団体を作る' }).click()
      await pageA.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME)
      await pageA.getByRole('button', { name: '団体を作成する' }).click()
      await expect(pageA.getByRole('heading', { name: ORG_NAME })).toBeVisible({
        timeout: 15_000,
      })
      // 11: 作成直後は審査待ち
      await expect(pageA.locator('.status-chip')).toHaveText('審査待ち')
      // 12: 作成者がオーナーとして匿名ラベルで1行表示される
      const rows = pageA.locator('.member-row')
      await expect(rows).toHaveCount(1)
      const label = (await rows.first().locator('.member-label').innerText()).trim()
      expect(MEMBER_LABEL_PATTERN.test(label)).toBe(true)
      await expect(rows.first()).toContainText('オーナー')
      await expect(rows.first().locator('.self-chip')).toHaveText('自分')
      await expectNoHorizontalScroll(pageA, '団体ホーム(390px)')
    })

    await test.step('13-14: プロフィール保存後も団体画面に留まり保存内容が確認できる', async () => {
      await pageA.getByLabel('紹介文（500文字まで）').fill('E2Eで保存した紹介文')
      // Task 009で公式窓口フォーム（保存するボタン）が追加されたため、プロフィール編集カードへ限定する
      await pageA
        .locator('section[aria-label="団体プロフィールの編集"]')
        .getByRole('button', { name: '保存する' })
        .click()
      await expect(pageA.getByText('保存しました。')).toBeVisible()
      // 修正対象の不具合: account再取得中に全画面ローディングへ戻ると
      // 選択中コンテキストが初期値（新入生）へ戻る。再取得完了を跨いで団体画面に留まること
      await pageA.waitForTimeout(1_000)
      await expect(pageA.getByRole('heading', { name: ORG_NAME })).toBeVisible()
      await expect(pageA.locator('.status-chip')).toHaveText('審査待ち')
      await expect(pageA.getByLabel('紹介文（500文字まで）')).toHaveValue('E2Eで保存した紹介文')
    })

    await test.step('15: 新入生⇄団体の切替ができる', async () => {
      const switcher = pageA.getByRole('group', { name: '利用モードの切替' })
      await switcher.getByRole('button', { name: '新入生' }).click()
      await expect(pageA.getByRole('heading', { name: '新入生ホーム' })).toBeVisible()
      await switcher.getByRole('button', { name: ORG_NAME }).click()
      await expect(pageA.getByRole('heading', { name: ORG_NAME })).toBeVisible()
    })

    await test.step('16: 一度だけ表示される招待リンクを作成できる', async () => {
      await pageA.getByRole('button', { name: '招待リンクを作成' }).click()
      const urlBox = pageA.getByLabel('招待リンクURL')
      await expect(urlBox).toBeVisible({ timeout: 15_000 })
      inviteUrl = await urlBox.inputValue()
      // トークン値を失敗メッセージへ出さないためboolean assertにする
      expect(inviteUrl.includes('#invite=')).toBe(true)
      await pageA.getByRole('button', { name: '閉じる' }).click()
      await expect(urlBox).toBeHidden()
    })

    await test.step('17: 別contextでdemo-bがログインできる', async () => {
      await signInWithOtp(pageB, request, EMAIL_B, EMAIL_B, 'organization')
    })

    await test.step('18-19: 招待URLのhash即時除去→内容確認→参加', async () => {
      // 同一URLでhashだけ異なるgotoはsame-document navigationとなり再読込されない。
      // 招待リンクは外部（チャット等）から新規に開かれる想定のため、about:blankを
      // 挟んで実際のリンクオープンと同じ全読込にする
      await pageB.goto('about:blank')
      await pageB.goto(inviteUrl)
      // 18: 読み取り直後にURLから#invite=...が除去される（トークンを出力しないbooleanで検証）
      await expect
        .poll(async () => (await pageB.evaluate(() => window.location.hash)) === '')
        .toBe(true)
      expect(pageB.url().includes('#invite')).toBe(false)
      // 19: 団体名と役割を確認して参加する
      await expect(pageB.locator('.invite-org-name')).toHaveText(ORG_NAME, { timeout: 15_000 })
      await expect(pageB.getByText('参加後の役割: メンバー', { exact: false })).toBeVisible()
      await pageB.getByRole('button', { name: '参加する' }).click()
      await expect(pageB.getByRole('heading', { name: ORG_NAME })).toBeVisible({
        timeout: 15_000,
      })
      await expectNoHorizontalScroll(pageB, '団体ホーム(担当者側・390px)')
    })

    await test.step('20: 団体担当者が2人になる', async () => {
      await expect(pageB.locator('.member-row')).toHaveCount(2)
    })

    await test.step('21: 使用済み招待リンクは再利用できない', async () => {
      await pageB.goto('about:blank')
      await pageB.goto(inviteUrl)
      await expect(pageB.getByText('この招待リンクは使えません', { exact: false })).toBeVisible({
        timeout: 15_000,
      })
      await expectNoHorizontalScroll(pageB, '招待無効画面(390px)')
      await pageB.getByRole('button', { name: '閉じる' }).click()
      await expect(pageB.getByRole('heading', { name: ORG_NAME })).toBeVisible()
    })

    await test.step('22: 担当者一覧にメール・氏名・学籍番号・Auth UUIDが出ない', async () => {
      const listText = await pageB.locator('.member-list').first().innerText()
      expect(listText.includes('@')).toBe(false)
      expect(UUID_PATTERN.test(listText)).toBe(false)
      const labels = await pageB.locator('.member-label').allInnerTexts()
      expect(labels.length).toBe(2)
      for (const label of labels) {
        expect(MEMBER_LABEL_PATTERN.test(label.trim())).toBe(true)
      }
    })

    await test.step('23-24(担当者側): Local Storage検査', async () => {
      const keys = await pageB.evaluate(() => Object.keys(window.localStorage))
      expect(keys.filter((key) => key.startsWith('cue-demo:'))).toEqual([])
      expect(keys.filter((key) => !key.startsWith('sb-'))).toEqual([])
    })
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
