import type { RefObject } from 'react'

type SendDoneProps = {
  deliverableCount: number
  saveFailed: boolean
  onOpenInbox: () => void
  onBackToDashboard: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
}

// 送信完了（集中モード解除・RoleSwitcher復帰）。人数は必ず実際の配信人数
// （deliverableCount）を表示し、次の一手は受信箱の直行CTAに絞る
export function SendDone({
  deliverableCount,
  saveFailed,
  onOpenInbox,
  onBackToDashboard,
  headingRef,
}: SendDoneProps) {
  return (
    <div className="done-card">
      <span className="done-check" aria-hidden="true">
        ✓
      </span>
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        {deliverableCount}人へ配信しました
      </h1>
      <p className="done-body">
        条件に合い、今週の受信上限に達していない新入生にだけ届いています。学生が返答すると、ダッシュボードの数字が更新されます。
      </p>
      {saveFailed && (
        <p className="save-warning" role="status">
          端末への保存に失敗しました。この画面のまま操作を続ければ今回の配信は有効ですが、リロードすると消えます。
        </p>
      )}
      <button type="button" className="button button-primary done-cta" onClick={onOpenInbox}>
        新入生の受信箱で確認する
      </button>
      <button
        type="button"
        className="button button-ghost done-secondary"
        onClick={onBackToDashboard}
      >
        ダッシュボードへもどる
      </button>
    </div>
  )
}
