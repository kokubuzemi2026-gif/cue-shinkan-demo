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
  // 受信再開の直後だけtrue。aria-live領域から通知する
  showResumeNotice?: boolean
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

export function PassportSummary({
  preference,
  onEdit,
  onTogglePaused,
  showResumeNotice = false,
}: PassportSummaryProps) {
  const { reception } = preference
  const paused = reception.paused

  return (
    <section className="passport-card" aria-label="興味パスポートの登録内容">
      {/* 停止/再開の切替結果を読み上げへ届けるため、状態表示はaria-liveで包む */}
      <p className="passport-status-row" aria-live="polite">
        <span className={paused ? 'status-chip status-chip--paused' : 'status-chip'}>
          {paused ? '受信停止中' : `オファー受信中・${formatWeeklyLimitLabel(reception.weeklyLimit)}まで`}
        </span>
        {showResumeNotice && (
          <span className="status-notice">オファーの受信を再開しました</span>
        )}
      </p>

      <h2 className="passport-card-title">あなたの興味パスポート</h2>

      {onEdit !== undefined && (
        <button type="button" className="button button-secondary passport-edit" onClick={onEdit}>
          内容を編集
        </button>
      )}

      {paused ? (
        <div className="paused-banner">
          <p>
            オファーの受信を停止しています。再開すると、条件の合う案内がまた届くようになります。
          </p>
          {onTogglePaused !== undefined && (
            <button type="button" className="button button-primary" onClick={onTogglePaused}>
              オファー受信を再開
            </button>
          )}
        </div>
      ) : (
        onTogglePaused !== undefined && (
          <button type="button" className="button button-ghost" onClick={onTogglePaused}>
            受信を停止する
          </button>
        )
      )}

      <dl className="passport-facts">
        <div className="passport-fact">
          <dt>興味のあるジャンル</dt>
          <dd>
            <ValueChips labels={preference.interests.map((value) => INTEREST_LABELS[value])} />
          </dd>
        </div>
        <div className="passport-fact">
          <dt>活動の目的</dt>
          <dd>
            <ValueChips labels={preference.purposes.map((value) => PURPOSE_LABELS[value])} />
          </dd>
        </div>
        {/* 単一値の条件は2列グリッドでコンパクトに見せる */}
        <div className="passport-grid">
          <div className="passport-fact">
            <dt>活動スタイル</dt>
            <dd>{ACTIVITY_STYLE_LABELS[preference.style]}</dd>
          </div>
          <div className="passport-fact">
            <dt>いまの経験</dt>
            <dd>{EXPERIENCE_LABELS[preference.experience]}</dd>
          </div>
          <div className="passport-fact">
            <dt>参加できる曜日</dt>
            <dd>{preference.availableDays.map((value) => DAY_SLOT_LABELS[value]).join('・')}</dd>
          </div>
          <div className="passport-fact">
            <dt>活動の頻度</dt>
            <dd>{FREQUENCY_LABELS[preference.frequency]}</dd>
          </div>
          <div className="passport-fact">
            <dt>1回あたりの予算</dt>
            <dd>{formatBudgetLabel(preference.maxFeePerEventYen)}</dd>
          </div>
          <div className="passport-fact">
            <dt>1週間に受け取る上限</dt>
            <dd>{formatWeeklyLimitLabel(reception.weeklyLimit)}</dd>
          </div>
        </div>
        <div className="passport-fact">
          <dt>受け取るカテゴリ</dt>
          <dd>
            <ValueChips
              labels={reception.allowedCategories.map((value) => INTEREST_LABELS[value])}
            />
          </dd>
        </div>
      </dl>

      <p className="passport-privacy-note">名前や顔写真は、団体には公開されません</p>
    </section>
  )
}
