import { useEffect, useReducer, useState, type FormEvent } from 'react'

import { useScreenFocus } from '../a11y/useScreenFocus'
import type { EntryIntent } from '../account/contextModel'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { canResend, initialAuthUiState, reduceAuthUi } from './authMachine'
import { AUTH_TEXT, mapOtpSendError } from './errorMessages'
import { readTurnstileSiteKey } from './turnstile'
import { TurnstileWidget } from './TurnstileWidget'
import { isUniversityEmail, normalizeUniversityEmail } from './universityEmail'

type SignInScreenProps = {
  client: CueSupabaseClient
  // 招待リンク経由の流入。ログイン後に承諾へ進むことを予告する
  hasPendingInvite: boolean
  // Task 020: 選んだ入口。見出し下の文脈表示とリード文だけを変える。
  // OTP送信・検証・再送・エラー表示・新規/既存の無差別表示は入口に依らず完全共通
  entryIntent?: EntryIntent | null
  // 「入口を選び直す」。招待流入（entryIntent=null）では出さない
  onReselectEntry?: () => void
}

const SEND_ERROR_TEXT = {
  rateLimited: AUTH_TEXT.rateLimited,
  sendFailed: AUTH_TEXT.sendFailed,
  badCode: AUTH_TEXT.badCode,
} as const

// 入口別の文脈表示（Task 020）。選んだ入口だけで決まり、アカウントの有無では変わらない
const ENTRY_LEAD: Record<EntryIntent, { context: string; lead: string }> = {
  student: {
    context: '新入生としてはじめる',
    lead: '登録とログインは共通です。大学メールへ届く6桁コードで本人確認します。',
  },
  organization: {
    context: '団体担当者としてはじめる',
    lead: '担当者個人の大学メールでログインします（団体共有のアカウントは作りません）。届く6桁コードで本人確認します。',
  },
}

// 登録とログインを一つの導線に統合したメールOTP画面。
// ドメイン外・plus付きメールはクライアント側で送信自体を拒否する（第一ゲート）。
// 成功・失敗の表示は新規/既存で差を付けず、アカウントの存在有無を漏らさない
export function SignInScreen({
  client,
  hasPendingInvite,
  entryIntent = null,
  onReselectEntry,
}: SignInScreenProps) {
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

  // Task 021: CAPTCHA（Turnstile・D057）。sitekey未設定なら完全に従来どおり。
  // 対象はOTP送信（/otp。初回と再送）だけで、コード検証（/verify）はCAPTCHA対象外
  const [turnstileSiteKey] = useState(() => readTurnstileSiteKey())
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0)
  const captchaReady = turnstileSiteKey === null || captchaToken !== null

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
      options: {
        shouldCreateUser: true,
        // CAPTCHA有効時のみ付く（sitekey未設定ならキー自体を送らない）
        ...(captchaToken !== null ? { captchaToken } : {}),
      },
    })
    // Turnstileトークンは/otp呼び出し1回ごとの単回使用。成功・失敗に関わらず
    // 消費済みとして破棄し、ウィジェットへ再取得を指示する
    if (turnstileSiteKey !== null) {
      setCaptchaToken(null)
      setCaptchaResetSignal((n) => n + 1)
    }
    if (error) {
      dispatch({ type: 'otpSendFailed', reason: mapOtpSendError(error) })
    } else {
      dispatch({ type: 'otpSendSucceeded', nowMs: Date.now() })
    }
  }

  const handleEmailSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!emailValid || ui.step !== 'enterEmail' || !captchaReady) return
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
    if (ui.step !== 'enterCode' || !canResend(ui, Date.now()) || !captchaReady) return
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
        {entryIntent !== null && (
          <p className="auth-hint entry-context">{ENTRY_LEAD[entryIntent].context}</p>
        )}
        <section className="auth-card" aria-label="メールアドレスの入力">
          <p className="auth-text">
            {entryIntent === null
              ? '登録とログインは共通です。大学メールへ届く6桁コードで本人確認します。'
              : ENTRY_LEAD[entryIntent].lead}
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
            {turnstileSiteKey !== null && (
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                onToken={setCaptchaToken}
                resetSignal={captchaResetSignal}
              />
            )}
            <button
              type="submit"
              className="button button-primary auth-submit"
              disabled={!emailValid || sending || !captchaReady}
            >
              {sending ? '送信しています…' : '6桁コードを送る'}
            </button>
          </form>
          {entryIntent !== null && onReselectEntry !== undefined && (
            <div className="auth-subactions">
              <button
                type="button"
                className="button button-ghost"
                onClick={onReselectEntry}
                disabled={sending}
              >
                入口を選び直す
              </button>
            </div>
          )}
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
        {turnstileSiteKey !== null && (
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            onToken={setCaptchaToken}
            resetSignal={captchaResetSignal}
          />
        )}
        <div className="auth-subactions">
          <button
            type="button"
            className="button button-secondary"
            onClick={handleResend}
            disabled={
              verifying ||
              resendWaitSeconds > 0 ||
              (ui.step === 'enterCode' && ui.resending) ||
              !captchaReady
            }
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
