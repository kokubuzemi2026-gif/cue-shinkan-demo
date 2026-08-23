import { useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { BottomNav, type StudentTab } from './components/BottomNav'
import { getRoleHeading, type DemoRole } from './domain/role'
import type { StudentPreference } from './domain/types'
import { StudentHome } from './features/student/StudentHome'
import { StudentInbox } from './features/student/StudentInbox'
import { studentPreferenceStore } from './storage/preferenceStore'

const CLUB_LEAD =
  '条件の合う新入生へ、新歓イベントの案内をここから届けられるようになります。'

// 設定タブの詳細はTask 004以降で実装する
const SETTINGS_PLACEHOLDER = {
  title: '設定',
  text: '受信の停止・再開や条件の変更は、ホームの興味パスポートからいつでもできます。',
}

function App() {
  const [role, setRole] = useState<DemoRole>('student')
  const [studentTab, setStudentTab] = useState<StudentTab>('home')
  // wizard入力中の集中モード。ロール切替と下部ナビを隠し、
  // 未保存draftの喪失と二重の固定バーを防ぐ（完了・中断で自動復元）
  const [focusMode, setFocusMode] = useState(false)
  // 保存済み興味パスポート。ホーム（登録・編集）と受信箱（評価・停止再開）が
  // 同じ状態を共有するため、Appが1箇所で読み書きする
  const [preference, setPreference] = useState<StudentPreference | null>(() =>
    studentPreferenceStore.load(),
  )
  const isStudent = role === 'student'
  const studentFocus = isStudent && focusMode

  const savePreference = (next: StudentPreference): boolean => {
    const ok = studentPreferenceStore.save(next)
    setPreference(next)
    return ok
  }

  return (
    <div className="app-shell">
      <AppHeader role={role} onRoleChange={setRole} hideRoleSwitcher={studentFocus} />
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
          <>
            <h1 className="page-title">{getRoleHeading(role)}</h1>
            <section className="placeholder-card" aria-label="準備中の画面">
              <span className="placeholder-chip">準備中</span>
              <p className="placeholder-text">{CLUB_LEAD}</p>
            </section>
          </>
        )}
      </main>
      {isStudent && !focusMode && <BottomNav activeTab={studentTab} onSelect={setStudentTab} />}
    </div>
  )
}

export default App
