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

// 未ログイン時に選んだ入口（Task 020・D056）。
// **roleではなくUI意図**であり、認可根拠にしない（認可は常にサーバーのRLS/RPC）。
// React stateのみで保持し、user metadata・DB・localStorageへ永続化しない。
// リロードで消えたら入口選択へ戻る（誤った画面へ進むより安全側）
export type EntryIntent = 'student' | 'organization'

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

// 入口意図に応じた初期コンテキスト。意図が示す側が使えるならそれ、
// 使えない・意図なし（null）なら既存の既定（defaultContext）と同値。
// **サーバーが返した contexts の中からしか選ばない**ため、
// 改変した意図や任意のorganization IDで未所属団体が表示されることはない
export function initialContextForIntent(
  contexts: AccountContext[],
  intent: EntryIntent | null,
): AccountContext | null {
  if (intent === 'student') {
    const student = contexts.find((context) => context.kind === 'student')
    if (student !== undefined) return student
  }
  if (intent === 'organization') {
    const org = contexts.find((context) => context.kind === 'org')
    if (org !== undefined) return org
  }
  return defaultContext(contexts)
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
