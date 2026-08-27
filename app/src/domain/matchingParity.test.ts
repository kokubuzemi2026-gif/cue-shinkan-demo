import { describe, expect, it } from 'vitest'

import { calculateMatch } from './matching'
import type {
  ActivityStyle,
  ClubOffer,
  DaySlot,
  ExperienceLevel,
  Frequency,
  InterestCategory,
  Purpose,
  StudentPreference,
} from './types'

// Task 009: TypeScript実装（calculateMatch）とSQL実装（private.match_passport）の
// 判定同一性を担保するケース表。app/supabase/tests/12_matching_parity_test.sql と
// 完全同一のC01〜C16・同一の期待文字列を持つ（D028のメール判定表と同じ双実装パターン）。
// 期待値の表記: eligible(t/f) | score | 理由を「/」連結 | 注意を「/」連結

type StudentSpec = {
  interests: InterestCategory[]
  purposes: Purpose[]
  style: ActivityStyle
  frequency: Frequency
  days: DaySlot[]
  experience: ExperienceLevel
  fee: number
  paused: boolean
  categories: InterestCategory[]
  weekly: number
}

type OfferSpec = {
  categories: InterestCategory[]
  purposes: Purpose[]
  intensity: ActivityStyle
  days: DaySlot[]
  frequency: Frequency
  fee: number
  beginner: boolean
}

function mkStudent(spec: StudentSpec): StudentPreference {
  return {
    id: 'parity-student',
    displayName: 'あなた',
    interests: spec.interests,
    purposes: spec.purposes,
    style: spec.style,
    frequency: spec.frequency,
    availableDays: spec.days,
    experience: spec.experience,
    maxFeePerEventYen: spec.fee,
    reception: {
      paused: spec.paused,
      allowedCategories: spec.categories,
      weeklyLimit: spec.weekly,
    },
  }
}

function mkOffer(spec: OfferSpec): ClubOffer {
  return {
    id: 'parity-offer',
    clubId: 'parity-club',
    eventName: 'パリティ検証イベント',
    description: '説明',
    reasonNote: '理由',
    dateText: '9月13日（土）',
    place: 'どこか',
    eventDays: spec.days,
    frequency: spec.frequency,
    feePerEventYen: spec.fee,
    beginnerFriendly: spec.beginner,
    intensity: spec.intensity,
    targetCategories: spec.categories,
    targetPurposes: spec.purposes,
    capacity: 10,
    deadline: '2026-09-10',
  }
}

function matchText(student: StudentSpec, offer: OfferSpec): string {
  const result = calculateMatch(mkStudent(student), mkOffer(offer))
  return [
    result.eligible ? 't' : 'f',
    String(result.score),
    result.reasons.join('/'),
    result.cautions.join('/'),
  ].join('|')
}

// SQL側（12_matching_parity_test.sql）と1文字も違わないこと
const CASES: { id: string; student: StudentSpec; offer: OfferSpec; expected: string }[] = [
  {
    id: 'C01: 完全一致は100点・理由3件・注意0件',
    student: { interests: ['outdoor', 'photo', 'travel'], purposes: ['friends', 'challenge'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'photo', 'travel'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 't|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  },
  {
    id: 'C02: 興味0点でも65点でeligible・興味以外の理由が並ぶ',
    student: { interests: ['outdoor'], purposes: ['friends', 'challenge'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'music'], weekly: 3 },
    offer: { categories: ['music'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 't|65|土日に参加しやすい/未経験でも歓迎される活動/『友達を作る』の目的が合っている|',
  },
  {
    id: 'C03: 63点はeligibleでない・費用と初心者対応の注意',
    student: { interests: ['outdoor'], purposes: ['friends', 'challenge'], style: 'serious', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 1000, paused: false, categories: ['outdoor'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekday_day'], frequency: 'monthly_1_2', fee: 1500, beginner: false },
    expected: 'f|63|アウトドアに興味がある/『友達を作る』の目的が合っている|参加費（1,500円）は希望予算（1回1,000円以内）より高めです/未経験者向けの案内がないイベントです',
  },
  {
    id: 'C04: 受信停止中は100点でも配信対象外',
    student: { interests: ['outdoor', 'photo', 'travel'], purposes: ['friends', 'challenge'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: true, categories: ['outdoor', 'photo', 'travel'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 'f|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  },
  {
    id: 'C05: 対象カテゴリの受信を許可していなければ配信対象外',
    student: { interests: ['outdoor', 'photo', 'travel'], purposes: ['friends', 'challenge'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['music'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 'f|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  },
  {
    id: 'C06: 経験を活かす理由と同額予算内の理由',
    student: { interests: ['outdoor'], purposes: ['creation'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'experienced', fee: 2000, paused: false, categories: ['outdoor'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekday_night'], frequency: 'monthly_1_2', fee: 2000, beginner: false },
    expected: 't|65|アウトドアに興味がある/経験を活かしやすい活動/参加費が予算内|',
  },
  {
    id: 'C07: 1円でも予算超過なら減点し、3桁区切りの注意を出す',
    student: { interests: ['outdoor'], purposes: ['creation'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'experienced', fee: 2000, paused: false, categories: ['outdoor'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekday_night'], frequency: 'monthly_1_2', fee: 2001, beginner: false },
    expected: 'f|60|アウトドアに興味がある/経験を活かしやすい活動|参加費（2,001円）は希望予算（1回2,000円以内）より高めです',
  },
  {
    id: 'C08: 目的1件一致は10点（90点）',
    student: { interests: ['outdoor', 'photo', 'travel'], purposes: ['friends', 'exercise'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'photo', 'travel'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 't|90|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  },
  {
    id: 'C09: ゆるく×本格的は0点+本気度の注意',
    student: { interests: ['outdoor', 'photo', 'travel'], purposes: ['friends', 'challenge'], style: 'relaxed', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'photo', 'travel'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'serious', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 't|85|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|活動の本気度は希望より高めです',
  },
  {
    id: 'C10: 頻度過多の注意',
    student: { interests: ['outdoor', 'photo', 'travel'], purposes: ['friends', 'challenge'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'photo', 'travel'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'weekly_2_plus', fee: 1500, beginner: true },
    expected: 't|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|活動頻度（週2回以上）は希望より多めです',
  },
  {
    id: 'C11: 頻度が少ない側なら注意なし',
    student: { interests: ['outdoor', 'photo', 'travel'], purposes: ['friends', 'challenge'], style: 'moderate', frequency: 'weekly_2_plus', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'photo', 'travel'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 't|100|アウトドアに興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  },
  {
    id: 'C12: 4候補あっても注意は先頭2件のみ',
    student: { interests: ['outdoor'], purposes: ['friends', 'challenge'], style: 'relaxed', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 1000, paused: false, categories: ['outdoor'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'serious', days: ['weekend'], frequency: 'weekly_2_plus', fee: 1500, beginner: false },
    expected: 't|70|アウトドアに興味がある/土日に参加しやすい/『友達を作る』の目的が合っている|参加費（1,500円）は希望予算（1回1,000円以内）より高めです/活動頻度（週2回以上）は希望より多めです',
  },
  {
    id: 'C13: 興味理由は学生の登録順（オファー側の順ではない）',
    student: { interests: ['photo', 'outdoor'], purposes: ['friends', 'challenge'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'photo', 'travel'], weekly: 3 },
    offer: { categories: ['outdoor', 'photo'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 't|100|写真に興味がある/土日に参加しやすい/未経験でも歓迎される活動|',
  },
  {
    id: 'C14: 曜日理由は定義順（平日昼→平日夜→土日）で選ぶ',
    student: { interests: ['outdoor', 'photo', 'travel'], purposes: ['friends', 'challenge'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend', 'weekday_night'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'photo', 'travel'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekday_night', 'weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 't|100|アウトドアに興味がある/平日夜に参加しやすい/未経験でも歓迎される活動|',
  },
  {
    id: 'C15: 目的理由は学生の登録順で最初の一致',
    student: { interests: ['outdoor'], purposes: ['challenge', 'friends'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'none', fee: 2000, paused: false, categories: ['outdoor', 'music'], weekly: 3 },
    offer: { categories: ['music'], purposes: ['friends', 'challenge'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 1500, beginner: true },
    expected: 't|65|土日に参加しやすい/未経験でも歓迎される活動/『新しいことへ挑戦』の目的が合っている|',
  },
  {
    id: 'C16: 0円同士は予算内（経験「少し」は理由なしの部分点）',
    student: { interests: ['outdoor'], purposes: ['creation'], style: 'moderate', frequency: 'monthly_1_2', days: ['weekend'], experience: 'some', fee: 0, paused: false, categories: ['outdoor'], weekly: 3 },
    offer: { categories: ['outdoor'], purposes: ['creation'], intensity: 'moderate', days: ['weekend'], frequency: 'monthly_1_2', fee: 0, beginner: false },
    expected: 't|85|アウトドアに興味がある/土日に参加しやすい/『創作する』の目的が合っている|',
  },
]

describe('TS/SQLマッチング同値ケース表（12_matching_parity_test.sqlと同一）', () => {
  for (const testCase of CASES) {
    it(testCase.id, () => {
      expect(matchText(testCase.student, testCase.offer)).toBe(testCase.expected)
    })
  }
})
