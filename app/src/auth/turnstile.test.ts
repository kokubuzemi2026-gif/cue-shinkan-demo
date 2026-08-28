import { afterEach, describe, expect, it, vi } from 'vitest'

import { readTurnstileSiteKey } from './turnstile'

// Task 021: sitekeyの読み取り。「未設定なら完全に不活性」の入口を固定する
describe('readTurnstileSiteKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未設定ならnull（CAPTCHA機能は不活性）', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', undefined)
    expect(readTurnstileSiteKey()).toBeNull()
  })

  it('空文字・空白だけでもnull（設定ミスでウィジェットを出さない）', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    expect(readTurnstileSiteKey()).toBeNull()
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '   ')
    expect(readTurnstileSiteKey()).toBeNull()
  })

  it('値があれば前後空白を除いて返す', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '  0x4AAAAAAADemoKey  ')
    expect(readTurnstileSiteKey()).toBe('0x4AAAAAAADemoKey')
  })
})
