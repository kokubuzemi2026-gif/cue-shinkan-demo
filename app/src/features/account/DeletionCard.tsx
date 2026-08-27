import { useEffect, useRef } from 'react'

import {
  canConfirm,
  DELETION_COPY,
  IRREVERSIBLE_NOTICE,
  type DeletionKind,
  type DeletionState,
} from './deletion'

type DeletionCardProps = {
  kind: DeletionKind
  state: DeletionState
  onRequest: () => void
  onCancel: () => void
  onConfirm: () => void
  // 完了後に次へ進む導線。省略すると結果表示だけで止まる。
  // 画面が自動で切り替わると「消えた」以外に何も分からないため、
  // 結果を読んでから利用者の操作で進ませる
  doneAction?: { label: string; onClick: () => void }
}

// 取り消せない操作の共通カード。
// - 1タップでは実行できない（要求→確認の2段階。状態はdeletion.tsが持つ）
// - 何が消えて何が残るかを、実行前に必ず出す
// - 危険さを色だけに依存させず、見出しと文言でも示す
export function DeletionCard({
  kind,
  state,
  onRequest,
  onCancel,
  onConfirm,
  doneAction,
}: DeletionCardProps) {
  const copy = DELETION_COPY[kind]
  // 確認が開いたら、その見出しへフォーカスを移す。
  // カードは画面の途中にあるため、移さないとスクリーンリーダーは確認文を読まず、
  // キーボード利用者は「消えるもの／残るもの」を読み飛ばして実行ボタンへ着く。
  // マウント時（idle）とdone時はrefがnullなので何もしない
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (state.phase === 'confirming') confirmHeadingRef.current?.focus()
  }, [state.phase])

  if (state.phase === 'done') {
    return (
      <section className="danger-card" aria-label={copy.action}>
        <p role="status" className="danger-done">
          {copy.done}
        </p>
        {doneAction !== undefined && (
          <div className="danger-actions">
            <button type="button" className="button button-primary" onClick={doneAction.onClick}>
              {doneAction.label}
            </button>
          </div>
        )}
      </section>
    )
  }

  if (state.phase === 'idle') {
    return (
      <section className="danger-card" aria-label={copy.action}>
        <h2 className="danger-heading">{copy.action}</h2>
        <p className="danger-note">{IRREVERSIBLE_NOTICE}</p>
        <button type="button" className="button button-ghost danger-button" onClick={onRequest}>
          {copy.action}
        </button>
      </section>
    )
  }

  return (
    <section className="danger-card danger-card--open" aria-label={copy.confirmTitle}>
      <h2 className="danger-heading" tabIndex={-1} ref={confirmHeadingRef}>
        {copy.confirmTitle}
      </h2>
      <p className="danger-note danger-note--strong">{IRREVERSIBLE_NOTICE}</p>

      <h3 className="danger-subheading">消えるもの</h3>
      <ul className="danger-list">
        {copy.removed.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h3 className="danger-subheading">残るもの</h3>
      <ul className="danger-list">
        {copy.kept.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {state.error !== null && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="danger-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onCancel}
          disabled={state.phase === 'running'}
        >
          やめる
        </button>
        <button
          type="button"
          className="button button-ghost danger-button"
          onClick={onConfirm}
          disabled={!canConfirm(state)}
        >
          {state.phase === 'running' ? '処理中…' : copy.confirmAction}
        </button>
      </div>
    </section>
  )
}
