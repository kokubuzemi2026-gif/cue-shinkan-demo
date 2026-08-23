import { describe, expect, it } from 'vitest'

import type { OfferResponse } from '../domain/types'
import type { StorageLike } from './appStorage'
import {
  createOfferResponseStore,
  OFFER_RESPONSES_KEY,
  OFFER_RESPONSES_SCHEMA_VERSION,
} from './responseStore'

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

const SAMPLE: OfferResponse[] = [
  {
    offerId: 'offer-rokko-hike',
    studentId: 'student-you',
    choice: 'interested',
    respondedAt: '2026-04-10T09:00:00.000Z',
  },
  {
    offerId: 'offer-photo-walk',
    studentId: 'student-you',
    choice: 'thinking',
    respondedAt: '2026-04-10T09:05:00.000Z',
  },
]

function envelope(schemaVersion: number, data: unknown): string {
  return JSON.stringify({ schemaVersion, data })
}

describe('offerResponseStore', () => {
  it('保存した返答をそのまま読み込める', () => {
    const store = createOfferResponseStore(createFakeStorage())
    expect(store.save(SAMPLE)).toBe(true)
    expect(store.load()).toEqual(SAMPLE)
  })

  it('未保存のときはnullを返す（呼び出し側で空配列として扱う）', () => {
    expect(createOfferResponseStore(createFakeStorage()).load()).toBeNull()
  })

  it('破損JSONはnullとして扱い例外を投げない', () => {
    const store = createOfferResponseStore(
      createFakeStorage({ [OFFER_RESPONSES_KEY]: '{oops' }),
    )
    expect(() => store.load()).not.toThrow()
    expect(store.load()).toBeNull()
  })

  it('schemaVersion不一致はnullとして扱う', () => {
    const store = createOfferResponseStore(
      createFakeStorage({ [OFFER_RESPONSES_KEY]: envelope(0, SAMPLE) }),
    )
    expect(store.load()).toBeNull()
  })

  it('choiceが3択以外のデータはnullとして扱う', () => {
    const broken = [{ ...SAMPLE[0], choice: 'maybe' }]
    const store = createOfferResponseStore(
      createFakeStorage({
        [OFFER_RESPONSES_KEY]: envelope(OFFER_RESPONSES_SCHEMA_VERSION, broken),
      }),
    )
    expect(store.load()).toBeNull()
  })

  it('respondedAt欠落や配列以外のデータはnullとして扱う', () => {
    const missingField = [{ offerId: 'o', studentId: 's', choice: 'skip' }]
    for (const broken of [missingField, { not: 'array' }]) {
      const store = createOfferResponseStore(
        createFakeStorage({
          [OFFER_RESPONSES_KEY]: envelope(OFFER_RESPONSES_SCHEMA_VERSION, broken),
        }),
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
    const store = createOfferResponseStore(throwing)
    expect(store.load()).toBeNull()
    expect(store.save(SAMPLE)).toBe(false)
  })

  it('空配列も保存・復元できる', () => {
    const store = createOfferResponseStore(createFakeStorage())
    expect(store.save([])).toBe(true)
    expect(store.load()).toEqual([])
  })
})
