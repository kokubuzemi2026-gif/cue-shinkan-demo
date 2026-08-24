import { useEffect, useRef } from 'react'
import type { SyntheticEvent, MouseEvent as ReactMouseEvent } from 'react'

import type { DemoResetResult } from '../storage/demoReset'

type DemoResetDialogProps = {
  open: boolean
  busy: boolean
  error: Extract<DemoResetResult, { ok: false }> | null
  onCancel: () => void
  onConfirm: () => void
}

// 「デモを最初から」確認ダイアログ。ネイティブ<dialog>のshowModal()を使い、
// 表示中は背景（フォーカス・クリック・支援技術のvirtual cursor）をブラウザがinert化する。
// storageへは触れず、確定・キャンセルの意思だけを親へ返す
export function DemoResetDialog({
  open,
  busy,
  error,
  onCancel,
  onConfirm,
}: DemoResetDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      dialog.showModal()
      // autofocus属性へ依存せず、開いた直後にキャンセル（安全側）へ明示的にfocusする
      cancelRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
      // ブラウザの自動復帰に加えて明示的にopener（デモバッジ）へ戻す（二重化）
      openerRef.current?.focus()
    }
  }, [open])

  // Escape（ネイティブcancelイベント）: 常にpreventDefaultで親のstateと同期させ、
  // busy中は無効化・通常時はキャンセル扱い
  const handleNativeCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    if (!busy) onCancel()
  }

  // 内容は.demo-dialog-panelで包んであり、panel内の余白クリックでは閉じない。
  // クリックターゲットがdialog要素そのもの＝真のbackdropクリックだけをキャンセル扱いにする
  const handleBackdropClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (busy) return
    if (event.target === dialogRef.current) onCancel()
  }

  return (
    <dialog
      ref={dialogRef}
      className="demo-dialog"
      aria-labelledby="demo-reset-title"
      aria-describedby="demo-reset-body"
      onCancel={handleNativeCancel}
      onClick={handleBackdropClick}
    >
      <div className="demo-dialog-panel">
        <h2 id="demo-reset-title" className="demo-dialog-title">
          デモを最初からやり直しますか？
        </h2>
        <p id="demo-reset-body" className="demo-dialog-body">
          興味パスポート、送信したキャンペーン、返答・既読の記録をすべて消して、最初のデモ状態（受信済み3件・今週のキャンペーン0/3）に戻します。
        </p>
        <p className="demo-dialog-note">
          このアプリはすべて架空データのデモです。実際の通知や連絡は発生しません。
        </p>
        <div className="demo-dialog-status" role="status">
          {busy && <p className="demo-dialog-progress">初期状態に戻しています…</p>}
          {!busy && error !== null && (
            <p className="demo-dialog-error">
              {error.reason === 'reset-failed' && error.rollback === 'partial'
                ? '初期化を完了できませんでした。デモ状態の一部が変更された可能性があります。ページを閉じずに、もう一度お試しください。'
                : '初期化できませんでした。現在のデモ状態は変更されていません。もう一度お試しください。'}
            </p>
          )}
        </div>
        <div className="demo-dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            初期状態に戻す
          </button>
        </div>
      </div>
    </dialog>
  )
}
