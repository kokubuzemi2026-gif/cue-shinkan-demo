import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Task 020 入口分離（新入生／団体担当者）のE2E（tasks/020-role-entry-ux.md）。
//
// 前提: ローカルSupabaseスタック（npm run db:start）+ Mailpit。
// 認証・認可モデルは不変（同一SignInScreen・同一OTP）で、検証するのは
// 「入口の表示」「合流」「入口に応じた初期表示」「意図の非永続」だけ。
//
// 機密対策: OTPコードを出力しない（値のassertionはboolean化）。

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'

const RUN = Date.now().toString(36)
const EMAIL_S = `demo-entry-s-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_O = `demo-entry-o-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_BOTH = `demo-entry-b-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_INVITEE = `demo-entry-i-${RUN}@stu.kobe-u.ac.jp`
// E7専用のowner。E4/E6のEMAIL_Oを使い回すと、E6の送信の約1秒後に同じアドレスへ
// 再送することになり、ローカルスタックの max_frequency = "1s"（config.toml）に
// 当たって rateLimited になり得る（CIで実際に落ちた）。初回送信のアドレスを使う
const EMAIL_O2 = `demo-entry-o2-${RUN}@stu.kobe-u.ac.jp`
const ORG_NAME = `入口E2E会-${RUN}`
const ORG_NAME_2 = `入口E2E会2-${RUN}`
const ORG_NAME_3 = `入口E2E会3-${RUN}`

test.describe.configure({ mode: 'serial' })

type MailpitSearchResult = { messages?: { ID: string }[] }
type MailpitMessage = { Text?: string; HTML?: string }

async function fetchOtpCode(request: APIRequestContext, address: string): Promise<string> {
  let messageId = ''
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/search`, { params: { query: address } })
        if (!res.ok()) return 0
        const body = (await res.json()) as MailpitSearchResult
        messageId = body.messages?.[0]?.ID ?? ''
        return body.messages?.length ?? 0
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)
  const res = await request.get(`${MAILPIT}/api/v1/message/${messageId}`)
  const message = (await res.json()) as MailpitMessage
  const text = `${message.Text ?? ''} ${message.HTML ?? ''}`
  const code = /\b(\d{6})\b/.exec(text)?.[1] ?? ''
  expect(code.length === 6).toBe(true)
  // 読み終えたメールは削除する（task016と同じ）。同じアドレスへ再ログインする
  // テスト（E5・E8）で、次回のpollが前回の古いメールを拾わないようにする
  await request.delete(`${MAILPIT}/api/v1/messages`, { data: { IDs: [messageId] } })
  return code
}

// 入口 → 同一OTP画面 → コード検証。両入口が完全に同じ処理へ合流することを
// 「同じlabel・同じボタン文言・同じコード画面」で確認する
async function signInVia(
  page: Page,
  request: APIRequestContext,
  entry: 'student' | 'organization',
  address: string,
) {
  await page.goto(BASE)
  const cta =
    entry === 'student'
      ? page.getByRole('button', { name: '新入生としてはじめる' })
      : page.getByRole('button', { name: '団体担当者としてはじめる' })
  await cta.click()
  // 合流点: 入口に依らず同じログイン画面
  await expect(page.getByRole('heading', { name: '大学メールでログイン' })).toBeVisible()
  await page.getByLabel('大学メールアドレス').fill(address)
  const codeInput = page.getByRole('textbox', { name: '6桁コード' })
  // 同じアドレスで続けてログインし直すテスト（E5・E8・旧E7）では、前回の送信から
  // 約1秒で次の送信が起きるため、ローカルスタックの再送間隔
  // max_frequency = "1s"（supabase/config.toml [auth.email]）にかかって
  // rateLimited になることがある（CI実測: 前後の操作が速いと1秒を割る）。
  // その場合だけ、画面の案内どおり少し待って送り直す。rateLimited以外の
  // 送信失敗はリトライせず、そのまま失敗として検出する
  const rateLimitAlert = page.getByRole('alert').filter({ hasText: '送信回数の上限' })
  for (let attempt = 1; ; attempt += 1) {
    await page.getByRole('button', { name: '6桁コードを送る' }).click()
    await expect(codeInput.or(rateLimitAlert).first()).toBeVisible({ timeout: 15_000 })
    if (await codeInput.isVisible()) break
    expect(attempt, '再送レート制限が続いています（max_frequency起因なら1回の待機で解消するはず）').toBeLessThan(3)
    await page.waitForTimeout(1_100)
  }
  await codeInput.fill(await fetchOtpCode(request, address))
  await page.getByRole('button', { name: 'ログインする' }).click()
  await passConsentIfPresent(page)
}

async function passConsentIfPresent(page: Page) {
  const consentCheck = page.getByRole('checkbox', { name: /同意します/u })
  const afterConsent = page.getByRole('heading', {
    name: /利用方法を選ぶ|新入生としてはじめる|団体担当者としてはじめる|新入生ホーム/,
  })
  const signedIn = page.getByRole('button', { name: 'ログアウト' })
  await expect(consentCheck.or(afterConsent).or(signedIn).first()).toBeVisible({
    timeout: 20_000,
  })
  if (await consentCheck.isVisible()) {
    await consentCheck.check()
    await page.getByRole('button', { name: '同意して進む', exact: true }).click()
    await expect(consentCheck).toBeHidden({ timeout: 15_000 })
  }
}

test('E1: 未ログイン時は2つの入口が表示され、選ぶだけでは何も保存されない', async ({
  page,
}) => {
  await page.goto(BASE)
  // 両方の入口が最初の画面内で認識できる（見出し・説明・CTA）
  await expect(page.getByRole('heading', { name: 'CUEをはじめる' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '新入生の方' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '団体の方はこちら' })).toBeVisible()
  await expect(page.getByText('興味に合う団体から、新歓案内を受け取れます。')).toBeVisible()
  await expect(page.getByText('団体情報や新歓案内を登録・管理できます。')).toBeVisible()
  const studentCta = page.getByRole('button', { name: '新入生としてはじめる' })
  const orgCta = page.getByRole('button', { name: '団体担当者としてはじめる' })
  await expect(studentCta).toBeVisible()
  await expect(orgCta).toBeVisible()
  // 「団体としてログイン」という共有アカウント連想の文言を使わない
  await expect(page.getByText('団体としてログイン')).toHaveCount(0)
  // 兼任の注記
  await expect(page.getByText(/どちらも個人の大学メールでログインします/)).toBeVisible()

  // 入口を選んでも localStorage へは何も書かれない（UI意図の非永続）
  await studentCta.click()
  await expect(page.getByRole('heading', { name: '大学メールでログイン' })).toBeVisible()
  const keys = await page.evaluate(() => Object.keys(window.localStorage))
  expect(keys.filter((key) => !key.startsWith('sb-'))).toEqual([])
})

test('E2: ログイン画面から入口を選び直せる（リロードでも入口へ戻る）', async ({ page }) => {
  await page.goto(BASE)
  await page.getByRole('button', { name: '団体担当者としてはじめる' }).click()
  await expect(page.getByText('団体担当者としてはじめる')).toBeVisible()
  await page.getByRole('button', { name: '入口を選び直す' }).click()
  await expect(page.getByRole('heading', { name: 'CUEをはじめる' })).toBeVisible()
  // 選び直し → 新入生入口
  await page.getByRole('button', { name: '新入生としてはじめる' }).click()
  await expect(page.getByRole('heading', { name: '大学メールでログイン' })).toBeVisible()
  // リロードで意図は消え、入口選択へ安全に戻る（誤った画面へは進まない）
  await page.reload()
  await expect(page.getByRole('heading', { name: 'CUEをはじめる' })).toBeVisible()
})

test('E3: 新入生入口＋権限なし → 登録導線（入口だけでは権限を作らない）', async ({
  page,
  request,
}) => {
  await signInVia(page, request, 'student', EMAIL_S)
  // 新入生に絞った登録画面（団体画面を先に出さない）
  await expect(page.getByRole('heading', { name: '新入生としてはじめる' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: '新入生として登録する' })).toBeVisible()
  // 権限ゼロなので「他の利用方法を見る」で全選択肢へ戻れる
  await expect(page.getByRole('button', { name: '他の利用方法を見る' })).toBeVisible()
  // まだ登録していない＝明示ボタンを押すまで権限は作られない
  await page.getByRole('button', { name: '新入生として登録する' }).click()
  await expect(page.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
    timeout: 15_000,
  })
})

test('E4: 団体入口＋所属なし → 団体登録導線と招待の説明（新入生画面を先に出さない）', async ({
  page,
  request,
}) => {
  await signInVia(page, request, 'organization', EMAIL_O)
  await expect(page.getByRole('heading', { name: '団体担当者としてはじめる' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: '新しい団体を作る' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '招待リンクで団体に参加する' })).toBeVisible()
  // 新しい招待検索・トークン入力は作らない
  await expect(page.getByRole('textbox')).toHaveCount(0)
  // 団体を作成して団体画面へ
  await page.getByRole('button', { name: '新しい団体を作る' }).click()
  await page.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME)
  await page.getByRole('button', { name: '団体を作成する' }).click()
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible({ timeout: 15_000 })
})

test('E5: 両権限ユーザーは入口に応じて初期表示が変わり、以後は既存切替が使える', async ({
  page,
  request,
}) => {
  // 準備: 新入生入口で登録 → シェルから団体も作る（兼任）
  await signInVia(page, request, 'student', EMAIL_BOTH)
  await expect(page.getByRole('heading', { name: '新入生としてはじめる' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: '新入生として登録する' }).click()
  await expect(page.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: '新しい団体を作る' }).click()
  await page.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME_2)
  await page.getByRole('button', { name: '団体を作成する' }).click()
  await expect(page.getByRole('heading', { name: ORG_NAME_2 })).toBeVisible({ timeout: 15_000 })

  // ログアウト → 入口意図を持ち越さない（入口画面へ戻る）
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page.getByRole('heading', { name: 'CUEをはじめる' })).toBeVisible({
    timeout: 15_000,
  })

  // 団体入口で再ログイン → 団体画面が先（新入生権限があっても新入生画面を先に出さない）
  await signInVia(page, request, 'organization', EMAIL_BOTH)
  await expect(page.getByRole('heading', { name: ORG_NAME_2 })).toBeVisible({ timeout: 15_000 })
  // 既存のコンテキスト切替で新入生へ移れる
  await page.getByRole('button', { name: '新入生', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
    timeout: 15_000,
  })

  // ログアウト → 新入生入口で再ログイン → 新入生画面が先
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page.getByRole('heading', { name: 'CUEをはじめる' })).toBeVisible({
    timeout: 15_000,
  })
  await signInVia(page, request, 'student', EMAIL_BOTH)
  await expect(page.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
    timeout: 15_000,
  })
})

test('E6: 団体所属のみの人が新入生入口を選ぶと、団体画面ではなく新入生登録の導線', async ({
  page,
  request,
}) => {
  // EMAIL_O は E4 で団体のみ作成済み（新入生権限なし）。テストごとに新しい
  // ブラウザ文脈なので未ログインから始まる
  await signInVia(page, request, 'student', EMAIL_O)
  await expect(page.getByRole('heading', { name: '新入生としてはじめる' })).toBeVisible({
    timeout: 15_000,
  })
  // 所属があるので「登録せずに団体画面へ進む」が出る（権限ゼロ向けの
  // 「他の利用方法を見る」は出ない）
  const skip = page.getByRole('button', { name: '登録せずに団体画面へ進む' })
  await expect(skip).toBeVisible()
  await expect(page.getByRole('button', { name: '他の利用方法を見る' })).toHaveCount(0)
  await skip.click()
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible({ timeout: 15_000 })
})

test('E7: 招待リンク流入では入口画面を挟まず、認証→同意→承諾の順のまま', async ({
  browser,
  page,
  request,
}) => {
  // 準備: E7専用のownerが団体を作り、招待リンクを発行する
  await signInVia(page, request, 'organization', EMAIL_O2)
  await expect(page.getByRole('heading', { name: '団体担当者としてはじめる' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: '新しい団体を作る' }).click()
  await page.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME_3)
  await page.getByRole('button', { name: '団体を作成する' }).click()
  await expect(page.getByRole('heading', { name: ORG_NAME_3 })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '招待リンクを作成' }).click()
  const urlBox = page.getByLabel('招待リンクURL')
  await expect(urlBox).toBeVisible({ timeout: 15_000 })
  const inviteUrl = await urlBox.inputValue()
  // トークン値を失敗メッセージへ出さないためboolean assertにする
  expect(inviteUrl.includes('#invite=')).toBe(true)

  // 未ログインの別ブラウザ文脈で招待リンクを開く
  const context = await browser.newContext()
  const invitee = await context.newPage()
  await invitee.goto(inviteUrl.trim())
  // 入口画面は出ない。招待の予告つきログイン画面へ直行する
  await expect(invitee.getByRole('heading', { name: '大学メールでログイン' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(invitee.getByRole('heading', { name: 'CUEをはじめる' })).toHaveCount(0)
  await expect(
    invitee.getByText('団体の招待リンクを開いています。ログイン後に参加確認へ進みます。'),
  ).toBeVisible()
  // 入口を経ていないので「入口を選び直す」も出ない
  await expect(invitee.getByRole('button', { name: '入口を選び直す' })).toHaveCount(0)

  // ログインすると（同意の後）承諾確認へ。入口選択は挟まらない
  await invitee.getByLabel('大学メールアドレス').fill(EMAIL_INVITEE)
  await invitee.getByRole('button', { name: '6桁コードを送る' }).click()
  const codeInput = invitee.getByRole('textbox', { name: '6桁コード' })
  await expect(codeInput).toBeVisible()
  await codeInput.fill(await fetchOtpCode(request, EMAIL_INVITEE))
  await invitee.getByRole('button', { name: 'ログインする' }).click()
  await passConsentIfPresent(invitee)
  await expect(invitee.getByRole('heading', { name: '団体への招待' })).toBeVisible({
    timeout: 20_000,
  })
  await context.close()
})

test('E8: 新入生権限のみの人が団体入口を選ぶと、登録せずに新入生画面へ進める', async ({
  page,
  request,
}) => {
  // EMAIL_S は E3 で新入生登録のみ（団体所属なし）。E6の対称パス
  await signInVia(page, request, 'organization', EMAIL_S)
  await expect(page.getByRole('heading', { name: '団体担当者としてはじめる' })).toBeVisible({
    timeout: 15_000,
  })
  // 新入生権限があるので「登録せずに新入生画面へ進む」が出る（権限ゼロ向けの
  // 「他の利用方法を見る」は出ない）
  const skip = page.getByRole('button', { name: '登録せずに新入生画面へ進む' })
  await expect(skip).toBeVisible()
  await expect(page.getByRole('button', { name: '他の利用方法を見る' })).toHaveCount(0)
  // 団体を作らないまま先へ進める＝入口意図が権限を要求しない
  await skip.click()
  await expect(page.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
    timeout: 15_000,
  })
})
