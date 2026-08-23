import { useReducer, useState } from 'react'

import { demoStudent } from '../../data/demoData'
import type { StudentPreference } from '../../domain/types'
import { studentPreferenceStore } from '../../storage/preferenceStore'
import { buildPreference, createDraft, passportReducer } from './passportForm'
import { PassportSummary } from './PassportSummary'
import { PassportWizard } from './PassportWizard'

type PassportView = 'intro' | 'wizard' | 'complete' | 'summary'

const SAVE_FAILED_MESSAGE =
  '端末への保存に失敗しました。入力内容はこの画面では保持されています。'

// 新入生ホーム。興味パスポートの未登録／入力中／完了／登録済みを1タブ内で切り替える。
// localStorageの読み書きはstudentPreferenceStore経由のみ（storage/preferenceStore.ts）。
export function StudentHome() {
  // 読み込みは同期のためローディング状態は不要。破損データはloadがnullへ縮退させる
  const [saved, setSaved] = useState<StudentPreference | null>(() =>
    studentPreferenceStore.load(),
  )
  const [view, setView] = useState<PassportView>(saved ? 'summary' : 'intro')
  // シードは「保存済みの内容、なければメイン学生の初期値」（tasks/003 受入条件）
  const [draft, dispatch] = useReducer(passportReducer, saved ?? demoStudent, createDraft)
  const [saveFailed, setSaveFailed] = useState(false)

  const startWizard = () => {
    dispatch({ type: 'reset', value: createDraft(saved ?? demoStudent) })
    setView('wizard')
  }

  const completeWizard = () => {
    const next = buildPreference(draft, saved ?? demoStudent)
    const ok = studentPreferenceStore.save(next)
    setSaved(next)
    setSaveFailed(!ok)
    setView('complete')
  }

  const cancelWizard = () => {
    setView(saved ? 'summary' : 'intro')
  }

  const togglePaused = () => {
    if (!saved) return
    const next: StudentPreference = {
      ...saved,
      reception: { ...saved.reception, paused: !saved.reception.paused },
    }
    const ok = studentPreferenceStore.save(next)
    setSaved(next)
    setSaveFailed(!ok)
  }

  if (view === 'wizard') {
    return (
      <>
        <h1 className="page-title">興味パスポート</h1>
        <p className="wizard-privacy">名前や顔写真は、団体には公開されません</p>
        <PassportWizard
          draft={draft}
          dispatch={dispatch}
          cancelLabel={saved ? '保存せずにもどる' : 'やめる'}
          onComplete={completeWizard}
          onCancel={cancelWizard}
        />
      </>
    )
  }

  if (view === 'complete' && saved) {
    return (
      <>
        <h1 className="page-title">興味パスポート</h1>
        <section className="complete-card" role="status">
          <span className="complete-check" aria-hidden="true">
            ✓
          </span>
          <h2 className="complete-heading">興味パスポートができました</h2>
          <p className="complete-body">
            あとは、条件の合う団体からの案内を待つだけです。応募もDMもいりません。
          </p>
          {saveFailed && <p className="save-warning">{SAVE_FAILED_MESSAGE}</p>}
          <p className="complete-note">
            内容はこの端末のブラウザにだけ保存されます。名前や顔写真は登録されていません。
          </p>
        </section>
        <PassportSummary preference={saved} />
        <button
          type="button"
          className="button button-primary"
          onClick={() => setView('summary')}
        >
          ホームへもどる
        </button>
      </>
    )
  }

  if (view === 'summary' && saved) {
    return (
      <>
        <h1 className="page-title">新入生ホーム</h1>
        {saveFailed && <p className="save-warning">{SAVE_FAILED_MESSAGE}</p>}
        <PassportSummary preference={saved} onEdit={startWizard} onTogglePaused={togglePaused} />
        <section className="placeholder-card" aria-label="次のステップ">
          <span className="placeholder-chip">次のステップ</span>
          <p className="placeholder-text">
            条件の合う新歓オファーが「受信箱」に届く予定です。
          </p>
        </section>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">新入生ホーム</h1>
      <section className="hero-card" aria-label="興味パスポートの案内">
        <span className="hero-chip">はじめの60秒</span>
        <h2 className="hero-heading">探さなくても、あなたに合う新歓が届く</h2>
        <p className="hero-body">
          興味や参加しやすい条件を登録すると、条件の合う部活・サークルの方から新歓イベントの案内が届きます。自分から応募したり、DMを送ったりする必要はありません。
        </p>
        <ul className="hero-points">
          <li>名前や顔写真は、団体には公開されません</li>
          <li>届くのは、あなたが受け取ると決めたカテゴリだけ</li>
          <li>受信はいつでも停止・再開できます</li>
        </ul>
        <button type="button" className="button button-primary" onClick={startWizard}>
          興味パスポートをつくる
        </button>
        <p className="hero-note">タップだけ・約60秒で完了します</p>
      </section>
    </>
  )
}
