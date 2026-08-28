import { describe, expect, it } from 'vitest'

import {
  buildEmail,
  classifyError,
  inboxUrl,
  logSafe,
  notificationSettingsUrl,
} from './emailTemplate'

const APP = 'https://example.invalid/cue-shinkan-demo/'

describe('emailTemplate', () => {
  it('オファーごとの通知は件名に件数を出さず、本文で1件届いたことだけを伝える', () => {
    const mail = buildEmail({ kind: 'offer_arrival', offerCount: 1, appUrl: APP })
    expect(mail.subject).toBe('CUE: 新しい新歓の案内が届いています')
    expect(mail.text).toContain('1件届きました')
  })

  it('まとめは件数だけを伝える', () => {
    const mail = buildEmail({ kind: 'daily_digest', offerCount: 3, appUrl: APP })
    expect(mail.subject).toContain('3件')
    expect(mail.text).toContain('3件届きました')
  })

  it('受信箱と通知設定へのリンクが本文にある（停止の導線を必ず含める）', () => {
    const mail = buildEmail({ kind: 'offer_arrival', offerCount: 1, appUrl: APP })
    expect(mail.text).toContain(inboxUrl(APP))
    expect(mail.text).toContain(notificationSettingsUrl(APP))
    expect(mail.text).toContain('変更・停止')
  })

  it('末尾スラッシュの有無でリンクが壊れない', () => {
    expect(inboxUrl('https://a.invalid/app')).toBe('https://a.invalid/app/#inbox')
    expect(inboxUrl('https://a.invalid/app/')).toBe('https://a.invalid/app/#inbox')
    expect(inboxUrl('https://a.invalid/app///')).toBe('https://a.invalid/app/#inbox')
  })

  it('件名・本文に希望条件・団体情報・返答状態が現れない', () => {
    for (const kind of ['offer_arrival', 'daily_digest'] as const) {
      const mail = buildEmail({ kind, offerCount: 2, appUrl: APP })
      const all = `${mail.subject}\n${mail.text}`
      for (const forbidden of [
        'アウトドア', '写真', '音楽', 'スポーツ', '予算', '円', '曜日', '土日', '平日',
        '本気度', 'マッチ度', '行ってみたい', 'あとで考える', '見送', '点',
      ]) {
        expect(all, `${kind} に「${forbidden}」が含まれない`).not.toContain(forbidden)
      }
    }
  })

  it('本文が短く、団体名を差し込む余地が無い（テンプレートに変数は件数とURLだけ）', () => {
    const a = buildEmail({ kind: 'daily_digest', offerCount: 2, appUrl: APP })
    const b = buildEmail({ kind: 'daily_digest', offerCount: 2, appUrl: APP })
    expect(a).toEqual(b)
    expect(a.text.length).toBeLessThan(400)
  })

  it('件数が壊れていても本文を壊さない', () => {
    expect(buildEmail({ kind: 'daily_digest', offerCount: 0, appUrl: APP }).text).toContain('1件')
    expect(buildEmail({ kind: 'daily_digest', offerCount: -5, appUrl: APP }).text).toContain('1件')
    expect(buildEmail({ kind: 'daily_digest', offerCount: NaN, appUrl: APP }).text).toContain('1件')
    expect(buildEmail({ kind: 'daily_digest', offerCount: 2.7, appUrl: APP }).text).toContain('2件')
  })

  it('SMTPの例外を短いコードへ分類する（生メッセージを持ち回らない）', () => {
    expect(classifyError(new Error('535 5.7.8 Username and Password not accepted'))).toBe('smtp_auth')
    expect(classifyError(new Error('connection ETIMEDOUT'))).toBe('smtp_timeout')
    expect(classifyError(new Error('ECONNREFUSED'))).toBe('smtp_connect')
    expect(classifyError(new Error('550 5.1.1 mailbox unavailable'))).toBe('recipient_rejected')
    expect(classifyError(new Error('421 too many messages, rate limit'))).toBe('rate_limited')
    expect(classifyError(new Error('something else'))).toBe('unknown')
    expect(classifyError(null)).toBe('unknown')
  })

  it('nodemailerのcode・responseCodeも分類に使う（messageだけでは不明になるため）', () => {
    // nodemailerは message が汎用文言でも code/responseCode で原因を示す。
    // 2026-08-28のsmoke test Bで、messageだけの分類では`unknown`しか得られず
    // 原因の切り分けができなかった（D058）
    expect(classifyError(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }))).toBe(
      'smtp_auth',
    )
    expect(classifyError(Object.assign(new Error('Conn err'), { code: 'ETIMEDOUT' }))).toBe(
      'smtp_timeout',
    )
    expect(classifyError(Object.assign(new Error('Message failed'), { responseCode: 550 }))).toBe(
      'recipient_rejected',
    )
    // code/responseCodeを持たない値でも従来どおり動く
    expect(classifyError('plain string 421 rate')).toBe('rate_limited')
  })

  it('nodemailerの実際の例外を、判定順序どおりに分類する（分岐ごとに検出力を持たせる）', () => {
    // 以下の文言・codeは nodemailer 9.0.6 の実ソース（lib/smtp-connection/index.js）と
    // 2026-08-28にhostedで観測した例外から取っている。
    // いずれも複数の語を含むため、判定順序が壊れると別のコードへ落ちる
    const cases: [unknown, string][] = [
      // 1. TLS: 'connection' を含むがTLS由来（STARTTLS拒否＝TLS剥奪の兆候）
      [Object.assign(new Error('Error upgrading connection with STARTTLS'), { code: 'ETLS' }), 'smtp_tls'],
      [
        Object.assign(
          new Error('Client network socket disconnected before secure TLS connection was established'),
          { code: 'ESOCKET' },
        ),
        'smtp_tls',
      ],
      [new Error('self signed certificate in certificate chain'), 'smtp_tls'],
      // 2. rate: 'connection' を含むが421はGmailの上限応答
      [
        Object.assign(new Error('Server terminates connection. response=421 4.7.0 Try again later'), {
          code: 'ECONNECTION',
          responseCode: 421,
        }),
        'rate_limited',
      ],
      // 3. stream: 会話の途中で切れる系（今回hostedで観測した文言そのもの）
      [new Error('Interrupted: operation canceled'), 'smtp_stream'],
      [Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }), 'smtp_stream'],
      [new Error('read ECONNRESET'), 'smtp_stream'],
      // 4. connect: 上のどれにも当たらない純粋な接続失敗
      [Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:465'), { code: 'ECONNREFUSED' }), 'smtp_connect'],
      // 5. 既存分類の退行防止
      [Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }), 'smtp_auth'],
      [Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }), 'smtp_timeout'],
      [Object.assign(new Error('Message failed'), { responseCode: 550 }), 'recipient_rejected'],
      [new Error('突然の未知の障害'), 'unknown'],
    ]
    for (const [error, expected] of cases) {
      expect(classifyError(error)).toBe(expected)
    }
  })

  it('分類コードは決まった集合の中からしか返さない（生メッセージが混ざらない）', () => {
    const allowed = [
      'smtp_auth',
      'smtp_tls',
      'rate_limited',
      'recipient_rejected',
      'smtp_timeout',
      'smtp_stream',
      'smtp_connect',
      'unknown',
    ]
    const inputs: unknown[] = [
      new Error('550 mailbox unavailable for demo-x@stu.kobe-u.ac.jp'),
      Object.assign(new Error('Invalid login: 535 5.7.8 password=hunter2'), { code: 'EAUTH' }),
      'plain string',
      null,
      undefined,
      { message: { nested: 'object' } },
      12345,
    ]
    for (const input of inputs) {
      expect(allowed).toContain(classifyError(input))
    }
  })

  it('分類コードは短く、宛先や本文を含まない', () => {
    const code = classifyError(new Error('550 mailbox unavailable for demo-x@stu.kobe-u.ac.jp'))
    expect(code).toBe('recipient_rejected')
    expect(code).not.toContain('@')
    expect(code.length).toBeLessThanOrEqual(40)
  })

  it('ログ行に宛先メール・本文・secretが現れない', () => {
    const line = logSafe({
      outboxId: '11111111-1111-1111-1111-111111111111',
      kind: 'offer_arrival',
      attempt: 2,
      result: 'failed',
      errorCode: 'smtp_timeout',
    })
    expect(line).toBe(
      'outbox=11111111-1111-1111-1111-111111111111 kind=offer_arrival attempt=2 result=failed error=smtp_timeout',
    )
    expect(line).not.toContain('@')
    expect(line).not.toMatch(/password|secret|key|token/iu)
  })
})
