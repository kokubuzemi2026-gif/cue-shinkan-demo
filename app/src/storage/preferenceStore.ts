import {
  ACTIVITY_STYLES,
  DAY_SLOTS,
  EXPERIENCE_LEVELS,
  FREQUENCIES,
  INTEREST_CATEGORIES,
  PURPOSES,
  type StudentPreference,
} from '../domain/types'
import {
  createJsonStore,
  getDefaultStorage,
  type JsonStore,
  type StorageLike,
} from './appStorage'

export const STUDENT_PREFERENCE_KEY = 'cue-demo:student-preference'
export const STUDENT_PREFERENCE_SCHEMA_VERSION = 1

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function isArrayOf<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return Array.isArray(value) && value.every((item) => isOneOf(item, allowed))
}

function isReception(value: unknown): value is StudentPreference['reception'] {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.paused === 'boolean' &&
    isArrayOf(candidate.allowedCategories, INTEREST_CATEGORIES) &&
    typeof candidate.weeklyLimit === 'number' &&
    Number.isInteger(candidate.weeklyLimit) &&
    // 週上限は1〜5件（docs/matching_and_safety.md §5）
    candidate.weeklyLimit >= 1 &&
    candidate.weeklyLimit <= 5
  )
}

// localStorage由来の値は型が保証されないため、ドメイン定数の集合まで検証する
export function isStudentPreference(value: unknown): value is StudentPreference {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.displayName === 'string' &&
    candidate.displayName.length > 0 &&
    isArrayOf(candidate.interests, INTEREST_CATEGORIES) &&
    isArrayOf(candidate.purposes, PURPOSES) &&
    isOneOf(candidate.style, ACTIVITY_STYLES) &&
    isOneOf(candidate.frequency, FREQUENCIES) &&
    isArrayOf(candidate.availableDays, DAY_SLOTS) &&
    isOneOf(candidate.experience, EXPERIENCE_LEVELS) &&
    typeof candidate.maxFeePerEventYen === 'number' &&
    Number.isFinite(candidate.maxFeePerEventYen) &&
    candidate.maxFeePerEventYen >= 0 &&
    isReception(candidate.reception)
  )
}

export function createStudentPreferenceStore(
  storage: StorageLike | null,
): JsonStore<StudentPreference> {
  return createJsonStore(
    storage,
    STUDENT_PREFERENCE_KEY,
    STUDENT_PREFERENCE_SCHEMA_VERSION,
    isStudentPreference,
  )
}

// アプリ本体が使う唯一のインスタンス。テストではcreateStudentPreferenceStoreへ
// フェイクStorageを注入して検証する。
export const studentPreferenceStore = createStudentPreferenceStore(getDefaultStorage())
