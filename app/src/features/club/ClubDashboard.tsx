import type { RefObject } from 'react'

import type { Club } from '../../domain/types'
import type { CampaignView } from './funnel'
import {
  FUNNEL_NOTE,
  FUNNEL_UNAVAILABLE_TEXT,
  funnelCellAriaLabel,
  funnelCellText,
  formatSnapshotDate,
  isDisclosedFunnel,
  toDisclosedFunnel,
} from './funnelDisclosure'

type ClubDashboardProps = {
  club: Club
  campaigns: CampaignView[]
  sentThisWeek: number
  weeklyLimit: number
  onCreate: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
  // 作成ボタンの表示可否（Task 009: 認証済みアプリでは団体のowner/adminのみ作成できる。
  // 省略時はtrue＝Phase 1デモの従来動作）
  canCreate?: boolean
}

const FUNNEL_LABELS = [
  { key: 'delivered', label: '配信' },
  { key: 'viewed', label: '閲覧' },
  { key: 'engaged', label: '関心' },
  { key: 'planned', label: '参加意向' },
] as const

// 団体ダッシュボード。表示するのはキャンペーン内容と匿名の件数だけで、
// 学生の名前・ID・個人別の属性は一切受け取らない（props型で遮断・D007/D024）
export function ClubDashboard({
  club,
  campaigns,
  sentThisWeek,
  weeklyLimit,
  onCreate,
  headingRef,
  canCreate = true,
}: ClubDashboardProps) {
  const quotaFull = sentThisWeek >= weeklyLimit

  return (
    <>
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        団体ダッシュボード
      </h1>

      <section className="club-profile" aria-label="団体プロフィール">
        <div className="club-profile-head">
          <span className="club-profile-name">{club.name}</span>
          {club.verified && <span className="verified-chip">認証済み</span>}
        </div>
        <p className="club-profile-description">{club.description}</p>
        <p className="club-profile-contact">
          <span className="club-contact-label">{club.contact.label}</span>
          <span className="club-contact-handle">{club.contact.handle}</span>
        </p>
      </section>

      <section className="quota-card" aria-label="今週の送信枠">
        <div className="quota-row">
          <span className="quota-label">今週のキャンペーン</span>
          <span className="quota-value">
            {sentThisWeek}/{weeklyLimit}
          </span>
        </div>
        <p className="quota-helper">直近7日間に送信できるキャンペーンは{weeklyLimit}件までです。</p>
        {canCreate ? (
          <>
            <button
              type="button"
              className="button button-primary club-create-button"
              onClick={onCreate}
              disabled={quotaFull}
            >
              新しいオファーを作成
            </button>
            {quotaFull && (
              <p className="quota-full-note">今週の作成上限（{weeklyLimit}件）に達しています。</p>
            )}
          </>
        ) : (
          <p className="quota-helper">オファーの作成・送信は、オーナーまたは管理者が行えます。</p>
        )}
      </section>

      <section aria-label="配信済みキャンペーン" className="campaign-section">
        <h2 className="club-section-heading">配信済みキャンペーン</h2>
        {campaigns.length === 0 ? (
          <p className="club-empty-note">配信済みのキャンペーンはまだありません。</p>
        ) : (
          <ul className="campaign-list">
            {campaigns.map((campaign) => {
              const funnel = toDisclosedFunnel(campaign.funnel)
              return (
                <li key={campaign.offer.id} className="campaign-card">
                  <div className="campaign-head">
                    <span className="campaign-name">{campaign.offer.eventName}</span>
                    {/* D044: 運営が止めたオファー。止められた側にも状態が分かるようにする */}
                    <span className="campaign-status-chip">
                      {campaign.stopped === true ? '停止中' : '配信済み'}
                    </span>
                  </div>
                  <p className="campaign-date">{campaign.offer.dateText}</p>
                  {campaign.stopped === true && (
                    <p className="campaign-stopped-note">
                      運営がこの案内の配信を停止しました。学生の受信箱では「募集終了」と表示され、新しい返答は届きません。心当たりがない場合は運営へ連絡してください。
                    </p>
                  )}
                  <dl className="campaign-funnel">
                    {FUNNEL_LABELS.map((metric) => (
                      <div key={metric.key} className="funnel-item">
                        <dt className="funnel-label">{metric.label}</dt>
                        {/* 抑制されたセルは「—」。0人と読み違えないよう読み上げ文も別に持つ */}
                        <dd
                          className="funnel-value"
                          aria-label={funnelCellAriaLabel(funnel, metric.key)}
                        >
                          {funnelCellText(funnel, metric.key)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {!funnel.available && (
                    <p className="campaign-funnel-note">{FUNNEL_UNAVAILABLE_TEXT}</p>
                  )}
                  {campaign.snapshotDate !== undefined && (
                    <p className="campaign-funnel-note">
                      {formatSnapshotDate(campaign.snapshotDate)}時点の集計
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {/* 抑制・丸めの注記は、サーバー由来の開示済みファネルにだけ出す。
            Phase 1デモは実数のため、出すと事実と異なる説明になる */}
        {campaigns.some((campaign) => isDisclosedFunnel(campaign.funnel)) && (
          <p className="club-metric-note">{FUNNEL_NOTE}</p>
        )}
        <p className="club-metric-note">
          参加意向は「行ってみたい」の回答数です。参加の確約ではありません。
        </p>
      </section>

      <p className="club-privacy-note">
        学生の名前や個人の一覧は表示されません。人数のみ確認できます。
      </p>
    </>
  )
}
