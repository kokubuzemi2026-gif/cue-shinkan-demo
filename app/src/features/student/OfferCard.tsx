import { RESPONSE_LABELS } from '../../domain/types'
import { formatEventFee, OFFER_STATUS_LABELS, type InboxItem } from './inbox'

type OfferCardProps = {
  item: InboxItem
  onOpen: (offerId: string) => void
  // 到着状態（tasks/006）: pending=一度きりの演出＋「新着」チップ /
  // settled=チップのみ（animationend後も表示維持） / null=通常。既読状態とは独立
  arrivalPhase?: 'pending' | 'settled' | null
  onArrivalSettled?: (offerId: string) => void
}

// 受信箱の一覧カード。カード全体が1つのボタンで、タップで詳細（開封=既読）へ進む
export function OfferCard({
  item,
  onOpen,
  arrivalPhase = null,
  onArrivalSettled,
}: OfferCardProps) {
  const { offer, club, result, response, status } = item
  const statusLabel = OFFER_STATUS_LABELS[status]
  const firstReason = result.reasons[0]
  const isArrival = arrivalPhase !== null

  return (
    <button
      type="button"
      className={arrivalPhase === 'pending' ? 'offer-card offer-card--arrival' : 'offer-card'}
      onClick={() => onOpen(offer.id)}
      onAnimationEnd={(event) => {
        // 子要素のアニメや別animationの終了で誤ってsettled化しないよう限定する
        if (event.target === event.currentTarget && event.animationName === 'offer-arrive') {
          onArrivalSettled?.(offer.id)
        }
      }}
      aria-label={`${isArrival ? '新着 ' : ''}${statusLabel} ${club.name} ${offer.eventName} マッチ度${result.score}`}
    >
      <span className="offer-card-top">
        {isArrival && <span className="arrival-chip">新着</span>}
        <span className={`offer-status offer-status--${status}`}>{statusLabel}</span>
        <span className="offer-match-chip">マッチ度 {result.score}</span>
      </span>
      <span className="offer-club-row">
        <span className="offer-club-name">{club.name}</span>
        {club.verified && <span className="verified-chip">認証済み</span>}
      </span>
      <span className="offer-event-name">{offer.eventName}</span>
      <span className="offer-meta">
        {offer.dateText}・{formatEventFee(offer.feePerEventYen)}
      </span>
      {firstReason !== undefined && (
        <span className="offer-reason-preview">理由: {firstReason}</span>
      )}
      {(result.cautions.length > 0 || response !== null) && (
        <span className="offer-flags">
          {result.cautions.length > 0 && <span className="caution-chip">気になる点あり</span>}
          {response !== null && (
            <span className="offer-response-note">
              あなたの返答: {RESPONSE_LABELS[response.choice]}
            </span>
          )}
        </span>
      )}
      {/* タップ可能であることの視覚的手掛かり。名前はaria-labelが担うため読み上げ対象外にする */}
      <span className="offer-open-hint" aria-hidden="true">
        詳しく見る →
      </span>
    </button>
  )
}
