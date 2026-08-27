import { useReducer } from 'react'

import {
  deletionReducer,
  INITIAL_DELETION_STATE,
} from '../features/account/deletion'
import { DeletionCard } from '../features/account/DeletionCard'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { serverErrorMessage } from '../serverdata/apiText'
import { deleteMyAccount, deleteStudentPassport } from '../serverdata/lifecycleApi'

type AccountDataPanelProps = {
  client: CueSupabaseClient
  hasPassport: boolean
  onPassportDeleted: () => void
  onAccountDeleted: () => void
}

// アカウントとデータの管理（Task 014）。
// 取り消せない操作なので、タブを分けて誤操作の距離を取り、
// 実行前に「何が消えて何が残るか」を必ず出す（DeletionCard）
export function AccountDataPanel({
  client,
  hasPassport,
  onPassportDeleted,
  onAccountDeleted,
}: AccountDataPanelProps) {
  const [passportState, passportDispatch] = useReducer(deletionReducer, INITIAL_DELETION_STATE)
  const [accountState, accountDispatch] = useReducer(deletionReducer, INITIAL_DELETION_STATE)

  const runPassportDelete = () => {
    passportDispatch({ type: 'start' })
    void (async () => {
      try {
        await deleteStudentPassport(client)
        passportDispatch({ type: 'succeeded' })
        onPassportDeleted()
      } catch (error) {
        passportDispatch({ type: 'failed', message: serverErrorMessage(error) })
      }
    })()
  }

  const runAccountDelete = () => {
    accountDispatch({ type: 'start' })
    void (async () => {
      try {
        await deleteMyAccount(client)
        accountDispatch({ type: 'succeeded' })
        onAccountDeleted()
      } catch (error) {
        accountDispatch({ type: 'failed', message: serverErrorMessage(error) })
      }
    })()
  }

  return (
    <>
      <h1 className="page-title">アカウントとデータ</h1>
      <p className="auth-text">
        CUEに保存されているあなたのデータを、自分で削除できます。削除した内容は元に戻せません。
      </p>

      {hasPassport ? (
        <DeletionCard
          kind="passport"
          state={passportState}
          onRequest={() => passportDispatch({ type: 'request' })}
          onCancel={() => passportDispatch({ type: 'cancel' })}
          onConfirm={runPassportDelete}
        />
      ) : (
        <section className="danger-card" aria-label="興味パスポートを削除">
          <h2 className="danger-heading">興味パスポートを削除</h2>
          <p className="danger-note">
            興味パスポートは登録されていません。新しい案内は届かない状態です。
          </p>
        </section>
      )}

      <DeletionCard
        kind="account"
        state={accountState}
        onRequest={() => accountDispatch({ type: 'request' })}
        onCancel={() => accountDispatch({ type: 'cancel' })}
        onConfirm={runAccountDelete}
      />

      <p className="auth-hint">
        大学メールでのログイン情報（アカウントそのもの）の削除は、運営が行います。アカウントを削除したあと、
        ログインしても利用できる権限はありません。
      </p>
    </>
  )
}
