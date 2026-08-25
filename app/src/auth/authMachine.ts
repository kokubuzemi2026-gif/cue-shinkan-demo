// サインイン画面のUI状態機械（純関数。docs/auth_and_authorization.md §3の遷移）。
// 副作用（signInWithOtp / verifyOtp）はSignInScreenが行い、結果をイベントとして渡す。
// 状態にはメールアドレス以外の秘密（コード・トークン）を保持しない

import type { OtpSendFailureReason } from './errorMessages'

// OTP再送のクールダウン（Supabaseローカル既定の再送間隔に合わせる）
export const OTP_RESEND_COOLDOWN_MS = 60_000

export type AuthUiState =
  | { step: 'enterEmail'; error: OtpSendFailureReason | null }
  | { step: 'sendingOtp'; email: string }
  | {
      step: 'enterCode'
      email: string
      error: OtpSendFailureReason | 'badCode' | null
      cooldownUntilMs: number
      resending: boolean
    }
  | { step: 'verifying'; email: string; cooldownUntilMs: number }

export type AuthUiEvent =
  | { type: 'submitEmail'; normalizedEmail: string }
  | { type: 'otpSendSucceeded'; nowMs: number }
  | { type: 'otpSendFailed'; reason: OtpSendFailureReason }
  | { type: 'submitCode' }
  | { type: 'verifyFailed' }
  | { type: 'resendRequested'; nowMs: number }
  | { type: 'editEmail' }

export const initialAuthUiState: AuthUiState = { step: 'enterEmail', error: null }

export function canResend(state: AuthUiState, nowMs: number): boolean {
  return state.step === 'enterCode' && !state.resending && nowMs >= state.cooldownUntilMs
}

export function reduceAuthUi(state: AuthUiState, event: AuthUiEvent): AuthUiState {
  switch (state.step) {
    case 'enterEmail':
      if (event.type === 'submitEmail') {
        return { step: 'sendingOtp', email: event.normalizedEmail }
      }
      return state
    case 'sendingOtp':
      if (event.type === 'otpSendSucceeded') {
        return {
          step: 'enterCode',
          email: state.email,
          error: null,
          cooldownUntilMs: event.nowMs + OTP_RESEND_COOLDOWN_MS,
          resending: false,
        }
      }
      if (event.type === 'otpSendFailed') {
        return { step: 'enterEmail', error: event.reason }
      }
      return state
    case 'enterCode':
      if (event.type === 'submitCode') {
        return { step: 'verifying', email: state.email, cooldownUntilMs: state.cooldownUntilMs }
      }
      if (event.type === 'resendRequested') {
        if (!canResend(state, event.nowMs)) {
          return state
        }
        return { ...state, resending: true, error: null }
      }
      if (event.type === 'otpSendSucceeded') {
        // 再送成功: クールダウンを再開する
        return {
          ...state,
          resending: false,
          error: null,
          cooldownUntilMs: event.nowMs + OTP_RESEND_COOLDOWN_MS,
        }
      }
      if (event.type === 'otpSendFailed') {
        return { ...state, resending: false, error: event.reason }
      }
      if (event.type === 'editEmail') {
        return { step: 'enterEmail', error: null }
      }
      return state
    case 'verifying':
      if (event.type === 'verifyFailed') {
        return {
          step: 'enterCode',
          email: state.email,
          error: 'badCode',
          cooldownUntilMs: state.cooldownUntilMs,
          resending: false,
        }
      }
      // 検証成功時はonAuthStateChangeで画面ごと切り替わるためイベントは不要
      return state
    default:
      return state
  }
}
