import { useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { BottomNav } from './components/BottomNav'
import { getRoleHeading, type DemoRole } from './domain/role'

const ROLE_LEADS: Record<DemoRole, string> = {
  student: 'あなたに合う部活・サークルからの新歓案内が、この画面に届く予定です。',
  club: '条件の合う新入生へ、新歓イベントの案内をここから届けられるようになります。',
}

function App() {
  const [role, setRole] = useState<DemoRole>('student')
  const isStudent = role === 'student'

  return (
    <div className="app-shell">
      <AppHeader role={role} onRoleChange={setRole} />
      <main className={isStudent ? 'app-main app-main--with-nav' : 'app-main'}>
        <h1 className="page-title">{getRoleHeading(role)}</h1>
        <section className="placeholder-card" aria-label="準備中の画面">
          <span className="placeholder-chip">準備中</span>
          <p className="placeholder-text">{ROLE_LEADS[role]}</p>
        </section>
      </main>
      {isStudent && <BottomNav />}
    </div>
  )
}

export default App
