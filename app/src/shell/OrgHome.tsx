import { canManageOrg, ORG_STATUS_LABELS, type MembershipInfo } from '../account/contextModel'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { OrgMembersScreen } from '../org/OrgMembersScreen'
import { OrgProfileForm } from '../org/OrgProfileForm'

type OrgHomeProps = {
  client: CueSupabaseClient
  membership: MembershipInfo
  // プロフィール保存後などに親がアカウント情報（団体名表示）を更新する
  onAccountChanged: () => void
}

const STATUS_NOTES: Record<MembershipInfo['organizationStatus'], string> = {
  pending: '運営の確認が終わるまで「審査待ち」です。オファー配信などの団体機能は認証後に有効になります。',
  verified: '認証済みの団体です。',
  suspended: 'この団体は現在停止中です。心当たりがない場合は運営へ連絡してください。',
}

// 団体コンテキストのホーム。オファー作成・配信はTask 009以降で接続される
export function OrgHome({ client, membership, onAccountChanged }: OrgHomeProps) {
  const manager = canManageOrg(membership.role)
  return (
    <>
      <h1 className="page-title">{membership.organizationName}</h1>
      <section className="auth-card" aria-label="団体の状態">
        <span className={`status-chip status-${membership.organizationStatus}`}>
          {ORG_STATUS_LABELS[membership.organizationStatus]}
        </span>
        <p className="auth-text">{STATUS_NOTES[membership.organizationStatus]}</p>
        <p className="auth-hint">あなたの表示ラベル: {membership.memberLabel}</p>
      </section>

      {manager && (
        <OrgProfileForm
          key={membership.organizationId}
          client={client}
          organizationId={membership.organizationId}
          initialName={membership.organizationName}
          initialDescription={membership.organizationDescription}
          onSaved={onAccountChanged}
        />
      )}

      <OrgMembersScreen
        client={client}
        organizationId={membership.organizationId}
        myRole={membership.role}
      />

      <section className="placeholder-card" aria-label="準備中の案内">
        <span className="placeholder-chip">準備中</span>
        <p className="placeholder-text">
          新歓イベントのオファー作成・配信・ファネル表示は、次の開発段階（サーバーデータ移行）でこの団体に接続されます。
        </p>
      </section>
    </>
  )
}
