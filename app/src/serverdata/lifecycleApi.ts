import type { CueSupabaseClient } from '../lib/supabaseClient'

// Task 014: 本人による削除・脱退（D046〜D048）。
// いずれもサーバー側が本人確認と最終ownerガードを持ち、
// クライアントは結果を表示するだけにする

export async function deleteStudentPassport(client: CueSupabaseClient): Promise<void> {
  const { error } = await client.rpc('delete_student_passport')
  if (error) throw error
}

export type AccountDeletionResult = {
  // 消した行数（0でも、残った団体があれば成功として返る）
  removedRows: number
  // 自分が最後の代表者のため外せなかった団体の数。
  // 0でなければ「団体の担当だけが残っている」ことを画面で伝える
  blockingOrganizations: number
}

export async function deleteMyAccount(
  client: CueSupabaseClient,
): Promise<AccountDeletionResult> {
  const { data, error } = await client.rpc('delete_my_account')
  if (error) throw error
  const row = (data ?? [])[0]
  return {
    removedRows: row?.removed_rows ?? 0,
    blockingOrganizations: row?.blocking_organizations ?? 0,
  }
}

export async function leaveOrganization(
  client: CueSupabaseClient,
  organizationId: string,
): Promise<void> {
  const { error } = await client.rpc('leave_organization', { org_id: organizationId })
  if (error) throw error
}
