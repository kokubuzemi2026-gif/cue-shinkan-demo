import { useEffect, useRef, useState } from 'react'

import { ChoiceChipGroup, type ChipOption } from '../../components/ChoiceChipGroup'
import {
  ACTIVITY_STYLE_LABELS,
  ACTIVITY_STYLES,
  DAY_SLOT_LABELS,
  DAY_SLOTS,
  EXPERIENCE_LABELS,
  EXPERIENCE_LEVELS,
  FREQUENCIES,
  FREQUENCY_LABELS,
  INTEREST_CATEGORIES,
  INTEREST_LABELS,
  PURPOSE_LABELS,
  PURPOSES,
} from '../../domain/types'
import {
  BUDGET_OPTIONS,
  formatBudgetLabel,
  formatWeeklyLimitLabel,
  PASSPORT_STEP_COUNT,
  PASSPORT_STEPS,
  validateStep,
  WEEKLY_LIMIT_OPTIONS,
  type PassportAction,
  type PassportDraft,
} from './passportForm'

// 選択肢とラベルはdomain/types.tsの定数だけから組み立てる（UI側で重複定義しない）
const INTEREST_OPTIONS = INTEREST_CATEGORIES.map((value) => ({
  value,
  label: INTEREST_LABELS[value],
}))
const PURPOSE_OPTIONS = PURPOSES.map((value) => ({ value, label: PURPOSE_LABELS[value] }))
const STYLE_OPTIONS = ACTIVITY_STYLES.map((value) => ({
  value,
  label: ACTIVITY_STYLE_LABELS[value],
}))
const EXPERIENCE_OPTIONS = EXPERIENCE_LEVELS.map((value) => ({
  value,
  label: EXPERIENCE_LABELS[value],
}))
const DAY_OPTIONS = DAY_SLOTS.map((value) => ({ value, label: DAY_SLOT_LABELS[value] }))
const FREQUENCY_OPTIONS = FREQUENCIES.map((value) => ({
  value,
  label: FREQUENCY_LABELS[value],
}))
const BUDGET_CHIP_OPTIONS = BUDGET_OPTIONS.map((value) => ({
  value,
  label: formatBudgetLabel(value),
}))
const WEEKLY_LIMIT_CHIP_OPTIONS = WEEKLY_LIMIT_OPTIONS.map((value) => ({
  value,
  label: formatWeeklyLimitLabel(value),
}))
const RECEPTION_OPTIONS: ChipOption<'on' | 'off'>[] = [
  { value: 'on', label: '受け取る' },
  { value: 'off', label: 'いまは停止する' },
]

type PassportWizardProps = {
  draft: PassportDraft
  dispatch: (action: PassportAction) => void
  // 初回は「やめる」、編集時は「保存せずにもどる」を親が渡す
  cancelLabel: string
  onComplete: () => void
  onCancel: () => void
}

export function PassportWizard({
  draft,
  dispatch,
  cancelLabel,
  onComplete,
  onCancel,
}: PassportWizardProps) {
  const [step, setStep] = useState(1)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // step切替時に見出しへフォーカスを移し、キーボード・スクリーンリーダーでも現在地が分かるようにする
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  const meta = PASSPORT_STEPS[step - 1]
  const validation = validateStep(draft, step)
  const isLast = step === PASSPORT_STEP_COUNT

  const goNext = () => {
    if (!validation.ok) return
    if (isLast) {
      onComplete()
    } else {
      setStep(step + 1)
    }
  }

  const goBack = () => {
    // 「戻る」はstep移動だけで、draftへ触れないため入力は消えない（tasks/003 受入条件）
    if (step > 1) {
      setStep(step - 1)
    } else {
      onCancel()
    }
  }

  return (
    <div className="wizard">
      <div className="wizard-progress">
        <p className="wizard-progress-text">
          ステップ {step} / {PASSPORT_STEP_COUNT}
        </p>
        <div className="wizard-progress-bar" aria-hidden="true">
          <div
            className="wizard-progress-fill"
            style={{ width: `${(step / PASSPORT_STEP_COUNT) * 100}%` }}
          />
        </div>
      </div>

      <h2 className="wizard-heading" tabIndex={-1} ref={headingRef}>
        {meta.heading}
      </h2>
      {meta.lead !== undefined && <p className="wizard-lead">{meta.lead}</p>}

      <div className="wizard-groups">
        {step === 1 && (
          <ChoiceChipGroup
            legend="興味のあるジャンル（複数OK）"
            options={INTEREST_OPTIONS}
            selected={draft.interests}
            onToggle={(value) => dispatch({ type: 'toggleInterest', value })}
          />
        )}

        {step === 2 && (
          <>
            <ChoiceChipGroup
              legend="活動の目的（複数OK）"
              options={PURPOSE_OPTIONS}
              selected={draft.purposes}
              onToggle={(value) => dispatch({ type: 'togglePurpose', value })}
            />
            <ChoiceChipGroup
              legend="活動スタイル"
              options={STYLE_OPTIONS}
              selected={[draft.style]}
              onToggle={(value) => dispatch({ type: 'setStyle', value })}
            />
            <ChoiceChipGroup
              legend="いまの経験"
              options={EXPERIENCE_OPTIONS}
              selected={[draft.experience]}
              onToggle={(value) => dispatch({ type: 'setExperience', value })}
              helper="経験は「合うイベントの見つけやすさ」にだけ使います。"
            />
          </>
        )}

        {step === 3 && (
          <>
            <ChoiceChipGroup
              legend="参加できる曜日（複数OK）"
              options={DAY_OPTIONS}
              selected={draft.availableDays}
              onToggle={(value) => dispatch({ type: 'toggleDay', value })}
            />
            <ChoiceChipGroup
              legend="活動の頻度"
              options={FREQUENCY_OPTIONS}
              selected={[draft.frequency]}
              onToggle={(value) => dispatch({ type: 'setFrequency', value })}
            />
            <ChoiceChipGroup
              legend="1回あたりの予算（上限）"
              options={BUDGET_CHIP_OPTIONS}
              selected={[draft.maxFeePerEventYen]}
              onToggle={(value) => dispatch({ type: 'setMaxFee', value })}
              helper="イベント1回分の参加費のめやすです。予算を超える案内には、注意点として表示されます。"
            />
          </>
        )}

        {step === 4 && (
          <>
            <ChoiceChipGroup
              legend="オファー受信"
              options={RECEPTION_OPTIONS}
              selected={[draft.receptionPaused ? 'off' : 'on']}
              onToggle={(value) => dispatch({ type: 'setReceptionPaused', value: value === 'off' })}
              helper={
                draft.receptionPaused
                  ? '停止中は新しいオファーが届きません。いつでも再開できます。'
                  : undefined
              }
            />
            <ChoiceChipGroup
              legend="受け取るカテゴリ"
              options={INTEREST_OPTIONS}
              selected={draft.allowedCategories}
              onToggle={(value) => dispatch({ type: 'toggleAllowedCategory', value })}
              helper="選んだカテゴリ以外の団体からは、案内が届きません。"
            />
            <ChoiceChipGroup
              legend="1週間に受け取る上限"
              options={WEEKLY_LIMIT_CHIP_OPTIONS}
              selected={[draft.weeklyLimit]}
              onToggle={(value) => dispatch({ type: 'setWeeklyLimit', value })}
              helper="通知が多すぎないよう、週ごとの上限を決められます。"
            />
          </>
        )}
      </div>

      <div className="wizard-error-region" aria-live="polite">
        {!validation.ok && <p className="wizard-error">{validation.message}</p>}
      </div>

      <div className="wizard-footer">
        <button type="button" className="button button-secondary" onClick={goBack}>
          {step > 1 ? '戻る' : cancelLabel}
        </button>
        <button
          type="button"
          className="button button-primary wizard-next"
          disabled={!validation.ok}
          onClick={goNext}
        >
          {isLast ? 'これで完了' : '次へ'}
        </button>
      </div>
    </div>
  )
}
