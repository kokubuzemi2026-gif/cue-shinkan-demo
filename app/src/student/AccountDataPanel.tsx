import { useReducer, useState } from 'react'

import {
  deletionReducer,
  INITIAL_DELETION_STATE,
} from '../features/account/deletion'
import { DeletionCard } from '../features/account/DeletionCard'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { serverErrorMessage } from '../serverdata/apiText'
import { deleteMyAccount, deleteStudentPassport } from '../serverdata/lifecycleApi'

// パスポートの状態は3値のまま受け取る（N1）。
// loading / error を「無い」へ潰すと、取得に失敗しただけの利用者へ
// 「新しい案内は届かない状態です」と誤って断定してしまう
export type PassportPresence = 'loading' | 'error' | 'none' | 'present'

type AccountDataPanelProps = {
  client: CueSupabaseClient
  passportPresence: PassportPresence
  onPassportDeleted: () => void
  onAccountDeleted: () => void
}

// アカウントとデータの管理（Task 014）。
// 取り消せない操作なので、タブを分けて誤操作の距離を取り、
// 実行前に「何が消えて何が残るか」を必ず出す（DeletionCard）
export function AccountDataPanel({
  client,
  passportPresence,
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
        // 受信箱・ホームの表示を最新にする。このパネルは完了表示を保持する
        onPassportDeleted()
      } catch (error) {
        passportDispatch({ type: 'failed', message: serverErrorMessage(error) })
      }
    })()
  }

  const [blockingOrganizations, setBlockingOrganizations] = useState(0)
  const runAccountDelete = () => {
    accountDispatch({ type: 'start' })
    void (async () => {
      try {
        const result = await deleteMyAccount(client)
        setBlockingOrganizations(result.blockingOrganizations)
        accountDispatch({ type: 'succeeded' })
        // シェルの再読込はここでは行わない。先に結果を見せ、
        // 利用者が「はじめの画面へ」を押してから切り替える
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

      {/* 削除に成功すると passportPresence は none になるが、完了表示は残す。
          結果を見せずにカードが「登録されていません」へ切り替わると、
          消えたのかどうかが利用者に分からない */}
      {passportPresence === 'present' || passportState.phase === 'done' ? (
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
          {/* N1: 読み込み中・失敗を「無い」と断定しない */}
          {passportPresence === 'loading' && (
            <p className="danger-note">興味パスポートの状態を確認しています…</p>
          )}
          {passportPresence === 'error' && (
            <p className="danger-note">
              興味パスポートの状態を確認できませんでした。通信環境を確認して、ホームから再試行してください。
            </p>
          )}
          {passportPresence === 'none' && (
            <p className="danger-note">
              興味パスポートは登録されていません。新しい案内は届かない状態です。
            </p>
          )}
        </section>
      )}

      <DeletionCard
        kind="account"
        state={accountState}
        onRequest={() => accountDispatch({ type: 'request' })}
        onCancel={() => accountDispatch({ type: 'cancel' })}
        onConfirm={runAccountDelete}
        doneAction={{ label: 'はじめの画面へ', onClick: onAccountDeleted }}
      />
      {/* H-1: 自分が唯一の代表者の団体は残る。何が残ったかを結果で伝える */}
      {accountState.phase === 'done' && blockingOrganizations > 0 && (
        <p className="form-error" role="status">
          あなたが唯一の代表者になっている団体（{blockingOrganizations}件）の担当は残っています。団体の削除や代表者の交代が必要な場合は、運営へ連絡してください。
        </p>
      )}

      <p className="auth-hint">
        大学メールでのログイン情報（アカウントそのもの）の削除は、運営が行います。それまでの間、あらためて新入生として登録し直すことはできます。
      </p>
    </>
  )
}
