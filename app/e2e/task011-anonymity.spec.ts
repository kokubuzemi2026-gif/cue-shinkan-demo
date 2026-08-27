import { execSync } from 'node:child_process'

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

// Task 011 匿名性・安全のE2E（tasks/011-anonymity-safety-concurrency.md）。
//
// 前提: ローカルSupabaseスタックが起動済み（npm run db:start）。メールはMailpitが捕捉する。
// 団体のverified化と合成学生プールの投入は、クライアント経路が存在しない運営相当のSQLで行う。
//
// 検証する画面上の性質:
// - 対象規模が正確な人数ではなく区分で表示される（D036）
// - 配信可能5人未満では送信ボタンが押せず、理由が表示される（D036）
// - ファネルの抑制セルが「0」ではなく「—」で表示され、非表示の理由が併記される（D037）
//
// 機密対策: OTPコードを失敗メッセージへ出さないため、秘密値のassertionはboolean化する。

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'
const DB_URL = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const RUN = Date.now().toString(36)
const EMAIL_OWNER = `demo-o11-${RUN}@stu.kobe-u.ac.jp`
const ORG_NAME = `匿名性E2E会-${RUN}`

test.describe.configure({ mode: 'serial' })

// psqlの `-q` はコマンドタグ（"UPDATE 1"）の出力を抑止する。
// 付けないと `update ... returning id` の戻り値に改行とタグが混ざる
function execSql(sql: string): string {
  const escaped = sql.replaceAll('"', '\\"')
  try {
    return execSync(`psql "${DB_URL}" -q -tA -c "${escaped}"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return execSync(
      `docker exec supabase_db_cue-shinkan-demo psql -U postgres -q -tA -c "${escaped}"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
  }
}

// 合成学生プール（実在しない架空アドレスのみ）。タグとカテゴリで母集団を分ける
function seedStudentPool(tag: string, count: number, category: string) {
  execSql(
    `with created as (` +
      `insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) ` +
      `select gen_random_uuid(), 'demo-pool-${tag}-' || n || '@stu.kobe-u.ac.jp', now(), now(), now() ` +
      `from generate_series(1, ${count}) as n returning id` +
    `), acct as (` +
      `insert into public.student_accounts (user_id) select id from created returning user_id` +
    `) insert into public.student_passports (` +
      `user_id, interests, purposes, style, frequency, available_days, experience, ` +
      `max_fee_per_event_yen, reception_paused, reception_categories, reception_weekly_limit) ` +
      `select user_id, array['${category}']::public.interest_category[], ` +
      `array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', ` +
      `array['weekend']::public.day_slot[], 'none', 2000, false, ` +
      `array['${category}']::public.interest_category[], 5 from acct`,
  )
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
  await request.delete(`${MAILPIT}/api/v1/messages`, { data: { IDs: [messageId] } })
  return otpMatch![1]
}

// Task 015: 同意画面が出たら同意して進む（初回・版更新時）。
// 既に同意済みなら何もしない
async function passConsentIfPresent(page: Page) {
  const consentCheck = page.getByRole('checkbox', { name: /同意します/u })
  const onboarding = page.getByRole('heading', { name: '利用方法を選ぶ' })
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
  // Task 015: ログイン後、登録の前に同意画面を通す（D050）
  await passConsentIfPresent(page)
}

function watchPage(page: Page, sink: string[], label: string) {
  page.on('console', (message) => {
    if (message.type() === 'error') sink.push(`${label} console: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    sink.push(`${label} pageerror: ${error.message}`)
  })
  page.on('response', (response) => {
    const status = response.status()
    const url = response.url()
    if (status < 400) return
    // 未登録パスポートのmaybeSingle取得は仕様上406を返す。
    // 送信拒否（匿名性不足）はRPCが400を返すのが正しい挙動のため除外する
    if (url.includes('/rest/v1/student_passports') && status === 406) return
    if (url.includes('/rest/v1/rpc/send_offer') && status === 400) return
    sink.push(`${label} http ${status}: ${url}`)
  })
}

// オファー作成フォームを埋めて確認画面まで進む（対象カテゴリだけを差し替える）
async function composeOffer(page: Page, eventName: string, category: string) {
  await page.getByRole('button', { name: '新しいオファーを作成' }).click()
  await page.getByLabel('イベント名').fill(eventName)
  await page.getByLabel('イベント紹介').fill('はじめての方でも参加できる新歓イベントです。')
  await page.getByLabel('開催日時').fill('9月13日（土）9:00〜15:00')
  await page.getByLabel('場所').fill('六甲ケーブル下 集合')
  await page
    .getByLabel('なぜこの人たちに届けたいか')
    .fill('最初の一歩を踏み出したい新入生に届けたいからです。')
  await page.getByRole('button', { name: category, exact: true }).click()
  await page.getByRole('button', { name: '友達を作る' }).click()
  await page.getByRole('button', { name: '土日', exact: true }).click()
  await page.getByRole('button', { name: '対象を確認する' }).click()
  await expect(page.getByRole('heading', { name: '送信内容の確認' })).toBeVisible({
    timeout: 15_000,
  })
}

test('Task 011: 対象規模の区分表示・最小5人の配信拒否・ファネルの抑制表示', async ({
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
    const page = await newPage('owner')
    let orgId = ''

    await test.step('1: 団体オーナーが団体を作成し、運営相当のSQLでverified化する', async () => {
      await signInWithOtp(page, request, EMAIL_OWNER)
      await expect(page.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
      await page.getByRole('button', { name: '新しい団体を作る' }).click()
      await page.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME)
      await page.getByRole('button', { name: '団体を作成する' }).click()
      await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible({ timeout: 15_000 })

      orgId = execSql(
        `update public.organizations set status='verified' where name='${ORG_NAME}' returning id`,
      )
      expect(orgId.length > 0).toBe(true)
      await page.reload()
      await expect(page.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
        timeout: 15_000,
      })
    })

    await test.step('2: 対象4人では区分 1〜4人 が表示され、送信できない（k=5・D036）', async () => {
      // このspec専用のカテゴリを使う。E2Eは同じDBを共有して直列実行されるため、
      // 他のspec（task009はアウトドア）と母集団が混ざらないようにする
      seedStudentPool(`${RUN}t`, 4, 'travel')
      await composeOffer(page, `気軽な旅の下見-${RUN}`, '旅行')

      // 正確な人数ではなく区分が表示される
      await expect(page.locator('.audience-count-number')).toHaveText('1〜4人')
      await expect(
        page.getByText('新入生の個人が特定されないよう、対象人数はおおよその区分で表示しています。'),
      ).toBeVisible()
      // 匿名性を保てないため送信できず、理由が示される
      await expect(page.getByText('対象の新入生が5人未満のため')).toBeVisible()
      await expect(page.getByRole('button', { name: 'この内容で送信' })).toBeDisabled()
      await expectNoHorizontalScroll(page, '送信確認(1-4人・390px)')

      await page.getByRole('button', { name: 'もどる' }).click()
      await page.getByRole('button', { name: 'やめる' }).click()
      await expect(page.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible()
    })

    await test.step('3: 対象12人では区分 10〜24人 で送信でき、生の人数は画面に出ない', async () => {
      seedStudentPool(`${RUN}s`, 12, 'sports')
      await composeOffer(page, `はじめてのスポーツ体験-${RUN}`, 'スポーツ')

      await expect(page.locator('.audience-count-number')).toHaveText('10〜24人')
      // 「12人」のような確定人数が確認画面のどこにも現れない
      const confirmText = await page.locator('.app-main').innerText()
      expect(confirmText.includes('12人')).toBe(false)
      expect(/\d+人とマッチ/u.test(confirmText)).toBe(false)

      await page.getByRole('button', { name: 'この内容で送信' }).click()
      await expect(
        page.getByRole('heading', { name: '10〜24人の新入生へ配信しました' }),
      ).toBeVisible({ timeout: 15_000 })
      await expectNoHorizontalScroll(page, '送信完了(390px)')
      await page.getByRole('button', { name: 'ダッシュボードへもどる' }).click()
      await expect(page.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible()
    })

    await test.step('4: ファネルは配信のみ丸めて開示し、残りは「—」で非表示にする（D037）', async () => {
      // キャンペーン一覧はダッシュボード表示後に非同期で取得される。
      // allInnerTexts()は自動待機しないため、先に自動待機するassertionで揃うのを待つ
      // （待たないと空配列を読んでしまう）
      await expect(page.locator('.campaign-card')).toHaveCount(1)
      await expect(page.locator('.funnel-value')).toHaveCount(4)
      const funnel = await page.locator('.funnel-value').allInnerTexts()
      // 配信12→10へ丸め、閲覧・関心・参加意向は0人だが10人未満のため抑制される。
      // 「0」と表示してしまうと「誰も見ていない」と誤読されるため必ず「—」にする
      expect(funnel).toEqual(['10', '—', '—', '—'])
      expect(funnel.includes('0')).toBe(false)
      await expect(
        page.getByText('「—」は0人ではなく非表示です', { exact: false }),
      ).toBeVisible()
      await expectNoHorizontalScroll(page, 'ダッシュボード(抑制表示・390px)')

      // 学生の個人情報・一覧は現れない
      const dashboardText = await page.locator('.app-main').innerText()
      expect(dashboardText.includes('@stu.kobe-u.ac.jp')).toBe(false)
    })

    await test.step('5: 配信10人未満のofferはファネルを一切開示しない', async () => {
      // ボランティアカテゴリで6人の配信を作る。
      // 旅行カテゴリを再利用しないのは、同一条件のpreviewが24時間固定される（D038）ため。
      // 対象条件を変えない限り、母集団が増えても区分は動かない
      seedStudentPool(`${RUN}v`, 6, 'volunteer')
      await composeOffer(page, `地域清掃の見学-${RUN}`, 'ボランティア')
      await expect(page.locator('.audience-count-number')).toHaveText('5〜9人')
      await page.getByRole('button', { name: 'この内容で送信' }).click()
      await expect(
        page.getByRole('heading', { name: '5〜9人の新入生へ配信しました' }),
      ).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: 'ダッシュボードへもどる' }).click()
      await expect(page.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible()

      // 新しいキャンペーンが先頭。配信6人（10人未満）は全セルが非表示
      const firstCard = page.locator('.campaign-card').first()
      await expect(firstCard.getByText(`地域清掃の見学-${RUN}`)).toBeVisible()
      const smallFunnel = await firstCard.locator('.funnel-value').allInnerTexts()
      expect(smallFunnel).toEqual(['—', '—', '—', '—'])
      await expect(firstCard.getByText('集計に必要な人数未満')).toBeVisible()
    })

    expect(problems, `console error・失敗リクエストが無いこと: ${problems.join(' | ')}`).toEqual([])
  } finally {
    for (const context of contexts) {
      await context.close()
    }
  }
})
