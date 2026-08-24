import { useCallback, useEffect, useState } from 'react'

import { canManageOrg, ORG_ROLE_LABELS, type OrgRole } from '../account/contextModel'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { InviteCreatedDialog } from './InviteCreatedDialog'
import { buildInviteUrl } from './inviteLink'
import {
  createInvitation,
  fetchMemberDirectory,
  listInvitations,
  orgApiErrorText,
  revokeInvitation,
  type InvitationListItem,
  type MemberDirectoryEntry,
} from './orgApi'

type OrgMembersScreenProps = {
  client: CueSupabaseClient
  organizationId: string
  myRole: OrgRole
}

const INVITE_STATE_LABELS: Record<string, string> = {
  pending: '未使用',
  used: '使用済み',
  revoked: '取消済み',
  expired: '期限切れ',
}

type LoadState<T> = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; items: T[] }

// 担当者一覧（PIIなしラベルのみ）と、owner/admin向けの招待管理。
// メンバーの追加は招待承諾のみ。削除・役割変更のUIはTask 008では提供しない
export function OrgMembersScreen({ client, organizationId, myRole }: OrgMembersScreenProps) {
  const manager = canManageOrg(myRole)
  const [members, setMembers] = useState<LoadState<MemberDirectoryEntry>>({ status: 'loading' })
  const [invitations, setInvitations] = useState<LoadState<InvitationListItem>>({
    status: 'loading',
  })
  const [inviteRole, setInviteRole] = useState<OrgRole>('member')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // 生トークンはこのstateだけに存在し、ダイアログを閉じたら破棄される
  const [createdInvite, setCreatedInvite] = useState<{ url: string; expiresAt: string } | null>(
    null,
  )

  const loadMembers = useCallback(async () => {
    setMembers({ status: 'loading' })
    try {
      const items = await fetchMemberDirectory(client, organizationId)
      setMembers({ status: 'loaded', items })
    } catch {
      setMembers({ status: 'error' })
    }
  }, [client, organizationId])

  const loadInvitations = useCallback(async () => {
    if (!manager) return
    setInvitations({ status: 'loading' })
    try {
      const items = await listInvitations(client, organizationId)
      setInvitations({ status: 'loaded', items })
    } catch {
      setInvitations({ status: 'error' })
    }
  }, [client, organizationId, manager])

  useEffect(() => {
    void loadMembers()
    void loadInvitations()
  }, [loadMembers, loadInvitations])

  const handleCreateInvite = async () => {
    if (inviteBusy) return
    setInviteBusy(true)
    setActionError(null)
    try {
      const created = await createInvitation(client, organizationId, inviteRole)
      const baseUrl = `${window.location.origin}${import.meta.env.BASE_URL}`
      setCreatedInvite({ url: buildInviteUrl(baseUrl, created.token), expiresAt: created.expiresAt })
      await loadInvitations()
    } catch (error) {
      setActionError(orgApiErrorText(error))
    } finally {
      setInviteBusy(false)
    }
  }

  const handleRevoke = async (invitationId: string) => {
    setActionError(null)
    try {
      await revokeInvitation(client, invitationId)
      await loadInvitations()
    } catch (error) {
      setActionError(orgApiErrorText(error))
    }
  }

  return (
    <>
      <section className="auth-card" aria-label="担当者一覧">
        <h2 className="auth-card-title">担当者</h2>
        <p className="auth-hint">
          個人を特定しないラベルで表示します（メールアドレス・氏名は保存していません）。
        </p>
        {members.status === 'loading' && (
          <p className="auth-text" role="status">
            読み込んでいます…
          </p>
        )}
        {members.status === 'error' && (
          <>
            <p className="form-error" role="alert">
              担当者一覧を読み込めませんでした。
            </p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void loadMembers()}
            >
              再試行
            </button>
          </>
        )}
        {members.status === 'loaded' && (
          <ul className="member-list">
            {members.items.map((member) => (
              <li key={member.memberLabel} className="member-row">
                <span className="member-label">{member.memberLabel}</span>
                <span className="member-meta">
                  {ORG_ROLE_LABELS[member.role]}
                  {member.isSelf && <span className="self-chip">自分</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manager && (
        <section className="auth-card" aria-label="招待の管理">
          <h2 className="auth-card-title">招待リンク</h2>
          <p className="auth-hint">
            1回だけ使えるリンクを作成して担当者を招待します（有効期限7日・メールアドレスの入力は不要）。
          </p>
          {createdInvite !== null ? (
            <InviteCreatedDialog
              inviteUrl={createdInvite.url}
              expiresAt={createdInvite.expiresAt}
              onClose={() => setCreatedInvite(null)}
            />
          ) : (
            <div className="invite-create-row">
              <label className="field-label" htmlFor="invite-role">
                招待する役割
              </label>
              <select
                id="invite-role"
                className="text-input"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as OrgRole)}
                disabled={inviteBusy}
              >
                <option value="member">メンバー</option>
                <option value="admin">管理者</option>
              </select>
              <button
                type="button"
                className="button button-primary auth-submit"
                onClick={() => void handleCreateInvite()}
                disabled={inviteBusy}
              >
                {inviteBusy ? '作成しています…' : '招待リンクを作成'}
              </button>
            </div>
          )}
          {actionError !== null && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          {invitations.status === 'error' && (
            <p className="form-error" role="alert">
              招待一覧を読み込めませんでした。
            </p>
          )}
          {invitations.status === 'loaded' && invitations.items.length === 0 && (
            <p className="auth-text">作成済みの招待はありません。</p>
          )}
          {invitations.status === 'loaded' && invitations.items.length > 0 && (
            <ul className="member-list">
              {invitations.items.map((invitation) => (
                <li key={invitation.id} className="member-row">
                  <span className="member-label">
                    {ORG_ROLE_LABELS[invitation.invitedRole]}招待
                  </span>
                  <span className="member-meta">
                    {INVITE_STATE_LABELS[invitation.state] ?? invitation.state}
                    {invitation.state === 'pending' && (
                      <button
                        type="button"
                        className="button button-ghost invite-revoke"
                        onClick={() => void handleRevoke(invitation.id)}
                      >
                        取消
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}
