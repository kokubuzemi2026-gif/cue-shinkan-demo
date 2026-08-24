import { describe, expect, it } from 'vitest'

import {
  buildDelivery,
  buildMatchSnapshots,
  eventFingerprint,
  isWithinWeeklyWindow,
} from './delivery'
import { calculateMatch } from './matching'
import type { ClubOffer, StudentPreference } from './types'

// 期待値はすべて手計算由来の固定リテラル。実装関数の出力から期待値を作らない

const NOW = '2026-08-23T12:00:00.000Z'

const baseOffer: ClubOffer = {
  id: 'offer-test',
  clubId: 'club-test',
  eventName: 'テスト体験会',
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
}

const matchingStudent: StudentPreference = {
  id: 'student-match',
  displayName: 'テスト学生A',
  interests: ['outdoor'],
  purposes: ['friends', 'challenge'],
  style: 'moderate',
  frequency: 'monthly_1_2',
  availableDays: ['weekend'],
  experience: 'none',
  maxFeePerEventYen: 2000,
  reception: { paused: false, allowedCategories: ['outdoor'], weeklyLimit: 3 },
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe('isWithinWeeklyWindow: D021の週境界', () => {
  it('ちょうど7日前は数えない（下限exclusive）', () => {
    expect(isWithinWeeklyWindow('2026-08-16T12:00:00.000Z', NOW)).toBe(false)
  })

  it('7日前より1ms内側は数える', () => {
    expect(isWithinWeeklyWindow('2026-08-16T12:00:00.001Z', NOW)).toBe(true)
  })

  it('7日前より1ms外側は数えない', () => {
    expect(isWithinWeeklyWindow('2026-08-16T11:59:59.999Z', NOW)).toBe(false)
  })

  it('現在時刻ちょうどは数え、未来（+1ms）は数えない（上限inclusive・時刻異常データの誤計上防止）', () => {
    expect(isWithinWeeklyWindow(NOW, NOW)).toBe(true)
    expect(isWithinWeeklyWindow('2026-08-23T12:00:00.001Z', NOW)).toBe(false)
  })

  it('不正なISO文字列はどちら側でもfalseへ縮退し、例外を投げない', () => {
    expect(isWithinWeeklyWindow('not-a-date', NOW)).toBe(false)
    expect(isWithinWeeklyWindow(NOW, 'not-a-date')).toBe(false)
  })
})

describe('eventFingerprint: 同一イベント判定（D023）', () => {
  it('空白（半角・全角・前後）、大小文字、NFKC全角英字の差を正規化して一致させる', () => {
    const spaced = {
      ...baseOffer,
      eventName: ' テント泊　体験会 ',
      dateText: '9月12日（土） 10:00〜16:00 ',
      place: '北テラス広場　集合',
    }
    const compact = {
      ...baseOffer,
      eventName: 'テント泊体験会',
      dateText: '9月12日（土）10:00〜16:00',
      place: '北テラス広場集合',
    }
    expect(eventFingerprint(spaced)).toBe(eventFingerprint(compact))

    const fullWidth = { ...baseOffer, eventName: 'ＣＡＭＰ Night' }
    const halfWidth = { ...baseOffer, eventName: 'camp night' }
    expect(eventFingerprint(fullWidth)).toBe(eventFingerprint(halfWidth))
  })

  it('団体・イベント名・日時・場所のいずれかが実質的に異なれば別イベントになる', () => {
    const base = eventFingerprint(baseOffer)
    expect(eventFingerprint({ ...baseOffer, clubId: 'club-other' })).not.toBe(base)
    expect(eventFingerprint({ ...baseOffer, eventName: '河原クッキング体験' })).not.toBe(base)
    expect(eventFingerprint({ ...baseOffer, dateText: '9月19日（土）10:00〜16:00' })).not.toBe(
      base,
    )
    expect(eventFingerprint({ ...baseOffer, place: '南テラス広場 集合' })).not.toBe(base)
  })

  it('IDだけが違う同一イベントは同じfingerprintになる（ID変え再送の検出根拠）', () => {
    expect(eventFingerprint({ ...baseOffer, id: 'offer-created-99' })).toBe(
      eventFingerprint(baseOffer),
    )
  })
})

describe('buildMatchSnapshots / buildDelivery', () => {
  it('eligibleな学生だけを入力順のままsnapshot化し、停止・許可外・低スコアを除外する', () => {
    const pausedStudent: StudentPreference = {
      ...matchingStudent,
      id: 'student-paused',
      reception: { ...matchingStudent.reception, paused: true },
    }
    const notAllowedStudent: StudentPreference = {
      ...matchingStudent,
      id: 'student-not-allowed',
      reception: { ...matchingStudent.reception, allowedCategories: ['music'] },
    }
    const lowScoreStudent: StudentPreference = {
      ...matchingStudent,
      id: 'student-low',
      interests: ['music'],
      purposes: ['creation'],
      availableDays: ['weekday_night'],
    }
    const snapshots = buildMatchSnapshots(
      [pausedStudent, matchingStudent, notAllowedStudent, lowScoreStudent],
      baseOffer,
    )
    expect(snapshots.map((snapshot) => snapshot.studentId)).toEqual(['student-match'])
  })

  it('snapshotの内容はcalculateMatchの出力と完全に一致する（唯一の判定源・値の加工なし）', () => {
    const [snapshot] = buildMatchSnapshots([matchingStudent], baseOffer)
    const result = calculateMatch(matchingStudent, baseOffer)
    expect(snapshot).toEqual({
      studentId: 'student-match',
      score: result.score,
      reasons: result.reasons,
      cautions: result.cautions,
    })
    // 独立リテラルでの検算（循環検証の防止）
    expect(snapshot.score).toBe(100)
    expect(snapshot.reasons).toEqual([
      'アウトドアに興味がある',
      '土日に参加しやすい',
      '未経験でも歓迎される活動',
    ])
    expect(snapshot.cautions).toEqual([])
  })

  it('deep freezeした入力でも動作し、入力を一切変更しない。同じ入力から同じ結果を返す', () => {
    const frozenStudents = deepFreeze([
      { ...matchingStudent, reception: { ...matchingStudent.reception } },
    ])
    const frozenOffer = deepFreeze({ ...baseOffer })
    const first = buildMatchSnapshots(frozenStudents, frozenOffer)
    const second = buildMatchSnapshots(frozenStudents, frozenOffer)
    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
  })

  it('buildDeliveryはoffer全体をsnapshotとして内蔵し、id=`delivery-${offer.id}`で入力値を保持する', () => {
    const recipients = buildMatchSnapshots([matchingStudent], baseOffer)
    const delivery = buildDelivery(baseOffer, recipients, '2026-08-23T10:00:00.000Z')
    expect(delivery.id).toBe('delivery-offer-test')
    expect(delivery.offer).toEqual(baseOffer)
    expect(delivery.deliveredAt).toBe('2026-08-23T10:00:00.000Z')
    expect(delivery.recipients).toEqual(recipients)
  })
})
