import { describe, expect, it } from 'vitest'

import { demoClubs, demoOffers, demoStudent } from '../../data/demoData'
import { calculateMatch } from '../../domain/matching'
import type { OfferReadMark, OfferResponse, StudentPreference } from '../../domain/types'
import {
  buildInboxView,
  deriveOfferStatus,
  formatDeadline,
  formatEventFee,
  isSelectionStale,
  markRead,
  upsertResponse,
} from './inbox'
import { withReceptionPaused } from './passportForm'

const READ_ROKKO: OfferReadMark = {
  offerId: 'offer-rokko-hike',
  studentId: 'student-you',
  readAt: '2026-04-10T09:00:00.000Z',
}

function response(offerId: string, choice: OfferResponse['choice']): OfferResponse {
  return { offerId, studentId: 'student-you', choice, respondedAt: '2026-04-10T09:30:00.000Z' }
}

function deepFreezeStudent(student: StudentPreference): StudentPreference {
  Object.freeze(student.interests)
  Object.freeze(student.purposes)
  Object.freeze(student.availableDays)
  Object.freeze(student.reception.allowedCategories)
  Object.freeze(student.reception)
  return Object.freeze(student)
}

describe('buildInboxView: 受信済み集合の導出', () => {
  it('デモ学生では六甲100→Harbor85→TableTalk68の順で団体が正しく結合される', () => {
    const view = buildInboxView(demoStudent, demoOffers, demoClubs, [], [])
    expect(view.items.map((item) => item.offer.id)).toEqual([
      'offer-rokko-hike',
      'offer-photo-walk',
      'offer-cafe-night',
    ])
    expect(view.items.map((item) => item.result.score)).toEqual([100, 85, 68])
    expect(view.items.map((item) => item.club.name)).toEqual([
      '六甲アウトドア会',
      'Harbor Film Lab',
      'Table Talk International',
    ])
    expect(view.paused).toBe(false)
  })

  it('各itemのreasons/cautionsはcalculateMatchの計算結果と完全に一致する', () => {
    const view = buildInboxView(demoStudent, demoOffers, demoClubs, [], [])
    for (const item of view.items) {
      const expected = calculateMatch(demoStudent, item.offer)
      expect(item.result.reasons).toEqual(expected.reasons)
      expect(item.result.cautions).toEqual(expected.cautions)
      expect(item.result.score).toBe(expected.score)
    }
  })

  it('受信停止中でも受信済み3件は表示され続け、pausedフラグだけが立つ（D020）', () => {
    const paused = withReceptionPaused(demoStudent, true)
    const view = buildInboxView(paused, demoOffers, demoClubs, [], [])
    expect(view.paused).toBe(true)
    expect(view.items).toHaveLength(3)
    expect(view.items.map((item) => item.offer.id)).toEqual([
      'offer-rokko-hike',
      'offer-photo-walk',
      'offer-cafe-night',
    ])
  })

  it('受信停止中でも返答・既読の結合と状態導出は通常どおり機能する', () => {
    const paused = withReceptionPaused(demoStudent, true)
    const view = buildInboxView(
      paused,
      demoOffers,
      demoClubs,
      [response('offer-rokko-hike', 'interested')],
      [READ_ROKKO],
    )
    expect(view.items[0].status).toBe('answered')
    expect(view.items[0].response?.choice).toBe('interested')
  })

  it('weeklyLimitを1へ変えても表示は3件のまま（表示のsliceをしない・D020）', () => {
    const limited: StudentPreference = {
      ...demoStudent,
      reception: { ...demoStudent.reception, weeklyLimit: 1 },
    }
    const view = buildInboxView(limited, demoOffers, demoClubs, [], [])
    expect(view.items).toHaveLength(3)
  })

  it('受信許可カテゴリ外（Bridge Volunteer）は混入しない', () => {
    const view = buildInboxView(demoStudent, demoOffers, demoClubs, [], [])
    expect(view.items.map((item) => item.offer.id)).not.toContain('offer-kodomo-shokudo')
  })

  it('clubIdが不明なオファーは例外を出さずに除外される', () => {
    const orphan = { ...demoOffers[0], id: 'offer-orphan', clubId: 'club-missing' }
    const view = buildInboxView(demoStudent, [...demoOffers, orphan], demoClubs, [], [])
    expect(view.items.map((item) => item.offer.id)).not.toContain('offer-orphan')
    expect(view.items).toHaveLength(3)
  })

  it('他学生の返答・既読は無視される', () => {
    const otherResponse: OfferResponse = {
      offerId: 'offer-rokko-hike',
      studentId: 'student-other',
      choice: 'skip',
      respondedAt: '2026-04-10T09:00:00.000Z',
    }
    const otherRead: OfferReadMark = {
      offerId: 'offer-rokko-hike',
      studentId: 'student-other',
      readAt: '2026-04-10T09:00:00.000Z',
    }
    const view = buildInboxView(demoStudent, demoOffers, demoClubs, [otherResponse], [otherRead])
    expect(view.items[0].status).toBe('unread')
    expect(view.items[0].response).toBeNull()
  })

  it('全入力を凍結しても動作し、入力を破壊しない', () => {
    const student = deepFreezeStudent({
      ...demoStudent,
      interests: [...demoStudent.interests],
      purposes: [...demoStudent.purposes],
      availableDays: [...demoStudent.availableDays],
      reception: {
        ...demoStudent.reception,
        allowedCategories: [...demoStudent.reception.allowedCategories],
      },
    })
    const offers = Object.freeze([...demoOffers])
    const clubs = Object.freeze([...demoClubs])
    const responses = Object.freeze([response('offer-rokko-hike', 'thinking')])
    const reads = Object.freeze([READ_ROKKO])
    expect(() =>
      buildInboxView(
        student,
        offers as typeof demoOffers,
        clubs as typeof demoClubs,
        responses as OfferResponse[],
        reads as OfferReadMark[],
      ),
    ).not.toThrow()
  })

  it('offersが空なら空の受信箱になる（空状態のfixture検証）', () => {
    const view = buildInboxView(demoStudent, [], demoClubs, [], [])
    expect(view.items).toEqual([])
  })

  it('条件に合わない学生fixtureでは空の受信箱になる（空状態のfixture検証）', () => {
    const mismatched: StudentPreference = {
      ...demoStudent,
      interests: ['music'],
      reception: { ...demoStudent.reception, allowedCategories: ['music'] },
    }
    const view = buildInboxView(mismatched, demoOffers, demoClubs, [], [])
    expect(view.items).toEqual([])
  })
})

describe('deriveOfferStatus: 4状態の導出', () => {
  it('開封記録も返答もなければ未読になる', () => {
    expect(deriveOfferStatus(false, null)).toBe('unread')
  })

  it('開封済みで返答がなければ未回答になる', () => {
    expect(deriveOfferStatus(true, null)).toBe('unanswered')
  })

  it('あとで考えるは保留、行ってみたい・見送るは回答済みになる', () => {
    expect(deriveOfferStatus(true, response('o', 'thinking'))).toBe('thinking')
    expect(deriveOfferStatus(true, response('o', 'interested'))).toBe('answered')
    expect(deriveOfferStatus(true, response('o', 'skip'))).toBe('answered')
  })

  it('返答があれば開封記録がなくても返答状態を優先する（既読データ破損時の縮退）', () => {
    expect(deriveOfferStatus(false, response('o', 'interested'))).toBe('answered')
    expect(deriveOfferStatus(false, response('o', 'thinking'))).toBe('thinking')
  })
})

describe('isSelectionStale: 詳細対象の消失判定', () => {
  it('選択中のオファーが表示集合から消えたらstaleになる（条件変更で非適合化した場合）', () => {
    const withRokko = buildInboxView(demoStudent, demoOffers, demoClubs, [], [])
    const mismatched: StudentPreference = {
      ...demoStudent,
      interests: ['music'],
      reception: { ...demoStudent.reception, allowedCategories: ['music'] },
    }
    const withoutRokko = buildInboxView(mismatched, demoOffers, demoClubs, [], [])
    expect(isSelectionStale('offer-rokko-hike', withRokko.items)).toBe(false)
    expect(isSelectionStale('offer-rokko-hike', withoutRokko.items)).toBe(true)
  })

  it('未選択（null）はstaleにならない（空の受信箱でも）', () => {
    expect(isSelectionStale(null, [])).toBe(false)
    const view = buildInboxView(demoStudent, demoOffers, demoClubs, [], [])
    expect(isSelectionStale(null, view.items)).toBe(false)
  })

  it('items空で選択が残っていればstaleになる', () => {
    expect(isSelectionStale('offer-rokko-hike', [])).toBe(true)
  })
})

describe('markRead / upsertResponse', () => {
  it('markRead: 未記録なら追加した新配列を返し、readAtを保持する', () => {
    const next = markRead([], READ_ROKKO)
    expect(next).toEqual([READ_ROKKO])
    expect(next[0].readAt).toBe('2026-04-10T09:00:00.000Z')
  })

  it('markRead: 記録済みなら同一配列参照を返す（書込スキップの判定に使う）', () => {
    const reads = [READ_ROKKO]
    const next = markRead(reads, { ...READ_ROKKO, readAt: '2026-04-11T00:00:00.000Z' })
    expect(next).toBe(reads)
    expect(next[0].readAt).toBe('2026-04-10T09:00:00.000Z')
  })

  it('markRead: 入力配列を破壊しない', () => {
    const reads = Object.freeze([READ_ROKKO]) as OfferReadMark[]
    const added = markRead(reads, { ...READ_ROKKO, offerId: 'offer-photo-walk' })
    expect(added).toHaveLength(2)
    expect(reads).toHaveLength(1)
  })

  it('upsertResponse: 新規追加・同一(offerId,studentId)は置換・他は保持・非破壊', () => {
    const initial = Object.freeze([response('offer-rokko-hike', 'thinking')]) as OfferResponse[]
    const added = upsertResponse(initial, response('offer-photo-walk', 'skip'))
    expect(added).toHaveLength(2)
    const replaced = upsertResponse(added, response('offer-rokko-hike', 'interested'))
    expect(replaced).toHaveLength(2)
    expect(replaced.find((entry) => entry.offerId === 'offer-rokko-hike')?.choice).toBe(
      'interested',
    )
    expect(replaced.find((entry) => entry.offerId === 'offer-photo-walk')?.choice).toBe('skip')
    expect(initial[0].choice).toBe('thinking')
  })
})

describe('表示整形', () => {
  it('参加費は1回あたり表記（D019）で、0円は参加費無料になる', () => {
    expect(formatEventFee(1500)).toBe('1回1,500円')
    expect(formatEventFee(0)).toBe('参加費無料')
  })

  it('申込期限はタイムゾーンに依存せず日本語表記になる', () => {
    expect(formatDeadline('2026-04-16')).toBe('4月16日まで')
    expect(formatDeadline('2026-12-01')).toBe('12月1日まで')
  })

  it('不正な期限文字列はそのまま返しクラッシュしない', () => {
    expect(formatDeadline('unknown')).toBe('unknown')
    expect(formatDeadline('2026-99-99')).toBe('2026-99-99')
  })
})
