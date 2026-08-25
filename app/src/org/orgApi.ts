import type { OrgRole } from '../account/contextModel'
import type { CueSupabaseClient } from '../lib/supabaseClient'

// 団体系SECURITY DEFINER RPCの薄い型付きラッパ。
// 認可判定はすべてサーバー側（RLS/RPC）にあり、ここでは行わない。
// サーバーの生エラーメッセージは画面へ出さず、orgApiErrorTextの定型文だけを表示する

export type CreatedInvitation = {
  invitationId: string
  token: string
  expiresAt: string
}

export type InvitationListItem = {
  id: string
  invitedRole: OrgRole
  createdAt: string
  expiresAt: string
  state: string
}

export type MemberDirectoryEntry = {
  memberLabel: string
  role: OrgRole
  joinedAt: string
  isSelf: boolean
}

export type InvitationPreview = {
  organizationName: string
  invitedRole: OrgRole
  expiresAt: string
}

export type AcceptedInvitation = {
  organizationId: string
  organizationName: string
}

// RPCのraise exceptionメッセージ→利用者向け定型文。
// 未知のエラーは内容を出さず汎用文言にする（PII・トークンの漏えい防止）
export function orgApiErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : ''
  switch (message) {
    case 'not_authorized':
      return 'この操作を行う権限がありません。'
    case 'not_university_user':
      return '大学メールで認証されたアカウントだけが利用できます。'
    case 'invalid_invitation':
      return 'この招待リンクは使えません（無効・期限切れ・取消済み・使用済みのいずれか）。'
    case 'already_member':
      return 'すでにこの団体のメンバーです。'
    case 'invalid_org_name':
      return '団体名は1〜100文字で入力してください。'
    case 'invalid_org_description':
      return '紹介文は500文字以内で入力してください。'
    case 'invalid_invited_role':
      return 'この役割の招待は作成できません。'
    default:
      return '処理に失敗しました。時間をおいて再度お試しください。'
  }
}

export async function createOrganization(
  client: CueSupabaseClient,
  name: string,
  description: string,
): Promise<string> {
  const { data, error } = await client.rpc('create_organization', {
    org_name: name,
    org_description: description,
  })
  if (error) throw error
  return data
}

export async function updateOrganizationProfile(
  client: CueSupabaseClient,
  organizationId: string,
  name: string,
  description: string,
): Promise<void> {
  const { error } = await client.rpc('update_organization_profile', {
    org_id: organizationId,
    new_name: name,
    new_description: description,
  })
  if (error) throw error
}

export async function createInvitation(
  client: CueSupabaseClient,
  organizationId: string,
  invitedRole: OrgRole,
): Promise<CreatedInvitation> {
  const { data, error } = await client.rpc('create_invitation', {
    org_id: organizationId,
    invited_role: invitedRole,
  })
  if (error) throw error
  const row = data?.[0]
  if (row === undefined) throw new Error('empty_rpc_result')
  // 生トークンはこの戻り値の1回だけ。呼び出し側は表示後に保持しない
  return { invitationId: row.invitation_id, token: row.token, expiresAt: row.expires_at }
}

export async function revokeInvitation(
  client: CueSupabaseClient,
  invitationId: string,
): Promise<void> {
  const { error } = await client.rpc('revoke_invitation', { invitation_id: invitationId })
  if (error) throw error
}

export async function listInvitations(
  client: CueSupabaseClient,
  organizationId: string,
): Promise<InvitationListItem[]> {
  const { data, error } = await client.rpc('list_invitations', { org_id: organizationId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    invitedRole: row.invited_role,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    state: row.state,
  }))
}

export async function previewInvitation(
  client: CueSupabaseClient,
  token: string,
): Promise<InvitationPreview> {
  const { data, error } = await client.rpc('preview_invitation', { invitation_token: token })
  if (error) throw error
  const row = data?.[0]
  if (row === undefined) throw new Error('invalid_invitation')
  return {
    organizationName: row.organization_name,
    invitedRole: row.invited_role,
    expiresAt: row.expires_at,
  }
}

export async function acceptInvitation(
  client: CueSupabaseClient,
  token: string,
): Promise<AcceptedInvitation> {
  const { data, error } = await client.rpc('accept_invitation', { invitation_token: token })
  if (error) throw error
  const row = data?.[0]
  if (row === undefined) throw new Error('invalid_invitation')
  return { organizationId: row.organization_id, organizationName: row.organization_name }
}

export async function fetchMemberDirectory(
  client: CueSupabaseClient,
  organizationId: string,
): Promise<MemberDirectoryEntry[]> {
  const { data, error } = await client.rpc('org_member_directory', { org_id: organizationId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    memberLabel: row.member_label,
    role: row.role,
    joinedAt: row.joined_at,
    isSelf: row.is_self,
  }))
}
