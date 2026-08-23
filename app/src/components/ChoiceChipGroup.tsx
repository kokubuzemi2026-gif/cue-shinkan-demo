export type ChipOption<T extends string | number> = {
  value: T
  label: string
}

type ChoiceChipGroupProps<T extends string | number> = {
  legend: string
  options: readonly ChipOption<T>[]
  selected: readonly T[]
  onToggle: (value: T) => void
  helper?: string
}

// タップ中心の選択UI。単一選択か複数選択かは呼び出し側のonToggle実装で決まり、
// このコンポーネントは選択状態の表示（aria-pressed）とタップ領域44px以上だけを保証する。
// Task 005の団体側の対象条件入力でも再利用する想定。
export function ChoiceChipGroup<T extends string | number>({
  legend,
  options,
  selected,
  onToggle,
  helper,
}: ChoiceChipGroupProps<T>) {
  return (
    <fieldset className="chip-fieldset">
      <legend className="chip-legend">{legend}</legend>
      <div className="chip-row">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className="choice-chip"
            aria-pressed={selected.includes(option.value)}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {helper !== undefined && <p className="chip-helper">{helper}</p>}
    </fieldset>
  )
}
