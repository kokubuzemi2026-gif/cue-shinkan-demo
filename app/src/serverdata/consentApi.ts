import type { CueSupabaseClient } from '../lib/supabaseClient'

// Task 015: 同意の状況取得と記録（D050）。
// 版が上がると needsConsent が true になり、再同意するまで登録できない（DB側で強制）

export type ConsentStatus = {
  agreedVersion: number | null
  currentVersion: number
  needsConsent: boolean
}

export async function fetchConsent(client: CueSupabaseClient): Promise<ConsentStatus> {
  const { data, error } = await client.rpc('my_consent')
  if (error) throw error
  const row = (data ?? [])[0]
  return {
    agreedVersion: row?.agreed_version ?? null,
    currentVersion: row?.current_version ?? 1,
    needsConsent: row?.needs_consent ?? true,
  }
}

// 画面が受け取った版で同意する（版が食い違うとサーバーが拒否する）
export async function recordConsent(
  client: CueSupabaseClient,
  version: number,
): Promise<void> {
  const { error } = await client.rpc('record_consent', { version })
  if (error) throw error
}
