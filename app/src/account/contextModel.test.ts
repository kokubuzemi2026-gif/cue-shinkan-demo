import { describe, expect, it } from 'vitest'

import {
  canManageOrg,
  defaultContext,
  deriveContexts,
  findMembership,
  isSameContext,
  resolveActiveContext,
  type MyAccount,
} from './contextModel'

function account(overrides: Partial<MyAccount>): MyAccount {
  return { isUniversityUser: true, hasStudentAccount: false, memberships: [], ...overrides }
}

const orgA = {
  organizationId: 'org-a',
  organizationName: '団体A',
  organizationDescription: '架空の説明',
  organizationStatus: 'pending' as const,
  role: 'owner' as const,
  memberLabel: '担当者-A1B2C3',
  joinedAt: '2026-08-24T00:00:00Z',
}
const orgB = { ...orgA, organizationId: 'org-b', organizationName: '団体B', role: 'member' as const }

describe('deriveContexts / defaultContext', () => {
  it('学生のみ: studentコンテキストだけを返し既定になる', () => {
    const contexts = deriveContexts(account({ hasStudentAccount: true }))
    expect(contexts).toEqual([{ kind: 'student' }])
    expect(defaultContext(contexts)).toEqual({ kind: 'student' })
  })

  it('団体のみ: 団体コンテキストだけを返し、最初の団体が既定になる', () => {
    const contexts = deriveContexts(account({ memberships: [orgA, orgB] }))
    expect(contexts).toEqual([
      { kind: 'org', organizationId: 'org-a' },
      { kind: 'org', organizationId: 'org-b' },
    ])
    expect(defaultContext(contexts)).toEqual({ kind: 'org', organizationId: 'org-a' })
  })

  it('両方: studentが先頭で既定はstudent（複数権限の共存）', () => {
    const contexts = deriveContexts(account({ hasStudentAccount: true, memberships: [orgA, orgB] }))
    expect(contexts).toHaveLength(3)
    expect(defaultContext(contexts)).toEqual({ kind: 'student' })
  })

  it('権限ゼロ: 空配列と既定nullを返す（onboardingへの分岐材料）', () => {
    const contexts = deriveContexts(account({}))
    expect(contexts).toEqual([])
    expect(defaultContext(contexts)).toBeNull()
  })
})

describe('resolveActiveContext', () => {
  const contexts = deriveContexts(account({ hasStudentAccount: true, memberships: [orgA] }))

  it('現在の選択が有効ならそのまま維持する', () => {
    const current = { kind: 'org', organizationId: 'org-a' } as const
    expect(resolveActiveContext(contexts, current)).toEqual(current)
  })

  it('無効になった選択（脱退済み団体）は既定へフォールバックする', () => {
    const current = { kind: 'org', organizationId: 'org-gone' } as const
    expect(resolveActiveContext(contexts, current)).toEqual({ kind: 'student' })
  })

  it('選択なしは既定を返す', () => {
    expect(resolveActiveContext(contexts, null)).toEqual({ kind: 'student' })
  })
})

describe('isSameContext / findMembership / canManageOrg', () => {
  it('コンテキストの同一性を判定する', () => {
    expect(isSameContext({ kind: 'student' }, { kind: 'student' })).toBe(true)
    expect(
      isSameContext({ kind: 'org', organizationId: 'x' }, { kind: 'org', organizationId: 'x' }),
    ).toBe(true)
    expect(isSameContext({ kind: 'student' }, { kind: 'org', organizationId: 'x' })).toBe(false)
    expect(
      isSameContext({ kind: 'org', organizationId: 'x' }, { kind: 'org', organizationId: 'y' }),
    ).toBe(false)
  })

  it('団体IDから所属情報を引ける', () => {
    const me = account({ memberships: [orgA, orgB] })
    expect(findMembership(me, 'org-b')?.role).toBe('member')
    expect(findMembership(me, 'org-none')).toBeNull()
  })

  it('owner/adminだけが団体管理UIを見る', () => {
    expect(canManageOrg('owner')).toBe(true)
    expect(canManageOrg('admin')).toBe(true)
    expect(canManageOrg('member')).toBe(false)
  })
})
