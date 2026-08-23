import type { ReactNode } from 'react'

import {
  ACTIVITY_STYLE_LABELS,
  DAY_SLOT_LABELS,
  EXPERIENCE_LABELS,
  FREQUENCY_LABELS,
  INTEREST_LABELS,
  PURPOSE_LABELS,
  type StudentPreference,
} from '../../domain/types'
import { formatBudgetLabel, formatWeeklyLimitLabel } from './passportForm'

type PassportSummaryProps = {
  preference: StudentPreference
  // 編集・停止/再開の導線は登録済みホームでだけ渡す（完了直後の要約では表示しない）
  onEdit?: () => void
  onTogglePaused?: () => void
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="passport-fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function ValueChips({ labels }: { labels: string[] }) {
  if (labels.length === 0) {
    return <span className="value-empty">（未選択）</span>
  }
  return (
    <span className="value-chip-row">
      {labels.map((label) => (
        <span key={label} className="value-chip">
          {label}
        </span>
      ))}
    </span>
  )
}

export function PassportSummary({ preference, onEdit, onTogglePaused }: PassportSummaryProps) {
  const { reception } = preference
  const paused = reception.paused

  return (
    <section className="passport-card" aria-label="興味パスポートの登録内容">
      {/* 停止/再開の切替結果を読み上げへ届けるため、状態チップはaria-liveで包む */}
      <p className="passport-status-row" aria-live="polite">
        <span className={paused ? 'status-chip status-chip--paused' : 'status-chip'}>
          {paused ? '受信停止中' : `オファー受信中・${formatWeeklyLimitLabel(reception.weeklyLimit)}まで`}
        </span>
      </p>

      <h2 className="passport-card-title">あなたの興味パスポート</h2>

      {paused && (
        <p className="paused-banner">
          オファーの受信を停止しています。再開すると、条件の合う案内がまた届くようになります。
        </p>
      )}

      <dl className="passport-facts">
        <Fact term="興味のあるジャンル">
          <ValueChips labels={preference.interests.map((value) => INTEREST_LABELS[value])} />
        </Fact>
        <Fact term="活動の目的">
          <ValueChips labels={preference.purposes.map((value) => PURPOSE_LABELS[value])} />
        </Fact>
        <Fact term="活動スタイル">{ACTIVITY_STYLE_LABELS[preference.style]}</Fact>
        <Fact term="いまの経験">{EXPERIENCE_LABELS[preference.experience]}</Fact>
        <Fact term="参加できる曜日">
          <ValueChips labels={preference.availableDays.map((value) => DAY_SLOT_LABELS[value])} />
        </Fact>
        <Fact term="活動の頻度">{FREQUENCY_LABELS[preference.frequency]}</Fact>
        <Fact term="1回あたりの予算">{formatBudgetLabel(preference.maxFeePerEventYen)}</Fact>
        <Fact term="受け取るカテゴリ">
          <ValueChips labels={reception.allowedCategories.map((value) => INTEREST_LABELS[value])} />
        </Fact>
        <Fact term="1週間に受け取る上限">{formatWeeklyLimitLabel(reception.weeklyLimit)}</Fact>
      </dl>

      {(onEdit !== undefined || onTogglePaused !== undefined) && (
        <div className="passport-actions">
          {onEdit !== undefined && (
            <button type="button" className="button button-secondary" onClick={onEdit}>
              内容を編集する
            </button>
          )}
          {onTogglePaused !== undefined && (
            <button type="button" className="button button-secondary" onClick={onTogglePaused}>
              {paused ? '受信を再開する' : '受信を停止する'}
            </button>
          )}
        </div>
      )}

      <p className="passport-privacy-note">名前や顔写真は、団体には公開されません</p>
    </section>
  )
}
