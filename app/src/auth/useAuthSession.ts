import { useEffect, useState } from 'react'

import type { CueSupabaseClient } from '../lib/supabaseClient'

// セッション状態（復元中 / 未ログイン / ログイン済み）。
// auth-jsが自身のキー（sb-*）でセッションを永続化する。CUEのlocalStorageキーには触れない
export type SessionState =
  | { status: 'restoring' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; userId: string }

export function useAuthSession(client: CueSupabaseClient): {
  session: SessionState
  signOut: () => Promise<void>
} {
  const [session, setSession] = useState<SessionState>({ status: 'restoring' })

  useEffect(() => {
    let active = true

    // 初期復元。onAuthStateChangeのINITIAL_SESSIONと重複しても同じ値のため冪等
    void client.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(
        data.session === null
          ? { status: 'signedOut' }
          : { status: 'signedIn', userId: data.session.user.id },
      )
    })

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(
        nextSession === null
          ? { status: 'signedOut' }
          : { status: 'signedIn', userId: nextSession.user.id },
      )
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [client])

  const signOut = async () => {
    try {
      await client.auth.signOut()
    } catch {
      // ネットワーク失敗でもローカルセッションは破棄される。状態はonAuthStateChangeが反映する
    }
  }

  return { session, signOut }
}
