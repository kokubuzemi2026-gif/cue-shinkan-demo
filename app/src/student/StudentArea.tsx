import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import '../styles/passport.css'
import '../styles/inbox.css'

import type { ResponseChoice, StudentPreference } from '../domain/types'
import { deriveOfferStatus, type InboxItem } from '../features/student/inbox'
import { OfferCard } from '../features/student/OfferCard'
import { PassportSummary } from '../features/student/PassportSummary'
import { PassportWizard } from '../features/student/PassportWizard'
import {
  buildPreference,
  createDraft,
  passportReducer,
  withReceptionPaused,
  type PassportAction,
  type PassportDraft,
} from '../features/student/passportForm'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { serverErrorMessage } from '../serverdata/apiText'
import { fetchMyInbox, markOfferRead, respondToOffer } from '../serverdata/inboxApi'
import {
  fetchMyPassport,
  saveMyPassport,
  SELF_DISPLAY_NAME,
  SELF_STUDENT_ID,
} from '../serverdata/passportApi'
import { getDefaultStorage } from '../storage/appStorage'
import { planDemoMigration, runDemoMigration } from './demoMigration'
import { NotificationSettings } from './NotificationSettings'
import { ServerOfferDetail } from './ServerOfferDetail'

type StudentAreaProps = {
  client: CueSupabaseClient
  // wizard中は親シェルがコンテキスト切替・権限追加を隠す（集中モード）
  onFocusModeChange: (active: boolean) => void
}

type PassportState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; preference: StudentPreference | null }

type InboxState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: InboxItem[] }

type StudentTab = 'home' | 'inbox' | 'settings'

// 通知メールは受信箱・通知設定へのリンクを載せる（docs/notifications.md §6）。
// 起動時に一度だけhashを読んでタブを決め、直ちにURLから取り除く
// （招待トークンと同じ扱い。以後のアプリ内操作をhashが上書きしない）
function initialTabFromHash(): StudentTab {
  if (typeof window === 'undefined') return 'home'
  const hash = window.location.hash
  const tab: StudentTab = hash === '#notifications' ? 'settings' : hash === '#inbox' ? 'inbox' : 'home'
  if (tab !== 'home') {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return tab
}
type HomeView = 'intro' | 'wizard' | 'complete' | 'summary'

// 未登録から始めるときの空draft。デモデータ（demoStudent）は持ち込まない
function createBlankDraft(): PassportDraft {
  return {
    interests: [],
    purposes: [],
    style: 'moderate',
    frequency: 'monthly_1_2',
    availableDays: [],
    experience: 'none',
    maxFeePerEventYen: 2000,
    receptionPaused: false,
    allowedCategories: [],
    weeklyLimit: 3,
  }
}

// buildPreferenceのbase（id・displayNameの供給元）。値はサーバーへ送られない自己表示値
const SELF_BASE: StudentPreference = {
  id: SELF_STUDENT_ID,
  displayName: SELF_DISPLAY_NAME,
  interests: [],
  purposes: [],
  style: 'moderate',
  frequency: 'monthly_1_2',
  availableDays: [],
  experience: 'none',
  maxFeePerEventYen: 2000,
  reception: { paused: false, allowedCategories: [], weeklyLimit: 3 },
}

const GENERIC_LOAD_ERROR = '読み込みに失敗しました。通信環境を確認して再試行してください。'

// 認証済みの新入生ホーム+受信箱。データの正本はすべてSupabase（Task 009）。
// - 取得済みコンテキストは再取得中も保持し、失敗時はエラー表示+再試行を出す
// - 旧デモ（cue-demo:*）の興味パスポートは初回に一度だけ検証付きで持ち込み、キーを削除する
export function StudentArea({ client, onFocusModeChange }: StudentAreaProps) {
  const [tab, setTab] = useState<StudentTab>(initialTabFromHash)
  const [passport, setPassport] = useState<PassportState>({ status: 'loading' })
  const [inbox, setInbox] = useState<InboxState>({ status: 'loading' })
  const [homeView, setHomeView] = useState<HomeView>('summary')
  const [draft, dispatch] = useReducer(passportReducer, undefined, createBlankDraft)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [migrationNotice, setMigrationNotice] = useState(false)
  const [resumeNotice, setResumeNotice] = useState(false)
  const [readSaveFailed, setReadSaveFailed] = useState(false)
  const [respondError, setRespondError] = useState<string | null>(null)
  const [responding, setResponding] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [passportReloadCount, setPassportReloadCount] = useState(0)
  const [inboxReloadCount, setInboxReloadCount] = useState(0)
  const migrationDoneRef = useRef(false)

  // ---- パスポートの取得（再取得中は表示中の内容を保持する） ----
  useEffect(() => {
    let active = true
    setPassport((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }))
    void (async () => {
      try {
        const preference = await fetchMyPassport(client)
        if (!active) return
        setPassport({ status: 'ready', preference })
        setHomeView((view) => (view === 'wizard' ? view : preference === null ? 'intro' : 'summary'))
      } catch {
        if (!active) return
        setPassport((previous) => (previous.status === 'ready' ? previous : { status: 'error' }))
      }
    })()
    return () => {
      active = false
    }
  }, [client, passportReloadCount])

  // ---- 受信箱の取得（再取得中は表示中の内容を保持する） ----
  useEffect(() => {
    let active = true
    setInbox((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }))
    void (async () => {
      try {
        const items = await fetchMyInbox(client)
        if (!active) return
        setInbox({ status: 'ready', items })
      } catch {
        if (!active) return
        setInbox((previous) => (previous.status === 'ready' ? previous : { status: 'error' }))
      }
    })()
    return () => {
      active = false
    }
  }, [client, inboxReloadCount])

  // ---- 旧デモデータの一回限り移行（サーバー状態が確定してから1回だけ） ----
  useEffect(() => {
    if (migrationDoneRef.current || passport.status !== 'ready') return
    migrationDoneRef.current = true
    const storage = getDefaultStorage()
    const plan = planDemoMigration(storage)
    if (plan.kind === 'none') return
    void (async () => {
      const outcome = await runDemoMigration(
        storage,
        passport.preference !== null,
        async (preference) => {
          try {
            await saveMyPassport(client, preference)
            return true
          } catch {
            return false
          }
        },
      )
      if (outcome === 'imported' && plan.kind === 'import') {
        setPassport({ status: 'ready', preference: plan.preference })
        setHomeView('summary')
        setMigrationNotice(true)
      }
    })()
  }, [client, passport])

  const savePreference = useCallback(
    async (next: StudentPreference): Promise<boolean> => {
      try {
        await saveMyPassport(client, next)
        setPassport({ status: 'ready', preference: next })
        setSaveError(null)
        return true
      } catch (error) {
        setSaveError(serverErrorMessage(error))
        return false
      }
    },
    [client],
  )

  const saved = passport.status === 'ready' ? passport.preference : null

  // ---- パスポートwizard ----
  const startWizard = () => {
    // 下書きの生成元は「保存済みの内容、なければ空draft」。デモデータは使わない
    dispatch({
      type: 'reset',
      value: saved !== null ? createDraft(saved) : createBlankDraft(),
    })
    setResumeNotice(false)
    setMigrationNotice(false)
    setHomeView('wizard')
  }

  const completeWizard = () => {
    const next = buildPreference(draft, saved ?? SELF_BASE)
    void (async () => {
      const ok = await savePreference(next)
      setHomeView(ok ? 'complete' : 'wizard')
    })()
  }

  const togglePaused = () => {
    if (saved === null) return
    const next = withReceptionPaused(saved, !saved.reception.paused)
    void (async () => {
      const ok = await savePreference(next)
      setResumeNotice(ok && !next.reception.paused)
    })()
  }

  // ---- 受信箱の操作 ----
  const items = inbox.status === 'ready' ? inbox.items : []
  const selected = selectedId === null ? undefined : items.find((item) => item.offer.id === selectedId)

  const openDetail = (deliveryId: string) => {
    setRespondError(null)
    setSelectedId(deliveryId)
    // 開封=既読の保存。表示は先に更新し、サーバー保存失敗は注意表示のみ（返答には影響しない）
    setInbox((previous) => {
      if (previous.status !== 'ready') return previous
      return {
        status: 'ready',
        items: previous.items.map((item) =>
          item.offer.id === deliveryId && !item.read
            ? { ...item, read: true, status: deriveOfferStatus(true, item.response) }
            : item,
        ),
      }
    })
    void markOfferRead(client, deliveryId)
      .then(() => setReadSaveFailed(false))
      .catch(() => setReadSaveFailed(true))
  }

  const respond = (deliveryId: string, choice: ResponseChoice) => {
    if (responding) return
    setResponding(true)
    setRespondError(null)
    void (async () => {
      try {
        await respondToOffer(client, deliveryId, choice)
        setInbox((previous) => {
          if (previous.status !== 'ready') return previous
          return {
            status: 'ready',
            items: previous.items.map((item) => {
              if (item.offer.id !== deliveryId) return item
              const response = {
                offerId: deliveryId,
                studentId: SELF_STUDENT_ID,
                choice,
                respondedAt: new Date().toISOString(),
              }
              return { ...item, response, status: deriveOfferStatus(item.read, response) }
            }),
          }
        })
        // 公式窓口は「行ってみたい」の後にサーバーが開示するため（D033）、
        // 返答後に受信箱を取り直して開示された値を反映する。
        // 表示中の内容は保持したまま再取得するので、返答直後の見た目は変わらない
        setInboxReloadCount((count) => count + 1)
      } catch (error) {
        setRespondError(serverErrorMessage(error))
      } finally {
        setResponding(false)
      }
    })()
  }

  const resumeReception = () => {
    if (saved === null || saved.reception.paused === false) return
    togglePaused()
  }

  const switchTab = (next: StudentTab) => {
    setTab(next)
    setSelectedId(null)
    setRespondError(null)
    if (next === 'inbox') {
      // 受信箱を開くたびに最新化する（表示中の内容は保持したまま再取得）
      setInboxReloadCount((count) => count + 1)
    }
  }

  // wizard中はタブを隠し、入力へ集中させる（Phase 1の集中モードと同趣旨）
  const focusMode = tab === 'home' && homeView === 'wizard'

  useEffect(() => {
    onFocusModeChange(focusMode)
  }, [focusMode, onFocusModeChange])
  useEffect(() => () => onFocusModeChange(false), [onFocusModeChange])

  return (
    <>
      {!focusMode && (
        <nav className="context-switcher" aria-label="新入生メニュー">
          <button
            type="button"
            className="context-switcher-button"
            aria-pressed={tab === 'home'}
            onClick={() => switchTab('home')}
          >
            ホーム
          </button>
          <button
            type="button"
            className="context-switcher-button"
            aria-pressed={tab === 'inbox'}
            onClick={() => switchTab('inbox')}
          >
            受信箱
          </button>
          <button
            type="button"
            className="context-switcher-button"
            aria-pressed={tab === 'settings'}
            onClick={() => switchTab('settings')}
          >
            通知設定
          </button>
        </nav>
      )}

      {tab === 'home' && (
        <HomePanel
          passport={passport}
          homeView={homeView}
          draft={draft}
          dispatch={dispatch}
          saveError={saveError}
          migrationNotice={migrationNotice}
          resumeNotice={resumeNotice}
          onRetryLoad={() => setPassportReloadCount((count) => count + 1)}
          onStartWizard={startWizard}
          onCompleteWizard={completeWizard}
          onCancelWizard={() => setHomeView(saved === null ? 'intro' : 'summary')}
          onBackToSummary={() => setHomeView('summary')}
          onTogglePaused={togglePaused}
          onOpenInbox={() => switchTab('inbox')}
        />
      )}

      {tab === 'settings' && <NotificationSettings client={client} />}

      {tab === 'inbox' &&
        (selected !== undefined ? (
          <ServerOfferDetail
            item={selected}
            responding={responding}
            respondError={respondError}
            onBack={() => setSelectedId(null)}
            onRespond={(choice) => respond(selected.offer.id, choice)}
          />
        ) : (
          <InboxPanel
            inbox={inbox}
            paused={saved?.reception.paused ?? false}
            readSaveFailed={readSaveFailed}
            onRetryLoad={() => setInboxReloadCount((count) => count + 1)}
            onOpen={openDetail}
            onResume={resumeReception}
            onNavigateHome={() => switchTab('home')}
          />
        ))}
    </>
  )
}

function HomePanel({
  passport,
  homeView,
  draft,
  dispatch,
  saveError,
  migrationNotice,
  resumeNotice,
  onRetryLoad,
  onStartWizard,
  onCompleteWizard,
  onCancelWizard,
  onBackToSummary,
  onTogglePaused,
  onOpenInbox,
}: {
  passport: PassportState
  homeView: HomeView
  draft: PassportDraft
  dispatch: (action: PassportAction) => void
  saveError: string | null
  migrationNotice: boolean
  resumeNotice: boolean
  onRetryLoad: () => void
  onStartWizard: () => void
  onCompleteWizard: () => void
  onCancelWizard: () => void
  onBackToSummary: () => void
  onTogglePaused: () => void
  onOpenInbox: () => void
}) {
  if (passport.status === 'loading') {
    return (
      <section className="placeholder-card" aria-label="読み込み中">
        <p className="placeholder-text">興味パスポートを読み込んでいます…</p>
      </section>
    )
  }

  if (passport.status === 'error') {
    return (
      <section className="auth-card" aria-label="再試行の案内">
        <h1 className="page-title">新入生ホーム</h1>
        <p className="auth-text">{GENERIC_LOAD_ERROR}</p>
        <button type="button" className="button button-primary" onClick={onRetryLoad}>
          再試行
        </button>
      </section>
    )
  }

  const saved = passport.preference

  if (homeView === 'wizard') {
    return (
      <>
        <h1 className="page-title">興味パスポート</h1>
        <p className="wizard-privacy">名前や顔写真は、団体には公開されません</p>
        {saveError !== null && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
        <PassportWizard
          draft={draft}
          dispatch={dispatch}
          onComplete={onCompleteWizard}
          onCancel={onCancelWizard}
        />
      </>
    )
  }

  if (homeView === 'complete' && saved !== null) {
    return (
      <>
        <h1 className="page-title">興味パスポート</h1>
        <section className="complete-card" role="status">
          <span className="complete-check" aria-hidden="true">
            ✓
          </span>
          <h2 className="complete-heading">興味パスポートを保存しました</h2>
          <p className="complete-body">
            あとは、条件の合う団体から届く案内を待つだけ。応募やDMは必要ありません。
          </p>
          <p className="complete-note">
            内容はあなたのアカウントに保存され、どの端末からでも確認できます。名前や顔写真は登録されません。
          </p>
        </section>
        <PassportSummary preference={saved} />
        <button type="button" className="button button-primary" onClick={onBackToSummary}>
          ホームへもどる
        </button>
      </>
    )
  }

  if (saved !== null) {
    return (
      <>
        <h1 className="page-title">新入生ホーム</h1>
        {migrationNotice && (
          <p role="status" className="auth-notice">
            このブラウザのデモ版に保存されていた興味パスポートをアカウントへ引き継ぎました。内容はいつでも編集できます。
          </p>
        )}
        {saveError !== null && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
        <PassportSummary
          preference={saved}
          onEdit={onStartWizard}
          onTogglePaused={onTogglePaused}
          showResumeNotice={resumeNotice}
        />
        <button type="button" className="button button-secondary" onClick={onOpenInbox}>
          受信箱を開く
        </button>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">新入生ホーム</h1>
      <section className="auth-card" aria-label="興味パスポートの案内">
        <h2 className="auth-card-title">新歓は、探すから届くへ。</h2>
        <p className="auth-text">
          興味や参加しやすい条件を登録すると、条件の合う団体からだけ新歓の案内が届きます。応募や自己紹介文は必要ありません。
        </p>
        {saveError !== null && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
        <button type="button" className="button button-primary" onClick={onStartWizard}>
          興味パスポートをはじめる
        </button>
        <p className="auth-hint">約1分・あとからいつでも変更できます</p>
      </section>
    </>
  )
}

function InboxPanel({
  inbox,
  paused,
  readSaveFailed,
  onRetryLoad,
  onOpen,
  onResume,
  onNavigateHome,
}: {
  inbox: InboxState
  paused: boolean
  readSaveFailed: boolean
  onRetryLoad: () => void
  onOpen: (deliveryId: string) => void
  onResume: () => void
  onNavigateHome: () => void
}) {
  if (inbox.status === 'loading') {
    return (
      <section className="placeholder-card" aria-label="読み込み中">
        <p className="placeholder-text">受信箱を読み込んでいます…</p>
      </section>
    )
  }

  if (inbox.status === 'error') {
    return (
      <section className="auth-card" aria-label="再試行の案内">
        <h1 className="page-title">受信箱</h1>
        <p className="auth-text">{GENERIC_LOAD_ERROR}</p>
        <button type="button" className="button button-primary" onClick={onRetryLoad}>
          再試行
        </button>
      </section>
    )
  }

  return (
    <>
      <h1 className="page-title">受信箱</h1>
      {readSaveFailed && (
        <p className="save-warning">開封状態の保存に失敗しました。表示への影響はありません。</p>
      )}

      {paused && (
        <div className="paused-banner">
          <p>
            オファーの受信を停止しています。停止中は新しい案内が届きません。届いている案内はこのまま見られます。
          </p>
          <button type="button" className="button button-primary" onClick={onResume}>
            オファー受信を再開
          </button>
        </div>
      )}

      {inbox.items.length === 0 ? (
        <section className="placeholder-card" aria-label="オファーなし">
          <span className="placeholder-chip">オファー 0件</span>
          <p className="placeholder-text">
            届いているオファーはまだありません。興味パスポートの条件に合う新歓案内が届くと、ここに表示されます。
          </p>
          <button type="button" className="button button-secondary" onClick={onNavigateHome}>
            条件を見直す
          </button>
        </section>
      ) : (
        <>
          {!paused && <p className="inbox-lead">選んだ条件に合う新歓案内だけが届いています。</p>}
          <ul className="offer-list">
            {inbox.items.map((item) => (
              <li key={item.offer.id}>
                <OfferCard item={item} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
