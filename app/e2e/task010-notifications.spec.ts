import { execSync } from 'node:child_process'

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

// Task 010 メール通知のE2E（tasks/010-email-notifications.md）。
//
// 前提: ローカルSupabaseスタックが起動済み（npm run db:start）。
//
// ここで検証するのは、学生が自分で受け取り方を選べることと、
// その選択が **配信時にoutboxへ積まれるかどうか** へ正しく効くこと。
// SMTPでの実送信（Edge Function）は Docker と Deno が必要なため、
// hosted staging での実機確認（docs/launch_plan.md §7）へ回している。
//
// psqlの `-q` はコマンドタグ（"UPDATE 1"）の出力を抑止する

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'
const DB_URL = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const RUN = Date.now().toString(36)
const EMAIL_STUDENT = `demo-s10-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_OWNER = `demo-o10-${RUN}@stu.kobe-u.ac.jp`
const ORG_NAME = `通知E2E会-${RUN}`

test.describe.configure({ mode: 'serial' })

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

// このspec専用のカテゴリ（film）で母集団を作る。E2Eは同じDBを共有して直列実行されるため
function seedStudentPool(tag: string, count: number) {
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
      `select user_id, array['film']::public.interest_category[], ` +
      `array['friends','challenge']::public.purpose[], 'moderate', 'monthly_1_2', ` +
      `array['weekend']::public.day_slot[], 'none', 2000, false, ` +
      `array['film']::public.interest_category[], 5 from acct`,
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
    if (url.includes('/rest/v1/student_passports') && status === 406) return
    if (url.includes('/rest/v1/student_notification_settings') && status === 406) return
    sink.push(`${label} http ${status}: ${url}`)
  })
}

test('Task 010: 通知設定の3択と、設定に応じたoutboxの積まれ方', async ({ browser, request }) => {
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
    const pageA = await newPage('student')
    const pageB = await newPage('owner')
    let studentId = ''

    await test.step('1: 学生が登録し、通知設定の既定が「オファーごと」である', async () => {
      await signInWithOtp(pageA, request, EMAIL_STUDENT)
      await expect(pageA.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
      await pageA.getByRole('button', { name: '新入生として登録する' }).click()
      await expect(pageA.getByRole('heading', { name: '新入生ホーム' })).toBeVisible()

      await pageA.getByRole('button', { name: '通知設定' }).click()
      await expect(pageA.getByRole('heading', { name: 'メール通知' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(pageA.getByRole('radio', { name: /オファーごとに通知/u })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await expectNoHorizontalScroll(pageA, '通知設定(390px)')
      // メールに何を書かないかが画面で説明されている
      await expect(pageA.getByText('どの団体から', { exact: false })).toBeVisible()
    })

    await test.step('2: パスポートを登録する（film・土日）', async () => {
      await pageA.getByRole('button', { name: 'ホーム' }).click()
      await pageA.getByRole('button', { name: '興味パスポートをはじめる' }).click()
      await pageA.getByRole('button', { name: '映像・映画' }).click()
      await pageA.getByRole('button', { name: '次へ' }).click()
      await pageA.getByRole('button', { name: '友達を作る' }).click()
      await pageA.getByRole('button', { name: '次へ' }).click()
      await pageA.getByRole('button', { name: '土日' }).click()
      await pageA.getByRole('button', { name: '次へ' }).click()
      await pageA.getByRole('button', { name: '映像・映画' }).click()
      await pageA.getByRole('button', { name: 'これで完了' }).click()
      await expect(pageA.getByText('興味パスポートを保存しました')).toBeVisible({
        timeout: 15_000,
      })
      studentId = execSql(
        `select u.id::text from auth.users u where u.email = '${EMAIL_STUDENT}'`,
      )
      expect(studentId.length > 0).toBe(true)
    })

    await test.step('3: 「1日1回のまとめ」へ変更でき、再読み込み後も保たれる', async () => {
      await pageA.getByRole('button', { name: '通知設定' }).click()
      await expect(pageA.getByRole('heading', { name: 'メール通知' })).toBeVisible()
      await pageA.getByRole('radio', { name: /1日1回のまとめ/u }).click()
      await expect(pageA.getByText('保存しました。')).toBeVisible({ timeout: 15_000 })

      await pageA.reload()
      await pageA.getByRole('button', { name: '通知設定' }).click()
      await expect(pageA.getByRole('radio', { name: /1日1回のまとめ/u })).toHaveAttribute(
        'aria-checked',
        'true',
        { timeout: 15_000 },
      )
      expect(
        execSql(`select mode from public.student_notification_settings where user_id = '${studentId}'`),
      ).toBe('daily')
    })

    await test.step('4: 団体が配信すると、設定に応じてoutboxへ積まれる', async () => {
      await signInWithOtp(pageB, request, EMAIL_OWNER)
      await expect(pageB.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
      await pageB.getByRole('button', { name: '新しい団体を作る' }).click()
      await pageB.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME)
      await pageB.getByRole('button', { name: '団体を作成する' }).click()
      await expect(pageB.getByRole('heading', { name: ORG_NAME })).toBeVisible({ timeout: 15_000 })

      execSql(`update public.organizations set status='verified' where name='${ORG_NAME}'`)
      // 学生Aを含めて配信可能な人数（5人以上）にする
      seedStudentPool(`${RUN}f`, 6)
      await pageB.reload()
      await expect(pageB.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
        timeout: 15_000,
      })

      await pageB.getByRole('button', { name: '新しいオファーを作成' }).click()
      await pageB.getByLabel('イベント名').fill(`上映会-${RUN}`)
      await pageB.getByLabel('イベント紹介').fill('短編映画の上映と感想会をします。')
      await pageB.getByLabel('開催日時').fill('9月13日（土）18:00')
      await pageB.getByLabel('場所').fill('大学会館ホール')
      await pageB.getByLabel('なぜこの人たちに届けたいか').fill('映像に興味のある新入生に届けたいからです。')
      await pageB.getByRole('button', { name: '映像・映画', exact: true }).click()
      await pageB.getByRole('button', { name: '友達を作る' }).click()
      await pageB.getByRole('button', { name: '土日', exact: true }).click()
      await pageB.getByRole('button', { name: '対象を確認する' }).click()
      await expect(pageB.getByRole('heading', { name: '送信内容の確認' })).toBeVisible({
        timeout: 15_000,
      })
      await pageB.getByRole('button', { name: 'この内容で送信' }).click()
      await expect(pageB.getByRole('heading', { name: /人の新入生へ配信しました/u })).toBeVisible({
        timeout: 15_000,
      })

      // daily の学生Aにはまとめが1行だけ積まれ、オファーごとの通知は積まれない
      expect(
        execSql(
          `select count(*)::int from private.email_outbox ` +
            `where user_id = '${studentId}' and kind = 'daily_digest'`,
        ),
      ).toBe('1')
      expect(
        execSql(
          `select count(*)::int from private.email_outbox ` +
            `where user_id = '${studentId}' and kind = 'offer_arrival'`,
        ),
      ).toBe('0')
      // 既定（each）のプール6人にはオファーごとの通知が積まれる
      expect(
        execSql(
          `select count(*)::int from private.email_outbox o ` +
            `join auth.users u on u.id = o.user_id ` +
            `where u.email like 'demo-pool-${RUN}f-%' and o.kind = 'offer_arrival'`,
        ),
      ).toBe('6')
      // outboxに宛先・本文は保存されない
      expect(
        execSql(
          `select count(*)::int from information_schema.columns ` +
            `where table_schema='private' and table_name='email_outbox' ` +
            `and (column_name ~ 'email' or column_name ~ 'body' or column_name ~ 'subject')`,
        ),
      ).toBe('0')
    })

    await test.step('5: 「通知しない」にすると、以後の配信で積まれない', async () => {
      await pageA.getByRole('button', { name: '通知設定' }).click()
      await expect(pageA.getByRole('heading', { name: 'メール通知' })).toBeVisible()
      await pageA.getByRole('radio', { name: /通知しない/u }).click()
      await expect(pageA.getByText('保存しました。')).toBeVisible({ timeout: 15_000 })

      const before = execSql(
        `select count(*)::int from private.email_outbox where user_id = '${studentId}'`,
      )

      // 2通目もUIから送る。RPCをpsqlで直接呼ぶと auth.uid() が無く not_authorized になるため
      await pageB.getByRole('button', { name: '新しいオファーを作成' }).click()
      await pageB.getByLabel('イベント名').fill(`2通目-${RUN}`)
      await pageB.getByLabel('イベント紹介').fill('前回に続いて短編の上映会をします。')
      await pageB.getByLabel('開催日時').fill('9月20日（土）18:00')
      await pageB.getByLabel('場所').fill('大学会館ホール')
      await pageB
        .getByLabel('なぜこの人たちに届けたいか')
        .fill('前回来られなかった新入生にも届けたいからです。')
      await pageB.getByRole('button', { name: '映像・映画', exact: true }).click()
      await pageB.getByRole('button', { name: '友達を作る' }).click()
      await pageB.getByRole('button', { name: '土日', exact: true }).click()
      await pageB.getByRole('button', { name: '対象を確認する' }).click()
      await expect(pageB.getByRole('heading', { name: '送信内容の確認' })).toBeVisible({
        timeout: 15_000,
      })
      await pageB.getByRole('button', { name: 'この内容で送信' }).click()
      await expect(pageB.getByRole('heading', { name: /人の新入生へ配信しました/u })).toBeVisible({
        timeout: 15_000,
      })

      expect(
        execSql(`select count(*)::int from private.email_outbox where user_id = '${studentId}'`),
      ).toBe(before)
      // 通知を止めてもオファー自体は届く（受信箱で確認できる）
      expect(
        execSql(
          `select count(*)::int from private.offer_recipients where user_id = '${studentId}'`,
        ),
      ).toBe('2')
    })

    expect(problems, `console error・失敗リクエストが無いこと: ${problems.join(' | ')}`).toEqual([])
  } finally {
    for (const context of contexts) {
      await context.close()
    }
  }
})
