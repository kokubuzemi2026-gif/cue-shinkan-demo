import { useEffect, useState } from 'react'

import { ORG_ROLE_LABELS } from '../account/contextModel'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import {
  acceptInvitation,
  orgApiErrorText,
  previewInvitation,
  type InvitationPreview,
} from './orgApi'

type AcceptInviteScreenProps = {
  client: CueSupabaseClient
  // トークンはメモリ上のprops経由でのみ受け渡す（URL・storage・ログへ出さない）
  token: string
  onAccepted: (organizationId: string) => void
  onDismiss: () => void
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'invalid'; text: string }
  | { status: 'ready'; preview: InvitationPreview }

// 招待の承諾。承諾前にどの団体へどの役割で参加するかを表示し、明示ボタンで確定する
export function AcceptInviteScreen({
  client,
  token,
  onAccepted,
  onDismiss,
}: AcceptInviteScreenProps) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    void previewInvitation(client, token)
      .then((preview) => {
        if (active) setState({ status: 'ready', preview })
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'invalid', text: orgApiErrorText(error) })
      })
    return () => {
      active = false
    }
  }, [client, token])

  const handleAccept = async () => {
    if (busy || state.status !== 'ready') return
    setBusy(true)
    setErrorText(null)
    try {
      const accepted = await acceptInvitation(client, token)
      onAccepted(accepted.organizationId)
    } catch (error) {
      setBusy(false)
      setErrorText(orgApiErrorText(error))
    }
  }

  return (
    <main className="auth-main">
      <h1 className="page-title">団体への招待</h1>
      <section className="auth-card" aria-label="招待の確認">
        {state.status === 'loading' && (
          <p className="auth-text" role="status">
            招待の内容を確認しています…
          </p>
        )}
        {state.status === 'invalid' && (
          <>
            <p className="form-error" role="alert">
              {state.text}
            </p>
            <p className="auth-hint">
              リンクが正しいのに開けない場合は、団体の担当者に新しい招待リンクの作成を依頼してください。
            </p>
            <button type="button" className="button button-secondary" onClick={onDismiss}>
              閉じる
            </button>
          </>
        )}
        {state.status === 'ready' && (
          <>
            <p className="auth-text">次の団体に担当者として参加しますか？</p>
            <p className="invite-org-name">{state.preview.organizationName}</p>
            <p className="auth-hint">
              参加後の役割: {ORG_ROLE_LABELS[state.preview.invitedRole]}。この招待は1回だけ使えます。
            </p>
            {errorText !== null && (
              <p className="form-error" role="alert">
                {errorText}
              </p>
            )}
            <div className="auth-subactions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => void handleAccept()}
                disabled={busy}
              >
                {busy ? '参加しています…' : '参加する'}
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={onDismiss}
                disabled={busy}
              >
                今回はやめておく
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
