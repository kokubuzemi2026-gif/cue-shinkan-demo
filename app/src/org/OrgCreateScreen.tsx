import { useState, type FormEvent } from 'react'

import { useScreenFocus } from '../a11y/useScreenFocus'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { createOrganization, orgApiErrorText } from './orgApi'

type OrgCreateScreenProps = {
  client: CueSupabaseClient
  onCreated: (organizationId: string) => void
  onCancel: () => void
}

// 団体作成。サーバーRPC（create_organization）が団体とowner所属を原子的に作成する。
// 作成された団体はpending（審査待ち）で始まり、statusをここから変えることはできない
export function OrgCreateScreen({ client, onCreated, onCancel }: OrgCreateScreenProps) {
  const headingRef = useScreenFocus<HTMLHeadingElement>('org-create')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const nameValid = name.trim().length >= 1 && name.trim().length <= 100

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!nameValid || busy) return
    setBusy(true)
    setErrorText(null)
    try {
      const organizationId = await createOrganization(client, name.trim(), description.trim())
      onCreated(organizationId)
    } catch (error) {
      setBusy(false)
      setErrorText(orgApiErrorText(error))
    }
  }

  return (
    <main className="auth-main">
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        新しい団体を作る
      </h1>
      <section className="auth-card" aria-label="団体情報の入力">
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="field-label" htmlFor="org-name">
            団体名（必須・100文字まで）
          </label>
          <input
            id="org-name"
            className="text-input"
            type="text"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
          <label className="field-label" htmlFor="org-description">
            紹介文（任意・500文字まで）
          </label>
          <textarea
            id="org-description"
            className="text-input text-area"
            maxLength={500}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
          />
          <p className="auth-hint">
            作成するとあなたがオーナーになります。団体は運営の確認が終わるまで「審査待ち」と表示されます。
          </p>
          {errorText !== null && (
            <p className="form-error" role="alert">
              {errorText}
            </p>
          )}
          <button
            type="submit"
            className="button button-primary auth-submit"
            disabled={!nameValid || busy}
          >
            {busy ? '作成しています…' : '団体を作成する'}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            もどる
          </button>
        </form>
      </section>
    </main>
  )
}
