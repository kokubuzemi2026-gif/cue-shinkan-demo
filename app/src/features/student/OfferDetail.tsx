import { useEffect, useRef, useState } from 'react'

import {
  FREQUENCY_LABELS,
  RESPONSE_CHOICES,
  RESPONSE_LABELS,
  type ResponseChoice,
} from '../../domain/types'
import { formatDeadline, formatEventFee, type InboxItem } from './inbox'

type OfferDetailProps = {
  item: InboxItem
  onBack: () => void
  onRespond: (choice: ResponseChoice) => void
}

const RESPONSE_BUTTON_CLASS: Record<ResponseChoice, string> = {
  // 低圧な返答設計: 見送りほど視覚的に軽くし、断りやすくする
  interested: 'button button-primary',
  thinking: 'button button-secondary',
  skip: 'button button-ghost',
}

export function OfferDetail({ item, onBack, onRespond }: OfferDetailProps) {
  const { offer, club, result, response } = item
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [reported, setReported] = useState(false)

  // 詳細を開いたらページ先頭へ統一し、イベント名見出しへフォーカスを移す
  useEffect(() => {
    window.scrollTo(0, 0)
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const choice = response?.choice ?? null

  return (
    <div className="offer-detail">
      <button type="button" className="button button-secondary detail-back" onClick={onBack}>
        受信箱へもどる
      </button>

      <section className="detail-club" aria-label="団体情報">
        <p className="offer-club-row">
          <span className="offer-club-name">{club.name}</span>
          {club.verified && <span className="verified-chip">認証済み</span>}
        </p>
        <p className="detail-club-description">{club.description}</p>
      </section>

      <h1 className="page-title detail-title" tabIndex={-1} ref={headingRef}>
        {offer.eventName}
      </h1>
      <p className="detail-match">
        <span className="offer-match-chip">マッチ度 {result.score} / 100</span>
      </p>

      <section className="detail-section" aria-label="あなたに届いた理由">
        <h2 className="detail-heading">あなたに届いた理由</h2>
        <ul className="reason-list">
          {result.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>

      {result.cautions.length > 0 && (
        <section className="detail-section caution-box" aria-label="先に知っておきたい点">
          <h2 className="detail-heading">先に知っておきたい点</h2>
          <ul className="caution-list">
            {result.cautions.map((caution) => (
              <li key={caution}>{caution}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="detail-section club-message" aria-label="団体からのメッセージ">
        <h2 className="detail-heading">団体からのメッセージ</h2>
        <p className="club-message-text">{offer.reasonNote}</p>
      </section>

      <section className="detail-section" aria-label="イベント情報">
        <h2 className="detail-heading">イベント情報</h2>
        <dl className="passport-facts">
          <div className="passport-grid">
            <div className="passport-fact">
              <dt>日時</dt>
              <dd>{offer.dateText}</dd>
            </div>
            <div className="passport-fact">
              <dt>場所</dt>
              <dd>{offer.place}</dd>
            </div>
            <div className="passport-fact">
              <dt>参加費</dt>
              <dd>{formatEventFee(offer.feePerEventYen)}</dd>
            </div>
            <div className="passport-fact">
              <dt>活動頻度</dt>
              <dd>{FREQUENCY_LABELS[offer.frequency]}</dd>
            </div>
            <div className="passport-fact">
              <dt>初心者対応</dt>
              <dd>{offer.beginnerFriendly ? '初心者歓迎' : '経験者向け'}</dd>
            </div>
            <div className="passport-fact">
              <dt>定員</dt>
              <dd>{offer.capacity}人</dd>
            </div>
            <div className="passport-fact">
              <dt>申込期限</dt>
              <dd>{formatDeadline(offer.deadline)}</dd>
            </div>
          </div>
        </dl>
      </section>

      <section className="detail-section" aria-label="返答する">
        <h2 className="detail-heading">返答する</h2>
        <div className="response-buttons">
          {RESPONSE_CHOICES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={RESPONSE_BUTTON_CLASS[candidate]}
              aria-pressed={choice === candidate}
              onClick={() => onRespond(candidate)}
            >
              {RESPONSE_LABELS[candidate]}
            </button>
          ))}
        </div>
        <p className="response-privacy-note">
          どの返答でも、あなたの名前や連絡先が団体に伝わることはありません。今回は見送っても、団体に個人単位で通知されることはありません。
        </p>

        <div aria-live="polite">
          {choice === 'interested' && (
            <div className="response-panel response-panel--interested" role="status">
              <p className="response-panel-title">「行ってみたい」を保存しました</p>
              <div className="panel-block">
                <h3 className="panel-subheading">参加方法</h3>
                <dl className="panel-facts">
                  <div className="panel-fact">
                    <dt>日時</dt>
                    <dd>{offer.dateText}</dd>
                  </div>
                  <div className="panel-fact">
                    <dt>場所</dt>
                    <dd>{offer.place}</dd>
                  </div>
                </dl>
              </div>
              <div className="panel-block">
                <h3 className="panel-subheading">団体公式窓口</h3>
                <p className="panel-contact-label">{club.contact.label}</p>
                <p className="panel-contact-handle">{club.contact.handle}</p>
                <p className="panel-contact-note">デモ用の架空アカウントです</p>
              </div>
              <ul className="response-panel-notes">
                <li>名前や連絡先は団体に渡りません</li>
                <li>これは入会の確約ではありません</li>
              </ul>
            </div>
          )}
          {choice === 'thinking' && (
            <div className="response-panel" role="status">
              <p className="response-panel-title">「あとで考える」を保存しました。</p>
              <p>受信箱に保留し、あとからいつでも変えられます。</p>
            </div>
          )}
          {choice === 'skip' && (
            <div className="response-panel" role="status">
              <p className="response-panel-title">「今回は見送る」を保存しました。</p>
              <p>見送りが団体に個人単位で伝わることはありません。</p>
            </div>
          )}
        </div>
      </section>

      <div className="detail-report" aria-live="polite">
        {reported ? (
          <p className="report-done">通報を受け付けました（デモのため実際の送信は行われません）</p>
        ) : (
          <button type="button" className="button button-ghost" onClick={() => setReported(true)}>
            この案内に問題がある場合は通報
          </button>
        )}
      </div>
    </div>
  )
}
