import type { CueSupabaseClient } from '../lib/supabaseClient'

// Task 014: 本人による削除・脱退（D046〜D048）。
// いずれもサーバー側が本人確認と最終ownerガードを持ち、
// クライアントは結果を表示するだけにする

export async function deleteStudentPassport(client: CueSupabaseClient): Promise<void> {
  const { error } = await client.rpc('delete_student_passport')
  if (error) throw error
}

export async function deleteMyAccount(client: CueSupabaseClient): Promise<void> {
  const { error } = await client.rpc('delete_my_account')
  if (error) throw error
}

export async function leaveOrganization(
  client: CueSupabaseClient,
  organizationId: string,
): Promise<void> {
  const { error } = await client.rpc('leave_organization', { org_id: organizationId })
  if (error) throw error
}
