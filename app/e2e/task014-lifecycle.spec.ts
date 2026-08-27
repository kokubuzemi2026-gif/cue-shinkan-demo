import { execSync } from 'node:child_process'

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

// Task 014 アカウント・データのライフサイクルのE2E（tasks/014-account-and-data-lifecycle.md）。
//
// 前提: ローカルSupabaseスタックが起動済み（npm run db:start）。
//
// 検証するのは、利用者が自分で消せることと、
// **消したあとに復元可能なデータが残らないこと**（DBを直接読んで確認する）。
//
// psqlの `-q` はコマンドタグ（"UPDATE 1"）の出力を抑止する

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'
const DB_URL = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const RUN = Date.now().toString(36)
const EMAIL_STUDENT = `demo-s14-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_OWNER = `demo-o14-${RUN}@stu.kobe-u.ac.jp`
const ORG_NAME = `ライフサイクルE2E会-${RUN}`

test.describe.configure({ mode: 'serial' })

// SQLは -c ではなく**標準入力**で渡す。
// -c "..." だとシェルが二重引用符の中で $$ をPIDへ、$1 を空へ展開してしまい、
// plpgsqlのDOブロックが壊れる（`do 10036 declare ...`）。
// stdinなら引用符・ドル記号・バッククォートを気にしなくてよい
function execSql(sql: string): string {
  try {
    return execSync(`psql "${DB_URL}" -v ON_ERROR_STOP=1 -q -tA`, {
      encoding: 'utf-8',
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return execSync(
      `docker exec -i supabase_db_cue-shinkan-demo psql -U postgres -v ON_ERROR_STOP=1 -q -tA`,
      { encoding: 'utf-8', input: sql, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
  }
}

// 運営操作はservice_role専用。運営者がSQL Editorから実行するのと同じ権限で呼ぶ
function execAdminSql(sql: string): string {
  return execSql(`set role service_role; ${sql}`)
}

// 合成学生プール（実在しない架空アドレスのみ）
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
  // 秘密値をメッセージへ出さないためboolean化する
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

// 意図的に拒否される要求（緊急停止中の確認・送信）を数えるためのフラグ。
// ブラウザは失敗した要求について response とは別に console へも
// 「Failed to load resource」を出すため、同じ基準で除外しないと
// 「拒否されたこと」自体を失敗として数えてしまう
let expectRejection = false

function watchPage(page: Page, sink: string[], label: string) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (expectRejection && message.text().startsWith('Failed to load resource')) return
    sink.push(`${label} console: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    sink.push(`${label} pageerror: ${error.message}`)
  })
  page.on('response', (response) => {
    const status = response.status()
    const url = response.url()
    if (status < 400) return
    // 未登録パスポート・通知設定のmaybeSingle取得は仕様上406を返す
    if (url.includes('/rest/v1/student_passports') && status === 406) return
    if (url.includes('/rest/v1/student_notification_settings') && status === 406) return
    // 最後の代表者の脱退拒否はRPCが400を返すのが正しい挙動
    if (expectRejection && url.includes('/rest/v1/rpc/leave_organization') && status === 400) {
      return
    }
    sink.push(`${label} http ${status}: ${url}`)
  })
}

// user_id列を持つ全テーブルを走査し、その利用者の行が残っているテーブル名を返す
function rowsLeftFor(userId: string): string {
  return execSql(
    `do $$ declare r record; v_count integer; v_hits text[] := '{}'; begin ` +
      `for r in select c.table_schema as sch, c.table_name as tbl ` +
      `from information_schema.columns c join information_schema.tables t ` +
      `on t.table_schema = c.table_schema and t.table_name = c.table_name ` +
      `where c.table_schema in ('public','private') and c.column_name = 'user_id' ` +
      `and t.table_type = 'BASE TABLE' order by 1,2 loop ` +
      `execute format('select count(*) from %I.%I where user_id = $1', r.sch, r.tbl) ` +
      `into v_count using '${userId}'::uuid; ` +
      `if v_count > 0 then v_hits := v_hits || (r.sch || '.' || r.tbl); end if; end loop; ` +
      `create temp table if not exists e2e_scan (hits text); delete from e2e_scan; ` +
      `insert into e2e_scan values (array_to_string(v_hits, ',')); end $$; ` +
      `select hits from e2e_scan;`,
  )
}

async function composeAndSend(page: Page, eventName: string, category: string) {
  await page.getByRole('button', { name: '新しいオファーを作成' }).click()
  await page.getByLabel('イベント名').fill(eventName)
  await page.getByLabel('イベント紹介').fill('はじめての方でも参加できる新歓イベントです。')
  await page.getByLabel('開催日時').fill('9月13日（土）14:00')
  await page.getByLabel('場所').fill('国際交流ラウンジ')
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
  await page.getByRole('button', { name: 'この内容で送信' }).click()
}

test('Task 014: 本人がデータを削除でき、復元可能な個人情報が残らない', async ({
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
    const pageStudent = await newPage('student')
    const pageOwner = await newPage('owner')
    let studentId = ''

    await test.step('1: 学生が登録し、国際交流のパスポートを保存する', async () => {
      await signInWithOtp(pageStudent, request, EMAIL_STUDENT)
      await expect(pageStudent.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
      await pageStudent.getByRole('button', { name: '新入生として登録する' }).click()
      await expect(pageStudent.getByRole('heading', { name: '新入生ホーム' })).toBeVisible()

      await pageStudent.getByRole('button', { name: '興味パスポートをはじめる' }).click()
      await pageStudent.getByRole('button', { name: '国際交流' }).click()
      await pageStudent.getByRole('button', { name: '次へ' }).click()
      await pageStudent.getByRole('button', { name: '友達を作る' }).click()
      await pageStudent.getByRole('button', { name: '次へ' }).click()
      await pageStudent.getByRole('button', { name: '土日' }).click()
      await pageStudent.getByRole('button', { name: '次へ' }).click()
      await pageStudent.getByRole('button', { name: '国際交流' }).click()
      await pageStudent.getByRole('button', { name: 'これで完了' }).click()
      await expect(pageStudent.getByText('興味パスポートを保存しました')).toBeVisible({
        timeout: 15_000,
      })
      studentId = execSql(`select u.id::text from auth.users u where u.email = '${EMAIL_STUDENT}'`)
      expect(studentId.length > 0).toBe(true)
    })

    await test.step('2: 団体が配信し、学生が返答する（消す対象のデータを作る）', async () => {
      await signInWithOtp(pageOwner, request, EMAIL_OWNER)
      await expect(pageOwner.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
      await pageOwner.getByRole('button', { name: '新しい団体を作る' }).click()
      await pageOwner.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME)
      await pageOwner.getByRole('button', { name: '団体を作成する' }).click()
      await expect(pageOwner.getByRole('heading', { name: ORG_NAME })).toBeVisible({
        timeout: 15_000,
      })
      // service_role には public.organizations のSELECT権限が無い（設計どおり）。
      // 対象IDは所有者権限で先に解決し、運営RPCへはリテラルで渡す
      const orgId = execSql(`select id::text from public.organizations where name = '${ORG_NAME}'`)
      expect(orgId.length > 0).toBe(true)
      execAdminSql(
        `select public.admin_set_organization_status(` +
          `'${orgId}'::uuid, 'verified', 'ops-e2e', 'E2E検証');`,
      )
      seedStudentPool(`${RUN}i`, 5, 'international')
      await pageOwner.reload()
      await expect(pageOwner.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
        timeout: 15_000,
      })
      await composeAndSend(pageOwner, `留学生交流会-${RUN}`, '国際交流')
      await expect(pageOwner.getByRole('heading', { name: /人の新入生へ配信しました/u })).toBeVisible(
        { timeout: 15_000 },
      )
      await pageOwner.getByRole('button', { name: 'ダッシュボードへもどる' }).click()
      await expect(pageOwner.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible()

      await pageStudent.getByRole('button', { name: '受信箱', exact: true }).click()
      await expect(pageStudent.getByText(`留学生交流会-${RUN}`)).toBeVisible({ timeout: 15_000 })
      await pageStudent.getByRole('button', { name: new RegExp(`留学生交流会-${RUN}`, 'u') }).click()
      await pageStudent.getByRole('button', { name: '行ってみたい' }).click()
      await expect(pageStudent.getByText('「行ってみたい」を保存しました')).toBeVisible({
        timeout: 15_000,
      })
      // 消す対象が実際にできている
      expect(rowsLeftFor(studentId).length > 0).toBe(true)
    })

    await test.step('3: 実行前に「取り消せない」と、消える/残るものが示される', async () => {
      await pageStudent.getByRole('button', { name: 'アカウント', exact: true }).click()
      await expect(pageStudent.getByRole('heading', { name: 'アカウントとデータ' })).toBeVisible()
      await expectNoHorizontalScroll(pageStudent, 'アカウント(390px)')

      await pageStudent.getByRole('button', { name: '興味パスポートを削除', exact: true }).click()
      await expect(
        pageStudent.getByRole('heading', { name: '興味パスポートを削除しますか？' }),
      ).toBeVisible()
      await expect(pageStudent.getByText('この操作は取り消せません。').first()).toBeVisible()
      // D023: 受信済みの案内が残ることを、消す前に伝える
      await expect(
        pageStudent.getByText('すでに届いている案内と、あなたの返答', { exact: false }).first(),
      ).toBeVisible()
      await expectNoHorizontalScroll(pageStudent, 'アカウント(確認・390px)')
    })

    await test.step('4: パスポートを削除しても、受信済みの案内は残る（D023）', async () => {
      await pageStudent.getByRole('button', { name: '削除する', exact: true }).click()
      await expect(
        pageStudent.getByText('興味パスポートを削除しました', { exact: false }),
      ).toBeVisible({ timeout: 15_000 })
      expect(
        execSql(`select count(*)::int from public.student_passports where user_id = '${studentId}'`),
      ).toBe('0')

      await pageStudent.getByRole('button', { name: '受信箱', exact: true }).click()
      await expect(pageStudent.getByText(`留学生交流会-${RUN}`)).toBeVisible({ timeout: 15_000 })
      expect(
        execSql(
          `select count(*)::int from private.offer_recipients where user_id = '${studentId}'`,
        ),
      ).toBe('1')
    })

    await test.step('5: アカウントを削除すると、全テーブルから本人の行が消える', async () => {
      await pageStudent.getByRole('button', { name: 'アカウント', exact: true }).click()
      await pageStudent.getByRole('button', { name: 'アカウントを削除', exact: true }).click()
      await expect(
        pageStudent.getByRole('heading', { name: 'アカウントを削除しますか？' }),
      ).toBeVisible()
      await pageStudent.getByRole('button', { name: 'アカウントを削除する', exact: true }).click()
      await expect(pageStudent.getByText('アカウントを削除しました', { exact: false })).toBeVisible({
        timeout: 15_000,
      })

      // user_id列を持つ全テーブルに1行も残らない
      expect(rowsLeftFor(studentId)).toBe('')
      // 団体側の配信snapshotは残る（D023）。他の5人の受信者行も無傷
      expect(
        execSql(
          `select count(*)::int from private.offer_deliveries where event_name = '留学生交流会-${RUN}'`,
        ),
      ).toBe('1')
      expect(
        execSql(
          `select count(*)::int from private.offer_recipients r ` +
            `join private.offer_deliveries d on d.id = r.delivery_id ` +
            `where d.event_name = '留学生交流会-${RUN}'`,
        ),
      ).toBe('5')
      // 監査記録に平文の識別子が残らない
      expect(
        execSql(
          `select count(*)::int from private.deletion_audit_log ` +
            `where subject_hash = '${studentId}' or subject_hash like '%@%'`,
        ),
      ).toBe('0')
    })

    await test.step('6: 削除後は利用できる権限が無くなる', async () => {
      await pageStudent.reload()
      await expect(pageStudent.getByRole('heading', { name: '利用方法を選ぶ' })).toBeVisible({
        timeout: 15_000,
      })
    })

    await test.step('7: 最後の代表者は団体から脱退できない', async () => {
      // ここでの400は正しい挙動。responseとconsoleの両方を同じ基準で除外する
      expectRejection = true
      await pageOwner.reload()
      await expect(pageOwner.getByRole('heading', { name: ORG_NAME })).toBeVisible({
        timeout: 15_000,
      })
      await pageOwner.getByRole('button', { name: 'この団体から脱退', exact: true }).click()
      await expect(
        pageOwner.getByRole('heading', { name: 'この団体から脱退しますか？' }),
      ).toBeVisible()
      await pageOwner.getByRole('button', { name: '脱退する', exact: true }).click()
      await expect(
        pageOwner.getByText('唯一の代表者になっている団体があります', { exact: false }),
      ).toBeVisible({ timeout: 15_000 })
      // 拒否されたので所属は残る
      expect(
        execSql(
          `select count(*)::int from public.organization_memberships m ` +
            `join public.organizations o on o.id = m.organization_id where o.name = '${ORG_NAME}'`,
        ),
      ).toBe('1')
      await expectNoHorizontalScroll(pageOwner, '団体ホーム(脱退拒否・390px)')
    })

    await test.step('8: 拒否のあとも画面は壊れていない', async () => {
      // 拒否を許す区間はここで閉じる（consoleイベントの遅れを取りこぼさない）
      expectRejection = false
      await pageOwner.getByRole('button', { name: 'やめる', exact: true }).click()
      await expect(pageOwner.getByRole('heading', { name: ORG_NAME })).toBeVisible()
    })

    expect(problems, `console error・失敗リクエストが無いこと: ${problems.join(' | ')}`).toEqual([])
  } finally {
    for (const context of contexts) {
      await context.close()
    }
  }
})
