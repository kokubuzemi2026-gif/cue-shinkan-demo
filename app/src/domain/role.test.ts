import { describe, expect, it } from 'vitest'

import { getRoleHeading, ROLE_LABELS } from './role'

describe('role', () => {
  it('新入生ロールでは新入生向けの見出しを返す', () => {
    expect(getRoleHeading('student')).toBe('新入生ホーム')
  })

  it('団体ロールでは団体向けの見出しを返す', () => {
    expect(getRoleHeading('club')).toBe('団体ダッシュボード')
  })

  it('ロール切替の表示名を定義している', () => {
    expect(ROLE_LABELS.student).toBe('新入生')
    expect(ROLE_LABELS.club).toBe('団体')
  })
})
