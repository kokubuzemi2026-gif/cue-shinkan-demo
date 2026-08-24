import { useCallback, useEffect, useState } from 'react'

import type { CueSupabaseClient } from '../lib/supabaseClient'
import type { MembershipInfo, MyAccount } from './contextModel'

// 自分の権限の読取り。
// 1) rpc('is_university_user')で認証境界を確認（false→accessBlocked表示の根拠）
// 2) student_accounts（RLSで自分の行のみ）と自分の所属＋所属団体を取得する。
// エラー詳細は画面へ出さない（メール・トークンを含み得るため）
export type AccountLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; account: MyAccount }

export function useMyAccount(
  client: CueSupabaseClient,
  userId: string,
): { state: AccountLoadState; reload: () => void } {
  const [state, setState] = useState<AccountLoadState>({ status: 'loading' })
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })

    void (async () => {
      try {
        const { data: isUniversity, error: universityError } =
          await client.rpc('is_university_user')
        if (universityError) throw universityError
        if (isUniversity !== true) {
          if (active) {
            setState({
              status: 'loaded',
              account: { isUniversityUser: false, hasStudentAccount: false, memberships: [] },
            })
          }
          return
        }

        const { data: studentRow, error: studentError } = await client
          .from('student_accounts')
          .select('user_id')
          .maybeSingle()
        if (studentError) throw studentError

        const { data: membershipRows, error: membershipError } = await client
          .from('organization_memberships')
          .select('organization_id, role, member_label, joined_at')
          .order('joined_at', { ascending: true })
        if (membershipError) throw membershipError

        const rows = membershipRows ?? []
        const organizationIds = rows.map((row) => row.organization_id)
        let organizationRows: {
          id: string
          name: string
          description: string
          status: MembershipInfo['organizationStatus']
        }[] = []
        if (organizationIds.length > 0) {
          const { data, error } = await client
            .from('organizations')
            .select('id, name, description, status')
            .in('id', organizationIds)
          if (error) throw error
          organizationRows = data ?? []
        }

        const memberships: MembershipInfo[] = rows.flatMap((row) => {
          const organization = organizationRows.find((org) => org.id === row.organization_id)
          if (organization === undefined) return []
          return [
            {
              organizationId: row.organization_id,
              organizationName: organization.name,
              organizationDescription: organization.description,
              organizationStatus: organization.status,
              role: row.role,
              memberLabel: row.member_label,
              joinedAt: row.joined_at,
            },
          ]
        })

        if (active) {
          setState({
            status: 'loaded',
            account: {
              isUniversityUser: true,
              hasStudentAccount: studentRow !== null,
              memberships,
            },
          })
        }
      } catch {
        if (active) setState({ status: 'error' })
      }
    })()

    return () => {
      active = false
    }
  }, [client, userId, reloadCount])

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1)
  }, [])

  return { state, reload }
}

// 初回権限登録・後からの権限追加で共用する（student_accountsの唯一の書込経路）
export async function registerStudentAccount(
  client: CueSupabaseClient,
  userId: string,
): Promise<boolean> {
  const { error } = await client.from('student_accounts').insert({ user_id: userId })
  return error === null
}
