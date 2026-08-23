import type {
  ActivityStyle,
  DaySlot,
  ExperienceLevel,
  Frequency,
  InterestCategory,
  Purpose,
  StudentPreference,
} from '../../domain/types'

// 興味パスポートwizardの下書き状態。UI都合でreceptionをフラットに持ち、
// 保存時にbuildPreferenceでStudentPreferenceへ組み立て直す。
export type PassportDraft = {
  interests: InterestCategory[]
  purposes: Purpose[]
  style: ActivityStyle
  frequency: Frequency
  availableDays: DaySlot[]
  experience: ExperienceLevel
  maxFeePerEventYen: number
  receptionPaused: boolean
  allowedCategories: InterestCategory[]
  weeklyLimit: number
}

export type PassportAction =
  | { type: 'toggleInterest'; value: InterestCategory }
  | { type: 'togglePurpose'; value: Purpose }
  | { type: 'setStyle'; value: ActivityStyle }
  | { type: 'setFrequency'; value: Frequency }
  | { type: 'toggleDay'; value: DaySlot }
  | { type: 'setExperience'; value: ExperienceLevel }
  | { type: 'setMaxFee'; value: number }
  | { type: 'setReceptionPaused'; value: boolean }
  | { type: 'toggleAllowedCategory'; value: InterestCategory }
  | { type: 'setWeeklyLimit'; value: number }
  | { type: 'reset'; value: PassportDraft }

// 選択順を保って追加・解除する。interestsの並びはマッチ理由の優先順に使われるため
// （domain/matching.ts: 学生の登録順で最初の一致を理由に使う）、並び替えはしない。
function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export function passportReducer(draft: PassportDraft, action: PassportAction): PassportDraft {
  switch (action.type) {
    case 'toggleInterest':
      return { ...draft, interests: toggleValue(draft.interests, action.value) }
    case 'togglePurpose':
      return { ...draft, purposes: toggleValue(draft.purposes, action.value) }
    case 'setStyle':
      return { ...draft, style: action.value }
    case 'setFrequency':
      return { ...draft, frequency: action.value }
    case 'toggleDay':
      return { ...draft, availableDays: toggleValue(draft.availableDays, action.value) }
    case 'setExperience':
      return { ...draft, experience: action.value }
    case 'setMaxFee':
      return { ...draft, maxFeePerEventYen: action.value }
    case 'setReceptionPaused':
      return { ...draft, receptionPaused: action.value }
    case 'toggleAllowedCategory':
      return { ...draft, allowedCategories: toggleValue(draft.allowedCategories, action.value) }
    case 'setWeeklyLimit':
      return { ...draft, weeklyLimit: action.value }
    case 'reset':
      return copyDraft(action.value)
  }
}

function copyDraft(draft: PassportDraft): PassportDraft {
  return {
    ...draft,
    interests: [...draft.interests],
    purposes: [...draft.purposes],
    availableDays: [...draft.availableDays],
    allowedCategories: [...draft.allowedCategories],
  }
}

// 下書きの生成元は「保存済みの内容、なければdemoStudent」（呼び出し側で選ぶ）。
// 受入条件「完了内容がメイン学生の初期値と一致する」はこのシードが担保する。
export function createDraft(source: StudentPreference): PassportDraft {
  return {
    interests: [...source.interests],
    purposes: [...source.purposes],
    style: source.style,
    frequency: source.frequency,
    availableDays: [...source.availableDays],
    experience: source.experience,
    maxFeePerEventYen: source.maxFeePerEventYen,
    receptionPaused: source.reception.paused,
    allowedCategories: [...source.reception.allowedCategories],
    weeklyLimit: source.reception.weeklyLimit,
  }
}

// id・displayNameは入力させない（個人特定情報を扱わないため）。常にbaseから引き継ぐ。
export function buildPreference(draft: PassportDraft, base: StudentPreference): StudentPreference {
  return {
    id: base.id,
    displayName: base.displayName,
    interests: [...draft.interests],
    purposes: [...draft.purposes],
    style: draft.style,
    frequency: draft.frequency,
    availableDays: [...draft.availableDays],
    experience: draft.experience,
    maxFeePerEventYen: draft.maxFeePerEventYen,
    reception: {
      paused: draft.receptionPaused,
      allowedCategories: [...draft.allowedCategories],
      weeklyLimit: draft.weeklyLimit,
    },
  }
}

export type PassportStepMeta = {
  step: number
  heading: string
  lead?: string
}

export const PASSPORT_STEP_COUNT = 4

// tasks/003指定の見出しコピーはstep 1に置く
export const PASSPORT_STEPS: PassportStepMeta[] = [
  {
    step: 1,
    heading: 'どんなきっかけが届いたら、ちょっと嬉しい？',
    lead: '気になるジャンルを選ぶと、そのジャンルの団体からだけ案内が届きます。あとから変更できます。',
  },
  { step: 2, heading: 'どんなふうに楽しみたい？' },
  { step: 3, heading: '参加しやすい条件は？' },
  { step: 4, heading: '受け取り方は、あなたが決められます' },
]

export type StepValidation = { ok: true } | { ok: false; message: string }

const VALID: StepValidation = { ok: true }

// 必須未選択の判定。messageはそのまま画面表示する（tasks/003 要件5）
export function validateStep(draft: PassportDraft, step: number): StepValidation {
  switch (step) {
    case 1:
      return draft.interests.length > 0
        ? VALID
        : { ok: false, message: '興味を1つ以上選んでください' }
    case 2:
      return draft.purposes.length > 0
        ? VALID
        : { ok: false, message: '目的を1つ以上選んでください' }
    case 3:
      return draft.availableDays.length > 0
        ? VALID
        : { ok: false, message: '参加できる曜日を1つ以上選んでください' }
    case 4:
      return draft.receptionPaused || draft.allowedCategories.length > 0
        ? VALID
        : { ok: false, message: '受け取るカテゴリを1つ以上選ぶか、受信を停止してください' }
    default:
      return VALID
  }
}

// 1回あたりの予算プリセット（円）。月額ではない（docs/decisions.md D019）。
// デモ学生の2,000円とデモオファーの費用帯（0〜2,500円）をカバーする。
export const BUDGET_OPTIONS: readonly number[] = [500, 1000, 2000, 3000, 5000]

// 週上限は1〜5件から選択（docs/matching_and_safety.md §5）
export const WEEKLY_LIMIT_OPTIONS: readonly number[] = [1, 2, 3, 4, 5]

export function formatBudgetLabel(yen: number): string {
  return `〜${yen.toLocaleString('ja-JP')}円`
}

export function formatWeeklyLimitLabel(limit: number): string {
  return `週${limit}件`
}
