import { useEffect, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { BottomNav, type StudentTab } from './components/BottomNav'
import { demoStudent } from './data/demoData'
import { buildSeedDeliveries } from './data/demoDeliverySeed'
import { anonymousStudentPool } from './data/demoStudentPool'
import { buildDelivery } from './domain/delivery'
import type { DemoRole } from './domain/role'
import type { ClubOffer, OfferDelivery, StudentPreference } from './domain/types'
import { ClubHome } from './features/club/ClubHome'
import {
  appendDelivery,
  CLUB_WEEKLY_CAMPAIGN_LIMIT,
  clubSentInWindow,
  findDuplicateEvent,
  previewAudience,
  toAudienceSummary,
  type AudienceSummary,
  type CommitOutcome,
} from './features/club/delivery'
import { StudentHome } from './features/student/StudentHome'
import { StudentInbox } from './features/student/StudentInbox'
import { offerDeliveryStore } from './storage/deliveryStore'
import { studentPreferenceStore } from './storage/preferenceStore'

// 設定タブの詳細はTask 006以降で実装する
const SETTINGS_PLACEHOLDER = {
  title: '設定',
  text: '受信の停止・再開や条件の変更は、ホームの興味パスポートからいつでもできます。',
}

function App() {
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
    const next = appendDelivery(current, buildDelivery(offer, evaluation.recipients, nowIso))
    if (next === current) {
      return { kind: 'duplicate' }
    }
    deliveriesRef.current = next
    setDeliveries(next)
    const saved = offerDeliveryStore.save(next)
    return { kind: saved ? 'sent' : 'sent-save-failed', summary: toAudienceSummary(evaluation) }
  }

  // 送信完了画面の主CTA: 学生ロールの受信箱タブをページ先頭で開く（新着未読が先頭）
  const openStudentInbox = () => {
    setRole('student')
    setStudentTab('inbox')
    window.scrollTo(0, 0)
  }

  return (
    <div className="app-shell">
      <AppHeader role={role} onRoleChange={setRole} hideRoleSwitcher={focusMode} />
      <main className={isStudent ? 'app-main app-main--with-nav' : 'app-main'}>
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
                savePreference={savePreference}
                onNavigateHome={() => setStudentTab('home')}
              />
            </div>
            {studentTab === 'settings' && (
              <>
                <h1 className="page-title">{SETTINGS_PLACEHOLDER.title}</h1>
                <section className="placeholder-card" aria-label="準備中の画面">
                  <span className="placeholder-chip">準備中</span>
                  <p className="placeholder-text">{SETTINGS_PLACEHOLDER.text}</p>
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
      {isStudent && !focusMode && <BottomNav activeTab={studentTab} onSelect={setStudentTab} />}
    </div>
  )
}

export default App
