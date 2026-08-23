import { describe, expect, it } from 'vitest'

import {
  calculateMatch,
  ELIGIBLE_THRESHOLD,
  evaluateOffersForStudent,
  MAX_CAUTIONS,
  MAX_REASONS,
  rankEligibleOffers,
} from './matching'
import { INTEREST_CATEGORIES, type ClubOffer, type StudentPreference } from './types'

// デフォルト同士は全要素満点（100点）になるよう揃えた合成フィクスチャ
function makeStudent(overrides: Partial<StudentPreference> = {}): StudentPreference {
  return {
    id: 'test-student',
    displayName: 'テスト学生',
    interests: ['outdoor'],
    purposes: ['friends', 'challenge'],
    style: 'moderate',
    frequency: 'monthly_1_2',
    availableDays: ['weekend'],
    experience: 'none',
    maxFeePerEventYen: 2000,
    reception: {
      paused: false,
      allowedCategories: [...INTEREST_CATEGORIES],
      weeklyLimit: 3,
    },
    ...overrides,
  }
}

function makeOffer(overrides: Partial<ClubOffer> = {}): ClubOffer {
  return {
    id: 'test-offer',
    clubId: 'test-club',
    eventName: 'テスト体験会',
    description: 'テスト用のイベントです',
    reasonNote: 'テスト用の対象説明です',
    dateText: '4月18日（土）10:00',
    place: 'テスト会場',
    eventDays: ['weekend'],
    frequency: 'monthly_1_2',
    feePerEventYen: 1000,
    beginnerFriendly: true,
    intensity: 'moderate',
    targetCategories: ['outdoor'],
    targetPurposes: ['friends', 'challenge'],
    capacity: 10,
    deadline: '2026-04-16',
    ...overrides,
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      deepFreeze(nested)
    }
    Object.freeze(value)
  }
  return value
}

describe('calculateMatch: スコアと配信判定', () => {
  it('全要素が一致すると100点・eligible・cautionなしになる', () => {
    const result = calculateMatch(makeStudent(), makeOffer())
    expect(result.score).toBe(100)
    expect(result.eligible).toBe(true)
    expect(result.cautions).toEqual([])
  })

  it('全要素が不一致だと0点でeligible=falseになる', () => {
    const student = makeStudent({
      interests: ['music'],
      purposes: ['exercise'],
      style: 'relaxed',
      availableDays: ['weekday_day'],
      maxFeePerEventYen: 500,
    })
    const offer = makeOffer({
      targetCategories: ['outdoor'],
      targetPurposes: ['creation'],
      intensity: 'serious',
      eventDays: ['weekend'],
      beginnerFriendly: false,
      feePerEventYen: 1000,
    })
    const result = calculateMatch(student, offer)
    expect(result.score).toBe(0)
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual([])
  })

  it('65点ちょうど（興味35+目的20+経験10）はeligible=trueになる', () => {
    const student = makeStudent({
      style: 'relaxed',
      availableDays: ['weekday_day'],
      maxFeePerEventYen: 500,
    })
    const offer = makeOffer({
      intensity: 'serious',
      eventDays: ['weekend'],
      feePerEventYen: 1000,
    })
    const result = calculateMatch(student, offer)
    expect(result.score).toBe(ELIGIBLE_THRESHOLD)
    expect(result.eligible).toBe(true)
  })

  it('65点未満の最近接構成（63点=興味35+目的20+スタイル隣接8）はeligible=falseになる', () => {
    // この配点の離散値では64点はどの組合せでも構成できない（計画E参照）
    const student = makeStudent({
      style: 'relaxed',
      availableDays: ['weekday_day'],
      maxFeePerEventYen: 500,
    })
    const offer = makeOffer({
      intensity: 'moderate',
      eventDays: ['weekend'],
      feePerEventYen: 1000,
      beginnerFriendly: false,
    })
    const result = calculateMatch(student, offer)
    expect(result.score).toBe(63)
    expect(result.eligible).toBe(false)
  })

  it('58点構成（興味不一致）もeligible=falseになる', () => {
    const student = makeStudent({ interests: ['music'], style: 'relaxed' })
    const result = calculateMatch(student, makeOffer())
    expect(result.score).toBe(58)
    expect(result.eligible).toBe(false)
  })

  it('満点でも受信停止中（paused=true）ならeligible=falseになる', () => {
    const student = makeStudent({
      reception: { paused: true, allowedCategories: [...INTEREST_CATEGORIES], weeklyLimit: 3 },
    })
    const result = calculateMatch(student, makeOffer())
    expect(result.score).toBe(100)
    expect(result.eligible).toBe(false)
  })

  it('満点でも受信許可カテゴリ外ならeligible=falseになる', () => {
    const student = makeStudent({
      reception: { paused: false, allowedCategories: ['music'], weeklyLimit: 3 },
    })
    const result = calculateMatch(student, makeOffer())
    expect(result.score).toBe(100)
    expect(result.eligible).toBe(false)
  })

  it('興味が一致しなくても残り要素の満点合計65でeligible=trueになり、理由が1件以上つく', () => {
    const student = makeStudent({ interests: ['music'] })
    const result = calculateMatch(student, makeOffer())
    expect(result.score).toBe(65)
    expect(result.eligible).toBe(true)
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons.some((reason) => reason.includes('興味'))).toBe(false)
  })
})

describe('calculateMatch: 空配列の境界', () => {
  it('interestsが空でも例外なく興味0点として計算される', () => {
    const result = calculateMatch(makeStudent({ interests: [] }), makeOffer())
    expect(result.score).toBe(65)
  })

  it('availableDays・purposesが空でも例外なく該当要素0点として計算される', () => {
    const result = calculateMatch(
      makeStudent({ availableDays: [], purposes: [] }),
      makeOffer(),
    )
    expect(result.score).toBe(65) // 100 - 曜日15 - 目的20
  })

  it('offerのeventDays・targetPurposesが空でも例外なく0点として計算される', () => {
    const result = calculateMatch(
      makeStudent(),
      makeOffer({ eventDays: [], targetPurposes: [] }),
    )
    expect(result.score).toBe(65)
  })

  it('targetCategoriesが空なら興味0点かつカテゴリ許可も成立せずeligible=falseになる', () => {
    const result = calculateMatch(makeStudent(), makeOffer({ targetCategories: [] }))
    expect(result.score).toBe(65)
    expect(result.eligible).toBe(false)
  })
})

describe('calculateMatch: 興味の複数一致', () => {
  it('2カテゴリ一致でも35点のままで、理由は学生の登録順で最初の一致1文になる', () => {
    const student = makeStudent({ interests: ['photo', 'outdoor'] })
    const offer = makeOffer({ targetCategories: ['outdoor', 'photo'] })
    const result = calculateMatch(student, offer)
    expect(result.score).toBe(100)
    expect(result.reasons[0]).toBe('写真に興味がある')
    expect(result.reasons.filter((reason) => reason.includes('興味'))).toHaveLength(1)
  })
})

describe('calculateMatch: 費用の境界（円/回の同一単位比較）', () => {
  it('参加費が予算と完全同額なら予算内（5点）でcautionは出ない', () => {
    const result = calculateMatch(
      makeStudent({ maxFeePerEventYen: 2000 }),
      makeOffer({ feePerEventYen: 2000 }),
    )
    expect(result.score).toBe(100)
    expect(result.cautions).toEqual([])
  })

  it('参加費が予算を1円でも超えると費用0点になり、1回あたり表記のcautionが出る', () => {
    const result = calculateMatch(
      makeStudent({ maxFeePerEventYen: 2000 }),
      makeOffer({ feePerEventYen: 2001 }),
    )
    expect(result.score).toBe(95)
    expect(result.cautions).toContain(
      '参加費（2,001円）は希望予算（1回2,000円以内）より高めです',
    )
  })
})

describe('calculateMatch: cautionの発火条件と上限', () => {
  it('活動頻度が希望より多いとcautionが出る', () => {
    const result = calculateMatch(
      makeStudent({ frequency: 'monthly_1_2' }),
      makeOffer({ frequency: 'weekly_1' }),
    )
    expect(result.cautions).toContain('活動頻度（週1回）は希望より多めです')
  })

  it('活動頻度が希望と同じ・少ない場合はcautionが出ない', () => {
    const same = calculateMatch(makeStudent(), makeOffer())
    const lighter = calculateMatch(
      makeStudent({ frequency: 'weekly_2_plus' }),
      makeOffer({ frequency: 'monthly_1_2' }),
    )
    expect(same.cautions.some((caution) => caution.includes('頻度'))).toBe(false)
    expect(lighter.cautions.some((caution) => caution.includes('頻度'))).toBe(false)
  })

  it('caution候補が3件以上でも優先順（費用→頻度→本気度→初心者）で2件に制限される', () => {
    const student = makeStudent({
      style: 'relaxed',
      frequency: 'monthly_1_2',
      maxFeePerEventYen: 500,
    })
    const offer = makeOffer({
      feePerEventYen: 1000,
      frequency: 'weekly_2_plus',
      intensity: 'serious',
      beginnerFriendly: false,
    })
    const result = calculateMatch(student, offer)
    expect(result.cautions).toHaveLength(MAX_CAUTIONS)
    expect(result.cautions[0]).toContain('参加費')
    expect(result.cautions[1]).toContain('活動頻度')
  })
})

describe('calculateMatch: reasonsの生成規則', () => {
  it('得点要素が5件あっても優先順（興味→曜日→経験）で3件に制限される', () => {
    const result = calculateMatch(makeStudent(), makeOffer())
    expect(result.reasons).toHaveLength(MAX_REASONS)
    expect(result.reasons[0]).toBe('アウトドアに興味がある')
    expect(result.reasons[1]).toBe('土日に参加しやすい')
    expect(result.reasons[2]).toBe('未経験でも歓迎される活動')
  })

  it('0点の要素からは理由文が生成されない', () => {
    const noInterest = calculateMatch(makeStudent({ interests: ['music'] }), makeOffer())
    expect(noInterest.reasons.some((reason) => reason.includes('興味'))).toBe(false)

    const noDays = calculateMatch(makeStudent({ availableDays: ['weekday_day'] }), makeOffer())
    expect(noDays.reasons.some((reason) => reason.includes('参加しやすい'))).toBe(false)

    const noPurpose = calculateMatch(makeStudent({ purposes: ['exercise'] }), makeOffer())
    expect(noPurpose.reasons.some((reason) => reason.includes('目的'))).toBe(false)

    const feeOver = calculateMatch(makeStudent({ maxFeePerEventYen: 100 }), makeOffer())
    expect(feeOver.reasons.some((reason) => reason.includes('予算内'))).toBe(false)
  })

  it('少し経験あり×経験者向けは部分適合5点になり、経験の理由文は生成されない', () => {
    const result = calculateMatch(
      makeStudent({ experience: 'some' }),
      makeOffer({ beginnerFriendly: false }),
    )
    expect(result.score).toBe(95) // 経験のみ部分適合5点（100 - 5）
    expect(result.eligible).toBe(true)
    expect(result.reasons.some((reason) => reason.includes('経験'))).toBe(false)
  })

  it('経験の理由文は「未経験×歓迎」「経験者×経験者向け」のみで生成される', () => {
    const someLevel = calculateMatch(makeStudent({ experience: 'some' }), makeOffer())
    expect(someLevel.reasons.some((reason) => reason.includes('経験'))).toBe(false)

    const experienced = calculateMatch(
      makeStudent({ experience: 'experienced' }),
      makeOffer({ beginnerFriendly: false }),
    )
    expect(experienced.reasons).toContain('経験を活かしやすい活動')
  })
})

describe('calculateMatch: ハードコード不在と決定性', () => {
  it('属性が同一ならID・団体・イベント名が違っても同じ結果になる', () => {
    const student = makeStudent()
    const resultA = calculateMatch(
      student,
      makeOffer({ id: 'offer-a', clubId: 'club-a', eventName: 'イベントA' }),
    )
    const resultB = calculateMatch(
      student,
      makeOffer({ id: 'offer-b', clubId: 'club-b', eventName: 'イベントB' }),
    )
    expect(resultA).toEqual(resultB)
  })

  it('属性を1つ変えると結果が期待どおりに変わる', () => {
    const base = calculateMatch(makeStudent(), makeOffer())
    const feeOver = calculateMatch(makeStudent(), makeOffer({ feePerEventYen: 9999 }))
    expect(base.score - feeOver.score).toBe(5)
    expect(feeOver.cautions.some((caution) => caution.includes('参加費'))).toBe(true)
  })

  it('同じ入力で2回呼び出すと完全に同じ結果を返す', () => {
    const student = makeStudent()
    const offer = makeOffer({ feePerEventYen: 2500, frequency: 'weekly_1' })
    expect(calculateMatch(student, offer)).toEqual(calculateMatch(student, offer))
  })

  it('deep freezeした入力でも例外なく動作し、入力を一切変更しない', () => {
    const student = deepFreeze(makeStudent())
    const offer = deepFreeze(makeOffer({ feePerEventYen: 2500 }))
    const studentSnapshot = JSON.stringify(student)
    const offerSnapshot = JSON.stringify(offer)

    expect(() => calculateMatch(student, offer)).not.toThrow()
    expect(JSON.stringify(student)).toBe(studentSnapshot)
    expect(JSON.stringify(offer)).toBe(offerSnapshot)
  })
})

describe('evaluateOffersForStudent / rankEligibleOffers', () => {
  it('evaluateはeligible=falseも含めて全件を入力順のまま返す', () => {
    const student = makeStudent()
    const offers = [
      makeOffer({ id: 'offer-1' }),
      makeOffer({ id: 'offer-2', targetCategories: ['music'], beginnerFriendly: false }), // 55点
      makeOffer({ id: 'offer-3' }),
    ]
    const evaluated = evaluateOffersForStudent(student, offers)
    expect(evaluated.map((entry) => entry.offer.id)).toEqual(['offer-1', 'offer-2', 'offer-3'])
    expect(evaluated[1]?.result.eligible).toBe(false)
  })

  it('rankはeligibleのみをscore降順で返し、同点はID昇順で決定的に並ぶ', () => {
    const student = makeStudent()
    const offers = [
      makeOffer({ id: 'offer-b' }), // 100点
      makeOffer({ id: 'offer-c', feePerEventYen: 2500 }), // 95点
      makeOffer({ id: 'offer-a' }), // 100点（同点タイ）
      makeOffer({ id: 'offer-x', targetCategories: ['music'], beginnerFriendly: false }), // 55点でineligible
    ]
    const ranked = rankEligibleOffers(student, offers)
    expect(ranked.map((entry) => entry.offer.id)).toEqual(['offer-a', 'offer-b', 'offer-c'])
  })

  it('rankは元の配列と並びを変更しない', () => {
    const student = makeStudent()
    const offers = [
      makeOffer({ id: 'offer-low', feePerEventYen: 2500 }),
      makeOffer({ id: 'offer-high' }),
    ]
    rankEligibleOffers(student, offers)
    expect(offers.map((offer) => offer.id)).toEqual(['offer-low', 'offer-high'])
  })

  it('offersが空配列なら空配列を返す', () => {
    expect(rankEligibleOffers(makeStudent(), [])).toEqual([])
  })
})
