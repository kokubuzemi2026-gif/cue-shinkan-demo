import { describe, expect, it } from 'vitest'

import { demoClubs, demoStudent } from '../../data/demoData'
import { buildSeedDeliveries } from '../../data/demoDeliverySeed'
import type {
  OfferDelivery,
  OfferReadMark,
  OfferResponse,
  StudentPreference,
} from '../../domain/types'
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

// Task 005（D023）で受信箱の正本は保存済み配信イベントへ移行した。
// Task 004の「条件に合わない学生fixtureでは空の受信箱になる」はD020暫定仕様
// （現在パスポートでの再評価）の検証だったため、本仕様の完成に伴い
// 「条件を変更しても配信済み履歴は消えない」という新仕様のテストへ意図的に置換している

const seedDeliveries = buildSeedDeliveries()

const READ_ROKKO: OfferReadMark = {
  offerId: 'offer-rokko-hike',
  studentId: 'student-you',
  readAt: '2026-04-10T09:00:00.000Z',
}

function response(offerId: string, choice: OfferResponse['choice']): OfferResponse {
  return { offerId, studentId: 'student-you', choice, respondedAt: '2026-04-10T09:30:00.000Z' }
}

// 新規配信のfixture（メイン学生宛て・ウィンドウ内の新しい日時）
function newCampaignDelivery(overrides: Partial<OfferDelivery> = {}): OfferDelivery {
  return {
    id: 'delivery-offer-created-1',
    deliveredAt: '2026-08-23T10:00:00.000Z',
    offer: {
      id: 'offer-created-1',
      clubId: 'club-rokko-outdoor',
      eventName: 'はじめてのテント泊体験会',
      description: 'テント設営から体験する1日イベントです。',
      reasonNote: 'アウトドアをこれから始めたい新入生に来てほしいからです。',
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
    ],
    ...overrides,
  }
}

function deepFreezeStudent(student: StudentPreference): StudentPreference {
  Object.freeze(student.interests)
  Object.freeze(student.purposes)
  Object.freeze(student.availableDays)
  Object.freeze(student.reception.allowedCategories)
  Object.freeze(student.reception)
  return Object.freeze(student)
}

describe('buildInboxView: 配信履歴からの導出（D023）', () => {
  it('シード3配信では六甲→Harbor→TableTalkの順で、delivery.offerの内容と団体が結合される', () => {
    const view = buildInboxView(demoStudent, seedDeliveries, demoClubs, [], [])
    expect(view.items.map((item) => item.offer.id)).toEqual([
      'offer-rokko-hike',
      'offer-photo-walk',
      'offer-cafe-night',
    ])
    expect(view.items.map((item) => item.club.name)).toEqual([
      '六甲アウトドア会',
      'Harbor Film Lab',
      'Table Talk International',
    ])
    expect(view.items.map((item) => item.offer.eventName)).toEqual([
      'はじめての六甲山ハイク',
      '週末フォトウォークと上映会',
      '国際交流カフェナイト',
    ])
    expect(view.paused).toBe(false)
  })

  it('各itemのresultは配信時snapshotのリテラル（100/85/68・理由・注意点）と一致する', () => {
    const view = buildInboxView(demoStudent, seedDeliveries, demoClubs, [], [])
    expect(view.items.map((item) => item.result.score)).toEqual([100, 85, 68])
    expect(view.items[0].result.reasons).toEqual([
      'アウトドアに興味がある',
      '土日に参加しやすい',
      '未経験でも歓迎される活動',
    ])
    expect(view.items[0].result.cautions).toEqual([])
    expect(view.items[1].result.cautions).toEqual([
      '参加費（2,500円）は希望予算（1回2,000円以内）より高めです',
    ])
    expect(view.items[2].result.cautions).toEqual(['活動頻度（週1回）は希望より多めです'])
    for (const item of view.items) {
      expect(item.result.eligible).toBe(true)
    }
  })

  it('新規配信を追加すると4件になり、新着が先頭に未読で現れる（送信→新着の核心）', () => {
    const view = buildInboxView(
      demoStudent,
      [...seedDeliveries, newCampaignDelivery()],
      demoClubs,
      [],
      [],
    )
    expect(view.items).toHaveLength(4)
    expect(view.items[0].offer.id).toBe('offer-created-1')
    expect(view.items[0].status).toBe('unread')
    expect(view.items[1].offer.id).toBe('offer-rokko-hike')
  })

  it('同時刻の配信はオファーID昇順で決定的に並ぶ', () => {
    const first = newCampaignDelivery()
    const second = newCampaignDelivery({
      id: 'delivery-offer-created-2',
      offer: { ...first.offer, id: 'offer-created-2', eventName: '同時刻のイベント' },
    })
    const view = buildInboxView(demoStudent, [second, first], demoClubs, [], [])
    expect(view.items.map((item) => item.offer.id)).toEqual([
      'offer-created-1',
      'offer-created-2',
    ])
  })

  it('興味・受信カテゴリをmusicのみへ変更しても、受信済み3件と表示内容は変わらない（履歴固定・D023）', () => {
    const changed: StudentPreference = {
      ...demoStudent,
      interests: ['music'],
      reception: { ...demoStudent.reception, allowedCategories: ['music'] },
    }
    const view = buildInboxView(changed, seedDeliveries, demoClubs, [], [])
    expect(view.items).toHaveLength(3)
    expect(view.items.map((item) => item.result.score)).toEqual([100, 85, 68])
    expect(view.items[0].result.reasons).toEqual([
      'アウトドアに興味がある',
      '土日に参加しやすい',
      '未経験でも歓迎される活動',
    ])
  })

  it('受信停止中でも受信済み3件は表示され続け、pausedフラグだけが立つ（D020）', () => {
    const paused = withReceptionPaused(demoStudent, true)
    const view = buildInboxView(paused, seedDeliveries, demoClubs, [], [])
    expect(view.paused).toBe(true)
    expect(view.items).toHaveLength(3)
  })

  it('受信停止中でも返答・既読の結合と状態導出は通常どおり機能する', () => {
    const paused = withReceptionPaused(demoStudent, true)
    const view = buildInboxView(
      paused,
      seedDeliveries,
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
    const view = buildInboxView(limited, seedDeliveries, demoClubs, [], [])
    expect(view.items).toHaveLength(3)
  })

  it('自分がrecipientに含まれない配信は表示しない（学生間のデータ分離）', () => {
    const othersOnly = newCampaignDelivery({
      recipients: [
        { studentId: 'pool-05', score: 88, reasons: ['アウトドアに興味がある'], cautions: [] },
      ],
    })
    const view = buildInboxView(
      demoStudent,
      [...seedDeliveries, othersOnly],
      demoClubs,
      [],
      [],
    )
    expect(view.items.map((item) => item.offer.id)).not.toContain('offer-created-1')
    expect(view.items).toHaveLength(3)
  })

  it('delivery.offer.clubIdが不明な配信は例外を出さずに除外される', () => {
    const orphan = newCampaignDelivery({
      id: 'delivery-offer-orphan',
      offer: { ...newCampaignDelivery().offer, id: 'offer-orphan', clubId: 'club-missing' },
    })
    const view = buildInboxView(
      demoStudent,
      [...seedDeliveries, orphan],
      demoClubs,
      [],
      [],
    )
    expect(view.items.map((item) => item.offer.id)).not.toContain('offer-orphan')
    expect(view.items).toHaveLength(3)
  })

  it('deliveriesが空なら空の受信箱になる（空状態のfixture検証）', () => {
    const view = buildInboxView(demoStudent, [], demoClubs, [], [])
    expect(view.items).toEqual([])
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
    const view = buildInboxView(
      demoStudent,
      seedDeliveries,
      demoClubs,
      [otherResponse],
      [otherRead],
    )
    expect(view.items[0].status).toBe('unread')
    expect(view.items[0].response).toBeNull()
  })

  it('全入力を凍結しても動作し、入力（配信配列の並び含む）を破壊しない', () => {
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
    // 古い順に渡しても入力配列自体は並び替えない
    const reversed = Object.freeze([...seedDeliveries].reverse()) as OfferDelivery[]
    const responses = Object.freeze([response('offer-rokko-hike', 'thinking')]) as OfferResponse[]
    const reads = Object.freeze([READ_ROKKO]) as OfferReadMark[]
    expect(() =>
      buildInboxView(student, reversed, Object.freeze([...demoClubs]) as typeof demoClubs, responses, reads),
    ).not.toThrow()
    expect(reversed[0].offer.id).toBe('offer-cafe-night')
    const view = buildInboxView(student, reversed, demoClubs, responses, reads)
    expect(view.items[0].offer.id).toBe('offer-rokko-hike')
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
  it('選択中のオファーが表示集合から消えたらstaleになる（配信データ縮退などの場合）', () => {
    const withRokko = buildInboxView(demoStudent, seedDeliveries, demoClubs, [], [])
    const withoutRokko = buildInboxView(
      demoStudent,
      seedDeliveries.filter((delivery) => delivery.offer.id !== 'offer-rokko-hike'),
      demoClubs,
      [],
      [],
    )
    expect(isSelectionStale('offer-rokko-hike', withRokko.items)).toBe(false)
    expect(isSelectionStale('offer-rokko-hike', withoutRokko.items)).toBe(true)
  })

  it('未選択（null）はstaleにならない（空の受信箱でも）', () => {
    expect(isSelectionStale(null, [])).toBe(false)
    const view = buildInboxView(demoStudent, seedDeliveries, demoClubs, [], [])
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
