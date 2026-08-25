// 認証まわりの利用者向け定型文。
// アカウントの存在有無を判別できる表現、メールアドレス・コード・トークンの
// エコーバックを一切含めない（docs/auth_and_authorization.md §3・§9）

export const AUTH_TEXT = {
  domainHint: '神戸大学の学生メール（@stu.kobe-u.ac.jp）だけが利用できます。＋付きのアドレスは使えません。',
  otpSentNotice: '6桁コードをメールへ送りました。届いたコードを入力してください。',
  rateLimited: '送信回数の上限に達しました。しばらく待ってから再度お試しください。',
  sendFailed: 'コードを送信できませんでした。時間をおいて再度お試しください。',
  badCode: 'コードが正しくないか、期限切れです。もう一度確認してください。',
} as const

export type OtpSendFailureReason = 'rateLimited' | 'sendFailed'

// Supabase AuthErrorを、画面表示用の2分類へ落とす。
// サーバーの生メッセージは表示しない（内容にメール等が含まれ得るため）
export function mapOtpSendError(error: { status?: number } | null): OtpSendFailureReason {
  if (error !== null && error.status === 429) {
    return 'rateLimited'
  }
  return 'sendFailed'
}
