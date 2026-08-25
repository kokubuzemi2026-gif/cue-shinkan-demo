import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

// Task 009 サーバーデータ移行のE2E（tasks/009-server-data-migration.md）。
//
// 前提: ローカルSupabaseスタックが起動済み（npm run db:start）。メールはMailpitが捕捉する。
// 団体のverified化はクライアント経路が存在しないため、運営操作に相当するSQLを
// ローカルスタックのDB（psqlまたはsupabaseのdbコンテナ）へ直接発行する。
//
// 機密対策: OTPコードを失敗メッセージへ出さないため、秘密値のassertionはboolean化する。
// trace/video/screenshotはplaywright.config.tsで無効化済み。

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'
const DB_URL = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const RUN = Date.now().toString(36)
const EMAIL_STUDENT = `demo-s9-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_OWNER = `demo-o9-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_MIGRATOR = `demo-m9-${RUN}@stu.kobe-u.ac.jp`
const ORG_NAME = `六甲E2E九会-${RUN}`
const EVENT_NAME = `E2Eハイク-${RUN}`

test.describe.configure({ mode: 'serial' })

// ---- 運営相当のSQL実行（psql→supabase dbコンテナの順で試す） ----
function execSql(sql: string): string {
  const escaped = sql.replaceAll('"', '\\"')
  try {
    return execSync(`psql "${DB_URL}" -tA -c "${escaped}"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return execSync(
      `docker exec supabase_db_cue-shinkan-demo psql -U postgres -tA -c "${escaped}"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
  }
}

// ---- ブラウザへ公開してよい2値（RLS越権プローブ用）。CIは環境変数、ローカルは.env.local ----
function readPublicSupabaseEnv(): { url: string; key: string } {
  let url = process.env.VITE_SUPABASE_URL ?? ''
  let key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
  if (url === '' || key === '') {
    try {
      const envLocal = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8')
      for (const line of envLocal.split('\n')) {
        const [name, ...rest] = line.split('=')
        if (name === 'VITE_SUPABASE_URL' && url === '') url = rest.join('=').trim()
        if (name === 'VITE_SUPABASE_PUBLISHABLE_KEY' && key === '') key = rest.join('=').trim()
      }
    } catch {
      // 見つからない場合は下のexpectで失敗させる
    }
  }
  expect(url.length > 0 && key.length > 0, 'Supabase URLとpublishable keyが必要').toBe(true)
  return { url, key }
}

async function expectNoHorizontalScroll(page: Page, situation: string) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(fits, `${situation}: 横スクロールが発生しない`).toBe(true)
}

type MailpitSearchResult = { messages?: { ID: string }[] }
type MailpitMessage = { HTML?: string; Text?: string }

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
  const detailRes = await request.get(`${MAILPIT}/api/v1/message/${messageId}`)
  expect(detailRes.ok()).toBe(true)
  const detail = (await detailRes.json()) as MailpitMessage
  const otpMatch = /\b(\d{6})\b/.exec(`${detail.HTML ?? ''}\n${detail.Text ?? ''}`)
  expect(otpMatch !== null).toBe(true)
  return otpMatch![1]
}

async function signInWithOtp(page: Page, request: APIRequestContext, address: string) {
  await page.goto(BASE)
  await page.getByLabel('大学メールアドレス').fill(address)
  const sendButton = page.getByRole('button', { name: '6桁コードを送る' })
  await expect(sendButton).toBeEnabled()
  await sendButton.click()
  const codeInput = page.getByRole('textbox', { name: '6桁コード' })
  await expect(codeInput).toBeVisible()
  const code = await fetchOtpCode(request, address)
  await codeInput.fill(code)
  await page.getByRole('button', { name: 'ログインする' }).click()
}

// console error・予期しない失敗リクエストの収集。
// 例外: 未登録パスポートのmaybeSingle取得は仕様上406を返すため除外する
function watchPage(page: Page, sink: string[], label: string) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      sink.push(`${label} console: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    sink.push(`${label} pageerror: ${error.message}`)
  })
  page.on('response', (response) => {
    const url = response.url()
    const status = response.status()
    if (status < 400) return
    if (url.includes('/rest/v1/student_passports') && status === 406) return
    sink.push(`${label} http ${status}: ${url}`)
  })
}

test('Task 009: パスポート・オファー・受信箱・ファネルのサーバー永続化とユーザー分離', async ({
  browser,
  request,
}) => {
  const problems: string[] = []
  const contexts: BrowserContext[] = []
  const newPage = async (label: string) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    contexts.push(context)
    const page = await context.newPage()
    watchPage(page, problems, label)
    return page
  }

  try {
    const pageA = await newPage('studentA')
    const pageB = await newPage('ownerB')

    await test.step('1: 学生Aが登録し、興味パスポートを作成できる', async () => {
      await signInWithOtp(pageA, request, EMAIL_STUDENT)
      await expect(pageA.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
      await pageA.getByRole('button', { name: '新入生として登録する' }).click()
      await expect(pageA.getByRole('heading', { name: '新入生ホーム' })).toBeVisible()
      await expectNoHorizontalScroll(pageA, '新入生ホーム(登録前・390px)')

      await pageA.getByRole('button', { name: '興味パスポートをはじめる' }).click()
      // step 1: 興味
      await pageA.getByRole('button', { name: 'アウトドア' }).click()
      await expectNoHorizontalScroll(pageA, 'パスポートwizard(390px)')
      await pageA.getByRole('button', { name: '次へ' }).click()
      // step 2: 目的（スタイル・経験は既定選択のまま）
      await pageA.getByRole('button', { name: '友達を作る' }).click()
      await pageA.getByRole('button', { name: '次へ' }).click()
      // step 3: 曜日（頻度・予算は既定のまま=月1〜2回・〜2,000円）
      await pageA.getByRole('button', { name: '土日' }).click()
      await pageA.getByRole('button', { name: '次へ' }).click()
      // step 4: 受け取るカテゴリ
      await pageA.getByRole('button', { name: 'アウトドア' }).click()
      await pageA.getByRole('button', { name: 'これで完了' }).click()

      await expect(pageA.getByText('興味パスポートを保存しました')).toBeVisible({
        timeout: 15_000,
      })
      await pageA.getByRole('button', { name: 'ホームへもどる' }).click()
      await expect(pageA.getByRole('heading', { name: '新入生ホーム' })).toBeVisible()
      await expect(pageA.getByText('アウトドア').first()).toBeVisible()
    })

    await test.step('2: 受信箱は空状態から始まる', async () => {
      await pageA.getByRole('button', { name: '受信箱' }).click()
      await expect(pageA.getByText('オファー 0件')).toBeVisible({ timeout: 15_000 })
      await expectNoHorizontalScroll(pageA, '受信箱(空・390px)')
    })

    await test.step('3: localStorageはsb-*のみ（cue-demo:*を作らない）', async () => {
      const keys = await pageA.evaluate(() => Object.keys(window.localStorage))
      expect(keys.filter((key) => key.startsWith('cue-demo:'))).toEqual([])
      expect(keys.filter((key) => !key.startsWith('sb-'))).toEqual([])
    })

    let orgId = ''

    await test.step('4: 団体オーナーBが団体を作成（審査待ちでは配信不可）', async () => {
      await signInWithOtp(pageB, request, EMAIL_OWNER)
      await expect(pageB.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
      await pageB.getByRole('button', { name: '新しい団体を作る' }).click()
      await pageB.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME)
      await pageB.getByRole('button', { name: '団体を作成する' }).click()
      await expect(pageB.getByRole('heading', { name: ORG_NAME })).toBeVisible({ timeout: 15_000 })
      await expect(pageB.locator('.status-chip')).toHaveText('審査待ち')
      // 審査待ちの間はオファー機能が表示されない
      await expect(pageB.getByText('運営の認証が完了すると利用できます')).toBeVisible()
      await expect(
        pageB.getByRole('button', { name: '新しいオファーを作成' }),
      ).toBeHidden()
    })

    await test.step('5: 運営相当のSQLでverified化→ダッシュボードが有効になる', async () => {
      orgId = execSql(
        `update public.organizations set status='verified' where name='${ORG_NAME}' returning id`,
      )
      expect(orgId.length > 0).toBe(true)
      await pageB.reload()
      await expect(pageB.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(pageB.getByText('0/3')).toBeVisible()
      await expectNoHorizontalScroll(pageB, '団体ダッシュボード(390px)')
    })

    await test.step('6: 公式窓口を登録できる', async () => {
      await pageB.getByLabel('表示名（例: 公式Instagram・50文字まで）').fill('公式Instagram')
      await pageB.getByLabel('アカウント・URL（100文字まで）').fill(`@rokko_e2e_${RUN}`)
      await pageB
        .locator('section[aria-label="公式窓口の編集"]')
        .getByRole('button', { name: '保存する' })
        .click()
      await expect(
        pageB.locator('section[aria-label="公式窓口の編集"]').getByText('保存しました。'),
      ).toBeVisible()
    })

    await test.step('7: オファー作成→プレビュー（匿名1人）→送信', async () => {
      await pageB.getByRole('button', { name: '新しいオファーを作成' }).click()
      await pageB.getByLabel('イベント名').fill(EVENT_NAME)
      await pageB.getByLabel('イベント紹介').fill('はじめてでも登れる六甲山ハイクです。道具の貸出があります。')
      await pageB.getByLabel('開催日時').fill('9月13日（土）9:00〜15:00')
      await pageB.getByLabel('場所').fill('六甲ケーブル下 集合')
      await pageB.getByLabel('なぜこの人たちに届けたいか').fill('アウトドアを始めたい新入生に、最初の一歩を用意したいからです。')
      // 対象条件: アウトドア × 友達を作る × 土日（他は既定のまま）
      await pageB.getByRole('button', { name: 'アウトドア' }).click()
      await pageB.getByRole('button', { name: '友達を作る' }).click()
      await pageB.getByRole('button', { name: '土日', exact: true }).click()
      await expectNoHorizontalScroll(pageB, 'オファー作成(390px)')
      await pageB.getByRole('button', { name: '対象を確認する' }).click()

      await expect(pageB.getByRole('heading', { name: '送信内容の確認' })).toBeVisible({
        timeout: 15_000,
      })
      // マッチ人数はサーバー計算の実数（学生Aの1人）。学生の個人情報は表示されない
      await expect(pageB.locator('.audience-count-number')).toHaveText('1人')
      await expect(pageB.getByText('個人が特定できる情報は表示されません。')).toBeVisible()
      await expectNoHorizontalScroll(pageB, '送信確認(390px)')
      await pageB.getByRole('button', { name: 'この内容で送信' }).click()
      await expect(pageB.getByRole('heading', { name: '1人へ配信しました' })).toBeVisible({
        timeout: 15_000,
      })
      await pageB.getByRole('button', { name: 'ダッシュボードへもどる' }).click()
      await expect(pageB.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible()
      await expect(pageB.getByText('1/3')).toBeVisible()
      await expect(pageB.locator('.campaign-card')).toHaveCount(1)
      const funnelBefore = await pageB.locator('.funnel-value').allInnerTexts()
      expect(funnelBefore).toEqual(['1', '0', '0', '0'])
    })

    let deliveryUrlChecked = false

    await test.step('8: 学生Aの受信箱に理由つきで届く（リロードで取得）', async () => {
      await pageA.reload()
      await pageA.getByRole('button', { name: '受信箱' }).click()
      await expect(pageA.locator('.offer-card')).toHaveCount(1, { timeout: 15_000 })
      await expect(pageA.getByText(EVENT_NAME)).toBeVisible()
      await expect(pageA.getByText('アウトドアに興味がある')).toBeVisible()
      await expect(pageA.getByText('未読')).toBeVisible()
      await expectNoHorizontalScroll(pageA, '受信箱(1件・390px)')
      deliveryUrlChecked = true
    })

    await test.step('9: 詳細を開く（既読化）→「行ってみたい」→公式窓口が開示される', async () => {
      await pageA.locator('.offer-card').click()
      await expect(pageA.getByRole('heading', { name: EVENT_NAME })).toBeVisible()
      await expect(pageA.getByText('マッチ度 100 / 100')).toBeVisible()
      await expect(pageA.getByText('あなたに届いた理由')).toBeVisible()
      await expect(pageA.getByText('団体からのメッセージ')).toBeVisible()
      await expectNoHorizontalScroll(pageA, 'オファー詳細(390px)')

      await pageA.getByRole('button', { name: '行ってみたい' }).click()
      await expect(pageA.getByText('「行ってみたい」を保存しました')).toBeVisible({
        timeout: 15_000,
      })
      // 同意後にのみ公式窓口が開示される（matching_and_safety.md §6）
      await expect(pageA.getByText(`@rokko_e2e_${RUN}`)).toBeVisible()
      await pageA.getByRole('button', { name: '受信箱へもどる' }).click()
      await expect(pageA.getByText('回答済み')).toBeVisible()
    })

    await test.step('10: 団体ファネルが匿名件数で更新される', async () => {
      await pageB.reload()
      await expect(pageB.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
        timeout: 15_000,
      })
      const funnel = await pageB.locator('.funnel-value').allInnerTexts()
      // 配信1・閲覧1・関心1・参加意向1（D022）
      expect(funnel).toEqual(['1', '1', '1', '1'])
      // 学生の個人情報・一覧は現れない
      const dashboardText = await pageB.locator('.app-main').innerText()
      expect(dashboardText.includes('@stu.kobe-u.ac.jp')).toBe(false)
    })

    await test.step('11: ログアウト→再ログインでもサーバーデータが復元される', async () => {
      await pageA.getByRole('button', { name: 'ログアウト' }).click()
      await expect(pageA.getByLabel('大学メールアドレス')).toBeVisible({ timeout: 15_000 })
      await signInWithOtp(pageA, request, EMAIL_STUDENT)
      // 権限登録済みのため、オンボーディングを経ずにホームへ入る
      await expect(pageA.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(pageA.getByText('アウトドア').first()).toBeVisible()
      await pageA.getByRole('button', { name: '受信箱' }).click()
      await expect(pageA.locator('.offer-card')).toHaveCount(1, { timeout: 15_000 })
      await expect(pageA.getByText('回答済み')).toBeVisible()
    })

    await test.step('12: 同一ユーザーの別browser contextでも同じサーバー状態が見える', async () => {
      // 複数端末相当: セッションを引き継いだ別contextで同じ内容が取得できる
      const storage = await pageA.context().storageState()
      const contextA2 = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: storage,
      })
      contexts.push(contextA2)
      const pageA2 = await contextA2.newPage()
      watchPage(pageA2, problems, 'studentA2')
      await pageA2.goto(BASE)
      await expect(pageA2.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
        timeout: 15_000,
      })
      await pageA2.getByRole('button', { name: '受信箱' }).click()
      await expect(pageA2.locator('.offer-card')).toHaveCount(1, { timeout: 15_000 })
      await expect(pageA2.getByText('回答済み')).toBeVisible()
    })

    await test.step('13: 旧デモデータ（cue-demo:*）は一回限りの検証付き移行で引き継がれ、キーが消える', async () => {
      const pageM = await newPage('migrator')
      await pageM.goto(BASE)
      // ログイン前に、旧デモのパスポート（写真・音楽）と壊れたキーを仕込む
      await pageM.evaluate(() => {
        const preference = {
          id: 'student-demo-1',
          displayName: 'あなた',
          interests: ['photo', 'music'],
          purposes: ['creation'],
          style: 'relaxed',
          frequency: 'monthly_1_2',
          availableDays: ['weekday_night'],
          experience: 'some',
          maxFeePerEventYen: 1000,
          reception: { paused: false, allowedCategories: ['photo'], weeklyLimit: 2 },
        }
        window.localStorage.setItem(
          'cue-demo:student-preference',
          JSON.stringify({ schemaVersion: 1, data: preference }),
        )
        window.localStorage.setItem('cue-demo:offer-reads', '{broken json')
        window.localStorage.setItem('cue-demo:offer-deliveries', 'not-an-envelope')
      })
      await signInWithOtp(pageM, request, EMAIL_MIGRATOR)
      await expect(pageM.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
      await pageM.getByRole('button', { name: '新入生として登録する' }).click()
      await expect(pageM.getByRole('heading', { name: '新入生ホーム' })).toBeVisible()
      // 引き継ぎ通知と、引き継がれた内容（写真）が表示される
      await expect(
        pageM.getByText('デモ版に保存されていた興味パスポートをアカウントへ引き継ぎました', {
          exact: false,
        }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(pageM.getByText('写真').first()).toBeVisible()
      // 4キーすべてが削除され、localStorageはsb-*のみ
      await expect
        .poll(async () =>
          (await pageM.evaluate(() => Object.keys(window.localStorage))).filter((key) =>
            key.startsWith('cue-demo:'),
          ),
        )
        .toEqual([])
      const keys = await pageM.evaluate(() => Object.keys(window.localStorage))
      expect(keys.filter((key) => !key.startsWith('sb-'))).toEqual([])
      // リロードしても引き継いだ内容がサーバーから復元される（通知は再表示されない）
      await pageM.reload()
      await expect(pageM.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(pageM.getByText('写真').first()).toBeVisible()
    })

    await test.step('14: REST/RPCの直接操作でユーザー分離を迂回できない', async () => {
      const { url, key } = readPublicSupabaseEnv()
      const tokenA = await pageA.evaluate(() => {
        const authKey = Object.keys(window.localStorage).find(
          (candidate) => candidate.startsWith('sb-') && candidate.includes('auth-token'),
        )
        if (authKey === undefined) return ''
        try {
          const parsed = JSON.parse(window.localStorage.getItem(authKey) ?? '{}') as {
            access_token?: string
            currentSession?: { access_token?: string }
          }
          return parsed.access_token ?? parsed.currentSession?.access_token ?? ''
        } catch {
          return ''
        }
      })
      expect(tokenA.length > 0).toBe(true)
      const authedHeaders = { apikey: key, Authorization: `Bearer ${tokenA}` }

      // 学生Aのpassport SELECTは自分の1行だけ（学生は2人以上登録済み）
      const passportRes = await request.get(`${url}/rest/v1/student_passports?select=user_id`, {
        headers: authedHeaders,
      })
      expect(passportRes.ok()).toBe(true)
      expect(((await passportRes.json()) as unknown[]).length).toBe(1)

      // 直接INSERT/UPDATE/DELETEは拒否される（保存はRPCのみ）
      const insertRes = await request.post(`${url}/rest/v1/student_passports`, {
        headers: authedHeaders,
        data: { user_id: '00000000-0000-0000-0000-000000000000' },
      })
      expect(insertRes.status() >= 400).toBe(true)
      const updateRes = await request.patch(
        `${url}/rest/v1/student_passports?user_id=neq.00000000-0000-0000-0000-000000000000`,
        { headers: authedHeaders, data: { max_fee_per_event_yen: 99999 } },
      )
      expect(updateRes.status() >= 400).toBe(true)

      // privateスキーマの配信テーブルへはREST経路が存在しない
      const privateRes = await request.get(`${url}/rest/v1/offer_deliveries?select=*`, {
        headers: authedHeaders,
      })
      expect(privateRes.status() >= 400).toBe(true)

      // 学生Aは他団体のキャンペーン・ファネルを読めない
      const campaignRes = await request.post(`${url}/rest/v1/rpc/list_org_campaigns`, {
        headers: authedHeaders,
        data: { org_id: orgId },
      })
      expect(campaignRes.status() >= 400).toBe(true)

      // anon（未ログイン）はパスポートへ一切アクセスできない
      const anonRes = await request.get(`${url}/rest/v1/student_passports?select=*`, {
        headers: { apikey: key },
      })
      expect(anonRes.status() >= 400).toBe(true)

      // 団体オーナーB（学生権限なし）は受信箱RPCを呼べない
      const tokenB = await pageB.evaluate(() => {
        const authKey = Object.keys(window.localStorage).find(
          (candidate) => candidate.startsWith('sb-') && candidate.includes('auth-token'),
        )
        if (authKey === undefined) return ''
        try {
          const parsed = JSON.parse(window.localStorage.getItem(authKey) ?? '{}') as {
            access_token?: string
          }
          return parsed.access_token ?? ''
        } catch {
          return ''
        }
      })
      expect(tokenB.length > 0).toBe(true)
      const inboxRes = await request.post(`${url}/rest/v1/rpc/list_my_inbox`, {
        headers: { apikey: key, Authorization: `Bearer ${tokenB}` },
        data: {},
      })
      expect(inboxRes.status() >= 400).toBe(true)
    })

    await test.step('15: console error・予期しない失敗リクエストがない', async () => {
      expect(deliveryUrlChecked).toBe(true)
      expect(problems, problems.join('\n')).toEqual([])
    })
  } finally {
    for (const context of contexts) {
      await context.close()
    }
  }
})
