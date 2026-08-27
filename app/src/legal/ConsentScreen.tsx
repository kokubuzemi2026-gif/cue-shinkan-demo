import { useState } from 'react'

import { CONSENT_DOCS_NOTE, CONSENT_INTRO, CONSENT_SUMMARY } from './consentContent'

type ConsentScreenProps = {
  // 画面が提示している版。record時にそのまま渡す（版が食い違うとサーバーが拒否する）
  version: number
  submitting: boolean
  error: string | null
  onAgree: (version: number) => void
}

// 登録前の同意画面（D050）。要点を読ませ、明示的に同意させる。
// 同意しない限り、DB側でパスポート登録・団体作成が拒否される
export function ConsentScreen({ version, submitting, error, onAgree }: ConsentScreenProps) {
  const [checked, setChecked] = useState(false)

  return (
    <section className="consent-screen" aria-label="利用規約とプライバシーの確認">
      <h1 className="page-title">はじめる前に</h1>
      <p className="auth-text">{CONSENT_INTRO}</p>

      <ul className="consent-points">
        {CONSENT_SUMMARY.map((point) => (
          <li key={point.title} className="consent-point">
            <h2 className="consent-point-title">{point.title}</h2>
            <p className="consent-point-body">{point.body}</p>
          </li>
        ))}
      </ul>

      <p className="auth-hint">{CONSENT_DOCS_NOTE}</p>

      <label className="consent-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>利用規約とプライバシーポリシー（ドラフト）に同意します</span>
      </label>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="button button-primary"
        disabled={!checked || submitting}
        onClick={() => onAgree(version)}
      >
        {submitting ? '記録しています…' : '同意して進む'}
      </button>
    </section>
  )
}
