import { execSync } from 'node:child_process'

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

// Task 016 UX・アクセシビリティのE2E（tasks/016-ux-accessibility-e2e.md）。
//
// 前提: ローカルSupabaseスタックが起動済み（npm run db:start）。
//
// 既存specが「機能が動くこと」を検証しているのに対し、ここでは
// **同じ導線が、キーボードだけで・390px幅で・フォーカスを見失わずに通ること**と、
// **長い1セッションの途中で再読み込み・セッション切れが起きても壊れないこと**を検証する。
// 機能の重複検証はしない（対応はtasks/016の表）。

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'
const DB_URL = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const RUN = Date.now().toString(36)
const EMAIL_STUDENT = `demo-s16-${RUN}@stu.kobe-u.ac.jp`
const EMAIL_OWNER = `demo-o16-${RUN}@stu.kobe-u.ac.jp`
const ORG_NAME = `アクセシビリティE2E部-${RUN}`

test.describe.configure({ mode: 'serial' })

// SQLは -c ではなく標準入力で渡す（シェルによる $$ / $1 の展開を避ける）
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

function execAdminSql(sql: string): string {
  return execSql(`set role service_role; ${sql}`)
}

// 合成学生プール（実在しない架空アドレスのみ）。最小5人（D036）を満たすために使う
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

// 画面が切り替わったあと、フォーカスがその画面の見出しへ移っていること。
// ルーターを持たないため、放置するとフォーカスはbodyへ落ちる（Task 016）
async function expectFocusOnHeading(page: Page, name: string) {
  const heading = page.getByRole('heading', { name, exact: true }).first()
  await expect(heading).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(async () => heading.evaluate((el) => el === document.activeElement), {
      timeout: 5_000,
      message: `「${name}」へフォーカスが移る`,
    })
    .toBe(true)
}

// Tabだけで目的の要素へ到達できることを確認しつつ、そこへフォーカスを移す。
// 到達できなければ失敗する（＝キーボードで操作不能ということ）
async function tabTo(page: Page, target: Locator, label: string, max = 60) {
  await expect(target).toBeVisible({ timeout: 15_000 })
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`${label}: Tab ${max}回で到達できない（キーボードで操作できない）`)
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

// マウスを一切使わずログインする。同意画面もキーボードだけで通す
async function signInByKeyboardOnly(page: Page, request: APIRequestContext, address: string) {
  await page.goto(BASE)
  await expectFocusOnHeading(page, '大学メールでログイン')

  const emailInput = page.getByLabel('大学メールアドレス')
  await tabTo(page, emailInput, 'メールアドレス入力')
  await page.keyboard.type(address)

  const sendButton = page.getByRole('button', { name: '6桁コードを送る' })
  await expect(sendButton).toBeEnabled()
  await tabTo(page, sendButton, '6桁コードを送るボタン')
  await page.keyboard.press('Enter')

  const codeInput = page.getByRole('textbox', { name: '6桁コード' })
  await expect(codeInput).toBeVisible({ timeout: 20_000 })
  // ステップが変わったら見出しへフォーカスが移る（移らないと先頭からTabやり直しになる）
  await expectFocusOnHeading(page, 'コードを入力')

  const code = await fetchOtpCode(request, address)
  await tabTo(page, codeInput, '6桁コード入力')
  await page.keyboard.type(code)
  const loginButton = page.getByRole('button', { name: 'ログインする' })
  await tabTo(page, loginButton, 'ログインするボタン')
  await page.keyboard.press('Enter')

  // 同意画面（初回は必ず出る）をキーボードだけで通す
  const consentCheck = page.getByRole('checkbox', { name: /同意します/u })
  const onboarding = page.getByRole('heading', { name: '利用方法を選ぶ' })
  await expect(consentCheck.or(onboarding).first()).toBeVisible({ timeout: 20_000 })
  if (await consentCheck.isVisible()) {
    await expectFocusOnHeading(page, 'はじめる前に')
    await expectNoHorizontalScroll(page, '同意画面(390px)')
    await tabTo(page, consentCheck, '同意チェックボックス')
    await page.keyboard.press('Space')
    const agree = page.getByRole('button', { name: '同意して進む', exact: true })
    await expect(agree).toBeEnabled()
    await tabTo(page, agree, '同意して進むボタン')
    await page.keyboard.press('Enter')
    await expect(consentCheck).toBeHidden({ timeout: 15_000 })
  }
}

// マウスで押す（キーボード検証の対象外の手順を短く済ませる）
async function clickByRole(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
}

test('1: 新入生の完全導線を、キーボードだけ・390px・フォーカスを見失わずに通す', async ({
  page,
  request,
}) => {
  await test.step('1-1: ログインと同意（マウスを使わない）', async () => {
    await signInByKeyboardOnly(page, request, EMAIL_STUDENT)
    // 同意のあと、権限選択の見出しへフォーカスが移る
    await expectFocusOnHeading(page, '利用方法を選ぶ')
    await expectNoHorizontalScroll(page, '権限選択(390px)')
  })

  await test.step('1-2: 新入生として登録し、ホームの見出しへフォーカスが移る', async () => {
    const register = page.getByRole('button', { name: '新入生として登録する', exact: true })
    await tabTo(page, register, '新入生として登録するボタン')
    await page.keyboard.press('Enter')
    await expectFocusOnHeading(page, '新入生ホーム')
    await expectNoHorizontalScroll(page, '新入生ホーム(390px)')
  })

  await test.step('1-3: 興味パスポートをキーボードだけで最後まで入力する', async () => {
    const start = page.getByRole('button', { name: '興味パスポートをはじめる', exact: true })
    await tabTo(page, start, '興味パスポートをはじめるボタン')
    await page.keyboard.press('Enter')
    // wizardの各ステップ: 選択肢チップも「次へ」もbuttonなのでTabで到達できる
    for (const [choice, next] of [
      ['アウトドア', '次へ'],
      ['友達を作る', '次へ'],
      ['土日', '次へ'],
      ['アウトドア', 'これで完了'],
    ] as const) {
      const chip = page.getByRole('button', { name: choice, exact: true }).first()
      await tabTo(page, chip, `選択肢「${choice}」`)
      await page.keyboard.press('Enter')
      const nextButton = page.getByRole('button', { name: next, exact: true })
      await expect(nextButton).toBeEnabled()
      await tabTo(page, nextButton, `「${next}」ボタン`)
      await page.keyboard.press('Enter')
      await expectNoHorizontalScroll(page, `wizard「${choice}」(390px)`)
    }
    await expect(page.getByText('興味パスポートを保存しました')).toBeVisible({ timeout: 15_000 })
  })

  await test.step('1-4: 途中で再読み込みしても、保存済みの状態から再開できる', async () => {
    await page.reload()
    await expect(page.getByRole('heading', { name: '新入生ホーム' })).toBeVisible({
      timeout: 20_000,
    })
    // 保存済みなので、もう「はじめる」ではなく要約が出る
    await expect(page.getByText('アウトドア', { exact: false }).first()).toBeVisible()
    await expectNoHorizontalScroll(page, '再読み込み後の新入生ホーム(390px)')
  })

  await test.step('1-5: タブ移動でも見出しへフォーカスが移る（受信箱・通知設定）', async () => {
    await clickByRole(page, '受信箱')
    await expectFocusOnHeading(page, '受信箱')
    await expectNoHorizontalScroll(page, '受信箱(390px)')

    await clickByRole(page, '通知設定')
    await expectFocusOnHeading(page, 'メール通知')
    await expectNoHorizontalScroll(page, '通知設定(390px)')
  })

  await test.step('1-6: 通知設定をキーボードだけで変更でき、再読み込み後も保たれる', async () => {
    // roving tabindex: タブ順に載っているのは選択中の1つだけ。
    // 既定の「オファーごとに通知」までTabで行き、矢印キーで隣へ移す
    const current = page.getByRole('radio', { name: /オファーごとに通知/u })
    await expect(current).toBeChecked()
    await tabTo(page, current, '選択中の通知設定')
    await page.keyboard.press('ArrowDown')
    const digest = page.getByRole('radio', { name: /1日1回のまとめ/u })
    await expect(digest).toBeChecked({ timeout: 15_000 })
    await expect(page.getByText('保存しました。', { exact: false })).toBeVisible({
      timeout: 15_000,
    })
    await page.reload()
    await clickByRole(page, '通知設定')
    await expect(page.getByRole('radio', { name: /1日1回のまとめ/u })).toBeChecked({
      timeout: 20_000,
    })
  })

  await test.step('1-7: メールのリンク（#notifications）で通知設定へ直接着地し、URLにhashが残らない', async () => {
    // hashだけの遷移は同一ドキュメント扱いで再マウントされないため、
    // 「メールのリンクを新しく開く」状況に合わせて一度離れてから開く
    await page.goto('about:blank')
    await page.goto(`${BASE}#notifications`)
    await expect(page.getByRole('heading', { name: 'メール通知' })).toBeVisible({ timeout: 20_000 })
    // 着地後にhashを消す（以後のアプリ内操作をhashが上書きしない）
    expect(page.url().includes('#notifications')).toBe(false)
    await expectNoHorizontalScroll(page, 'メールからの着地(390px)')
  })

  await test.step('1-8: 別ページから戻ってもセッションが残り、白画面にならない', async () => {
    await page.goto('about:blank')
    await page.goBack()
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible({ timeout: 20_000 })
    await expectNoHorizontalScroll(page, 'ブラウザバック後(390px)')
  })

  await test.step('1-9: セッションが切れても、白画面にならずログイン画面へ戻る', async () => {
    // 期限切れ・別端末でのログアウトに相当する状態を作る
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith('sb-')) window.localStorage.removeItem(key)
      }
    })
    await page.reload()
    await expect(page.getByRole('heading', { name: '大学メールでログイン' })).toBeVisible({
      timeout: 20_000,
    })
    await expectNoHorizontalScroll(page, 'セッション切れ後のログイン画面(390px)')
  })
})

test('2: 団体の完全導線でも、フォーカスと390pxが破綻しない', async ({ page, request }) => {
  seedStudentPool(`a11y-${RUN}`, 8, 'outdoor')

  await test.step('2-1: ログイン→同意→権限選択（キーボードのみ）', async () => {
    await signInByKeyboardOnly(page, request, EMAIL_OWNER)
    await expectFocusOnHeading(page, '利用方法を選ぶ')
  })

  await test.step('2-2: 団体作成の画面でフォーカスが見出しへ移る', async () => {
    const create = page.getByRole('button', { name: '新しい団体を作る', exact: true })
    await tabTo(page, create, '新しい団体を作るボタン')
    await page.keyboard.press('Enter')
    await expectFocusOnHeading(page, '新しい団体を作る')
    await expectNoHorizontalScroll(page, '団体作成(390px)')

    const nameInput = page.getByLabel('団体名（必須・100文字まで）')
    await tabTo(page, nameInput, '団体名入力')
    await page.keyboard.type(ORG_NAME)
    const submit = page.getByRole('button', { name: '団体を作成する', exact: true })
    await tabTo(page, submit, '団体を作成するボタン')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible({ timeout: 20_000 })
  })

  await test.step('2-3: 審査待ちの状態が、色だけでなく文字でも示される', async () => {
    const chip = page.getByText('審査待ち', { exact: true })
    await expect(chip).toBeVisible()
    // 状態チップは文字を持つ（色だけに意味を依存させない）
    expect((await chip.innerText()).trim().length).toBeGreaterThan(0)
    await expectNoHorizontalScroll(page, '審査待ちの団体画面(390px)')
  })

  await test.step('2-4: 運営が確認するとオファー導線が開く', async () => {
    const orgId = execSql(
      `select id::text from public.organizations where name = '${ORG_NAME}'`,
    )
    expect(orgId.length).toBeGreaterThan(0)
    execAdminSql(
      `select public.admin_set_organization_status('${orgId}', 'verified', 'e2e-016', '検証');`,
    )
    await page.reload()
    await expect(page.getByRole('heading', { name: '団体ダッシュボード' })).toBeVisible({
      timeout: 20_000,
    })
    await expectNoHorizontalScroll(page, '団体ダッシュボード(390px)')
  })

  await test.step('2-5: オファー作成・確認・完了の各画面でフォーカスが移る', async () => {
    await clickByRole(page, '新しいオファーを作成')
    await expectFocusOnHeading(page, '新しいオファー')
    await expectNoHorizontalScroll(page, 'オファー作成(390px)')

    await page.getByLabel('イベント名').fill(`はじめての山歩き-${RUN}`)
    await page.getByLabel('イベント紹介').fill('はじめての方でも参加できる新歓イベントです。')
    await page.getByLabel('開催日時').fill('9月13日（土）9:00')
    await page.getByLabel('場所').fill('六甲ケーブル下')
    await page
      .getByLabel('なぜこの人たちに届けたいか')
      .fill('外で体を動かすのが好きな人と一緒に歩きたいからです。')
    await clickByRole(page, 'アウトドア')
    await clickByRole(page, '友達を作る')
    await clickByRole(page, '土日')
    await clickByRole(page, '対象を確認する')

    await expectFocusOnHeading(page, '送信内容の確認')
    await expectNoHorizontalScroll(page, '送信内容の確認(390px)')

    await clickByRole(page, 'この内容で送信')
    await expect(page.getByRole('heading', { name: /人の新入生へ配信しました/u })).toBeVisible({
      timeout: 30_000,
    })
    await expectNoHorizontalScroll(page, '送信完了(390px)')
  })

  await test.step('2-6: ダッシュボードへ戻ると見出しへフォーカスが戻る', async () => {
    await clickByRole(page, 'ダッシュボードへもどる')
    await expectFocusOnHeading(page, '団体ダッシュボード')
    await expectNoHorizontalScroll(page, '送信後のダッシュボード(390px)')
  })
})
