// 削除導線の純粋ロジック（Task 014・D046〜D048）。
// 「取り消せない」ことを操作の前に必ず出し、1タップで消えないよう2段階にする。
// 文言をここへ集約するのは、画面ごとに説明がずれると
// 「何が消えて何が残るのか」を利用者が読み解けなくなるため

export type DeletionKind = 'passport' | 'account' | 'membership'

export type DeletionCopy = {
  // 操作の名前（ボタン）
  action: string
  // 確認段階の見出し
  confirmTitle: string
  // 消えるもの・残るもの。箇条書きで示す
  removed: string[]
  kept: string[]
  // 実行ボタン
  confirmAction: string
  // 実行後の報告
  done: string
}

export const IRREVERSIBLE_NOTICE = 'この操作は取り消せません。'

export const DELETION_COPY: Record<DeletionKind, DeletionCopy> = {
  passport: {
    action: '興味パスポートを削除',
    confirmTitle: '興味パスポートを削除しますか？',
    removed: ['登録した興味・参加しやすい条件・受信の設定'],
    // D023: 受信済みの案内は履歴として残る。ここを書かないと
    // 「消したのに案内が残っている」と不信につながる
    kept: [
      // L-1: 届いた案内の「届いた理由」には登録時の条件が書かれている。
      // 「条件は消えた」と「案内に書かれた理由は残る」の両方を正直に伝える
      'すでに届いている案内と、あなたの返答（案内に書かれた「届いた理由」も含めて、受信箱でこれまでどおり見られます）',
      'アカウント（ログインはこれまでどおりできます）',
    ],
    confirmAction: '削除する',
    done: '興味パスポートを削除しました。新しい案内は届かなくなります。',
  },
  account: {
    action: 'アカウントを削除',
    confirmTitle: 'アカウントを削除しますか？',
    removed: [
      '興味パスポート',
      'すでに届いている案内と、あなたの返答',
      '通知の設定と、送信待ちの通知メール',
      '所属している団体からの脱退（あなたが唯一の代表者の団体を除く）',
    ],
    kept: [
      // M-5: 最も重要な残存物を、決定の瞬間に見せる一覧から外さない
      '大学メールでのログイン情報（削除は運営が行います。それまで、あらためて新入生として登録し直すこともできます）',
      '団体が保存している配信の記録（人数だけの集計で、あなた個人は含まれません）',
    ],
    confirmAction: 'アカウントを削除する',
    done: 'アカウントを削除しました。',
  },
  membership: {
    action: 'この団体から脱退',
    confirmTitle: 'この団体から脱退しますか？',
    removed: ['あなたのこの団体での担当者としての権限'],
    kept: [
      '団体そのものと、これまでの配信の記録',
      'あなたのアカウント（新入生としての利用は続けられます）',
    ],
    confirmAction: '脱退する',
    done: '団体から脱退しました。',
  },
}

// idle → confirming → running → done / error（errorからはconfirmingへ戻す）
export type DeletionPhase = 'idle' | 'confirming' | 'running' | 'done'

export type DeletionState = {
  phase: DeletionPhase
  error: string | null
}

export const INITIAL_DELETION_STATE: DeletionState = { phase: 'idle', error: null }

export type DeletionAction =
  | { type: 'request' }
  | { type: 'cancel' }
  | { type: 'start' }
  | { type: 'succeeded' }
  | { type: 'failed'; message: string }

export function deletionReducer(state: DeletionState, action: DeletionAction): DeletionState {
  switch (action.type) {
    case 'request':
      // 実行中の再要求は無視する（二重送信の入口を作らない）
      return state.phase === 'running' ? state : { phase: 'confirming', error: null }
    case 'cancel':
      return state.phase === 'running' ? state : INITIAL_DELETION_STATE
    case 'start':
      // 確認を経ていない実行は受け付けない（1タップで消えないことの保証）
      return state.phase === 'confirming' ? { phase: 'running', error: null } : state
    case 'succeeded':
      return state.phase === 'running' ? { phase: 'done', error: null } : state
    case 'failed':
      return state.phase === 'running'
        ? { phase: 'confirming', error: action.message }
        : state
    default:
      return state
  }
}

// 実行ボタンを押せるのは確認段階だけ。実行中は押せない
export function canConfirm(state: DeletionState): boolean {
  return state.phase === 'confirming'
}
