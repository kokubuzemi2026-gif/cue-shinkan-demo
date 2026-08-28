// メール本文の組み立て（Task 010 / D042）。
//
// この層はSMTPにもDenoにも依存しない純粋な関数だけを持つ。
// 送信ワーカー（index.ts）から呼ばれ、単体テストはVitestで実行する。
//
// 本文に載せてよいのは次だけ:
// - 新しい案内が届いた事実（と、まとめの場合はその件数）
// - 受信箱へのリンク
// - 通知設定（受け取り方の変更・停止）へのリンク
//
// 載せてはいけないもの:
// - 学生の希望条件（興味・予算・曜日・本気度など）
// - 団体名・イベント名・団体の内部情報
// - 返答状態（行ってみたい／あとで考える／見送る）
// - マッチ度・理由文・対象人数

export type EmailKind = 'offer_arrival' | 'daily_digest'

export type EmailContent = {
  subject: string
  text: string
}

export type EmailInput = {
  kind: EmailKind
  // まとめのときだけ意味を持つ。オファーごとの通知では常に1件
  offerCount: number
  // アプリのURL（末尾スラッシュは有無どちらでもよい）
  appUrl: string
}

function joinUrl(base: string, hash: string): string {
  return `${base.replace(/\/+$/u, '')}/${hash}`
}

// 受信箱と通知設定への導線。通知設定へのリンクが「配信停止」相当の導線を兼ねる。
// ワンクリック解除にしないのは、トークンを踏ませる方式が
// なりすまし・誤操作・トークン漏えいの経路になるため（本人のログインを経由させる）
export function inboxUrl(appUrl: string): string {
  return joinUrl(appUrl, '#inbox')
}

export function notificationSettingsUrl(appUrl: string): string {
  return joinUrl(appUrl, '#notifications')
}

export function buildEmail(input: EmailInput): EmailContent {
  const count = Number.isFinite(input.offerCount) ? Math.max(1, Math.trunc(input.offerCount)) : 1
  const subject =
    input.kind === 'daily_digest'
      ? `CUE: 今日届いた新歓の案内が${count}件あります`
      : 'CUE: 新しい新歓の案内が届いています'

  const lead =
    input.kind === 'daily_digest'
      ? `今日はあなたの条件に合う新歓の案内が${count}件届きました。`
      : 'あなたの条件に合う新歓の案内が1件届きました。'

  const text = [
    lead,
    '',
    `内容の確認と返答はこちらから: ${inboxUrl(input.appUrl)}`,
    '',
    'このメールには案内の内容を書いていません。どの団体から届いたか、どんな条件で',
    '届いたかは、アプリの受信箱でだけ確認できます。',
    '',
    `通知の受け取り方の変更・停止: ${notificationSettingsUrl(input.appUrl)}`,
    '',
    'CUE（新歓マッチング）',
  ].join('\n')

  return { subject, text }
}

// ログへ出してよい情報だけを残す。宛先・本文・secretはログへ出さない（D042）
export type LogSafeRecord = {
  outboxId: string
  kind: EmailKind
  attempt: number
  result: 'sent' | 'failed'
  errorCode?: string
}

// SMTPライブラリの例外メッセージは、宛先・認証情報・本文断片を含み得る。
// 既知の分類だけを短いコードへ落とし、それ以外は 'unknown' にする
export function classifyError(error: unknown): string {
  const obj = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null
  // nodemailerは message に加えて code（EAUTH等）と responseCode（535等）を返す。
  // messageだけを見ていると原因不明の`unknown`になり、運用時に何も分からない
  // （2026-08-28のsmoke test Bで実際にそうなった・D058）。3つとも突き合わせる
  const message = [
    obj !== null && 'message' in obj ? String(obj.message) : String(error ?? ''),
    obj !== null && 'code' in obj ? String(obj.code) : '',
    obj !== null && 'responseCode' in obj ? String(obj.responseCode) : '',
  ]
    .join(' ')
    .toLowerCase()
  if (message.includes('auth') || message.includes('535')) return 'smtp_auth'
  if (message.includes('timeout') || message.includes('etimedout')) return 'smtp_timeout'
  if (message.includes('connect') || message.includes('econnrefused')) return 'smtp_connect'
  if (message.includes('550') || message.includes('mailbox')) return 'recipient_rejected'
  if (message.includes('rate') || message.includes('421') || message.includes('quota')) {
    return 'rate_limited'
  }
  // TLS由来を先に見る（`esocket`は下の'socket'にも一致するため順序が重要）
  if (message.includes('certificate') || message.includes('tls')) {
    return 'smtp_tls'
  }
  // 接続はできたのに会話の途中で切れる系（denomailerで実際に起きた事象）。
  // `unknown`へ落とすと原因の切り分けができないため独立させる
  if (
    message.includes('interrupted') ||
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('epipe')
  ) {
    return 'smtp_stream'
  }
  return 'unknown'
}

export function logSafe(record: LogSafeRecord): string {
  const parts = [
    `outbox=${record.outboxId}`,
    `kind=${record.kind}`,
    `attempt=${record.attempt}`,
    `result=${record.result}`,
  ]
  if (record.errorCode !== undefined) parts.push(`error=${record.errorCode}`)
  return parts.join(' ')
}
