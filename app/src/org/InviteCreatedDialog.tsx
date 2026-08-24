import { useState } from 'react'

type InviteCreatedDialogProps = {
  inviteUrl: string
  expiresAt: string
  onClose: () => void
}

function formatExpiry(isoText: string): string {
  const time = Date.parse(isoText)
  if (Number.isNaN(time)) return '7日後'
  return new Date(time).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// 招待リンクの一度きり表示。閉じると生トークンはメモリからも消え、再表示できない
// （DBはハッシュのみ保持のため復元不能。必要なら新しい招待を作る）
export function InviteCreatedDialog({ inviteUrl, expiresAt, onClose }: InviteCreatedDialogProps) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const handleCopy = async () => {
    setCopied(false)
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
    } catch {
      setCopyFailed(true)
    }
  }

  return (
    <section className="auth-card invite-created" aria-label="招待リンクの表示">
      <h2 className="auth-card-title">招待リンクを作成しました</h2>
      <p className="auth-text">
        このリンクは<strong>今だけ</strong>表示されます。閉じると再表示できません（必要なら新しく作成してください）。
      </p>
      <textarea
        className="text-input invite-url"
        readOnly
        rows={3}
        value={inviteUrl}
        onFocus={(event) => event.target.select()}
        aria-label="招待リンクURL"
      />
      <p className="auth-hint">
        有効期限: {formatExpiry(expiresAt)}まで・1回だけ使えます。参加してほしい相手に直接渡してください。
      </p>
      {copied && (
        <p className="auth-notice" role="status">
          コピーしました。
        </p>
      )}
      {copyFailed && (
        <p className="form-error" role="alert">
          コピーできませんでした。上のURLを長押しして選択・コピーしてください。
        </p>
      )}
      <div className="auth-subactions">
        <button type="button" className="button button-primary" onClick={() => void handleCopy()}>
          リンクをコピー
        </button>
        <button type="button" className="button button-secondary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </section>
  )
}
