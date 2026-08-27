import { useCallback, useReducer, useState } from 'react'

import { useScreenFocus } from '../a11y/useScreenFocus'
import { canManageOrg, ORG_STATUS_LABELS, type MembershipInfo } from '../account/contextModel'
import { deletionReducer, INITIAL_DELETION_STATE } from '../features/account/deletion'
import { DeletionCard } from '../features/account/DeletionCard'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { serverErrorMessage } from '../serverdata/apiText'
import { leaveOrganization } from '../serverdata/lifecycleApi'
import { OrgContactForm } from '../org/OrgContactForm'
import { OrgMembersScreen } from '../org/OrgMembersScreen'
import { OrgOffersPanel } from '../org/OrgOffersPanel'
import { OrgProfileForm } from '../org/OrgProfileForm'

type OrgHomeProps = {
  client: CueSupabaseClient
  membership: MembershipInfo
  // プロフィール保存後などに親がアカウント情報（団体名表示）を更新する
  onAccountChanged: () => void
  // オファー作成中は親シェルがコンテキスト切替・権限追加を隠す（集中モード）
  onFocusModeChange: (active: boolean) => void
}

const STATUS_NOTES: Record<MembershipInfo['organizationStatus'], string> = {
  pending: '運営の確認が終わるまで「審査待ち」です。オファー配信などの団体機能は認証後に有効になります。',
  verified: '認証済みの団体です。',
  suspended: 'この団体は現在停止中です。心当たりがない場合は運営へ連絡してください。',
}

// 団体コンテキストのホーム。オファー作成・配信・ファネルはTask 009でサーバー接続済み
export function OrgHome({
  client,
  membership,
  onAccountChanged,
  onFocusModeChange,
}: OrgHomeProps) {
  const manager = canManageOrg(membership.role)
  const verified = membership.organizationStatus === 'verified'
  // 公式窓口の保存後にダッシュボード表示（公式窓口snapshot）を再読込するためのトークン
  const [contactVersion, setContactVersion] = useState(0)
  // コンテキスト切替で団体が変わったときだけ見出しへ移す。
  // オファー作成の集中モードから戻るときはOrgOffersPanel側が自分の見出しへ移すため、
  // ここで奪わない（親のeffectは子より後に走るので、奪うと上書きになる）。
  // verifiedの団体ではOrgOffersPanelが自分の見出しへ移すので、refを渡さず
  // 二重にフォーカスが動くのを避ける（読み上げの途中で移ると読み直しになる）
  const headingRef = useScreenFocus<HTMLHeadingElement>(membership.organizationId)
  // オファー作成・確認・完了中はプロフィール・担当者一覧を隠し、入力へ集中させる
  const [offersFocus, setOffersFocus] = useState(false)
  // 脱退（Task 014・D048）。最後のownerは脱退できず、理由はサーバーが返す
  const [leaveState, leaveDispatch] = useReducer(deletionReducer, INITIAL_DELETION_STATE)
  const runLeave = () => {
    leaveDispatch({ type: 'start' })
    void (async () => {
      try {
        await leaveOrganization(client, membership.organizationId)
        leaveDispatch({ type: 'succeeded' })
        onAccountChanged()
      } catch (error) {
        leaveDispatch({ type: 'failed', message: serverErrorMessage(error) })
      }
    })()
  }
  const handleOffersFocus = useCallback(
    (active: boolean) => {
      setOffersFocus(active)
      onFocusModeChange(active)
    },
    [onFocusModeChange],
  )

  return (
    <>
      {!offersFocus && (
        <h1 className="page-title" tabIndex={-1} ref={verified ? undefined : headingRef}>
          {membership.organizationName}
        </h1>
      )}
      {!offersFocus && (
        <section className="auth-card" aria-label="団体の状態">
          <span className={`status-chip status-${membership.organizationStatus}`}>
            {ORG_STATUS_LABELS[membership.organizationStatus]}
          </span>
          <p className="auth-text">{STATUS_NOTES[membership.organizationStatus]}</p>
          <p className="auth-hint">あなたの表示ラベル: {membership.memberLabel}</p>
        </section>
      )}

      {verified ? (
        <OrgOffersPanel
          client={client}
          organizationId={membership.organizationId}
          canSend={manager}
          refreshToken={contactVersion}
          onFocusModeChange={handleOffersFocus}
        />
      ) : (
        <section className="placeholder-card" aria-label="オファー配信の案内">
          <span className="placeholder-chip">認証待ち</span>
          <p className="placeholder-text">
            新歓イベントのオファー作成・配信・ファネルは、運営の認証が完了すると利用できます。
          </p>
        </section>
      )}

      {!offersFocus && manager && (
        <>
          <OrgProfileForm
            key={membership.organizationId}
            client={client}
            organizationId={membership.organizationId}
            initialName={membership.organizationName}
            initialDescription={membership.organizationDescription}
            onSaved={onAccountChanged}
          />
          <OrgContactForm
            key={`contact-${membership.organizationId}`}
            client={client}
            organizationId={membership.organizationId}
            onSaved={() => setContactVersion((version) => version + 1)}
          />
        </>
      )}

      {!offersFocus && (
        <OrgMembersScreen
          client={client}
          organizationId={membership.organizationId}
          myRole={membership.role}
        />
      )}

      {!offersFocus && (
        <DeletionCard
          kind="membership"
          state={leaveState}
          onRequest={() => leaveDispatch({ type: 'request' })}
          onCancel={() => leaveDispatch({ type: 'cancel' })}
          onConfirm={runLeave}
        />
      )}
    </>
  )
}
