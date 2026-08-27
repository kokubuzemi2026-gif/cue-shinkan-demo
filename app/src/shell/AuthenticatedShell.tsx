import { useEffect, useState } from 'react'

import {
  deriveContexts,
  findMembership,
  resolveActiveContext,
  type AccountContext,
  type MyAccount,
} from '../account/contextModel'
import { registerStudentAccount } from '../account/useMyAccount'
import { ConsentScreen } from '../legal/ConsentScreen'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { serverErrorMessage } from '../serverdata/apiText'
import { fetchConsent, recordConsent, type ConsentStatus } from '../serverdata/consentApi'
import { OrgCreateScreen } from '../org/OrgCreateScreen'
import { StudentArea } from '../student/StudentArea'
import { ContextSwitcher } from './ContextSwitcher'
import { OrgHome } from './OrgHome'

type AuthenticatedShellProps = {
  client: CueSupabaseClient
  userId: string
  account: MyAccount
  reloadAccount: () => void
  signOut: () => Promise<void>
}

// 認証済みシェル。既存のlocalStorageデモには一切触れない（読み書き・表示とも）。
// コンテキスト切替はUI状態のみで、リロード後は既定コンテキストに戻る
export function AuthenticatedShell({
  client,
  userId,
  account,
  reloadAccount,
  signOut,
}: AuthenticatedShellProps) {
  const contexts = deriveContexts(account)
  const [active, setActive] = useState<AccountContext | null>(() => resolveActiveContext(contexts, null))
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [addStudentBusy, setAddStudentBusy] = useState(false)
  const [addStudentFailed, setAddStudentFailed] = useState(false)
  // wizard・オファー作成などの集中モード中は、コンテキスト切替と権限追加を隠して
  // 入力中の喪失を防ぐ（Phase 1のRoleSwitcher非表示と同趣旨）
  const [focusMode, setFocusMode] = useState(false)
  // Task 015: 同意（D050）。同意するまで、登録・団体作成はDB側でも拒否される。
  // 画面でも、登録の前に同意を必ず通す
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

  // アカウント再読込（団体追加・脱退など）後に、選択中コンテキストの有効性を再解決する
  useEffect(() => {
    setActive((current) => resolveActiveContext(deriveContexts(account), current))
  }, [account])

  const handleOrgCreated = (organizationId: string) => {
    setCreatingOrg(false)
    reloadAccount()
    setActive({ kind: 'org', organizationId })
  }

  const handleAddStudentRole = async () => {
    if (addStudentBusy) return
    setAddStudentBusy(true)
    setAddStudentFailed(false)
    const ok = await registerStudentAccount(client, userId)
    setAddStudentBusy(false)
    if (ok) {
      reloadAccount()
      setActive({ kind: 'student' })
    } else {
      setAddStudentFailed(true)
    }
  }

  // 同意が必要なら、他の何よりも先に同意画面を出す（登録の前に必ず通す）。
  // 読み込み中・失敗も「無い＝同意済み」と誤解させない
  if (consent === 'loading') {
    return (
      <section className="placeholder-card" aria-label="読み込み中">
        <p className="placeholder-text">確認しています…</p>
      </section>
    )
  }
  if (consent === 'error') {
    return (
      <section className="auth-card" aria-label="再試行の案内">
        <h1 className="page-title">はじめる前に</h1>
        <p className="auth-text">確認情報を読み込めませんでした。通信環境を確認してください。</p>
        <button type="button" className="button button-primary" onClick={loadConsent}>
          再試行
        </button>
      </section>
    )
  }
  if (consent.needsConsent) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header-top">
            <span className="brand">
              CUE<span className="brand-sub">（仮）</span>
            </span>
            <button
              type="button"
              className="button button-ghost signout-button"
              onClick={() => void signOut()}
            >
              ログアウト
            </button>
          </div>
        </header>
        <main className="app-main">
          <ConsentScreen
            version={consent.currentVersion}
            submitting={consentBusy}
            error={consentError}
            onAgree={handleAgree}
          />
        </main>
      </div>
    )
  }

  if (creatingOrg) {
    return (
      <OrgCreateScreen
        client={client}
        onCreated={handleOrgCreated}
        onCancel={() => setCreatingOrg(false)}
      />
    )
  }

  const activeMembership =
    active !== null && active.kind === 'org' ? findMembership(account, active.organizationId) : null

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-top">
          <span className="brand">
            CUE<span className="brand-sub">（仮）</span>
          </span>
          <button
            type="button"
            className="button button-ghost signout-button"
            onClick={() => void signOut()}
          >
            ログアウト
          </button>
        </div>
        {active !== null && !focusMode && (
          <ContextSwitcher
            account={account}
            contexts={contexts}
            active={active}
            onSelect={setActive}
          />
        )}
      </header>
      <main className="app-main">
        {active === null && (
          <section className="placeholder-card" aria-label="権限なしの案内">
            <p className="placeholder-text">利用できる権限がありません。</p>
          </section>
        )}
        {active?.kind === 'student' && (
          <StudentArea
            client={client}
            onFocusModeChange={setFocusMode}
            onAccountChanged={reloadAccount}
          />
        )}
        {active?.kind === 'org' &&
          (activeMembership !== null ? (
            <OrgHome
              client={client}
              membership={activeMembership}
              onAccountChanged={reloadAccount}
              onFocusModeChange={setFocusMode}
            />
          ) : (
            <section className="placeholder-card" aria-label="読み込み中">
              <p className="placeholder-text">団体情報を読み込んでいます…</p>
            </section>
          ))}

        {!focusMode && (
        <section className="auth-card shell-actions" aria-label="権限の追加">
          <h2 className="auth-card-title">権限を追加する</h2>
          {!account.hasStudentAccount && (
            <>
              {addStudentFailed && (
                <p className="form-error" role="alert">
                  登録に失敗しました。時間をおいて再度お試しください。
                </p>
              )}
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void handleAddStudentRole()}
                disabled={addStudentBusy}
              >
                {addStudentBusy ? '登録しています…' : '新入生としても利用する'}
              </button>
            </>
          )}
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setCreatingOrg(true)}
          >
            新しい団体を作る
          </button>
        </section>
        )}
      </main>
    </div>
  )
}
