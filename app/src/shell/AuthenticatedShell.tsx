import { useEffect, useState } from 'react'

import {
  deriveContexts,
  findMembership,
  initialContextForIntent,
  resolveActiveContext,
  type AccountContext,
  type EntryIntent,
  type MyAccount,
} from '../account/contextModel'
import { registerStudentAccount } from '../account/useMyAccount'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { OrgCreateScreen } from '../org/OrgCreateScreen'
import { StudentArea } from '../student/StudentArea'
import { ContextSwitcher } from './ContextSwitcher'
import { OrgHome } from './OrgHome'

type AuthenticatedShellProps = {
  client: CueSupabaseClient
  userId: string
  account: MyAccount
  // Task 020: 入口意図。**初期コンテキストの決定にだけ**使う（D056）。
  // 以後の切替は既存のContextSwitcherが担い、意図は初回表示で消費する
  entryIntent?: EntryIntent | null
  onEntryIntentConsumed?: () => void
  reloadAccount: () => void
  signOut: () => Promise<void>
}

// 認証済みシェル。既存のlocalStorageデモには一切触れない（読み書き・表示とも）。
// コンテキスト切替はUI状態のみで、リロード後は既定コンテキストに戻る
export function AuthenticatedShell({
  client,
  userId,
  account,
  entryIntent = null,
  onEntryIntentConsumed,
  reloadAccount,
  signOut,
}: AuthenticatedShellProps) {
  const contexts = deriveContexts(account)
  // 初期コンテキスト: 入口意図が示す側（サーバーが返したcontextsの中に限る）。
  // 意図なしなら従来どおり resolveActiveContext(contexts, null) と同値
  const [active, setActive] = useState<AccountContext | null>(() =>
    resolveActiveContext(contexts, initialContextForIntent(contexts, entryIntent)),
  )
  // 意図は初回表示で消費する。残したままにすると、唯一の団体を脱退したとき等に
  // ゲートが再成立して登録導線へ追い出される（初期値はinitializerで確定済みのため、
  // ここで消しても初期表示には影響しない）
  useEffect(() => {
    onEntryIntentConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- マウント時に1回だけ
  }, [])
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [addStudentBusy, setAddStudentBusy] = useState(false)
  const [addStudentFailed, setAddStudentFailed] = useState(false)
  // wizard・オファー作成などの集中モード中は、コンテキスト切替と権限追加を隠して
  // 入力中の喪失を防ぐ（Phase 1のRoleSwitcher非表示と同趣旨）
  const [focusMode, setFocusMode] = useState(false)
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
