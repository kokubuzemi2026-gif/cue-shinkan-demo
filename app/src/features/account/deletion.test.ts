import { describe, expect, it } from 'vitest'

import {
  canConfirm,
  DELETION_COPY,
  deletionReducer,
  INITIAL_DELETION_STATE,
  IRREVERSIBLE_NOTICE,
  type DeletionState,
} from './deletion'

describe('deletionReducer', () => {
  it('確認を経ないと実行段階へ進めない（1タップで消えない）', () => {
    const started = deletionReducer(INITIAL_DELETION_STATE, { type: 'start' })
    expect(started.phase).toBe('idle')
    expect(canConfirm(INITIAL_DELETION_STATE)).toBe(false)
  })

  it('要求→確認→実行→完了と進む', () => {
    const confirming = deletionReducer(INITIAL_DELETION_STATE, { type: 'request' })
    expect(confirming.phase).toBe('confirming')
    expect(canConfirm(confirming)).toBe(true)
    const running = deletionReducer(confirming, { type: 'start' })
    expect(running.phase).toBe('running')
    expect(canConfirm(running)).toBe(false)
    expect(deletionReducer(running, { type: 'succeeded' }).phase).toBe('done')
  })

  it('実行中は取り消しも再要求も効かない（二重送信の入口を作らない）', () => {
    const running: DeletionState = { phase: 'running', error: null }
    expect(deletionReducer(running, { type: 'cancel' })).toBe(running)
    expect(deletionReducer(running, { type: 'request' })).toBe(running)
  })

  it('失敗したら確認段階へ戻し、理由を保持する', () => {
    const running: DeletionState = { phase: 'running', error: null }
    const failed = deletionReducer(running, { type: 'failed', message: '団体のownerです' })
    expect(failed.phase).toBe('confirming')
    expect(failed.error).toBe('団体のownerです')
    // 再試行すると理由は消える
    expect(deletionReducer(failed, { type: 'start' }).error).toBeNull()
  })

  it('取り消すと初期状態へ戻り、理由も消える', () => {
    const failed: DeletionState = { phase: 'confirming', error: '失敗' }
    expect(deletionReducer(failed, { type: 'cancel' })).toEqual(INITIAL_DELETION_STATE)
  })
})

describe('DELETION_COPY', () => {
  it('3種類すべてに、消えるものと残るものが書かれている', () => {
    for (const copy of Object.values(DELETION_COPY)) {
      expect(copy.removed.length).toBeGreaterThan(0)
      expect(copy.kept.length).toBeGreaterThan(0)
      expect(copy.confirmTitle.length).toBeGreaterThan(0)
    }
  })

  it('パスポート削除では、受信済みの案内が残ることを明示する（D023）', () => {
    const kept = DELETION_COPY.passport.kept.join('')
    expect(kept).toContain('すでに届いている案内')
    // アカウントは消えないことも書く
    expect(kept).toContain('アカウント')
  })

  it('アカウント削除では、団体側に個人が残らないことを明示する（D029）', () => {
    expect(DELETION_COPY.account.kept.join('')).toContain('あなた個人は含まれません')
  })

  // M-5: 最も重要な残存物（大学メール）を、決定の瞬間の一覧から外さない
  it('アカウント削除では、大学メールのログイン情報が残ることを明示する', () => {
    const kept = DELETION_COPY.account.kept.join('')
    expect(kept).toContain('大学メール')
    expect(kept).toContain('運営が行います')
  })

  // L-1: 届いた案内には「届いた理由」として登録時の条件が書かれている
  it('パスポート削除では、案内に書かれた「届いた理由」が残ることを明示する', () => {
    expect(DELETION_COPY.passport.kept.join('')).toContain('届いた理由')
  })

  it('取り消せない旨の文言がある', () => {
    expect(IRREVERSIBLE_NOTICE).toContain('取り消せません')
  })
})
