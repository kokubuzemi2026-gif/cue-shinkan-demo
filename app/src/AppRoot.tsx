import { useEffect, useRef, useState } from 'react'

import { useScreenFocus } from './a11y/useScreenFocus'
import { RoleOnboarding } from './account/RoleOnboarding'
import { ConsentScreen } from './legal/ConsentScreen'
import { serverErrorMessage } from './serverdata/apiText'
import { fetchConsent, recordConsent, type ConsentStatus } from './serverdata/consentApi'
import { useMyAccount } from './account/useMyAccount'
import type { EntryIntent } from './account/contextModel'
import { EntryScreen } from './auth/EntryScreen'
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
  // Task 020: 未ログイン時に選んだ入口（D056）。roleではなくUI意図で、
  // React stateのみに保持する（永続化しない。リロードで入口選択へ戻る）
  const [entryIntent, setEntryIntent] = useState<EntryIntent | null>(null)

  // ログアウト（明示操作・別タブ・セッション失効のいずれでも）で入口意図を破棄し、
  // 次の利用者へ引き継がない。**signedIn -> signedOut の遷移だけ**で破棄する:
  // signedOut中の毎レンダーで消すと、入口を選んだ直後（OTP往復中）に消えてしまう
  const prevStatusRef = useRef(session.status)
  useEffect(() => {
    if (prevStatusRef.current === 'signedIn' && session.status === 'signedOut') {
      setEntryIntent(null)
    }
    prevStatusRef.current = session.status
  }, [session.status])

  if (session.status === 'restoring') {
    return <LoadingScreen label="ログイン状態を確認しています…" />
  }
  if (session.status === 'signedOut') {
    // 招待リンク流入では入口選択を強制しない（既存の 認証 -> 同意 -> 承諾 の順のまま）
    if (inviteToken !== null) {
      return <SignInScreen client={client} hasPendingInvite />
    }
    if (entryIntent === null) {
      return <EntryScreen onSelect={setEntryIntent} />
    }
    return (
      <SignInScreen
        client={client}
        hasPendingInvite={false}
        entryIntent={entryIntent}
        onReselectEntry={() => setEntryIntent(null)}
      />
    )
  }
  return (
    <SignedInApp
      key={session.userId}
      client={client}
      userId={session.userId}
      inviteToken={inviteToken}
      onInviteHandled={() => setInviteToken(null)}
      entryIntent={entryIntent}
      onEntryIntentConsumed={() => setEntryIntent(null)}
      signOut={signOut}
    />
  )
}

function SignedInApp({
  client,
  userId,
  inviteToken,
  onInviteHandled,
  entryIntent,
  onEntryIntentConsumed,
  signOut,
}: {
  client: CueSupabaseClient
  userId: string
  inviteToken: string | null
  onInviteHandled: () => void
  // Task 020: 入口意図。初期表示にだけ使い、認可には使わない（D056）
  entryIntent: EntryIntent | null
  onEntryIntentConsumed: () => void
  signOut: () => Promise<void>
}) {
  const { state, reload } = useMyAccount(client, userId)
  const [creatingFirstOrg, setCreatingFirstOrg] = useState(false)
  // Task 020: 入口で絞った初回登録画面から「他の利用方法を見る」で全選択肢へ戻す
  const [showAllRoles, setShowAllRoles] = useState(false)
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

  // 失敗・利用不可の画面も「画面の切替」なので見出しへフォーカスを移す。
  // 3つは同時に出ないので1つのrefを使い回す
  const blockedScreen =
    state.status === 'error'
      ? 'account-error'
      : state.status === 'loaded' && !state.account.isUniversityUser
        ? 'not-university'
        : consent === 'error'
          ? 'consent-error'
          : 'none'
  const blockedHeadingRef = useScreenFocus<HTMLHeadingElement>(blockedScreen)

  if (state.status === 'loading') {
    return <LoadingScreen label="アカウント情報を読み込んでいます…" />
  }

  if (state.status === 'error') {
    return (
      <main className="auth-main">
        <h1 className="page-title" tabIndex={-1} ref={blockedHeadingRef}>
          読み込みに失敗しました
        </h1>
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
        <h1 className="page-title" tabIndex={-1} ref={blockedHeadingRef}>
          このアカウントでは利用できません
        </h1>
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
        <h1 className="page-title" tabIndex={-1} ref={blockedHeadingRef}>
          はじめる前に
        </h1>
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

  // 団体作成画面（初回登録と入口意図の両方から使う）。
  // 作成後は再読込し、意図ゲートが通ればシェルが第1団体を初期表示する
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

  // Task 020: 入口意図に応じた初期表示（同意・招待ゲートより**後**。D050の順序を守る）。
  // 意図が示す側の権限が無い場合は、逆側の画面を先に出さず登録導線を示す。
  // ここで表示を絞るだけで、権限・団体・membershipは各ボタンの明示操作でしか作られない
  const effectiveIntent = showAllRoles ? null : entryIntent
  if (effectiveIntent === 'student' && !account.hasStudentAccount) {
    return (
      <RoleOnboarding
        client={client}
        userId={userId}
        onStudentRegistered={reload}
        onCreateOrganization={() => setCreatingFirstOrg(true)}
        focus="student"
        onShowAll={hasAnyRole ? undefined : () => setShowAllRoles(true)}
        onSkip={account.memberships.length > 0 ? onEntryIntentConsumed : undefined}
        skipLabel="登録せずに団体画面へ進む"
      />
    )
  }
  if (effectiveIntent === 'organization' && account.memberships.length === 0) {
    return (
      <RoleOnboarding
        client={client}
        userId={userId}
        onStudentRegistered={reload}
        onCreateOrganization={() => setCreatingFirstOrg(true)}
        focus="organization"
        onShowAll={hasAnyRole ? undefined : () => setShowAllRoles(true)}
        onSkip={account.hasStudentAccount ? onEntryIntentConsumed : undefined}
        skipLabel="登録せずに新入生画面へ進む"
      />
    )
  }

  if (!hasAnyRole) {
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
      entryIntent={entryIntent}
      onEntryIntentConsumed={onEntryIntentConsumed}
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
