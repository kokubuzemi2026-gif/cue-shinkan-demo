import { describe, expect, it } from 'vitest'

import { buildSeedDeliveries } from '../data/demoDeliverySeed'
import { nextCreatedOfferId } from '../features/club/delivery'
import type { StorageLike } from './appStorage'
import { createOfferDeliveryStore } from './deliveryStore'
import {
  consumeResetCompleted,
  DEMO_STORAGE_KEYS,
  markResetCompleted,
  RESET_COMPLETED_FLAG,
  resetDemoStorage,
} from './demoReset'
import { createStudentPreferenceStore } from './preferenceStore'
import { createOfferReadStore } from './readStore'
import { createOfferResponseStore } from './responseStore'

// 期待値はリテラル固定。実装関数から期待値を生成しない

type FakeStorage = StorageLike & { dump(): Record<string, string> }

function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    dump: () => Object.fromEntries(map.entries()),
  }
}

// CUEの4キーが埋まった「汚れた」状態＋unrelated key
function dirtyState(): Record<string, string> {
  return {
    'cue-demo:student-preference': '{"schemaVersion":1,"data":{}}',
    'cue-demo:offer-responses': '{"schemaVersion":1,"data":[]}',
    'cue-demo:offer-reads': '{"schemaVersion":1,"data":[]}',
    'cue-demo:offer-deliveries': '{"schemaVersion":1,"data":[]}',
    'other-app:x': 'keep-me',
    'cue-demo-similar': 'not-ours-keep',
  }
}

describe('resetDemoStorage', () => {
  it('成功時: CUEの4キーだけ削除され、ok:trueを返す', () => {
    const storage = createFakeStorage(dirtyState())
    expect(resetDemoStorage(storage)).toEqual({ ok: true })
    for (const key of DEMO_STORAGE_KEYS) {
      expect(storage.getItem(key)).toBeNull()
    }
  })

  it('成功時: unrelated key（他アプリ・類似名）は保持される', () => {
    const storage = createFakeStorage(dirtyState())
    resetDemoStorage(storage)
    expect(storage.getItem('other-app:x')).toBe('keep-me')
    expect(storage.getItem('cue-demo-similar')).toBe('not-ours-keep')
  })

  it('2番目のキーのremoveItemだけ失敗すると、元の4値へrollbackしてreset-failed/completeを返す', () => {
    const initial = dirtyState()
    const storage = createFakeStorage(initial)
    const originalRemove = storage.removeItem.bind(storage)
    storage.removeItem = (key) => {
      if (key === 'cue-demo:offer-responses') throw new Error('blocked')
      originalRemove(key)
    }
    const result = resetDemoStorage(storage)
    expect(result).toEqual({ ok: false, reason: 'reset-failed', rollback: 'complete' })
    // rollbackはremoveItem不能キーには不要（そもそも消えていない）で、他3キーはsetItemで復元される
    for (const key of DEMO_STORAGE_KEYS) {
      expect(storage.getItem(key)).toBe(initial[key])
    }
  })

  it('失敗時もunrelated keyは不変のまま', () => {
    const storage = createFakeStorage(dirtyState())
    const originalRemove = storage.removeItem.bind(storage)
    storage.removeItem = (key) => {
      if (key === 'cue-demo:offer-reads') throw new Error('blocked')
      originalRemove(key)
    }
    resetDemoStorage(storage)
    expect(storage.getItem('other-app:x')).toBe('keep-me')
    expect(storage.getItem('cue-demo-similar')).toBe('not-ours-keep')
  })

  it('rollbackのsetItemも一部失敗するとrollback:partialを返す', () => {
    const storage = createFakeStorage(dirtyState())
    const originalRemove = storage.removeItem.bind(storage)
    const originalSet = storage.setItem.bind(storage)
    // preferenceは消えるが、responsesの削除が失敗して全体は失敗。
    // rollbackでpreferenceを書き戻そうとするとsetItemも失敗する
    storage.removeItem = (key) => {
      if (key === 'cue-demo:offer-responses') throw new Error('blocked')
      originalRemove(key)
    }
    storage.setItem = (key, value) => {
      if (key === 'cue-demo:student-preference') throw new Error('quota')
      originalSet(key, value)
    }
    const result = resetDemoStorage(storage)
    expect(result).toEqual({ ok: false, reason: 'reset-failed', rollback: 'partial' })
  })

  it('元から不存在のキーはrollback後も不存在のまま（complete判定）', () => {
    // preference未保存（キーなし）の状態で、deliveriesの削除だけ失敗させる
    const initial = dirtyState()
    delete (initial as Record<string, string | undefined>)['cue-demo:student-preference']
    const storage = createFakeStorage(initial)
    const originalRemove = storage.removeItem.bind(storage)
    storage.removeItem = (key) => {
      if (key === 'cue-demo:offer-deliveries') throw new Error('blocked')
      originalRemove(key)
    }
    const result = resetDemoStorage(storage)
    expect(result).toEqual({ ok: false, reason: 'reset-failed', rollback: 'complete' })
    expect(storage.getItem('cue-demo:student-preference')).toBeNull()
    expect(storage.getItem('cue-demo:offer-responses')).toBe(initial['cue-demo:offer-responses'])
  })

  it('snapshot読取が例外のキーを含む失敗はrollback:partialとして報告する', () => {
    const storage = createFakeStorage(dirtyState())
    const originalGet = storage.getItem.bind(storage)
    let snapshotPhase = true
    storage.getItem = (key) => {
      // snapshot段階のpreference読取だけ失敗させる（以後の検証読取は成功）
      if (snapshotPhase && key === 'cue-demo:student-preference') {
        throw new Error('read blocked')
      }
      return originalGet(key)
    }
    const originalRemove = storage.removeItem.bind(storage)
    storage.removeItem = (key) => {
      snapshotPhase = false
      if (key === 'cue-demo:offer-responses') throw new Error('blocked')
      originalRemove(key)
    }
    const result = resetDemoStorage(storage)
    expect(result).toEqual({ ok: false, reason: 'reset-failed', rollback: 'partial' })
  })

  it('storageがnullならstorage-unavailable/complete（何も変更していない）を例外なく返す', () => {
    expect(resetDemoStorage(null)).toEqual({
      ok: false,
      reason: 'storage-unavailable',
      rollback: 'complete',
    })
  })

  it('検証のgetItemが例外を投げてもreset-failedへ縮退する（消えたつもりを防ぐ）', () => {
    const storage = createFakeStorage(dirtyState())
    const originalGet = storage.getItem.bind(storage)
    let phase: 'snapshot' | 'verify' = 'snapshot'
    let snapshotReads = 0
    storage.getItem = (key) => {
      if (phase === 'snapshot') {
        snapshotReads += 1
        if (snapshotReads === DEMO_STORAGE_KEYS.length) phase = 'verify'
        return originalGet(key)
      }
      throw new Error('verify blocked')
    }
    const result = resetDemoStorage(storage)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('reset-failed')
    }
  })

  it('idempotent: 成功後にもう一度実行してもok:trueで状態は同一', () => {
    const storage = createFakeStorage(dirtyState())
    expect(resetDemoStorage(storage)).toEqual({ ok: true })
    const afterFirst = storage.dump()
    expect(resetDemoStorage(storage)).toEqual({ ok: true })
    expect(storage.dump()).toEqual(afterFirst)
  })

  it('成功後は4store.load()がすべてnull（通常bootstrapのcanonical再シード条件）', () => {
    const storage = createFakeStorage(dirtyState())
    resetDemoStorage(storage)
    expect(createStudentPreferenceStore(storage).load()).toBeNull()
    expect(createOfferResponseStore(storage).load()).toBeNull()
    expect(createOfferReadStore(storage).load()).toBeNull()
    expect(createOfferDeliveryStore(storage).load()).toBeNull()
  })

  it('リセット後の次の作成IDはoffer-created-1（NB-1採番の初期値維持）', () => {
    expect(nextCreatedOfferId(buildSeedDeliveries(), [])).toBe('offer-created-1')
  })
})

describe('リセット完了フラグ（sessionStorage一時マーカー）', () => {
  it('markで保存され、consumeは1回だけtrueを返し2回目はfalse', () => {
    const session = createFakeStorage()
    markResetCompleted(session)
    expect(session.getItem(RESET_COMPLETED_FLAG)).toBe('1')
    expect(consumeResetCompleted(session)).toBe(true)
    expect(session.getItem(RESET_COMPLETED_FLAG)).toBeNull()
    expect(consumeResetCompleted(session)).toBe(false)
  })

  it('フラグ不存在ならfalseで、他のキーへ影響しない', () => {
    const session = createFakeStorage({ 'qa:other': 'x' })
    expect(consumeResetCompleted(session)).toBe(false)
    expect(session.getItem('qa:other')).toBe('x')
  })

  it('session storageがnull・例外でもmarkは握って続行しconsumeはfalse（通知経路のクラッシュ防止）', () => {
    expect(() => markResetCompleted(null)).not.toThrow()
    expect(consumeResetCompleted(null)).toBe(false)
    const throwing = createFakeStorage()
    throwing.setItem = () => {
      throw new Error('blocked')
    }
    throwing.getItem = () => {
      throw new Error('blocked')
    }
    expect(() => markResetCompleted(throwing)).not.toThrow()
    expect(consumeResetCompleted(throwing)).toBe(false)
  })
})
