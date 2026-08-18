export const INTEREST_CATEGORIES = [
  'outdoor',
  'photo',
  'travel',
  'music',
  'sports',
  'film',
  'volunteer',
  'international',
] as const

export type InterestCategory = (typeof INTEREST_CATEGORIES)[number]

export const INTEREST_LABELS: Record<InterestCategory, string> = {
  outdoor: 'アウトドア',
  photo: '写真',
  travel: '旅行',
  music: '音楽',
  sports: 'スポーツ',
  film: '映像・映画',
  volunteer: 'ボランティア',
  international: '国際交流',
}

export const PURPOSES = ['friends', 'challenge', 'exercise', 'creation'] as const

export type Purpose = (typeof PURPOSES)[number]

export const PURPOSE_LABELS: Record<Purpose, string> = {
  friends: '友達を作る',
  challenge: '新しいことへ挑戦',
  exercise: '体を動かす',
  creation: '創作する',
}

// 配列の並びは本気度の弱い順。スタイル適合の段差計算が依存する
export const ACTIVITY_STYLES = ['relaxed', 'moderate', 'serious'] as const

export type ActivityStyle = (typeof ACTIVITY_STYLES)[number]

export const ACTIVITY_STYLE_LABELS: Record<ActivityStyle, string> = {
  relaxed: 'ゆるく',
  moderate: 'ほどほど',
  serious: '本格的',
}

// 配列の並びは活動負担の軽い順。頻度の注意点判定が依存する
export const FREQUENCIES = ['monthly_1_2', 'weekly_1', 'weekly_2_plus'] as const

export type Frequency = (typeof FREQUENCIES)[number]

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  monthly_1_2: '月1〜2回',
  weekly_1: '週1回',
  weekly_2_plus: '週2回以上',
}

export const DAY_SLOTS = ['weekday_day', 'weekday_night', 'weekend'] as const

export type DaySlot = (typeof DAY_SLOTS)[number]

export const DAY_SLOT_LABELS: Record<DaySlot, string> = {
  weekday_day: '平日昼',
  weekday_night: '平日夜',
  weekend: '土日',
}

export const EXPERIENCE_LEVELS = ['none', 'some', 'experienced'] as const

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  none: '未経験',
  some: '少し経験あり',
  experienced: '経験者',
}

export const RESPONSE_CHOICES = ['interested', 'thinking', 'skip'] as const

export type ResponseChoice = (typeof RESPONSE_CHOICES)[number]

export const RESPONSE_LABELS: Record<ResponseChoice, string> = {
  interested: '行ってみたい',
  thinking: 'あとで考える',
  skip: '今回は見送る',
}

export type ReceptionSettings = {
  paused: boolean
  allowedCategories: InterestCategory[]
  // 週あたりの受信上限（1〜5件）。上限の実判定はTask 004以降で行う
  weeklyLimit: number
}

// 氏名・顔写真・学籍番号・連絡先などの個人特定情報は定義しない（docs/matching_and_safety.md §2）
export type StudentPreference = {
  id: string
  displayName: string
  interests: InterestCategory[]
  purposes: Purpose[]
  style: ActivityStyle
  frequency: Frequency
  availableDays: DaySlot[]
  experience: ExperienceLevel
  // 1回あたりの予算上限（円）。月額とは比較しない（docs/decisions.md D019）
  maxFeePerEventYen: number
  reception: ReceptionSettings
}

export type Club = {
  id: string
  name: string
  verified: boolean
  description: string
}

// マッチングに使う属性はすべてオファー側が持つ（docs/matching_and_safety.md §3）
export type ClubOffer = {
  id: string
  clubId: string
  eventName: string
  description: string
  reasonNote: string
  dateText: string
  place: string
  eventDays: DaySlot[]
  frequency: Frequency
  // 1回あたりの参加費（円）。学生予算と同一単位（docs/decisions.md D019）
  feePerEventYen: number
  beginnerFriendly: boolean
  intensity: ActivityStyle
  targetCategories: InterestCategory[]
  targetPurposes: Purpose[]
  capacity: number
  deadline: string
}

export type MatchResult = {
  eligible: boolean
  score: number
  reasons: string[]
  cautions: string[]
}

export type OfferResponse = {
  offerId: string
  studentId: string
  choice: ResponseChoice
  respondedAt: string
}
