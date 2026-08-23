import type { RefObject } from 'react'

import type { ClubOffer } from '../../domain/types'
import {
  DAY_SLOT_LABELS,
  INTEREST_LABELS,
  PURPOSE_LABELS,
} from '../../domain/types'
import type { AudienceSummary } from './delivery'
import { formatDeadlineLabel, formatEventFeeText } from './offerComposer'

type SendConfirmProps = {
  // オファー内容（団体自身のキャンペーン）と匿名の人数3値だけを受け取る。
  // 受信者snapshot・studentId・学生の設定はprops型に存在しない（D007/D024）
  offer: ClubOffer
  summary: AudienceSummary
  sentThisWeek: number
  weeklyLimit: number
  duplicate: boolean
  commitNotice: string | null
  onSend: () => void
  onBack: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
}

// 送信確認（集中モード）。主役は「N人の新入生とマッチしています」の実計算値
export function SendConfirm({
  offer,
  summary,
  sentThisWeek,
  weeklyLimit,
  duplicate,
  commitNotice,
  onSend,
  onBack,
  headingRef,
}: SendConfirmProps) {
  const quotaFull = sentThisWeek >= weeklyLimit
  // 送信できない理由（優先順: 再送禁止 → 週枠 → 配信0人）
  const blockingMessage = duplicate
    ? '同じイベントはすでに配信済みのため、再送できません'
    : quotaFull
      ? `今週の作成上限（${weeklyLimit}件）に達しているため送信できません`
      : summary.deliverableCount === 0
        ? summary.matchedCount === 0
          ? '現在の条件に合う新入生がいないため送信できません'
          : '対象の新入生は全員が今週の受信上限に達しているため送信できません'
        : null
  const canSend = blockingMessage === null

  return (
    <div className="club-flow">
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        送信内容の確認
      </h1>

      <section className="audience-hero" aria-label="マッチ人数">
        <p className="audience-count">
          <strong className="audience-count-number">{summary.matchedCount}人</strong>
          の新入生とマッチしています
        </p>
        {summary.limitedCount > 0 && (
          <p className="audience-breakdown">
            うち受信上限に達している学生 {summary.limitedCount}人 → 今回の配信{' '}
            {summary.deliverableCount}人
          </p>
        )}
        {canSend && (
          <p className="audience-quota">
            送信すると今週のキャンペーンが {sentThisWeek + 1}/{weeklyLimit} になります
          </p>
        )}
      </section>

      <section className="club-form-card" aria-label="配信内容">
        <h2 className="club-section-heading">配信する内容</h2>
        <dl className="confirm-facts">
          <div className="confirm-fact">
            <dt>イベント名</dt>
            <dd>{offer.eventName}</dd>
          </div>
          <div className="confirm-fact">
            <dt>日時</dt>
            <dd>{offer.dateText}</dd>
          </div>
          <div className="confirm-fact">
            <dt>場所</dt>
            <dd>{offer.place}</dd>
          </div>
          <div className="confirm-fact">
            <dt>参加費</dt>
            <dd>{formatEventFeeText(offer.feePerEventYen)}</dd>
          </div>
          <div className="confirm-fact">
            <dt>定員</dt>
            <dd>{offer.capacity}人</dd>
          </div>
          <div className="confirm-fact">
            <dt>申込期限</dt>
            <dd>{formatDeadlineLabel(offer.deadline)}</dd>
          </div>
        </dl>
        <div className="confirm-target">
          <h3 className="confirm-target-heading">対象の条件</h3>
          <div className="value-chip-row">
            {offer.targetCategories.map((category) => (
              <span key={category} className="value-chip">
                {INTEREST_LABELS[category]}
              </span>
            ))}
            {offer.targetPurposes.map((purpose) => (
              <span key={purpose} className="value-chip">
                {PURPOSE_LABELS[purpose]}
              </span>
            ))}
            {offer.eventDays.map((day) => (
              <span key={day} className="value-chip">
                {DAY_SLOT_LABELS[day]}
              </span>
            ))}
          </div>
        </div>
      </section>

      <p className="club-privacy-note">個人が特定できる情報は表示されません。</p>

      <div className="wizard-error-region" role="status">
        {blockingMessage !== null && <p className="wizard-error">{blockingMessage}</p>}
        {blockingMessage === null && commitNotice !== null && (
          <p className="wizard-error">{commitNotice}</p>
        )}
      </div>

      <div className="wizard-footer">
        <button type="button" className="button button-secondary" onClick={onBack}>
          もどる
        </button>
        <button
          type="button"
          className="button button-primary wizard-next"
          disabled={!canSend}
          onClick={onSend}
        >
          この内容で送信
        </button>
      </div>
    </div>
  )
}
