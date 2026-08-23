import { describe, expect, it } from 'vitest'

import { calculateMatch, rankEligibleOffers } from '../domain/matching'
import { demoClubs, demoOffers, demoStudent } from './demoData'

function getOffer(offerId: string) {
  const offer = demoOffers.find((candidate) => candidate.id === offerId)
  if (offer === undefined) {
    throw new Error(`デモデータにオファー ${offerId} がありません`)
  }
  return offer
}

// 計画書の手計算表（各要素の内訳を足した期待値）
const EXPECTED_RESULTS = [
  { offerId: 'offer-rokko-hike', score: 100, eligible: true }, // 35+20+15+15+10+5
  { offerId: 'offer-photo-walk', score: 85, eligible: true }, // 35+10+15+15+10+0
  { offerId: 'offer-cafe-night', score: 68, eligible: true }, // 35+10+8+0+10+5
  { offerId: 'offer-kodomo-shokudo', score: 58, eligible: false }, // 0+20+8+15+10+5・カテゴリ不許可
  { offerId: 'offer-morning-run', score: 38, eligible: false }, // 0+0+8+15+10+5
  { offerId: 'offer-jazz-session', score: 13, eligible: false }, // 0+0+8+0+0+5
] as const

describe('デモデータ: 手計算表どおりのマッチ結果', () => {
  it.each(EXPECTED_RESULTS)(
    '$offerId は score=$score / eligible=$eligible になる',
    ({ offerId, score, eligible }) => {
      const result = calculateMatch(demoStudent, getOffer(offerId))
      expect(result.score).toBe(score)
      expect(result.eligible).toBe(eligible)
    },
  )

  it('メイン学生×六甲アウトドア会は90秒デモの3理由でマッチし、cautionが出ない', () => {
    const result = calculateMatch(demoStudent, getOffer('offer-rokko-hike'))
    expect(result.reasons).toEqual([
      'アウトドアに興味がある',
      '土日に参加しやすい',
      '未経験でも歓迎される活動',
    ])
    expect(result.cautions).toEqual([])
  })

  it('Harbor Film Labは配信対象のまま予算超過がcautionsへ出る', () => {
    const result = calculateMatch(demoStudent, getOffer('offer-photo-walk'))
    expect(result.eligible).toBe(true)
    expect(result.cautions).toEqual([
      '参加費（2,500円）は希望予算（1回2,000円以内）より高めです',
    ])
  })

  it('Table Talk Internationalは頻度多めのcautionが出る', () => {
    const result = calculateMatch(demoStudent, getOffer('offer-cafe-night'))
    expect(result.cautions).toEqual(['活動頻度（週1回）は希望より多めです'])
  })

  it('Bridge Volunteer Teamは受信許可カテゴリ外のためスコアに関わらず配信されない', () => {
    expect(demoStudent.reception.allowedCategories).not.toContain('volunteer')
    const result = calculateMatch(demoStudent, getOffer('offer-kodomo-shokudo'))
    expect(result.eligible).toBe(false)
  })

  it('eligibleなオファーには必ず1件以上のマッチ理由がつく', () => {
    for (const offer of demoOffers) {
      const result = calculateMatch(demoStudent, offer)
      if (result.eligible) {
        expect(result.reasons.length).toBeGreaterThan(0)
      }
    }
  })

  it('受信箱の並びは 六甲ハイク→フォトウォーク→カフェナイト になる', () => {
    const ranked = rankEligibleOffers(demoStudent, demoOffers)
    expect(ranked.map((entry) => entry.offer.id)).toEqual([
      'offer-rokko-hike',
      'offer-photo-walk',
      'offer-cafe-night',
    ])
  })

  it('結果はID・団体名ではなく属性から計算される（同一属性の別オファーで同一結果）', () => {
    const original = getOffer('offer-rokko-hike')
    const clone = {
      ...original,
      id: 'offer-clone',
      clubId: 'club-clone',
      eventName: '別名イベント',
    }
    expect(calculateMatch(demoStudent, clone)).toEqual(calculateMatch(demoStudent, original))
  })
})

describe('デモデータ: 整合性', () => {
  it('学生・団体・オファーのIDに重複がない', () => {
    const ids = [demoStudent.id, ...demoClubs.map((club) => club.id), ...demoOffers.map((offer) => offer.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('全オファーのclubIdが実在する団体を参照している', () => {
    const clubIds = new Set(demoClubs.map((club) => club.id))
    for (const offer of demoOffers) {
      expect(clubIds.has(offer.clubId)).toBe(true)
    }
  })

  it('全オファーの必須属性が妥当（対象カテゴリ・開催枠が非空、費用0以上、定員1以上、期限がISO日付）', () => {
    for (const offer of demoOffers) {
      expect(offer.targetCategories.length).toBeGreaterThan(0)
      expect(offer.eventDays.length).toBeGreaterThan(0)
      expect(offer.feePerEventYen).toBeGreaterThanOrEqual(0)
      expect(offer.capacity).toBeGreaterThan(0)
      expect(offer.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('全団体に公開用の公式窓口が定義されている（個人連絡先ではなく団体公式）', () => {
    for (const club of demoClubs) {
      expect(club.contact.label.length).toBeGreaterThan(0)
      expect(club.contact.handle.length).toBeGreaterThan(0)
    }
  })

  it('公式窓口のハンドルは実在と混同しないよう_demo表記を含む', () => {
    for (const club of demoClubs) {
      expect(club.contact.handle).toContain('_demo')
    }
  })

  it('implementation_plan §4の6団体がすべて存在する', () => {
    const names = demoClubs.map((club) => club.name)
    expect(names).toEqual([
      '六甲アウトドア会',
      'Harbor Film Lab',
      'Table Talk International',
      'Bridge Volunteer Team',
      'Kobe Weekend Runners',
      'Blue Note Session',
    ])
  })
})
