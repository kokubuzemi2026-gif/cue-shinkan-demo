import { describe, expect, it } from 'vitest'

import {
  canResend,
  initialAuthUiState,
  OTP_RESEND_COOLDOWN_MS,
  reduceAuthUi,
  type AuthUiState,
} from './authMachine'

const EMAIL = 'demo-a@stu.kobe-u.ac.jp'
const NOW = 1_000_000

function sentState(nowMs = NOW): AuthUiState {
  const sending = reduceAuthUi(initialAuthUiState, { type: 'submitEmail', normalizedEmail: EMAIL })
  return reduceAuthUi(sending, { type: 'otpSendSucceeded', nowMs })
}

describe('reduceAuthUi: メール送信', () => {
  it('submitEmailでsendingOtpへ進む', () => {
    const next = reduceAuthUi(initialAuthUiState, { type: 'submitEmail', normalizedEmail: EMAIL })
    expect(next).toEqual({ step: 'sendingOtp', email: EMAIL })
  })

  it('送信成功でenterCodeへ進み、60秒のクールダウンが始まる', () => {
    const next = sentState()
    expect(next).toEqual({
      step: 'enterCode',
      email: EMAIL,
      error: null,
      cooldownUntilMs: NOW + OTP_RESEND_COOLDOWN_MS,
      resending: false,
    })
  })

  it('レート制限失敗はenterEmailへ戻り、定型エラー種別だけを持つ', () => {
    const sending = reduceAuthUi(initialAuthUiState, { type: 'submitEmail', normalizedEmail: EMAIL })
    const next = reduceAuthUi(sending, { type: 'otpSendFailed', reason: 'rateLimited' })
    expect(next).toEqual({ step: 'enterEmail', error: 'rateLimited' })
  })

  it('その他の送信失敗はsendFailedになる', () => {
    const sending = reduceAuthUi(initialAuthUiState, { type: 'submitEmail', normalizedEmail: EMAIL })
    const next = reduceAuthUi(sending, { type: 'otpSendFailed', reason: 'sendFailed' })
    expect(next).toEqual({ step: 'enterEmail', error: 'sendFailed' })
  })
})

describe('reduceAuthUi: コード検証', () => {
  it('submitCodeでverifyingへ進む', () => {
    const next = reduceAuthUi(sentState(), { type: 'submitCode' })
    expect(next.step).toBe('verifying')
  })

  it('検証失敗はenterCodeへ戻りbadCodeを示す（コード値は状態に残らない）', () => {
    const verifying = reduceAuthUi(sentState(), { type: 'submitCode' })
    const next = reduceAuthUi(verifying, { type: 'verifyFailed' })
    expect(next).toEqual({
      step: 'enterCode',
      email: EMAIL,
      error: 'badCode',
      cooldownUntilMs: NOW + OTP_RESEND_COOLDOWN_MS,
      resending: false,
    })
  })
})

describe('reduceAuthUi: 再送クールダウン', () => {
  it('クールダウン中は再送要求を無視する', () => {
    const state = sentState()
    const next = reduceAuthUi(state, { type: 'resendRequested', nowMs: NOW + 1_000 })
    expect(next).toBe(state)
    expect(canResend(state, NOW + 1_000)).toBe(false)
  })

  it('クールダウン経過後は再送でき、成功で新しいクールダウンが始まる', () => {
    const after = NOW + OTP_RESEND_COOLDOWN_MS
    const state = sentState()
    expect(canResend(state, after)).toBe(true)
    const resending = reduceAuthUi(state, { type: 'resendRequested', nowMs: after })
    expect(resending).toMatchObject({ step: 'enterCode', resending: true, error: null })
    const done = reduceAuthUi(resending, { type: 'otpSendSucceeded', nowMs: after + 500 })
    expect(done).toMatchObject({
      resending: false,
      cooldownUntilMs: after + 500 + OTP_RESEND_COOLDOWN_MS,
    })
  })

  it('再送失敗は入力画面へ戻さず、enterCodeのままエラー種別を示す', () => {
    const after = NOW + OTP_RESEND_COOLDOWN_MS
    const resending = reduceAuthUi(sentState(), { type: 'resendRequested', nowMs: after })
    const next = reduceAuthUi(resending, { type: 'otpSendFailed', reason: 'rateLimited' })
    expect(next).toMatchObject({ step: 'enterCode', resending: false, error: 'rateLimited' })
  })
})

describe('reduceAuthUi: メール修正と無関係イベント', () => {
  it('editEmailで最初の画面へ戻る', () => {
    const next = reduceAuthUi(sentState(), { type: 'editEmail' })
    expect(next).toEqual({ step: 'enterEmail', error: null })
  })

  it('該当しないイベントは状態を変えない', () => {
    expect(reduceAuthUi(initialAuthUiState, { type: 'verifyFailed' })).toBe(initialAuthUiState)
    const code = sentState()
    expect(reduceAuthUi(code, { type: 'submitEmail', normalizedEmail: EMAIL })).toBe(code)
  })
})
