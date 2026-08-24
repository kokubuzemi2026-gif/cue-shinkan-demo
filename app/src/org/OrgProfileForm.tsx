import { useState, type FormEvent } from 'react'

import type { CueSupabaseClient } from '../lib/supabaseClient'
import { orgApiErrorText, updateOrganizationProfile } from './orgApi'

type OrgProfileFormProps = {
  client: CueSupabaseClient
  organizationId: string
  initialName: string
  initialDescription: string
  // 保存後に親がアカウント（団体名表示）を再読込する
  onSaved: () => void
}

// 団体名・紹介文の編集。更新はRPC（update_organization_profile）経由のみで、
// statusはこの画面からもRPCからも変更できない（運営専用経路）
export function OrgProfileForm({
  client,
  organizationId,
  initialName,
  initialDescription,
  onSaved,
}: OrgProfileFormProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const nameValid = name.trim().length >= 1 && name.trim().length <= 100

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!nameValid || busy) return
    setBusy(true)
    setErrorText(null)
    setSaved(false)
    try {
      await updateOrganizationProfile(client, organizationId, name.trim(), description.trim())
      setBusy(false)
      setSaved(true)
      onSaved()
    } catch (error) {
      setBusy(false)
      setErrorText(orgApiErrorText(error))
    }
  }

  return (
    <section className="auth-card" aria-label="団体プロフィールの編集">
      <h2 className="auth-card-title">団体プロフィール</h2>
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field-label" htmlFor="org-profile-name">
          団体名（100文字まで）
        </label>
        <input
          id="org-profile-name"
          className="text-input"
          type="text"
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
        <label className="field-label" htmlFor="org-profile-description">
          紹介文（500文字まで）
        </label>
        <textarea
          id="org-profile-description"
          className="text-input text-area"
          maxLength={500}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={busy}
        />
        {errorText !== null && (
          <p className="form-error" role="alert">
            {errorText}
          </p>
        )}
        {saved && (
          <p className="auth-notice" role="status">
            保存しました。
          </p>
        )}
        <button
          type="submit"
          className="button button-secondary auth-submit"
          disabled={!nameValid || busy}
        >
          {busy ? '保存しています…' : '保存する'}
        </button>
      </form>
    </section>
  )
}
