import { describe, expect, it } from 'vitest'

import { buildSeedDeliveries } from '../../data/demoDeliverySeed'
import type { OfferDelivery, OfferReadMark, OfferResponse } from '../../domain/types'
import { buildFunnel, listClubCampaigns } from './funnel'

// 六甲ハイクのシード配信（受信者12人。人数はdemoDeliverySeed.test.tsの正本リテラルで固定済み）
const hikeDelivery = buildSeedDeliveries()[0]

function read(offerId: string, studentId: string): OfferReadMark {
  return { offerId, studentId, readAt: '2026-08-23T10:00:00.000Z' }
}

function response(
  offerId: string,
  studentId: string,
  choice: OfferResponse['choice'],
): OfferResponse {
  return { offerId, studentId, choice, respondedAt: '2026-08-23T10:05:00.000Z' }
}

const HIKE = 'offer-rokko-hike'

describe('buildFunnel: D022の導出', () => {
  it('既読も返答もなければ 配信12・閲覧0・関心0・参加意向0 になる', () => {
    expect(buildFunnel(hikeDelivery, [], [])).toEqual({
      delivered: 12,
      viewed: 0,
      engaged: 0,
      planned: 0,
    })
  })

  it('既読保存が失敗してもinterested返答があれば閲覧1・関心1・参加意向1（単調性の縮退保証）', () => {
    const funnel = buildFunnel(hikeDelivery, [], [response(HIKE, 'student-you', 'interested')])
    expect(funnel).toEqual({ delivered: 12, viewed: 1, engaged: 1, planned: 1 })
  })

  it('thinkingは閲覧1・関心1・意向0、skipは閲覧1・関心0・意向0になる', () => {
    expect(
      buildFunnel(hikeDelivery, [read(HIKE, 'student-you')], [
        response(HIKE, 'student-you', 'thinking'),
      ]),
    ).toEqual({ delivered: 12, viewed: 1, engaged: 1, planned: 0 })
    expect(
      buildFunnel(hikeDelivery, [read(HIKE, 'student-you')], [
        response(HIKE, 'student-you', 'skip'),
      ]),
    ).toEqual({ delivered: 12, viewed: 1, engaged: 0, planned: 0 })
  })

  it('重複した既読・返答レコードがあってもstudentId単位で1人と数える', () => {
    const funnel = buildFunnel(
      hikeDelivery,
      [read(HIKE, 'student-you'), read(HIKE, 'student-you')],
      [
        response(HIKE, 'student-you', 'interested'),
        response(HIKE, 'student-you', 'interested'),
      ],
    )
    expect(funnel).toEqual({ delivered: 12, viewed: 1, engaged: 1, planned: 1 })
  })

  it('受信者でないstudentIdや他オファーの記録はすべての指標から除外する（積集合の保証）', () => {
    const funnel = buildFunnel(
      hikeDelivery,
      [read(HIKE, 'pool-13'), read('offer-photo-walk', 'student-you')],
      [
        response(HIKE, 'pool-13', 'interested'),
        response('offer-photo-walk', 'student-you', 'interested'),
      ],
    )
    expect(funnel).toEqual({ delivered: 12, viewed: 0, engaged: 0, planned: 0 })
  })

  it('thinkingからinterestedへ上書きすると、関心1のまま参加意向が0→1になる（受入条件の増分）', () => {
    const before = buildFunnel(hikeDelivery, [read(HIKE, 'student-you')], [
      response(HIKE, 'student-you', 'thinking'),
    ])
    expect(before.engaged).toBe(1)
    expect(before.planned).toBe(0)
    const after = buildFunnel(hikeDelivery, [read(HIKE, 'student-you')], [
      response(HIKE, 'student-you', 'interested'),
    ])
    expect(after.engaged).toBe(1)
    expect(after.planned).toBe(1)
  })

  it('返り値は匿名の件数4キーのみで、常に 配信≥閲覧≥関心≥参加意向 が成り立つ', () => {
    const funnel = buildFunnel(
      hikeDelivery,
      [read(HIKE, 'student-you'), read(HIKE, 'pool-01')],
      [
        response(HIKE, 'student-you', 'interested'),
        response(HIKE, 'pool-02', 'thinking'),
        response(HIKE, 'pool-05', 'skip'),
      ],
    )
    expect(Object.keys(funnel).sort()).toEqual(['delivered', 'engaged', 'planned', 'viewed'])
    for (const value of Object.values(funnel)) {
      expect(typeof value).toBe('number')
    }
    expect(funnel.delivered).toBeGreaterThanOrEqual(funnel.viewed)
    expect(funnel.viewed).toBeGreaterThanOrEqual(funnel.engaged)
    expect(funnel.engaged).toBeGreaterThanOrEqual(funnel.planned)
    expect(funnel).toEqual({ delivered: 12, viewed: 4, engaged: 2, planned: 1 })
  })
})

describe('listClubCampaigns: ダッシュボード一覧', () => {
  it('当該団体の配信だけを新しい順（同時刻はoffer ID昇順）で返し、受信者情報を含まない', () => {
    const seeds = buildSeedDeliveries()
    const sameTime: OfferDelivery = {
      id: 'delivery-offer-created-1',
      deliveredAt: '2026-04-10T00:00:00.000Z',
      offer: { ...seeds[0].offer, id: 'offer-created-1', eventName: '同時刻のテスト' },
      recipients: [],
    }
    const views = listClubCampaigns([...seeds, sameTime], [], [], 'club-rokko-outdoor')
    // 六甲の配信のみ（Harbor・TableTalkは含まない）
    expect(views.map((view) => view.offer.id)).toEqual(['offer-created-1', 'offer-rokko-hike'])
    for (const view of views) {
      // 受信者情報を持たないことの固定（列を足すときは意図的な追加であることを確認する）。
      // stoppedは運営の停止状態で、個人を指す情報ではない（D044）
      expect(Object.keys(view).sort()).toEqual(['funnel', 'offer', 'stopped'])
      expect(view.stopped).toBe(false)
    }
  })
})
