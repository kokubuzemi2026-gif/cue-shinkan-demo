// 利用者が切り替えられるコンテキスト（新入生 / 所属団体）の導出（純関数）。
// これはUIの表示切替であり認可根拠ではない。認可は常にサーバーのRLS/RPCが行う
// （docs/auth_and_authorization.md §4）

import type { Database } from '../lib/database.types'

export type OrgRole = Database['public']['Enums']['org_role']
export type OrgStatus = Database['public']['Enums']['org_status']

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  member: 'メンバー',
}

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  pending: '審査待ち',
  verified: '認証済み',
  suspended: '停止中',
}

export type MembershipInfo = {
  organizationId: string
  organizationName: string
  organizationDescription: string
  organizationStatus: OrgStatus
  role: OrgRole
  memberLabel: string
  joinedAt: string
}

export type MyAccount = {
  isUniversityUser: boolean
  hasStudentAccount: boolean
  memberships: MembershipInfo[]
}

export type AccountContext = { kind: 'student' } | { kind: 'org'; organizationId: string }

export function deriveContexts(account: MyAccount): AccountContext[] {
  const contexts: AccountContext[] = []
  if (account.hasStudentAccount) {
    contexts.push({ kind: 'student' })
  }
  for (const membership of account.memberships) {
    contexts.push({ kind: 'org', organizationId: membership.organizationId })
  }
  return contexts
}

export function isSameContext(a: AccountContext, b: AccountContext): boolean {
  if (a.kind === 'student' && b.kind === 'student') return true
  return a.kind === 'org' && b.kind === 'org' && a.organizationId === b.organizationId
}

// 既定: 新入生権限があればstudent、なければ最初の所属団体
export function defaultContext(contexts: AccountContext[]): AccountContext | null {
  return contexts[0] ?? null
}

// 現在の選択が有効ならそのまま、無効（脱退等）なら既定へフォールバックする
export function resolveActiveContext(
  contexts: AccountContext[],
  current: AccountContext | null,
): AccountContext | null {
  if (current !== null && contexts.some((candidate) => isSameContext(candidate, current))) {
    return current
  }
  return defaultContext(contexts)
}

export function findMembership(
  account: MyAccount,
  organizationId: string,
): MembershipInfo | null {
  return (
    account.memberships.find((membership) => membership.organizationId === organizationId) ?? null
  )
}

// owner/adminだけが招待・プロフィール編集のUIを見る（サーバー側でも同条件を再検証する）
export function canManageOrg(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin'
}
