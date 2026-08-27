import { useScreenFocus } from '../a11y/useScreenFocus'
import type { EntryIntent } from '../account/contextModel'

type EntryScreenProps = {
  // 入口を選んだ（親がログイン画面へ切り替える）。ここでは何も作成・保存しない
  onSelect: (intent: EntryIntent) => void
}

// 未ログイン時の入口選択（Task 020・D056）。
// - 新入生がCUEの中核利用者のため、視覚上の主導線にする
// - 団体側も独立したカードで示す（小さなテキストリンクにしない）
// - どちらを選んでも同じ大学メール6桁OTPへ合流する。ここでの選択は
//   初期表示のためのUI意図であり、権限・団体・membershipを作らない
// - 「団体担当者として」と表現する（団体共有アカウントを連想させない・D026）
export function EntryScreen({ onSelect }: EntryScreenProps) {
  const headingRef = useScreenFocus<HTMLHeadingElement>('entry')
  return (
    <main className="auth-main">
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        CUEをはじめる
      </h1>

      <section className="auth-card entry-card entry-card--student" aria-label="新入生の方">
        <h2 className="auth-card-title">新入生の方</h2>
        <p className="auth-text">興味に合う団体から、新歓案内を受け取れます。</p>
        <button
          type="button"
          className="button button-primary auth-submit"
          onClick={() => onSelect('student')}
        >
          新入生としてはじめる
        </button>
      </section>

      <section className="auth-card entry-card" aria-label="団体の方はこちら">
        <h2 className="auth-card-title">団体の方はこちら</h2>
        <p className="auth-text">団体情報や新歓案内を登録・管理できます。</p>
        <button
          type="button"
          className="button button-secondary auth-submit"
          onClick={() => onSelect('organization')}
        >
          団体担当者としてはじめる
        </button>
      </section>

      <p className="auth-hint entry-note">
        どちらも個人の大学メールでログインします。新入生と団体担当者を兼任している方は、ログイン後に切り替えられます。
      </p>
    </main>
  )
}
