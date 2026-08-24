import type { RefObject } from 'react'

import { ChoiceChipGroup, type ChipOption } from '../../components/ChoiceChipGroup'
import {
  ACTIVITY_STYLE_LABELS,
  ACTIVITY_STYLES,
  DAY_SLOT_LABELS,
  DAY_SLOTS,
  FREQUENCIES,
  FREQUENCY_LABELS,
  INTEREST_CATEGORIES,
  INTEREST_LABELS,
  PURPOSE_LABELS,
  PURPOSES,
} from '../../domain/types'
import {
  CAPACITY_CHOICES,
  DEADLINE_CHOICES,
  FEE_CHOICES_YEN,
  formatDeadlineLabel,
  formatFeeLabel,
  toggleDraftValue,
  type OfferDraft,
} from './offerComposer'

// 選択肢はdomainの定数だけから組み立てる（UI側で重複定義しない）
const CATEGORY_OPTIONS = INTEREST_CATEGORIES.map((value) => ({
  value,
  label: INTEREST_LABELS[value],
}))
const PURPOSE_OPTIONS = PURPOSES.map((value) => ({ value, label: PURPOSE_LABELS[value] }))
const DAY_OPTIONS = DAY_SLOTS.map((value) => ({ value, label: DAY_SLOT_LABELS[value] }))
const FREQUENCY_OPTIONS = FREQUENCIES.map((value) => ({
  value,
  label: FREQUENCY_LABELS[value],
}))
const INTENSITY_OPTIONS = ACTIVITY_STYLES.map((value) => ({
  value,
  label: ACTIVITY_STYLE_LABELS[value],
}))
const FEE_OPTIONS = FEE_CHOICES_YEN.map((value) => ({ value, label: formatFeeLabel(value) }))
const CAPACITY_OPTIONS = CAPACITY_CHOICES.map((value) => ({ value, label: `${value}人` }))
const DEADLINE_OPTIONS = DEADLINE_CHOICES.map((value) => ({
  value,
  label: formatDeadlineLabel(value),
}))
const BEGINNER_OPTIONS: ChipOption<'welcome' | 'experienced'>[] = [
  { value: 'welcome', label: '初心者歓迎' },
  { value: 'experienced', label: '経験者向け' },
]

type OfferComposerProps = {
  draft: OfferDraft
  onChange: (next: OfferDraft) => void
  errors: string[]
  onConfirm: () => void
  onCancel: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
}

// オファー作成フォーム（集中モード・1画面）。プリセット入力済みで、
// 90秒デモでは内容を確認して「対象を確認する」へ進むだけで完了する
export function OfferComposer({
  draft,
  onChange,
  errors,
  onConfirm,
  onCancel,
  headingRef,
}: OfferComposerProps) {
  const setField = <K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) => {
    onChange({ ...draft, [key]: value })
  }

  return (
    <div className="club-flow">
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        新しいオファー
      </h1>
      <p className="club-flow-lead">
        条件に合う新入生にだけ届きます。学生の一覧は表示されません。
      </p>

      <section className="club-form-card" aria-label="イベント情報">
        <h2 className="club-section-heading">イベント情報</h2>
        <div className="club-field">
          <label className="club-field-label" htmlFor="offer-event-name">
            イベント名
          </label>
          <input
            id="offer-event-name"
            className="club-input"
            type="text"
            value={draft.eventName}
            onChange={(event) => setField('eventName', event.target.value)}
          />
        </div>
        <div className="club-field">
          <label className="club-field-label" htmlFor="offer-description">
            イベント紹介
          </label>
          <textarea
            id="offer-description"
            className="club-textarea"
            rows={3}
            value={draft.description}
            onChange={(event) => setField('description', event.target.value)}
          />
        </div>
        <div className="club-field">
          <label className="club-field-label" htmlFor="offer-date-text">
            開催日時
          </label>
          <input
            id="offer-date-text"
            className="club-input"
            type="text"
            value={draft.dateText}
            onChange={(event) => setField('dateText', event.target.value)}
          />
        </div>
        <div className="club-field">
          <label className="club-field-label" htmlFor="offer-place">
            場所
          </label>
          <input
            id="offer-place"
            className="club-input"
            type="text"
            value={draft.place}
            onChange={(event) => setField('place', event.target.value)}
          />
        </div>
        <ChoiceChipGroup
          legend="参加費（1回あたり）"
          options={FEE_OPTIONS}
          selected={[draft.feePerEventYen]}
          onToggle={(value) => setField('feePerEventYen', value)}
        />
        <ChoiceChipGroup
          legend="定員"
          options={CAPACITY_OPTIONS}
          selected={[draft.capacity]}
          onToggle={(value) => setField('capacity', value)}
        />
        <ChoiceChipGroup
          legend="申込期限"
          options={DEADLINE_OPTIONS}
          selected={[draft.deadline]}
          onToggle={(value) => setField('deadline', value)}
        />
      </section>

      <section className="club-form-card" aria-label="対象条件">
        <h2 className="club-section-heading">届けたい相手の条件</h2>
        <ChoiceChipGroup
          legend="興味カテゴリ（複数OK）"
          options={CATEGORY_OPTIONS}
          selected={draft.targetCategories}
          onToggle={(value) =>
            setField('targetCategories', toggleDraftValue(draft.targetCategories, value))
          }
          helper="このカテゴリの受信を許可している学生にだけ届きます。"
        />
        <ChoiceChipGroup
          legend="活動目的（複数OK）"
          options={PURPOSE_OPTIONS}
          selected={draft.targetPurposes}
          onToggle={(value) =>
            setField('targetPurposes', toggleDraftValue(draft.targetPurposes, value))
          }
        />
        <ChoiceChipGroup
          legend="開催曜日（複数OK）"
          options={DAY_OPTIONS}
          selected={draft.eventDays}
          onToggle={(value) => setField('eventDays', toggleDraftValue(draft.eventDays, value))}
        />
        <ChoiceChipGroup
          legend="活動頻度"
          options={FREQUENCY_OPTIONS}
          selected={[draft.frequency]}
          onToggle={(value) => setField('frequency', value)}
        />
        <ChoiceChipGroup
          legend="活動の本気度"
          options={INTENSITY_OPTIONS}
          selected={[draft.intensity]}
          onToggle={(value) => setField('intensity', value)}
        />
        <ChoiceChipGroup
          legend="初心者対応"
          options={BEGINNER_OPTIONS}
          selected={[draft.beginnerFriendly ? 'welcome' : 'experienced']}
          onToggle={(value) => setField('beginnerFriendly', value === 'welcome')}
        />
      </section>

      <section className="club-form-card" aria-label="届けたい理由">
        <h2 className="club-section-heading">届けたい理由</h2>
        <div className="club-field">
          <label className="club-field-label" htmlFor="offer-reason-note">
            なぜこの人たちに届けたいか
          </label>
          <textarea
            id="offer-reason-note"
            className="club-textarea"
            rows={3}
            value={draft.reasonNote}
            onChange={(event) => setField('reasonNote', event.target.value)}
          />
          <p className="club-field-helper">
            学生のオファー詳細に「団体からのメッセージ」として表示されます。
          </p>
        </div>
      </section>

      <div className="wizard-error-region" aria-live="polite">
        {errors.map((message) => (
          <p key={message} className="wizard-error">
            {message}
          </p>
        ))}
      </div>

      <div className="wizard-footer">
        <button type="button" className="button button-secondary" onClick={onCancel}>
          やめる
        </button>
        <button
          type="button"
          className="button button-primary wizard-next"
          onClick={onConfirm}
        >
          対象を確認する
        </button>
      </div>
    </div>
  )
}
