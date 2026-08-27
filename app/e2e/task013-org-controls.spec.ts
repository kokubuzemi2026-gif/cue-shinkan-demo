import { execSync } from 'node:child_process'

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

// Task 013 団体確認・停止・緊急停止のE2E（tasks/013-org-verification-and-killswitch.md）。
//
// 前提: ローカルSupabaseスタックが起動済み（npm run db:start）。
//
// 運営操作はservice_role専用RPCのため、クライアント経路が存在しない。
// ここでは運営者がSQL Editorから実行する状況を psql（service_role）で再現し、
// **その結果が団体・学生の画面へどう出るか**を検証する。
//
// psqlの `-q` はコマンドタグ（"UPDATE 1"）の出力を抑止する

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'
const DB_URL = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const RUN = Date.now().toString(36)
const EMAIL_STUDENT = `demo-s13-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_OWNER = `demo-o13-${RUN}@stu.kobe-u.ac.jp`
const ORG_NAME = `運営操作E2E会-${RUN}`

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

// Task 015: 同意画面が出たら同意して進む（初回・版更新時）。
// 既に同意済みなら何もしない
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
// どちらの入口でもOTPログイン処理は同一で、ログイン後の初期表示だけが変わる
const ENTRY_CTA = {
  student: '新入生としてはじめる',
  organization: '団体担当者としてはじめる',
} as const

async function signInWithOtp(
  page: Page,
  request: APIRequestContext,
  address: string,
  entry: keyof typeof ENTRY_CTA = 'student',
) {
  await page.goto(BASE)
  await page.getByRole('button', { name: ENTRY_CTA[entry] }).click()
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
    // 緊急停止中の確認・送信拒否はRPCが400を返すのが正しい挙動
    if (expectRejection && url.includes('/rest/v1/rpc/send_offer') && status === 400) return
    if (expectRejection && url.includes('/rest/v1/rpc/preview_offer_audience') && status === 400) {
      return
    }
    sink.push(`${label} http ${status}: ${url}`)
  })
}

async function composeAndSend(
  page: Page,
  eventName: string,
  category: string,
  dayLabel = '土日',
) {
  await page.getByRole('button', { name: '新しいオファーを作成' }).click()
  await page.getByLabel('イベント名').fill(eventName)
  await page.getByLabel('イベント紹介').fill('はじめての方でも参加できる新歓イベントです。')
  await page.getByLabel('開催日時').fill('9月13日（土）14:00')
  await page.getByLabel('場所').fill('大学会館 音楽室')
  await page
    .getByLabel('なぜこの人たちに届けたいか')
    .fill('最初の一歩を踏み出したい新入生に届けたいからです。')
  await page.getByRole('button', { name: category, exact: true }).click()
  await page.getByRole('button', { name: '友達を作る' }).click()
  await page.getByRole('button', { name: dayLabel, exact: true }).click()
  await page.getByRole('button', { name: '対象を確認する' }).click()
}

// 確認画面まで進んでから送信する（previewが通る条件でだけ使う）
async function confirmAndSend(page: Page) {
  await expect(page.getByRole('heading', { name: '送信内容の確認' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'この内容で送信' }).click()
}

test('Task 013: 団体確認・オファー停止・緊急停止が画面へ正しく反映される', async ({
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
    let orgId = ''
    let deliveryId = ''

    await test.step('1: 学生が登録し、音楽カテゴリのパスポートを保存する', async () => {
      await signInWithOtp(pageStudent, request, EMAIL_STUDENT)
      // Task 020: 新入生入口を選んだ初回ログインは、入口で絞った登録画面になる
      await expect(pageStudent.getByRole('heading', { name: '新入生としてはじめる' })).toBeVisible({
        timeout: 15_000,
      })
      await pageStudent.getByRole('button', { name: '新入生として登録する' }).click()
      await expect(pageStudent.getByRole('heading', { name: '新入生ホーム' })).toBeVisible()

      await pageStudent.getByRole('button', { name: '興味パスポートをはじめる' }).click()
      await pageStudent.getByRole('button', { name: '音楽' }).click()
      await pageStudent.getByRole('button', { name: '次へ' }).click()
      await pageStudent.getByRole('button', { name: '友達を作る' }).click()
      await pageStudent.getByRole('button', { name: '次へ' }).click()
      await pageStudent.getByRole('button', { name: '土日' }).click()
      await pageStudent.getByRole('button', { name: '次へ' }).click()
      await pageStudent.getByRole('button', { name: '音楽' }).click()
      await pageStudent.getByRole('button', { name: 'これで完了' }).click()
      await expect(pageStudent.getByText('興味パスポートを保存しました')).toBeVisible({
        timeout: 15_000,
      })
    })

    await test.step('2: 作成直後の団体は「審査待ち」で、オファーを作れない', async () => {
      await signInWithOtp(pageOwner, request, EMAIL_OWNER, 'organization')
      // Task 020: 団体入口を選んだ初回ログインは、団体側に絞った登録画面になる
      await expect(pageOwner.getByRole('heading', { name: '団体担当者としてはじめる' })).toBeVisible({
        timeout: 15_000,
      })
      await pageOwner.getByRole('button', { name: '新しい団体を作る' }).click()
      await pageOwner.getByLabel('団体名（必須・100文字まで）').fill(ORG_NAME)
      await pageOwner.getByRole('button', { name: '団体を作成する' }).click()
      await expect(pageOwner.getByRole('heading', { name: ORG_NAME })).toBeVisible({
        timeout: 15_000,
      })

      // 「審査待ち」は状態チップと説明文の両方に出るため、チップだけを完全一致で見る
      await expect(pageOwner.getByText('審査待ち', { exact: true })).toBeVisible()
      await expect(pageOwner.getByRole('button', { name: '新しいオファーを作成' })).toHaveCount(0)
      await expectNoHorizontalScroll(pageOwner, '団体ホーム(審査待ち・390px)')

      orgId = execSql(`select id::text from public.organizations where name = '${ORG_NAME}'`)
      expect(orgId.length > 0).toBe(true)
      expect(execSql(`select status from public.organizations where id = '${orgId}'`)).toBe(
        'pending',
      )
    })

    await test.step('3: 運営が確認（verified）すると配信できるようになる', async () => {
      execAdminSql(
        `select public.admin_set_organization_status(` +
          `'${orgId}'::uuid, 'verified', 'ops-e2e', 'E2E検証');`,
      )
      expect(execSql(`select status from public.organizations where id = '${orgId}'`)).toBe(
        'verified',
      )
      // 監査記録に変更前後が残る（学生を指す情報は入らない）
      expect(
        execSql(
          `select previous_value || '->' || new_value from private.admin_audit_log ` +
            `where target_organization_id = '${orgId}' and action = 'organization_status_changed'`,
        ),
      ).toBe('pending->verified')

      // 学生1人 + プール5人で配信可能人数（5人以上）にする
      seedStudentPool(`${RUN}m`, 5, 'music')
      await pageOwner.reload()
      await expect(pageOwner.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
        timeout: 15_000,
      })

      await composeAndSend(pageOwner, `新歓ライブ-${RUN}`, '音楽')
      await confirmAndSend(pageOwner)
      await expect(pageOwner.getByRole('heading', { name: /人の新入生へ配信しました/u })).toBeVisible(
        { timeout: 15_000 },
      )
      await pageOwner.getByRole('button', { name: 'ダッシュボードへもどる' }).click()
      await expect(pageOwner.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible()
      // 見出し「配信済みキャンペーン」と区別するため完全一致で見る
      await expect(pageOwner.getByText('配信済み', { exact: true })).toBeVisible()

      deliveryId = execSql(
        `select id::text from private.offer_deliveries where event_name = '新歓ライブ-${RUN}'`,
      )
      expect(deliveryId.length > 0).toBe(true)
    })

    await test.step('4: 学生が受信し、「行ってみたい」の後に公式窓口が開示される（D033）', async () => {
      // 公式窓口を登録してから返答する（未登録だと窓口欄が出ない）
      execSql(
        `update public.organizations set contact_label = '公式Instagram', ` +
          `contact_handle = '@cue_music_demo' where id = '${orgId}'`,
      )
      execSql(
        `update private.offer_deliveries set org_contact_label = '公式Instagram', ` +
          `org_contact_handle = '@cue_music_demo' where id = '${deliveryId}'`,
      )

      await pageStudent.getByRole('button', { name: '受信箱', exact: true }).click()
      await expect(pageStudent.getByText(`新歓ライブ-${RUN}`)).toBeVisible({ timeout: 15_000 })
      await pageStudent.getByRole('button', { name: new RegExp(`新歓ライブ-${RUN}`, 'u') }).click()
      await expect(pageStudent.getByRole('heading', { name: `新歓ライブ-${RUN}` })).toBeVisible()
      await pageStudent.getByRole('button', { name: '行ってみたい' }).click()
      await expect(pageStudent.getByText('@cue_music_demo')).toBeVisible({ timeout: 15_000 })
      await expectNoHorizontalScroll(pageStudent, 'オファー詳細(返答後・390px)')
    })

    await test.step('5: 運営がオファーを停止すると、受信箱が「募集終了」になり返答できない（D044）', async () => {
      execAdminSql(
        `select public.admin_set_offer_stopped('${deliveryId}'::uuid, true, 'ops-e2e', '内容の確認中');`,
      )

      await pageStudent.reload()
      await pageStudent.getByRole('button', { name: '受信箱', exact: true }).click()
      // 受信箱から消さない（何が起きたか分かるように残す）
      await expect(pageStudent.getByText(`新歓ライブ-${RUN}`)).toBeVisible({ timeout: 15_000 })
      await expect(pageStudent.getByText('募集終了', { exact: true }).first()).toBeVisible()

      await pageStudent.getByRole('button', { name: new RegExp(`新歓ライブ-${RUN}`, 'u') }).click()
      await expect(
        pageStudent.getByText('この案内は募集を終了しました。新しい返答はできません。'),
      ).toBeVisible()
      // 返答導線が閉じている
      await expect(pageStudent.getByRole('button', { name: '行ってみたい' })).toHaveCount(0)
      await expect(pageStudent.getByRole('button', { name: '今回は見送る' })).toHaveCount(0)
      // 開示済みの公式窓口も返さない
      const detailText = await pageStudent.locator('.app-main').innerText()
      expect(detailText.includes('@cue_music_demo')).toBe(false)
      await expectNoHorizontalScroll(pageStudent, 'オファー詳細(停止後・390px)')

      // 団体側にも停止が見える（停止理由の本文は渡さない）
      await pageOwner.reload()
      await expect(pageOwner.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(pageOwner.getByText('停止中', { exact: true })).toBeVisible()
      const ownerText = await pageOwner.locator('.app-main').innerText()
      expect(ownerText.includes('内容の確認中')).toBe(false)
    })

    await test.step('6: 緊急停止（kill switch）中は配信できない（D045）', async () => {
      execAdminSql(
        `select public.admin_set_delivery_paused(true, 'ops-e2e', 'E2E検証の緊急停止');`,
      )
      expect(execSql(`select delivery_paused from private.platform_controls`)).toBe('t')

      expectRejection = true

      // 6a: 新しい条件の対象規模は答えない（D045・独立レビューL1）。
      //     曜日を平日夜に変えると対象条件のfingerprintが変わり、キャッシュに無い
      await composeAndSend(pageOwner, `停止中の下見-${RUN}`, '音楽', '平日夜')
      await expect(
        pageOwner.getByText('現在、システム全体で配信を一時停止しています。', { exact: false }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(pageOwner.getByRole('heading', { name: '送信内容の確認' })).toHaveCount(0)
      await pageOwner.getByRole('button', { name: '入力へもどる' }).click()
      await pageOwner.getByRole('button', { name: 'やめる' }).click()
      await expect(pageOwner.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible()

      // 6b: 24時間以内に答えた同一条件は確認画面まで進める（既に知っている値）が、
      //     送信そのものは止まる
      await composeAndSend(pageOwner, `緊急停止中ライブ-${RUN}`, '音楽')
      await confirmAndSend(pageOwner)
      // 「通信環境を確認して」ではなく、停止の理由が伝わる（Task 013で追加）
      await expect(
        pageOwner.getByText('現在、システム全体で配信を一時停止しています。', { exact: false }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(pageOwner.getByRole('heading', { name: /人の新入生へ配信しました/u })).toHaveCount(
        0,
      )
      // 配信行も残らない（部分的な副作用が無い）
      expect(
        execSql(
          `select count(*)::int from private.offer_deliveries ` +
            `where event_name = '緊急停止中ライブ-${RUN}'`,
        ),
      ).toBe('0')
    })

    await test.step('7: 緊急停止を解除すると、再び配信できる', async () => {
      // 拒否を許す範囲はここで閉じる（consoleイベントがresponseより遅れて届いても
      // 取りこぼさないよう、ステップ6の末尾ではなく次のステップの先頭で戻す）
      expectRejection = false
      execAdminSql(`select public.admin_set_delivery_paused(false, 'ops-e2e', null);`)
      expect(execSql(`select delivery_paused from private.platform_controls`)).toBe('f')

      await pageOwner.reload()
      await expect(pageOwner.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
        timeout: 15_000,
      })
      await composeAndSend(pageOwner, `解除後ライブ-${RUN}`, '音楽')
      await confirmAndSend(pageOwner)
      await expect(pageOwner.getByRole('heading', { name: /人の新入生へ配信しました/u })).toBeVisible(
        { timeout: 15_000 },
      )
      await pageOwner.getByRole('button', { name: 'ダッシュボードへもどる' }).click()
      await expect(pageOwner.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible()
    })

    await test.step('8: 監査記録に学生の個人情報が入らない（D043）', async () => {
      // 4件の運営操作がすべて記録されている
      expect(
        execSql(
          `select count(*)::int from private.admin_audit_log where actor_label = 'ops-e2e'`,
        ),
      ).toBe('4')
      // 本文にメールアドレス・学生IDが現れない
      expect(
        execSql(
          `select count(*)::int from private.admin_audit_log a ` +
            `where a.actor_label || coalesce(a.reason,'') || coalesce(a.previous_value,'') ` +
            `|| coalesce(a.new_value,'') like '%@%'`,
        ),
      ).toBe('0')
      // 学生を指す列そのものが存在しない
      expect(
        execSql(
          `select count(*)::int from information_schema.columns ` +
            `where table_schema='private' and table_name='admin_audit_log' ` +
            `and (column_name ~ 'user' or column_name ~ 'email' or column_name ~ 'student')`,
        ),
      ).toBe('0')
    })

    expect(problems, `console error・失敗リクエストが無いこと: ${problems.join(' | ')}`).toEqual([])
  } finally {
    // 緊急停止は**全団体に効く単一行**のため、途中で失敗すると後続のspecまで
    // 配信できなくなる。停止したままなら必ず戻す（既に戻っていれば何もしない＝
    // 監査記録も増えないので、上のステップ8の件数検査と両立する）
    if (execSql(`select delivery_paused from private.platform_controls`) === 't') {
      execAdminSql(`select public.admin_set_delivery_paused(false, 'ops-e2e-cleanup', null);`)
    }
    for (const context of contexts) {
      await context.close()
    }
  }
})
