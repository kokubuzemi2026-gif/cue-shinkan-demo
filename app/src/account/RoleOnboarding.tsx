import { useState } from 'react'

import { useScreenFocus } from '../a11y/useScreenFocus'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import type { EntryIntent } from './contextModel'
import { registerStudentAccount } from './useMyAccount'

type RoleOnboardingProps = {
  client: CueSupabaseClient
  userId: string
  // 新入生登録が完了した（親がアカウントを再読込する）
  onStudentRegistered: () => void
  // 「団体を作る」を選んだ（親が団体作成画面へ切り替える）
  onCreateOrganization: () => void
  // Task 020: 選んだ入口に応じて表示を絞る。undefinedなら従来の全選択肢。
  // ここでの絞り込みはUI表示のみで、登録は各ボタンの明示操作でしか起きない
  focus?: EntryIntent
  // 絞り込み表示から全選択肢へ戻す（権限ゼロの利用者にだけ渡す）
  onShowAll?: () => void
  // 登録せずに既存の権限で先へ進む（他方の権限を持つ利用者にだけ渡す）
  onSkip?: () => void
  skipLabel?: string
}

// 初回権限登録。権限ゼロのユーザーに「新入生 / 団体担当者 / 招待で参加」の入口を示す。
// ここでの選択は排他ではなく、後から他方の権限も追加できる
export function RoleOnboarding({
  client,
  userId,
  onStudentRegistered,
  onCreateOrganization,
  focus,
  onShowAll,
  onSkip,
  skipLabel,
}: RoleOnboardingProps) {
  const headingRef = useScreenFocus<HTMLHeadingElement>(focus ?? 'onboarding')
  const [busy, setBusy] = useState(false)
  const [registerFailed, setRegisterFailed] = useState(false)

  const handleRegisterStudent = async () => {
    if (busy) return
    setBusy(true)
    setRegisterFailed(false)
    const ok = await registerStudentAccount(client, userId)
    if (ok) {
      onStudentRegistered()
      return
    }
    setBusy(false)
    setRegisterFailed(true)
  }

  const heading =
    focus === 'student'
      ? '新入生としてはじめる'
      : focus === 'organization'
        ? '団体担当者としてはじめる'
        : '利用方法を選ぶ'
  const showStudentCard = focus === undefined || focus === 'student'
  const showOrgCards = focus === undefined || focus === 'organization'

  return (
    <main className="auth-main">
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        {heading}
      </h1>
      <p className="auth-text">
        {focus === undefined
          ? 'あとから別の権限を追加することもできます（新入生と団体担当者の兼任も可能です）。'
          : 'ここで登録するまで、権限や団体は作られません。あとから別の権限を追加することもできます。'}
      </p>

      {showStudentCard && (
        <section className="auth-card" aria-label="新入生として使う">
          <h2 className="auth-card-title">新入生として使う</h2>
          <p className="auth-text">
            興味に合う団体からの新歓案内を受け取る側として登録します。氏名や学籍番号の入力は不要です。
          </p>
          {registerFailed && (
            <p className="form-error" role="alert">
              登録に失敗しました。時間をおいて再度お試しください。
            </p>
          )}
          <button
            type="button"
            className="button button-primary auth-submit"
            onClick={() => void handleRegisterStudent()}
            disabled={busy}
          >
            {busy ? '登録しています…' : '新入生として登録する'}
          </button>
        </section>
      )}

      {showOrgCards && (
        <>
          <section className="auth-card" aria-label="団体の担当者として使う">
            <h2 className="auth-card-title">団体の担当者として使う</h2>
            <p className="auth-text">
              新しく団体を登録します。作成した団体は運営の確認が終わるまで「審査待ち」になります。
            </p>
            <button
              type="button"
              className={`button ${focus === 'organization' ? 'button-primary' : 'button-secondary'} auth-submit`}
              onClick={onCreateOrganization}
              disabled={busy}
            >
              新しい団体を作る
            </button>
          </section>

          <section className="auth-card" aria-label="招待リンクで参加する">
            <h2 className="auth-card-title">招待リンクで団体に参加する</h2>
            <p className="auth-text">
              既存団体の担当者から受け取った招待リンクを、この端末のブラウザで開いてください。参加確認の画面が表示されます。
            </p>
          </section>
        </>
      )}

      {(onSkip !== undefined || (focus !== undefined && onShowAll !== undefined)) && (
        <div className="auth-subactions">
          {onSkip !== undefined && (
            <button
              type="button"
              className="button button-secondary"
              onClick={onSkip}
              disabled={busy}
            >
              {skipLabel ?? '登録せずに進む'}
            </button>
          )}
          {focus !== undefined && onShowAll !== undefined && (
            <button
              type="button"
              className="button button-ghost"
              onClick={onShowAll}
              disabled={busy}
            >
              他の利用方法を見る
            </button>
          )}
        </div>
      )}
    </main>
  )
}
