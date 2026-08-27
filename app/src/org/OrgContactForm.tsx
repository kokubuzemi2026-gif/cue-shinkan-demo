import { useEffect, useState, type FormEvent } from 'react'

import type { CueSupabaseClient } from '../lib/supabaseClient'
import { serverErrorMessage } from '../serverdata/apiText'
import { updateOrganizationContact } from '../serverdata/offerApi'

type OrgContactFormProps = {
  client: CueSupabaseClient
  organizationId: string
  // 保存後に親が公式窓口の表示（ダッシュボード）を再読込する
  onSaved: () => void
}

// 団体の公式窓口の編集（owner/adminのみ表示）。
// 「行ってみたい」を選んだ学生にだけ開示される連絡導線で、個人の連絡先は登録しない
// （matching_and_safety.md §6）。更新はRPC（update_organization_contact）経由のみ
export function OrgContactForm({ client, organizationId, onSaved }: OrgContactFormProps) {
  const [label, setLabel] = useState('')
  const [handle, setHandle] = useState('')
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [reloadCount, setReloadCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    setLoadState('loading')
    void (async () => {
      const { data, error } = await client
        .from('organizations')
        .select('contact_label, contact_handle')
        .eq('id', organizationId)
        .maybeSingle()
      if (!active) return
      // 失敗を無言で捨てると、入力欄と保存ボタンがdisabledのまま復帰できなくなる
      if (error !== null || data === null || data === undefined) {
        setLoadState('error')
        return
      }
      setLabel(data.contact_label)
      setHandle(data.contact_handle)
      setLoadState('ready')
    })()
    return () => {
      active = false
    }
  }, [client, organizationId, reloadCount])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setErrorText(null)
    setSaved(false)
    try {
      await updateOrganizationContact(client, organizationId, label.trim(), handle.trim())
      setBusy(false)
      setSaved(true)
      onSaved()
    } catch (error) {
      setBusy(false)
      setErrorText(serverErrorMessage(error))
    }
  }

  if (loadState === 'error') {
    return (
      <section className="auth-card" aria-label="公式窓口の編集">
        <h2 className="auth-card-title">公式窓口</h2>
        <p className="auth-text">
          公式窓口の設定を読み込めませんでした。通信環境を確認して再試行してください。
        </p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setReloadCount((count) => count + 1)}
        >
          再試行
        </button>
      </section>
    )
  }

  return (
    <section className="auth-card" aria-label="公式窓口の編集">
      <h2 className="auth-card-title">公式窓口</h2>
      {loadState === 'loading' && (
        <p className="auth-text" role="status">
          読み込んでいます…
        </p>
      )}
      <p className="auth-text">
        「行ってみたい」を選んだ新入生にだけ表示される、団体の公式アカウントです。個人の連絡先は登録しないでください。
      </p>
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field-label" htmlFor="org-contact-label">
          表示名（例: 公式Instagram・50文字まで）
        </label>
        <input
          id="org-contact-label"
          className="text-input"
          type="text"
          maxLength={50}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          disabled={busy || loadState !== 'ready'}
        />
        <label className="field-label" htmlFor="org-contact-handle">
          アカウント・URL（100文字まで）
        </label>
        <input
          id="org-contact-handle"
          className="text-input"
          type="text"
          maxLength={100}
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          disabled={busy || loadState !== 'ready'}
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
          disabled={busy || loadState !== 'ready'}
        >
          {busy ? '保存しています…' : '保存する'}
        </button>
      </form>
    </section>
  )
}
