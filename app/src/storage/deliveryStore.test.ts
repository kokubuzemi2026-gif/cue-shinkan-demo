import { describe, expect, it } from 'vitest'

import type { OfferDelivery } from '../domain/types'
import type { StorageLike } from './appStorage'
import {
  createOfferDeliveryStore,
  OFFER_DELIVERIES_KEY,
  OFFER_DELIVERIES_SCHEMA_VERSION,
} from './deliveryStore'

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

function envelope(schemaVersion: number, data: unknown): string {
  return JSON.stringify({ schemaVersion, data })
}

// テスト用の正当な配信レコード（手書きのリテラル。実装関数から生成しない）
function sampleDelivery(overrides: Partial<OfferDelivery> = {}): OfferDelivery {
  return {
    id: 'delivery-offer-sample',
    deliveredAt: '2026-08-20T09:00:00.000Z',
    offer: {
      id: 'offer-sample',
      clubId: 'club-rokko-outdoor',
      eventName: 'サンプル体験会',
      description: 'テスト用のイベントです。',
      reasonNote: 'テストのためです。',
      dateText: '9月12日（土）10:00〜16:00',
      place: '北テラス広場 集合',
      eventDays: ['weekend'],
      frequency: 'monthly_1_2',
      feePerEventYen: 1500,
      beginnerFriendly: true,
      intensity: 'moderate',
      targetCategories: ['outdoor'],
      targetPurposes: ['friends', 'challenge'],
      capacity: 10,
      deadline: '2026-09-10',
    },
    recipients: [
      {
        studentId: 'student-you',
        score: 100,
        reasons: ['アウトドアに興味がある', '土日に参加しやすい', '未経験でも歓迎される活動'],
        cautions: [],
      },
      {
        studentId: 'pool-05',
        score: 88,
        reasons: ['アウトドアに興味がある'],
        cautions: ['参加費（1,500円）は希望予算（1回1,000円以内）より高めです'],
      },
    ],
    ...overrides,
  }
}

function storeWithData(data: unknown) {
  return createOfferDeliveryStore(
    createFakeStorage({
      [OFFER_DELIVERIES_KEY]: envelope(OFFER_DELIVERIES_SCHEMA_VERSION, data),
    }),
  )
}

describe('offerDeliveryStore', () => {
  it('offer snapshot・受信者snapshotを含む配信をそのまま保存・復元できる', () => {
    const store = createOfferDeliveryStore(createFakeStorage())
    const deliveries = [sampleDelivery()]
    expect(store.save(deliveries)).toBe(true)
    expect(store.load()).toEqual(deliveries)
  })

  it('未保存のときはnullを返す（初回シード判定の根拠）', () => {
    expect(createOfferDeliveryStore(createFakeStorage()).load()).toBeNull()
  })

  it('破損JSONはnullとして扱い例外を投げない', () => {
    const store = createOfferDeliveryStore(
      createFakeStorage({ [OFFER_DELIVERIES_KEY]: '{oops' }),
    )
    expect(() => store.load()).not.toThrow()
    expect(store.load()).toBeNull()
  })

  it('schemaVersion不一致はnullとして扱う', () => {
    const store = createOfferDeliveryStore(
      createFakeStorage({ [OFFER_DELIVERIES_KEY]: envelope(0, [sampleDelivery()]) }),
    )
    expect(store.load()).toBeNull()
  })

  it('offer snapshotの不正（enum外intensity・負の参加費・空のカテゴリ）はstore全体をnullにする', () => {
    const base = sampleDelivery()
    const cases: unknown[] = [
      [{ ...base, offer: { ...base.offer, intensity: 'extreme' } }],
      [{ ...base, offer: { ...base.offer, feePerEventYen: -1 } }],
      [{ ...base, offer: { ...base.offer, targetCategories: [] } }],
    ]
    for (const broken of cases) {
      expect(storeWithData(broken).load()).toBeNull()
    }
  })

  it('受信者snapshotの不正（score101・score非数・reasons0件/4件）はstore全体をnullにする', () => {
    const base = sampleDelivery()
    const you = base.recipients[0]
    const cases: unknown[] = [
      [{ ...base, recipients: [{ ...you, score: 101 }] }],
      [{ ...base, recipients: [{ ...you, score: 'high' }] }],
      [{ ...base, recipients: [{ ...you, reasons: [] }] }],
      [{ ...base, recipients: [{ ...you, reasons: ['a', 'b', 'c', 'd'] }] }],
    ]
    for (const broken of cases) {
      expect(storeWithData(broken).load()).toBeNull()
    }
  })

  it('deliveredAtが不正なISO文字列ならnullにする（週上限計算D021の前提）', () => {
    expect(storeWithData([sampleDelivery({ deliveredAt: 'not-a-date' })]).load()).toBeNull()
  })

  it('同一配信内の受信者studentId重複はnullにする', () => {
    const base = sampleDelivery()
    const broken = [{ ...base, recipients: [base.recipients[0], base.recipients[0]] }]
    expect(storeWithData(broken).load()).toBeNull()
  })

  it('delivery IDの重複はnullにする', () => {
    const first = sampleDelivery()
    const second = sampleDelivery({
      offer: { ...first.offer, id: 'offer-other', eventName: '別のイベント' },
    })
    expect(storeWithData([first, second]).load()).toBeNull()
  })

  it('offer IDの重複はnullにする（再送禁止の永続層防衛）', () => {
    const first = sampleDelivery()
    const second = sampleDelivery({
      id: 'delivery-offer-sample-2',
      offer: { ...first.offer, eventName: '別のイベント' },
    })
    expect(storeWithData([first, second]).load()).toBeNull()
  })

  it('IDが違っても同一イベント（fingerprint重複）はnullにする（ID変え再送の永続層防衛）', () => {
    const first = sampleDelivery()
    const second = sampleDelivery({
      id: 'delivery-offer-copy',
      offer: { ...first.offer, id: 'offer-copy', eventName: ' サンプル体験会 ' },
    })
    expect(storeWithData([first, second]).load()).toBeNull()
  })

  it('Storage例外時はload=null / save=falseへ縮退し、空配列は保存・復元できる', () => {
    const throwing = createFakeStorage()
    throwing.getItem = () => {
      throw new Error('blocked')
    }
    throwing.setItem = () => {
      throw new Error('quota')
    }
    const failing = createOfferDeliveryStore(throwing)
    expect(failing.load()).toBeNull()
    expect(failing.save([sampleDelivery()])).toBe(false)

    const store = createOfferDeliveryStore(createFakeStorage())
    expect(store.save([])).toBe(true)
    expect(store.load()).toEqual([])
  })
})
