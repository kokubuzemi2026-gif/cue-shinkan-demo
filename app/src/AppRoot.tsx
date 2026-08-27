import { useEffect, useState } from 'react'

import { RoleOnboarding } from './account/RoleOnboarding'
import { ConsentScreen } from './legal/ConsentScreen'
import { serverErrorMessage } from './serverdata/apiText'
import { fetchConsent, recordConsent, type ConsentStatus } from './serverdata/consentApi'
import { useMyAccount } from './account/useMyAccount'
import { SignInScreen } from './auth/SignInScreen'
import { useAuthSession } from './auth/useAuthSession'
import { getSupabaseClient, type CueSupabaseClient } from './lib/supabaseClient'
import { AcceptInviteScreen } from './org/AcceptInviteScreen'
import { OrgCreateScreen } from './org/OrgCreateScreen'
import { AuthenticatedShell } from './shell/AuthenticatedShell'
import { SetupNotice } from './shell/SetupNotice'

type AppRootProps = {
  // main.tsxがcreateRootより前に1回だけURLから取り出した招待トークン（URLからは除去済み）。
  // 以後トークンはReactのprops/stateのメモリ上にのみ存在する
  initialInviteToken: string | null
}

// Phase 2の実運用エントリ。
// - env未設定: SetupNotice（クラッシュ・白画面・デモへのフォールバックをしない）
// - 旧localStorageデモ（src/demo/DemoApp.tsx）はこのツリーから到達不能
export function AppRoot({ initialInviteToken }: AppRootProps) {
  const client = getSupabaseClient()
  if (client === null) {
    return <SetupNotice />
  }
  return <AuthApp client={client} initialInviteToken={initialInviteToken} />
}

function AuthApp({
  client,
  initialInviteToken,
}: {
  client: CueSupabaseClient
  initialInviteToken: string | null
}) {
  const { session, signOut } = useAuthSession(client)
  const [inviteToken, setInviteToken] = useState(initialInviteToken)

  if (session.status === 'restoring') {
    return <LoadingScreen label="ログイン状態を確認しています…" />
  }
  if (session.status === 'signedOut') {
    return <SignInScreen client={client} hasPendingInvite={inviteToken !== null} />
  }
  return (
    <SignedInApp
      key={session.userId}
      client={client}
      userId={session.userId}
      inviteToken={inviteToken}
      onInviteHandled={() => setInviteToken(null)}
      signOut={signOut}
    />
  )
}

function SignedInApp({
  client,
  userId,
  inviteToken,
  onInviteHandled,
  signOut,
}: {
  client: CueSupabaseClient
  userId: string
  inviteToken: string | null
  onInviteHandled: () => void
  signOut: () => Promise<void>
}) {
  const { state, reload } = useMyAccount(client, userId)
  const [creatingFirstOrg, setCreatingFirstOrg] = useState(false)
  // Task 015: 同意（D050）。**登録より前**に通す必要があるため、権限の有無で
  // 分岐するより先（AppRoot側）に置く。シェル側へ置くと、最初の権限を作った
  // 後にしか出ず「登録前に同意」にならない
  const [consent, setConsent] = useState<ConsentStatus | 'loading' | 'error'>('loading')
  const [consentBusy, setConsentBusy] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)
  const loadConsent = () => {
    setConsent('loading')
    void (async () => {
      try {
        setConsent(await fetchConsent(client))
      } catch {
        setConsent('error')
      }
    })()
  }
  useEffect(loadConsent, [client])
  const handleAgree = (version: number) => {
    if (consentBusy) return
    setConsentBusy(true)
    setConsentError(null)
    void (async () => {
      try {
        await recordConsent(client, version)
        setConsent(await fetchConsent(client))
      } catch (error) {
        setConsentError(serverErrorMessage(error))
      } finally {
        setConsentBusy(false)
      }
    })()
  }

  if (state.status === 'loading') {
    return <LoadingScreen label="アカウント情報を読み込んでいます…" />
  }

  if (state.status === 'error') {
    return (
      <main className="auth-main">
        <h1 className="page-title">読み込みに失敗しました</h1>
        <section className="auth-card" aria-label="再試行の案内">
          <p className="auth-text">
            アカウント情報を取得できませんでした。通信環境を確認して再試行してください。
          </p>
          <div className="auth-subactions">
            <button type="button" className="button button-primary" onClick={reload}>
              再試行
            </button>
            <button type="button" className="button button-ghost" onClick={() => void signOut()}>
              ログアウト
            </button>
          </div>
        </section>
      </main>
    )
  }

  const { account } = state

  // 認証境界の正本（is_university_user）がfalse:
  // ドメイン外で作られたauth identity・メール変更でドメイン外になった既存アカウントの双方を
  // ここで遮断する。CUEのデータには一切アクセスできない
  if (!account.isUniversityUser) {
    return (
      <main className="auth-main">
        <h1 className="page-title">このアカウントでは利用できません</h1>
        <section className="auth-card" aria-label="利用条件の案内">
          <p className="auth-text">
            CUEを利用できるのは、神戸大学の学生メール（@stu.kobe-u.ac.jp）で確認済みのアカウントだけです。
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void signOut()}
          >
            ログアウトして別のメールで登録する
          </button>
        </section>
      </main>
    )
  }

  // 同意が必要なら、登録・招待承諾より先に同意画面を出す。
  // 読み込み中・失敗を「同意済み」と誤解させない
  if (consent === 'loading') {
    return <LoadingScreen label="確認しています…" />
  }
  if (consent === 'error') {
    return (
      <main className="auth-main">
        <h1 className="page-title">はじめる前に</h1>
        <section className="auth-card" aria-label="再試行の案内">
          <p className="auth-text">
            確認情報を読み込めませんでした。通信環境を確認して再試行してください。
          </p>
          <div className="auth-subactions">
            <button type="button" className="button button-primary" onClick={loadConsent}>
              再試行
            </button>
            <button type="button" className="button button-ghost" onClick={() => void signOut()}>
              ログアウト
            </button>
          </div>
        </section>
      </main>
    )
  }
  if (consent.needsConsent) {
    return (
      <main className="auth-main">
        <ConsentScreen
          version={consent.currentVersion}
          submitting={consentBusy}
          error={consentError}
          onAgree={handleAgree}
        />
      </main>
    )
  }

  // 招待トークンがある場合は、権限の有無に関わらずまず承諾確認を表示する
  if (inviteToken !== null) {
    return (
      <AcceptInviteScreen
        client={client}
        token={inviteToken}
        onAccepted={() => {
          onInviteHandled()
          reload()
        }}
        onDismiss={onInviteHandled}
      />
    )
  }

  const hasAnyRole = account.hasStudentAccount || account.memberships.length > 0

  if (!hasAnyRole) {
    if (creatingFirstOrg) {
      return (
        <OrgCreateScreen
          client={client}
          onCreated={() => {
            setCreatingFirstOrg(false)
            reload()
          }}
          onCancel={() => setCreatingFirstOrg(false)}
        />
      )
    }
    return (
      <RoleOnboarding
        client={client}
        userId={userId}
        onStudentRegistered={reload}
        onCreateOrganization={() => setCreatingFirstOrg(true)}
      />
    )
  }

  return (
    <AuthenticatedShell
      client={client}
      userId={userId}
      account={account}
      reloadAccount={reload}
      signOut={signOut}
    />
  )
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="auth-main auth-main--center">
      <p className="auth-text" role="status">
        {label}
      </p>
    </main>
  )
}
