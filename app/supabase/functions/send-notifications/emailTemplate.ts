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

// 例外文にはリモートサーバーの応答がそのまま連結され、550バウンスでは**宛先アドレス**が載る。
// 局所部の綴りが分類規則へ部分一致するため、分類の前にアドレスを取り除く。
// これで閉じるのは、**550より上に置かざるを得ない規則**と衝突する綴り
// （`demo-starttls@` → 'starttls'、`demo-mauth@` → 'auth'）。'rate' / 'quota' / 'tls' との
// 衝突は判定順序（550を上に置く）側で閉じている（2026-08-28の独立レビューで実測）。
//
// 量指定子は束縛していない。束縛すると「局所部が64字を超えるアドレスの先頭が残る」
// という別の穴が開くため、長大な入力への備えは呼び出し側の長さ上限で持つ
function stripAddresses(text: string): string {
  return text.replace(/[^\s<>(),;:"]+@[^\s<>(),;:"]+/gu, '')
}

const MESSAGE_LIMIT = 2000
const CODE_LIMIT = 100

// 切り詰めたときだけ、末尾で途切れた語を落とす。切り詰めの境界が宛先アドレスの '@' の
// 手前に落ちると局所部の断片（`demo-starttls`）が残り、アドレス除去をすり抜けて
// 上位規則へ部分一致する（独立レビューが実測）。
// **切り詰めていないときは触らない。** 単語1つだけのメッセージ（`ECONNREFUSED`）を
// 消してしまうため
function truncateMessage(text: string): string {
  if (text.length <= MESSAGE_LIMIT) return text
  return text.slice(0, MESSAGE_LIMIT).replace(/[^\s<>(),;:"]+$/u, '')
}

// SMTPライブラリの例外メッセージは、宛先・認証情報・本文断片を含み得る。
// 既知の分類だけを短いコードへ落とし、それ以外は 'unknown' にする
export function classifyError(error: unknown): string {
  const obj = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null
  // nodemailerは message に加えて code（EAUTH・ETLS・ESOCKET等）と
  // responseCode（535・421・550等）を返す。messageだけを見ると原因不明の`unknown`になり、
  // 運用で何も切り分けられない（2026-08-28のsmoke test Bで実際にそうなった・D058）
  // 応答文の長さはリモート側が決める（nodemailerの_formatErrorが応答全文を連結する）。
  // アドレス除去の正規表現は「区切り文字を含まない長大な1トークン」で二次時間になり、
  // Edge Functionのイベントループを同期的に塞ぐ（実測64KBで4.5秒）。分類に使うのは
  // 先頭だけで足りるので、**3要素それぞれに**上限を切る。
  // code・responseCodeはライブラリが決める短い値なので実際には切られないが、
  // 「上限が掛かる」ことを構造で保証しておく（偶然に頼らない）
  const rawMessage = obj !== null && 'message' in obj ? String(obj.message) : String(error ?? '')
  const message = stripAddresses(
    [
      truncateMessage(rawMessage),
      obj !== null && 'code' in obj ? String(obj.code).slice(0, CODE_LIMIT) : '',
      obj !== null && 'responseCode' in obj ? String(obj.responseCode).slice(0, CODE_LIMIT) : '',
    ].join(' '),
  ).toLowerCase()

  // **判定順序が仕様**。nodemailerの例外文は複数の語を同時に含み、しかも
  // message にはリモートサーバーの応答文がそのまま連結される（_formatError）。
  // そのため「具体的な語（エラーコード・SMTP応答番号）を先に、包括的な語を後に」見る。
  // 例: `Error upgrading connection with STARTTLS: 530 Authentication Required` は
  // 'auth' も 'connect' も含むので、etls/starttlsを最上位に置かないと分類が動かされる
  if (message.includes('etls') || message.includes('starttls')) return 'smtp_tls'
  if (message.includes('535') || message.includes('eauth') || message.includes('auth')) {
    return 'smtp_auth'
  }
  // 送信上限・送信元ブロックのうち、宛先拒否と紛れない**具体トークンだけ**を550より先に見る。
  // 421形式（`Server terminates connection. response=421`）は 'connect' を含むため
  // connect判定より先に、550形式（`550-5.4.5 Daily user sending limit exceeded` /
  // `550-5.7.1 ... unusual rate of unsolicited mail ...`）は550と重なるためここへ置く。
  // 後者は宛先の問題ではなく**送信元アカウントの評判ブロック**で、運用の打ち手は
  // 上限系と同じ（送信を絞る）。runbook §7が監視シグナルにしているのもこちら側
  if (
    message.includes('421') ||
    message.includes('sending limit') ||
    message.includes('sending quota') ||
    message.includes('relay limit') ||
    message.includes('5.4.5') ||
    message.includes('unsolicited') ||
    message.includes('unusual rate')
  ) {
    return 'rate_limited'
  }
  // 宛先拒否。応答文に紛れ込んだ素の 'rate' / 'quota' や広い 'tls' で
  // 宛先拒否が別コードへ流れないよう、それらより先に見る
  if (message.includes('550') || message.includes('mailbox')) return 'recipient_rejected'
  // 上限系の包括的な語。550を通り抜けた後に見る
  if (message.includes('rate') || message.includes('quota')) return 'rate_limited'
  if (
    message.includes('certificate') ||
    message.includes('wrong version') ||
    message.includes('tls')
  ) {
    return 'smtp_tls'
  }
  if (message.includes('timeout') || message.includes('etimedout')) return 'smtp_timeout'
  // 接続はできたのに会話の途中で切れる系（denomailerで実際に起きた事象）。
  // maxRequeues: 0 の失敗文言 `Reached maximum number of retries after connection was
  // closed` も 'connect' ではなくここへ落とす（実体は会話中の切断）
  if (
    message.includes('interrupted') ||
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('econnreset') ||
    message.includes('epipe') ||
    message.includes('was closed') ||
    message.includes('socket')
  ) {
    return 'smtp_stream'
  }
  if (
    message.includes('econnrefused') ||
    message.includes('econnection') ||
    message.includes('enotfound') ||
    message.includes('edns') ||
    message.includes('connect')
  ) {
    return 'smtp_connect'
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
