import { describe, expect, it } from 'vitest'

import type { OfferReadMark } from '../domain/types'
import type { StorageLike } from './appStorage'
import {
  createOfferReadStore,
  OFFER_READS_KEY,
  OFFER_READS_SCHEMA_VERSION,
} from './readStore'

function createFakeStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

const SAMPLE: OfferReadMark[] = [
  { offerId: 'offer-rokko-hike', studentId: 'student-you', readAt: '2026-04-10T09:00:00.000Z' },
]

function envelope(schemaVersion: number, data: unknown): string {
  return JSON.stringify({ schemaVersion, data })
}

describe('offerReadStore', () => {
  it('保存した既読マークをそのまま読み込める', () => {
    const store = createOfferReadStore(createFakeStorage())
    expect(store.save(SAMPLE)).toBe(true)
    expect(store.load()).toEqual(SAMPLE)
  })

  it('未保存のときはnullを返す（呼び出し側で空配列として扱う）', () => {
    expect(createOfferReadStore(createFakeStorage()).load()).toBeNull()
  })

  it('破損JSONはnullとして扱い例外を投げない', () => {
    const store = createOfferReadStore(createFakeStorage({ [OFFER_READS_KEY]: '{oops' }))
    expect(() => store.load()).not.toThrow()
    expect(store.load()).toBeNull()
  })

  it('schemaVersion不一致はnullとして扱う', () => {
    const store = createOfferReadStore(
      createFakeStorage({ [OFFER_READS_KEY]: envelope(0, SAMPLE) }),
    )
    expect(store.load()).toBeNull()
  })

  it('readAt欠落・id空文字・配列以外はnullとして扱う', () => {
    const cases: unknown[] = [
      [{ offerId: 'o', studentId: 's' }],
      [{ offerId: '', studentId: 's', readAt: 'x' }],
      { not: 'array' },
    ]
    for (const broken of cases) {
      const store = createOfferReadStore(
        createFakeStorage({ [OFFER_READS_KEY]: envelope(OFFER_READS_SCHEMA_VERSION, broken) }),
      )
      expect(store.load()).toBeNull()
    }
  })

  it('Storage例外時はload=null / save=falseへ縮退する', () => {
    const throwing = createFakeStorage()
    throwing.getItem = () => {
      throw new Error('blocked')
    }
    throwing.setItem = () => {
      throw new Error('quota')
    }
    const store = createOfferReadStore(throwing)
    expect(store.load()).toBeNull()
    expect(store.save(SAMPLE)).toBe(false)
  })

  it('空配列も保存・復元できる', () => {
    const store = createOfferReadStore(createFakeStorage())
    expect(store.save([])).toBe(true)
    expect(store.load()).toEqual([])
  })
})
