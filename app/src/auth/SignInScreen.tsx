import { useEffect, useReducer, useState, type FormEvent } from 'react'

import { useScreenFocus } from '../a11y/useScreenFocus'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { canResend, initialAuthUiState, reduceAuthUi } from './authMachine'
import { AUTH_TEXT, mapOtpSendError } from './errorMessages'
import { isUniversityEmail, normalizeUniversityEmail } from './universityEmail'

type SignInScreenProps = {
  client: CueSupabaseClient
  // 招待リンク経由の流入。ログイン後に承諾へ進むことを予告する
  hasPendingInvite: boolean
}

const SEND_ERROR_TEXT = {
  rateLimited: AUTH_TEXT.rateLimited,
  sendFailed: AUTH_TEXT.sendFailed,
  badCode: AUTH_TEXT.badCode,
} as const

// 登録とログインを一つの導線に統合したメールOTP画面。
// ドメイン外・plus付きメールはクライアント側で送信自体を拒否する（第一ゲート）。
// 成功・失敗の表示は新規/既存で差を付けず、アカウントの存在有無を漏らさない
export function SignInScreen({ client, hasPendingInvite }: SignInScreenProps) {
  const [ui, dispatch] = useReducer(reduceAuthUi, initialAuthUiState)
  const [rawEmail, setRawEmail] = useState('')
  const [code, setCode] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  // メール入力 <-> コード入力の切替でだけ見出しへフォーカスを移す
  // （再送クールダウンの毎秒再描画では動かさない）
  const headingRef = useScreenFocus<HTMLHeadingElement>(
    ui.step === 'enterEmail' || ui.step === 'sendingOtp' ? 'email' : 'code',
  )

  const normalizedEmail = normalizeUniversityEmail(rawEmail)
  const emailValid = isUniversityEmail(normalizedEmail)
  const showDomainWarning = rawEmail.trim().length > 0 && !emailValid

  // 再送クールダウンの残秒表示用（コード入力中だけ動かす）
  useEffect(() => {
    if (ui.step !== 'enterCode') return
    const timer = setInterval(() => setNowMs(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [ui.step])

  const sendOtp = async (email: string) => {
    const { error } = await client.auth.signInWithOtp({
      email,
      // 登録とログインの統合導線（新規ユーザーもここで作成される）。
      // emailRedirectToは渡さない＝Magic Linkを使わない
      options: { shouldCreateUser: true },
    })
    if (error) {
      dispatch({ type: 'otpSendFailed', reason: mapOtpSendError(error) })
    } else {
      dispatch({ type: 'otpSendSucceeded', nowMs: Date.now() })
    }
  }

  const handleEmailSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!emailValid || ui.step !== 'enterEmail') return
    dispatch({ type: 'submitEmail', normalizedEmail })
    void sendOtp(normalizedEmail)
  }

  const handleCodeSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (ui.step !== 'enterCode' || code.length !== 6) return
    const email = ui.email
    dispatch({ type: 'submitCode' })
    const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) {
      setCode('')
      dispatch({ type: 'verifyFailed' })
    }
    // 成功時はonAuthStateChangeが発火し、この画面ごと切り替わる
  }

  const handleResend = () => {
    if (ui.step !== 'enterCode' || !canResend(ui, Date.now())) return
    const email = ui.email
    dispatch({ type: 'resendRequested', nowMs: Date.now() })
    void sendOtp(email)
  }

  const handleEditEmail = () => {
    setCode('')
    dispatch({ type: 'editEmail' })
  }

  const resendWaitSeconds =
    ui.step === 'enterCode' ? Math.max(0, Math.ceil((ui.cooldownUntilMs - nowMs) / 1_000)) : 0

  if (ui.step === 'enterEmail' || ui.step === 'sendingOtp') {
    const sending = ui.step === 'sendingOtp'
    return (
      <main className="auth-main">
        <h1 className="page-title" tabIndex={-1} ref={headingRef}>
          大学メールでログイン
        </h1>
        <section className="auth-card" aria-label="メールアドレスの入力">
          <p className="auth-text">
            登録とログインは共通です。大学メールへ届く6桁コードで本人確認します。
          </p>
          {hasPendingInvite && (
            <p className="auth-notice" role="status">
              団体の招待リンクを開いています。ログイン後に参加確認へ進みます。
            </p>
          )}
          {/* noValidate: 入力値は送信前にnormalizeUniversityEmailで正規化するため、
              前後空白付きの生入力をブラウザ標準のemail検証が弾かないようにする。
              判定は自前のisUniversityEmail（+サーバー側is_university_user）が行う */}
          <form className="auth-form" onSubmit={handleEmailSubmit} noValidate>
            <label className="field-label" htmlFor="signin-email">
              大学メールアドレス
            </label>
            <input
              id="signin-email"
              className="text-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="s0000000@stu.kobe-u.ac.jp"
              value={rawEmail}
              onChange={(event) => setRawEmail(event.target.value)}
              disabled={sending}
            />
            <p className="auth-hint">{AUTH_TEXT.domainHint}</p>
            {showDomainWarning && (
              <p className="form-error" role="alert">
                {AUTH_TEXT.domainHint}
              </p>
            )}
            {ui.step === 'enterEmail' && ui.error !== null && (
              <p className="form-error" role="alert">
                {SEND_ERROR_TEXT[ui.error]}
              </p>
            )}
            <button
              type="submit"
              className="button button-primary auth-submit"
              disabled={!emailValid || sending}
            >
              {sending ? '送信しています…' : '6桁コードを送る'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  const verifying = ui.step === 'verifying'
  return (
    <main className="auth-main">
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        コードを入力
      </h1>
      <section className="auth-card" aria-label="6桁コードの入力">
        <p className="auth-text">{AUTH_TEXT.otpSentNotice}</p>
        <form className="auth-form" onSubmit={handleCodeSubmit}>
          <label className="field-label" htmlFor="signin-code">
            6桁コード
          </label>
          <input
            id="signin-code"
            className="text-input code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))}
            disabled={verifying}
          />
          {ui.step === 'enterCode' && ui.error !== null && (
            <p className="form-error" role="alert">
              {SEND_ERROR_TEXT[ui.error]}
            </p>
          )}
          <button
            type="submit"
            className="button button-primary auth-submit"
            disabled={code.length !== 6 || verifying}
          >
            {verifying ? '確認しています…' : 'ログインする'}
          </button>
        </form>
        <div className="auth-subactions">
          <button
            type="button"
            className="button button-secondary"
            onClick={handleResend}
            disabled={verifying || resendWaitSeconds > 0 || (ui.step === 'enterCode' && ui.resending)}
          >
            {resendWaitSeconds > 0 ? `再送（あと${resendWaitSeconds}秒）` : 'コードを再送する'}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={handleEditEmail}
            disabled={verifying}
          >
            メールアドレスを入力し直す
          </button>
        </div>
      </section>
    </main>
  )
}
