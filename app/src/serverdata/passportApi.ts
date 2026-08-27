import type { StudentPreference } from '../domain/types'
import type { Database } from '../lib/database.types'
import type { CueSupabaseClient } from '../lib/supabaseClient'

// 興味パスポートのサーバー入出力。
// 読取は自分の行のSELECT（RLS）、書込はsave_student_passport RPCのみ。
// 画面・ローカル状態にはauth UUIDを流通させない（id/displayNameは固定の自己表示値）

export type PassportRow = Database['public']['Tables']['student_passports']['Row']

// 認証済みアプリ内の自己参照ID。表示・保存されず、型都合のプレースホルダー
export const SELF_STUDENT_ID = 'me'
export const SELF_DISPLAY_NAME = 'あなた'

export function passportRowToPreference(row: PassportRow): StudentPreference {
  return {
    id: SELF_STUDENT_ID,
    displayName: SELF_DISPLAY_NAME,
    interests: [...row.interests],
    purposes: [...row.purposes],
    style: row.style,
    frequency: row.frequency,
    availableDays: [...row.available_days],
    experience: row.experience,
    maxFeePerEventYen: row.max_fee_per_event_yen,
    reception: {
      paused: row.reception_paused,
      allowedCategories: [...row.reception_categories],
      weeklyLimit: row.reception_weekly_limit,
    },
  }
}

export function preferenceToSaveArgs(
  preference: StudentPreference,
): Database['public']['Functions']['save_student_passport']['Args'] {
  return {
    interests: [...preference.interests],
    purposes: [...preference.purposes],
    style: preference.style,
    frequency: preference.frequency,
    available_days: [...preference.availableDays],
    experience: preference.experience,
    max_fee_per_event_yen: preference.maxFeePerEventYen,
    reception_paused: preference.reception.paused,
    reception_categories: [...preference.reception.allowedCategories],
    reception_weekly_limit: preference.reception.weeklyLimit,
  }
}

// 自分のパスポートを取得する。未登録はnull（RLSにより他人の行は返らない）
export async function fetchMyPassport(
  client: CueSupabaseClient,
): Promise<StudentPreference | null> {
  const { data, error } = await client.from('student_passports').select('*').maybeSingle()
  if (error) throw error
  return data === null ? null : passportRowToPreference(data)
}

export async function saveMyPassport(
  client: CueSupabaseClient,
  preference: StudentPreference,
): Promise<void> {
  const { error } = await client.rpc('save_student_passport', preferenceToSaveArgs(preference))
  if (error) throw error
}
