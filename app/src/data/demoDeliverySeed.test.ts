import { describe, expect, it } from 'vitest'

import { isWithinWeeklyWindow } from '../domain/delivery'
import { buildSeedDeliveries } from './demoDeliverySeed'

// 期待値は計画の手計算表由来の固定リテラル（受信者数12/5/6・スコア100/85/68など）。
// 実装関数の出力から期待値を生成しない

const DEMO_NOW = '2026-08-23T12:00:00.000Z'

describe('buildSeedDeliveries: 初期3件のcanonicalシード', () => {
  it('3件・offer.id保持・deliveredAt固定リテラル・受信者数12/5/6で、六甲ハイクが最新になる', () => {
    const seeds = buildSeedDeliveries()
    expect(
      seeds.map((delivery) => ({
        id: delivery.id,
        offerId: delivery.offer.id,
        deliveredAt: delivery.deliveredAt,
        recipients: delivery.recipients.length,
      })),
    ).toEqual([
      {
        id: 'delivery-offer-rokko-hike',
        offerId: 'offer-rokko-hike',
        deliveredAt: '2026-04-10T00:00:00.000Z',
        recipients: 12,
      },
      {
        id: 'delivery-offer-photo-walk',
        offerId: 'offer-photo-walk',
        deliveredAt: '2026-04-09T00:00:00.000Z',
        recipients: 5,
      },
      {
        id: 'delivery-offer-cafe-night',
        offerId: 'offer-cafe-night',
        deliveredAt: '2026-04-08T00:00:00.000Z',
        recipients: 6,
      },
    ])
  })

  it('メイン学生のsnapshotがTask 004の表示（100/85/68・理由・注意点の文言）と一致する', () => {
    const seeds = buildSeedDeliveries()
    const forYou = (offerId: string) =>
      seeds
        .find((delivery) => delivery.offer.id === offerId)!
        .recipients.find((recipient) => recipient.studentId === 'student-you')!

    expect(forYou('offer-rokko-hike')).toEqual({
      studentId: 'student-you',
      score: 100,
      reasons: ['アウトドアに興味がある', '土日に参加しやすい', '未経験でも歓迎される活動'],
      cautions: [],
    })
    expect(forYou('offer-photo-walk')).toEqual({
      studentId: 'student-you',
      score: 85,
      reasons: ['写真に興味がある', '土日に参加しやすい', '未経験でも歓迎される活動'],
      cautions: ['参加費（2,500円）は希望予算（1回2,000円以内）より高めです'],
    })
    expect(forYou('offer-cafe-night')).toEqual({
      studentId: 'student-you',
      score: 68,
      reasons: [
        '旅行に興味がある',
        '未経験でも歓迎される活動',
        '『友達を作る』の目的が合っている',
      ],
      cautions: ['活動頻度（週1回）は希望より多めです'],
    })
  })

  it('引数なしで決定的に生成され、2回呼び出すと完全に同じ内容になる', () => {
    expect(buildSeedDeliveries()).toEqual(buildSeedDeliveries())
  })

  it('停止中・許可外・低スコアの学生はどのシード配信にも含まれず、全シードが現在の週上限ウィンドウ外にある', () => {
    const seeds = buildSeedDeliveries()
    for (const delivery of seeds) {
      const ids = delivery.recipients.map((recipient) => recipient.studentId)
      expect(ids).not.toContain('pool-12')
      expect(ids).not.toContain('pool-19')
      expect(ids).not.toContain('pool-14')
      // 六甲ハイクではカテゴリ不許可のpool-13も除外される
      if (delivery.offer.id === 'offer-rokko-hike') {
        expect(ids).not.toContain('pool-13')
      }
      // 過去日付シードは現在（2026-08-23想定）の週上限枠を消費しない（D021）
      expect(isWithinWeeklyWindow(delivery.deliveredAt, DEMO_NOW)).toBe(false)
    }
  })
})
