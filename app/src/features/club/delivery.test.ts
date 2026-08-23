import { describe, expect, it } from 'vitest'

import { buildSeedDeliveries } from '../../data/demoDeliverySeed'
import { anonymousStudentPool } from '../../data/demoStudentPool'
import { demoStudent } from '../../data/demoData'
import { calculateMatch } from '../../domain/matching'
import type { OfferDelivery, StudentPreference } from '../../domain/types'
import {
  appendDelivery,
  clubSentInWindow,
  findDuplicateEvent,
  nextCreatedOfferId,
  previewAudience,
  toAudienceSummary,
} from './delivery'
import { buildClubOffer, createOfferDraft, DEMO_CLUB_ID } from './offerComposer'

// 期待人数・IDは計画の手計算表由来の固定リテラル。実装出力から期待値を作らない

const NOW = '2026-08-23T12:00:00.000Z'
const audience = [demoStudent, ...anonymousStudentPool]
const seedDeliveries = buildSeedDeliveries()
// プリセット（マッチ条件が六甲ハイクと同一）から作る新キャンペーン
const presetOffer = buildClubOffer(createOfferDraft(), seedDeliveries)

const EXPECTED_RECIPIENT_IDS = [
  'student-you',
  'pool-01',
  'pool-02',
  'pool-03',
  'pool-04',
  'pool-05',
  'pool-06',
  'pool-07',
  'pool-08',
  'pool-09',
  'pool-10',
  'pool-11',
]

// 週上限判定用: 指定した学生だけを受信者に持つ、ウィンドウ内のフィクスチャ配信
function inWindowDeliveryFor(studentIds: string[], suffix: number): OfferDelivery {
  return {
    id: `delivery-offer-created-${suffix}`,
    deliveredAt: '2026-08-22T09:00:00.000Z',
    offer: {
      id: `offer-created-${suffix}`,
      clubId: DEMO_CLUB_ID,
      eventName: `テスト送信${suffix}`,
      description: 'テスト',
      reasonNote: 'テスト',
      dateText: `9月${suffix}日（土）10:00`,
      place: 'テスト広場',
      eventDays: ['weekend'],
      frequency: 'monthly_1_2',
      feePerEventYen: 0,
      beginnerFriendly: true,
      intensity: 'moderate',
      targetCategories: ['outdoor'],
      targetPurposes: ['friends'],
      capacity: 10,
      deadline: '2026-09-10',
    },
    recipients: studentIds.map((studentId) => ({
      studentId,
      score: 83,
      reasons: ['アウトドアに興味がある'],
      cautions: [],
    })),
  }
}

describe('previewAudience: 配信対象の実計算', () => {
  it('初期状態（過去シードのみ）ではmatched 12 / limited 0 / deliverable 12になる', () => {
    const evaluation = previewAudience(audience, presetOffer, seedDeliveries, NOW)
    expect(evaluation.matchedCount).toBe(12)
    expect(evaluation.limitedCount).toBe(0)
    expect(evaluation.deliverableCount).toBe(12)
  })

  it('recipientsは手計算表の12人と一致し、停止・許可外・低スコアの学生を含まない', () => {
    const evaluation = previewAudience(audience, presetOffer, seedDeliveries, NOW)
    const ids = evaluation.recipients.map((recipient) => recipient.studentId)
    expect(ids).toEqual(EXPECTED_RECIPIENT_IDS)
    for (const excluded of ['pool-12', 'pool-13', 'pool-14', 'pool-19']) {
      expect(ids).not.toContain(excluded)
    }
  })

  it('各recipient snapshotはcalculateMatchの結果と完全一致し、メイン学生は100点・理由3件になる', () => {
    const evaluation = previewAudience(audience, presetOffer, seedDeliveries, NOW)
    const byId = new Map(audience.map((student) => [student.id, student]))
    for (const recipient of evaluation.recipients) {
      const result = calculateMatch(byId.get(recipient.studentId)!, presetOffer)
      expect(recipient.score).toBe(result.score)
      expect(recipient.reasons).toEqual(result.reasons)
      expect(recipient.cautions).toEqual(result.cautions)
    }
    const you = evaluation.recipients.find((recipient) => recipient.studentId === 'student-you')!
    expect(you.score).toBe(100)
    expect(you.reasons).toEqual([
      'アウトドアに興味がある',
      '土日に参加しやすい',
      '未経験でも歓迎される活動',
    ])
  })

  it('週上限に達した学生（pool-04: 上限1・今週1件受信済み）はlimitedへ移り配信対象から外れる', () => {
    const deliveries = [...seedDeliveries, inWindowDeliveryFor(['pool-04'], 90)]
    const evaluation = previewAudience(audience, presetOffer, deliveries, NOW)
    expect(evaluation.matchedCount).toBe(12)
    expect(evaluation.limitedCount).toBe(1)
    expect(evaluation.deliverableCount).toBe(11)
    expect(evaluation.recipients.map((r) => r.studentId)).not.toContain('pool-04')
  })

  it('停止と週上限の複合: メイン学生停止＋pool-04上限到達でmatched 11 / limited 1 / deliverable 10', () => {
    const pausedYou: StudentPreference = {
      ...demoStudent,
      reception: { ...demoStudent.reception, paused: true },
    }
    const deliveries = [...seedDeliveries, inWindowDeliveryFor(['pool-04'], 90)]
    const evaluation = previewAudience(
      [pausedYou, ...anonymousStudentPool],
      presetOffer,
      deliveries,
      NOW,
    )
    expect(evaluation.matchedCount).toBe(11)
    expect(evaluation.limitedCount).toBe(1)
    expect(evaluation.deliverableCount).toBe(10)
    const ids = evaluation.recipients.map((r) => r.studentId)
    expect(ids).not.toContain('student-you')
    expect(ids).not.toContain('pool-04')
  })

  it('誰も対象カテゴリを許可していない場合は0/0/0とrecipients空を返す（空配信ブロックの根拠）', () => {
    const noOutdoor = audience.map((student) => ({
      ...student,
      reception: {
        ...student.reception,
        allowedCategories: student.reception.allowedCategories.filter(
          (category) => category !== 'outdoor',
        ),
      },
    }))
    const evaluation = previewAudience(noOutdoor, presetOffer, seedDeliveries, NOW)
    expect(evaluation).toEqual({
      matchedCount: 0,
      limitedCount: 0,
      deliverableCount: 0,
      recipients: [],
    })
  })

  it('同じ入力から同じ結果を返し、入力配列・オブジェクトを変更しない', () => {
    const deliveries = [...seedDeliveries]
    const before = JSON.stringify({ audience, deliveries })
    const first = previewAudience(audience, presetOffer, deliveries, NOW)
    const second = previewAudience(audience, presetOffer, deliveries, NOW)
    expect(first).toEqual(second)
    expect(JSON.stringify({ audience, deliveries })).toBe(before)
  })
})

describe('toAudienceSummary: UI境界', () => {
  it('人数3値だけを持ち、recipients（個人情報）を含まない', () => {
    const evaluation = previewAudience(audience, presetOffer, seedDeliveries, NOW)
    const summary = toAudienceSummary(evaluation)
    expect(summary).toEqual({ matchedCount: 12, limitedCount: 0, deliverableCount: 12 })
    expect(Object.keys(summary).sort()).toEqual([
      'deliverableCount',
      'limitedCount',
      'matchedCount',
    ])
  })
})

describe('appendDelivery: 二重配信の防止', () => {
  it('同一offer IDの配信が既にあれば同一配列参照を返す（二度押しの冪等化）', () => {
    const delivery = inWindowDeliveryFor(['student-you'], 91)
    const once = appendDelivery(seedDeliveries, delivery)
    expect(once).toHaveLength(4)
    const twice = appendDelivery(once, delivery)
    expect(twice).toBe(once)
  })

  it('新規配信は末尾へ追記し、入力配列を変更しない', () => {
    const before = [...seedDeliveries]
    const next = appendDelivery(seedDeliveries, inWindowDeliveryFor(['student-you'], 91))
    expect(next).toHaveLength(4)
    expect(seedDeliveries).toEqual(before)
    expect(next.slice(0, 3)).toEqual(before)
  })
})

describe('findDuplicateEvent: 同一イベント再送の検出', () => {
  it('別のoffer IDでも同一イベント（同団体・同名・同日時・同場所）は重複として検出する', () => {
    const sameEventNewId = { ...presetOffer, id: 'offer-created-99' }
    const deliveries = [
      ...seedDeliveries,
      {
        id: `delivery-${presetOffer.id}`,
        offer: presetOffer,
        deliveredAt: '2026-08-22T09:00:00.000Z',
        recipients: [],
      },
    ]
    const found = findDuplicateEvent(deliveries, sameEventNewId)
    expect(found?.offer.id).toBe(presetOffer.id)
  })

  it('同名でも日時が異なれば別イベントとして扱う（続編開催の誤ブロック防止）', () => {
    const deliveries = [
      ...seedDeliveries,
      {
        id: `delivery-${presetOffer.id}`,
        offer: presetOffer,
        deliveredAt: '2026-08-22T09:00:00.000Z',
        recipients: [],
      },
    ]
    const laterDate = {
      ...presetOffer,
      id: 'offer-created-99',
      dateText: '9月19日（土）10:00〜16:00',
    }
    expect(findDuplicateEvent(deliveries, laterDate)).toBeNull()
  })

  it('同日時でも名称や場所が異なれば別イベントとして扱い、未送信なら重複なし（null）を返す', () => {
    const otherName = { ...presetOffer, id: 'offer-created-99', eventName: '河原クッキング体験' }
    expect(findDuplicateEvent(seedDeliveries, otherName)).toBeNull()
    expect(findDuplicateEvent(seedDeliveries, presetOffer)).toBeNull()
  })
})

describe('nextCreatedOfferId / clubSentInWindow', () => {
  it('配信なしならoffer-created-1、欠番混在でも最大suffix+1を返す（ID衝突の防止）', () => {
    expect(nextCreatedOfferId([])).toBe('offer-created-1')
    expect(nextCreatedOfferId(seedDeliveries)).toBe('offer-created-1')
    const withCreated = [
      ...seedDeliveries,
      inWindowDeliveryFor(['student-you'], 1),
      inWindowDeliveryFor(['pool-01'], 3),
    ]
    expect(nextCreatedOfferId(withCreated)).toBe('offer-created-4')
  })

  it('過去シード（4月）は団体週3枠を消費せず、今週の送信2件を追加すると2になる', () => {
    expect(clubSentInWindow(seedDeliveries, DEMO_CLUB_ID, NOW)).toBe(0)
    const withTwo = [
      ...seedDeliveries,
      inWindowDeliveryFor(['student-you'], 1),
      inWindowDeliveryFor(['pool-01'], 2),
    ]
    expect(clubSentInWindow(withTwo, DEMO_CLUB_ID, NOW)).toBe(2)
    // 他団体の配信は数えない
    expect(clubSentInWindow(withTwo, 'club-harbor-film', NOW)).toBe(0)
  })
})
