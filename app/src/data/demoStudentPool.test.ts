import { describe, expect, it } from 'vitest'

import { calculateMatch } from '../domain/matching'
import type { ClubOffer } from '../domain/types'
import { demoOffers, demoStudent } from './demoData'
import { anonymousStudentPool } from './demoStudentPool'

// 期待人数・対象ID・スコアは計画の手計算表由来の固定リテラル。
// 実装関数の出力から期待値を生成しない（循環検証の禁止）

const audience = [demoStudent, ...anonymousStudentPool]

function offerById(id: string): ClubOffer {
  const offer = demoOffers.find((candidate) => candidate.id === id)
  if (offer === undefined) throw new Error(`missing offer: ${id}`)
  return offer
}

function eligibleIds(offer: ClubOffer): string[] {
  return audience
    .filter((student) => calculateMatch(student, offer).eligible)
    .map((student) => student.id)
}

// 六甲ハイク条件でeligibleになる12人（手計算表）
const HIKE_ELIGIBLE_IDS = [
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

describe('匿名学生プール: 母集団の整合', () => {
  it('19人・ID一意・pool-接頭辞で、メイン学生を含まない（母集団の二重計上防止）', () => {
    expect(anonymousStudentPool).toHaveLength(19)
    const ids = anonymousStudentPool.map((student) => student.id)
    expect(new Set(ids).size).toBe(19)
    expect(ids.every((id) => id.startsWith('pool-'))).toBe(true)
    expect(ids).not.toContain(demoStudent.id)
  })

  it('全員のdisplayNameが「匿名新入生NN」形式で、ID連番と一致する（PII・実在名の混入防止）', () => {
    for (const student of anonymousStudentPool) {
      expect(student.displayName).toMatch(/^匿名新入生\d{2}$/)
      expect(student.displayName.slice(-2)).toBe(student.id.slice(-2))
    }
  })

  it('メイン学生を含む母集団で、六甲ハイクのeligibleがちょうど12人・手計算表のIDと一致する', () => {
    expect(eligibleIds(offerById('offer-rokko-hike'))).toEqual(HIKE_ELIGIBLE_IDS)
  })

  it('他5オファーのeligibleも手計算表どおりで、誰にでも届く水増し設計になっていない', () => {
    expect(eligibleIds(offerById('offer-photo-walk'))).toEqual([
      'student-you',
      'pool-03',
      'pool-09',
      'pool-11',
      'pool-17',
    ])
    expect(eligibleIds(offerById('offer-cafe-night'))).toEqual([
      'student-you',
      'pool-02',
      'pool-07',
      'pool-09',
      'pool-16',
      'pool-18',
    ])
    expect(eligibleIds(offerById('offer-kodomo-shokudo'))).toEqual(['pool-05', 'pool-18'])
    expect(eligibleIds(offerById('offer-morning-run'))).toEqual([
      'pool-01',
      'pool-08',
      'pool-15',
    ])
    expect(eligibleIds(offerById('offer-jazz-session'))).toEqual(['pool-06', 'pool-14'])
  })

  it('停止中2人とアウトドア不許可4人が存在し、全員ハイク非eligibleになる（除外3類型の実在保証）', () => {
    const hike = offerById('offer-rokko-hike')
    const paused = anonymousStudentPool.filter((student) => student.reception.paused)
    expect(paused.map((student) => student.id)).toEqual(['pool-12', 'pool-19'])
    const outdoorNotAllowed = anonymousStudentPool.filter(
      (student) => !student.reception.allowedCategories.includes('outdoor'),
    )
    expect(outdoorNotAllowed.map((student) => student.id)).toEqual([
      'pool-13',
      'pool-16',
      'pool-17',
      'pool-18',
    ])
    for (const student of [...paused, ...outdoorNotAllowed]) {
      expect(calculateMatch(student, hike).eligible).toBe(false)
    }
  })

  it('スポット検算: p02=100・p05=88と注意点2件・p14=23・p13は83点でも許可外で配信されない', () => {
    const hike = offerById('offer-rokko-hike')
    const byId = new Map(anonymousStudentPool.map((student) => [student.id, student]))

    const p02 = calculateMatch(byId.get('pool-02')!, hike)
    expect(p02.score).toBe(100)
    expect(p02.eligible).toBe(true)

    const p05 = calculateMatch(byId.get('pool-05')!, hike)
    expect(p05.score).toBe(88)
    expect(p05.eligible).toBe(true)
    expect(p05.cautions).toEqual([
      '参加費（1,500円）は希望予算（1回1,000円以内）より高めです',
      '活動の本気度は希望より高めです',
    ])

    const p14 = calculateMatch(byId.get('pool-14')!, hike)
    expect(p14.score).toBe(23)
    expect(p14.eligible).toBe(false)

    const p13 = calculateMatch(byId.get('pool-13')!, hike)
    expect(p13.score).toBe(83)
    expect(p13.eligible).toBe(false)
  })

  it('全員のweeklyLimitが1〜5で、週上限QAの前提となる値と一致する', () => {
    const limits = Object.fromEntries(
      anonymousStudentPool.map((student) => [student.id, student.reception.weeklyLimit]),
    )
    expect(limits).toEqual({
      'pool-01': 3,
      'pool-02': 2,
      'pool-03': 3,
      'pool-04': 1,
      'pool-05': 3,
      'pool-06': 2,
      'pool-07': 3,
      'pool-08': 5,
      'pool-09': 3,
      'pool-10': 3,
      'pool-11': 3,
      'pool-12': 3,
      'pool-13': 1,
      'pool-14': 3,
      'pool-15': 3,
      'pool-16': 2,
      'pool-17': 3,
      'pool-18': 1,
      'pool-19': 5,
    })
    for (const student of anonymousStudentPool) {
      expect(student.reception.weeklyLimit).toBeGreaterThanOrEqual(1)
      expect(student.reception.weeklyLimit).toBeLessThanOrEqual(5)
    }
  })
})
