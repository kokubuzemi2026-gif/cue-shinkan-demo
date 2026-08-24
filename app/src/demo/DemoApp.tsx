// Phase 1のlocalStorageデモ本体（旧src/App.tsx。Task 008で隔離）。
// localStorageがユーザーIDで分離されていないため、認証済みシェル（src/AppRoot.tsx）からは
// importしない・マウントしない。公開デモはmainブランチ（GitHub Pages）が正本。
// Task 009でここの機能をサーバーデータへ接続し直す
import { useEffect, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { BottomNav, type StudentTab } from '../components/BottomNav'
import { DemoResetDialog } from '../components/DemoResetDialog'
import { demoStudent } from '../data/demoData'
import { buildSeedDeliveries } from '../data/demoDeliverySeed'
import { anonymousStudentPool } from '../data/demoStudentPool'
import { buildDelivery } from '../domain/delivery'
import type { DemoRole } from '../domain/role'
import type { ClubOffer, OfferDelivery, StudentPreference } from '../domain/types'
import { ClubHome } from '../features/club/ClubHome'
import {
  arrivalEventForDelivery,
  nextArrivalState,
  type ArrivalEvent,
  type ArrivalState,
} from '../features/student/arrival'
import {
  appendDelivery,
  CLUB_WEEKLY_CAMPAIGN_LIMIT,
  clubSentInWindow,
  findDuplicateEvent,
  previewAudience,
  toAudienceSummary,
  type AudienceSummary,
  type CommitOutcome,
} from '../features/club/delivery'
import { StudentHome } from '../features/student/StudentHome'
import { StudentInbox } from '../features/student/StudentInbox'
import { offerDeliveryStore } from '../storage/deliveryStore'
import {
  getSessionStorageSafe,
  markResetCompleted,
  resetDemoStorageDefault,
  type DemoResetResult,
} from '../storage/demoReset'
import { studentPreferenceStore } from '../storage/preferenceStore'

type DemoAppProps = {
  // main.tsxがcreateRootより前に1回だけ消費したリセット完了フラグ（StrictMode安全）。
  // Appはこの純粋なpropから完了通知とscrollTo(0,0)を行う
  initialResetCompleted: boolean
}

function DemoApp({ initialResetCompleted }: DemoAppProps) {
  const [role, setRole] = useState<DemoRole>('student')
  const [studentTab, setStudentTab] = useState<StudentTab>('home')
  // 入力中の集中モード（学生wizardと団体compose/confirmで共用）。ロール切替と
  // 下部ナビを隠し、未保存draftの喪失と二重の固定バーを防ぐ。
  // 各ツリーが完了・中断・アンマウントの全経路で解除する
  const [focusMode, setFocusMode] = useState(false)
  // 保存済み興味パスポート。ホーム（登録・編集）と受信箱（停止再開）が
  // 同じ状態を共有するため、Appが1箇所で読み書きする
  const [preference, setPreference] = useState<StudentPreference | null>(() =>
    studentPreferenceStore.load(),
  )
  // 配信イベント正本（D023）。学生受信箱と団体ダッシュボードが同じ状態を読むため
  // Appが持ち上げる。store未保存・破損時はcanonicalシードで再構築する
  const [deliveries, setDeliveries] = useState<OfferDelivery[]>(
    () => offerDeliveryStore.load() ?? buildSeedDeliveries(),
  )
  // 送信確定の再判定は常に最新の配信一覧へ行う（ボタン連打時のstale state対策）
  const deliveriesRef = useRef(deliveries)
  deliveriesRef.current = deliveries

  // 初回起動（store未保存または破損）のときだけシードを1回保存する。
  // シードは引数なしの決定的生成のため、StrictModeの二重実行でも内容は同一で冪等
  useEffect(() => {
    if (offerDeliveryStore.load() === null) {
      offerDeliveryStore.save(buildSeedDeliveries())
    }
  }, [])

  // ---- デモリセット（tasks/006） ----
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<Extract<DemoResetResult, { ok: false }> | null>(
    null,
  )
  // リセット完了通知はmain.tsxで消費済みのpropから初期化（renderでの再消費なし）
  const [showResetNotice, setShowResetNotice] = useState(initialResetCompleted)

  // scroll restorationはmanualだが、リセット直後の先頭表示を明示的にも保証する
  useEffect(() => {
    if (initialResetCompleted) {
      window.scrollTo(0, 0)
    }
  }, [initialResetCompleted])

  // ---- 到着状態（tasks/006・非永続） ----
  // 対象は「最後に実際にメイン学生へ届いた」配信1件。reloadで消滅し偽の新着は出ない
  const [arrival, setArrival] = useState<ArrivalState>(null)
  const sendArrival = (event: ArrivalEvent) => {
    setArrival((state) => nextArrivalState(state, event))
  }

  const openResetDialog = () => {
    setResetError(null)
    setResetDialogOpen(true)
  }

  const cancelResetDialog = () => {
    if (resetBusy) return
    setResetDialogOpen(false)
    setResetError(null)
  }

  const runDemoReset = () => {
    if (resetBusy) return
    setResetError(null)
    setResetBusy(true)
    // busy表示（「初期状態に戻しています…」）を最低1フレーム描画してから、
    // 同期のstorage操作を開始する（rAF×2で描画境界を跨ぐ）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const result = resetDemoStorageDefault()
        if (result.ok) {
          markResetCompleted(getSessionStorageSafe())
          window.location.reload()
          return
        }
        setResetBusy(false)
        setResetError(result)
      })
    })
  }

  const isStudent = role === 'student'

  const savePreference = (next: StudentPreference): boolean => {
    const ok = studentPreferenceStore.save(next)
    setPreference(next)
    return ok
  }

  // 配信判定の母集団: 現在のメイン学生（未保存時はcanonical）＋匿名プールの20人（D024）
  const audienceStudents = (): StudentPreference[] => [
    preference ?? demoStudent,
    ...anonymousStudentPool,
  ]

  // 団体UIへは匿名の人数3値だけを返す（受信者snapshotをAppの外へ出さない）
  const summarizeAudience = (offer: ClubOffer): AudienceSummary =>
    toAudienceSummary(
      previewAudience(audienceStudents(), offer, deliveriesRef.current, new Date().toISOString()),
    )

  // 送信確定。同一イベント・週3枠・配信0人はここで再判定し、該当時はstoreを一切
  // 書き換えない。永続化はdeliveryStore.saveの1回だけで、部分保存状態を作らない。
  // 保存失敗時はメモリ上の配信として継続し、UI側が失敗とリロード消失の可能性を明示する
  const commitDelivery = (offer: ClubOffer): CommitOutcome => {
    const current = deliveriesRef.current
    const nowIso = new Date().toISOString()
    if (findDuplicateEvent(current, offer) !== null) {
      return { kind: 'duplicate' }
    }
    if (clubSentInWindow(current, offer.clubId, nowIso) >= CLUB_WEEKLY_CAMPAIGN_LIMIT) {
      return { kind: 'limit-reached' }
    }
    const evaluation = previewAudience(audienceStudents(), offer, current, nowIso)
    if (evaluation.recipients.length === 0) {
      return { kind: 'no-recipients' }
    }
    const delivery = buildDelivery(offer, evaluation.recipients, nowIso)
    const next = appendDelivery(current, delivery)
    if (next === current) {
      return { kind: 'duplicate' }
    }
    deliveriesRef.current = next
    setDeliveries(next)
    const saved = offerDeliveryStore.save(next)
    // 到着状態は、この配信のrecipientsにメイン学生が実際に含まれるときだけ更新する
    // （停止・不許可・週上限・score不足で届かない送信では偽の新着を出さない）。
    // 保存失敗時もメモリ上の配信は受信箱へ表示されるため演出対象になる
    const arrivalEvent = arrivalEventForDelivery(delivery, (preference ?? demoStudent).id)
    if (arrivalEvent !== null) {
      sendArrival(arrivalEvent)
    }
    return { kind: saved ? 'sent' : 'sent-save-failed', summary: toAudienceSummary(evaluation) }
  }

  // 送信完了画面の主CTA: 学生ロールの受信箱タブをページ先頭で開く（新着未読が先頭）
  const openStudentInbox = () => {
    setShowResetNotice(false)
    setRole('student')
    setStudentTab('inbox')
    window.scrollTo(0, 0)
  }

  // タブ・ロール切替のラッパ。リセット完了通知は最初の移動で片づけ、
  // 受信箱から離れたら到着状態を消費する（hidden→再表示でのアニメ再発火防止）
  const changeStudentTab = (tab: StudentTab) => {
    if (tab !== 'home') setShowResetNotice(false)
    if (studentTab === 'inbox' && tab !== 'inbox') sendArrival({ type: 'leftInbox' })
    setStudentTab(tab)
  }
  const changeRole = (next: DemoRole) => {
    if (next !== 'student') setShowResetNotice(false)
    if (next !== 'student' && studentTab === 'inbox') sendArrival({ type: 'leftInbox' })
    setRole(next)
  }

  return (
    <div className="app-shell">
      <AppHeader
        role={role}
        onRoleChange={changeRole}
        hideRoleSwitcher={focusMode}
        onOpenDemoReset={openResetDialog}
      />
      <main className={isStudent ? 'app-main app-main--with-nav' : 'app-main'}>
        {isStudent && showResetNotice && studentTab === 'home' && (
          <p className="reset-complete-notice" role="status">
            デモを初期状態に戻しました
          </p>
        )}
        {isStudent ? (
          <>
            {/* ホーム・受信箱はhiddenで保持し、タブ往復でも入力中draftや詳細位置が消えないようにする */}
            <div className="student-tab-panel" hidden={studentTab !== 'home'}>
              <StudentHome
                preference={preference}
                savePreference={savePreference}
                onFocusModeChange={setFocusMode}
              />
            </div>
            <div className="student-tab-panel" hidden={studentTab !== 'inbox'}>
              <StudentInbox
                preference={preference}
                deliveries={deliveries}
                arrival={arrival}
                onArrivalEvent={sendArrival}
                savePreference={savePreference}
                onNavigateHome={() => changeStudentTab('home')}
              />
            </div>
            {studentTab === 'settings' && (
              <>
                <h1 className="page-title">設定</h1>
                <section className="placeholder-card" aria-label="受信設定の案内">
                  <p className="placeholder-text">
                    受信の停止・再開や条件の変更は、ホームの興味パスポートからいつでもできます。
                  </p>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => changeStudentTab('home')}
                  >
                    ホームで条件を変更する
                  </button>
                </section>
              </>
            )}
          </>
        ) : (
          <ClubHome
            deliveries={deliveries}
            summarizeAudience={summarizeAudience}
            commitDelivery={commitDelivery}
            onFocusModeChange={setFocusMode}
            openStudentInbox={openStudentInbox}
          />
        )}
      </main>
      {isStudent && !focusMode && (
        <BottomNav activeTab={studentTab} onSelect={changeStudentTab} />
      )}
      <DemoResetDialog
        open={resetDialogOpen}
        busy={resetBusy}
        error={resetError}
        onCancel={cancelResetDialog}
        onConfirm={runDemoReset}
      />
    </div>
  )
}

export default DemoApp
