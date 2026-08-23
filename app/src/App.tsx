import { useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { BottomNav, type StudentTab } from './components/BottomNav'
import { getRoleHeading, type DemoRole } from './domain/role'
import { StudentHome } from './features/student/StudentHome'

const CLUB_LEAD =
  '条件の合う新入生へ、新歓イベントの案内をここから届けられるようになります。'

// 受信箱はTask 004、設定タブの詳細はTask 004以降で実装する
const STUDENT_TAB_PLACEHOLDERS: Record<
  Exclude<StudentTab, 'home'>,
  { title: string; text: string }
> = {
  inbox: {
    title: '受信箱',
    text: '興味パスポートの条件に合うオファーが、ここに届く予定です。',
  },
  settings: {
    title: '設定',
    text: '受信の停止・再開や条件の変更は、ホームの興味パスポートからいつでもできます。',
  },
}

function App() {
  const [role, setRole] = useState<DemoRole>('student')
  const [studentTab, setStudentTab] = useState<StudentTab>('home')
  const isStudent = role === 'student'

  return (
    <div className="app-shell">
      <AppHeader role={role} onRoleChange={setRole} />
      <main className={isStudent ? 'app-main app-main--with-nav' : 'app-main'}>
        {isStudent ? (
          <>
            {/* ホームはhiddenで保持し、タブを往復しても入力中のwizard draftが消えないようにする */}
            <div className="student-tab-panel" hidden={studentTab !== 'home'}>
              <StudentHome />
            </div>
            {studentTab !== 'home' && (
              <>
                <h1 className="page-title">{STUDENT_TAB_PLACEHOLDERS[studentTab].title}</h1>
                <section className="placeholder-card" aria-label="準備中の画面">
                  <span className="placeholder-chip">準備中</span>
                  <p className="placeholder-text">
                    {STUDENT_TAB_PLACEHOLDERS[studentTab].text}
                  </p>
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
      {isStudent && <BottomNav activeTab={studentTab} onSelect={setStudentTab} />}
    </div>
  )
}

export default App
