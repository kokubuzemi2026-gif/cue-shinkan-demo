import {
  ACTIVITY_STYLES,
  DAY_SLOT_LABELS,
  DAY_SLOTS,
  FREQUENCIES,
  FREQUENCY_LABELS,
  INTEREST_LABELS,
  PURPOSE_LABELS,
  type ClubOffer,
  type MatchResult,
  type StudentPreference,
} from './types'

// 配点はdocs/matching_and_safety.md §4.2の6要素100点満点。
// 「数値はユーザー検証後に変更する」ため、細分値も含めてここへ集約する。
export const SCORE_RULES = {
  interest: { match: 35, none: 0 },
  purpose: { twoOrMore: 20, one: 10, none: 0 },
  style: { exact: 15, adjacent: 8, opposite: 0 },
  days: { match: 15, none: 0 },
  experience: { fit: 10, partial: 5, none: 0 },
  fee: { withinBudget: 5, over: 0 },
} as const

export const ELIGIBLE_THRESHOLD = 65
export const MAX_REASONS = 3
export const MAX_CAUTIONS = 2

export type EvaluatedOffer = {
  offer: ClubOffer
  result: MatchResult
}

function formatYen(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`
}

export function calculateMatch(student: StudentPreference, offer: ClubOffer): MatchResult {
  // 興味カテゴリ: 1件でも一致すれば満点の二値。学生の登録順で最初の一致を理由に使う
  const matchedInterest = student.interests.find((interest) =>
    offer.targetCategories.includes(interest),
  )
  const interestScore =
    matchedInterest !== undefined ? SCORE_RULES.interest.match : SCORE_RULES.interest.none

  // 活動目的: 一致数で判定（1件=部分適合、2件以上=満点）
  const matchedPurposes = student.purposes.filter((purpose) =>
    offer.targetPurposes.includes(purpose),
  )
  const purposeScore =
    matchedPurposes.length >= 2
      ? SCORE_RULES.purpose.twoOrMore
      : matchedPurposes.length === 1
        ? SCORE_RULES.purpose.one
        : SCORE_RULES.purpose.none

  // スタイル×本気度: 強度スケール上の段差で判定
  const styleGap = Math.abs(
    ACTIVITY_STYLES.indexOf(student.style) - ACTIVITY_STYLES.indexOf(offer.intensity),
  )
  const styleScore =
    styleGap === 0
      ? SCORE_RULES.style.exact
      : styleGap === 1
        ? SCORE_RULES.style.adjacent
        : SCORE_RULES.style.opposite

  // 曜日: 参加できる開催枠が1つでもあれば満点の二値。理由文はDAY_SLOTS定義順で決定的に選ぶ
  const matchedDay = DAY_SLOTS.find(
    (slot) => student.availableDays.includes(slot) && offer.eventDays.includes(slot),
  )
  const daysScore = matchedDay !== undefined ? SCORE_RULES.days.match : SCORE_RULES.days.none

  // 経験×初心者対応: 初心者歓迎は経験を問わず適合。経験者向けは経験段階に応じて減点
  const experienceScore = offer.beginnerFriendly
    ? SCORE_RULES.experience.fit
    : student.experience === 'experienced'
      ? SCORE_RULES.experience.fit
      : student.experience === 'some'
        ? SCORE_RULES.experience.partial
        : SCORE_RULES.experience.none

  // 費用: 同一単位（円/回）同士のみ比較する（D019）。同額は予算内
  const feeWithinBudget = offer.feePerEventYen <= student.maxFeePerEventYen
  const feeScore = feeWithinBudget ? SCORE_RULES.fee.withinBudget : SCORE_RULES.fee.over

  const score = interestScore + purposeScore + styleScore + daysScore + experienceScore + feeScore

  // 理由は得点した要素からのみ、優先順（興味→曜日→経験→目的→費用）で生成する
  const reasons: string[] = []
  if (matchedInterest !== undefined) {
    reasons.push(`${INTEREST_LABELS[matchedInterest]}に興味がある`)
  }
  if (matchedDay !== undefined) {
    reasons.push(`${DAY_SLOT_LABELS[matchedDay]}に参加しやすい`)
  }
  if (offer.beginnerFriendly && student.experience === 'none') {
    reasons.push('未経験でも歓迎される活動')
  } else if (!offer.beginnerFriendly && student.experience === 'experienced') {
    reasons.push('経験を活かしやすい活動')
  }
  const firstMatchedPurpose = matchedPurposes[0]
  if (firstMatchedPurpose !== undefined) {
    reasons.push(`『${PURPOSE_LABELS[firstMatchedPurpose]}』の目的が合っている`)
  }
  if (feeWithinBudget) {
    reasons.push('参加費が予算内')
  }

  // 重要な不一致は隠さない（§4.3）。優先順（費用→頻度→本気度→初心者対応）
  const cautions: string[] = []
  if (!feeWithinBudget) {
    cautions.push(
      `参加費（${formatYen(offer.feePerEventYen)}）は希望予算（1回${formatYen(student.maxFeePerEventYen)}以内）より高めです`,
    )
  }
  if (FREQUENCIES.indexOf(offer.frequency) > FREQUENCIES.indexOf(student.frequency)) {
    cautions.push(`活動頻度（${FREQUENCY_LABELS[offer.frequency]}）は希望より多めです`)
  }
  if (ACTIVITY_STYLES.indexOf(offer.intensity) > ACTIVITY_STYLES.indexOf(student.style)) {
    cautions.push('活動の本気度は希望より高めです')
  }
  if (!offer.beginnerFriendly && student.experience === 'none') {
    cautions.push('未経験者向けの案内がないイベントです')
  }

  // 配信対象の判定はtasks/002の3条件のみ（受信停止・カテゴリ不許可・65点未満）
  const categoryAllowed = offer.targetCategories.some((category) =>
    student.reception.allowedCategories.includes(category),
  )
  const eligible = !student.reception.paused && categoryAllowed && score >= ELIGIBLE_THRESHOLD

  return {
    eligible,
    score,
    reasons: reasons.slice(0, MAX_REASONS),
    cautions: cautions.slice(0, MAX_CAUTIONS),
  }
}

// 全オファーを評価し、入力順のまま返す（eligible=falseも含む）
export function evaluateOffersForStudent(
  student: StudentPreference,
  offers: ClubOffer[],
): EvaluatedOffer[] {
  return offers.map((offer) => ({ offer, result: calculateMatch(student, offer) }))
}

// eligibleなオファーだけをscore降順（同点はオファーID昇順）で返す。入力配列は変更しない
export function rankEligibleOffers(
  student: StudentPreference,
  offers: ClubOffer[],
): EvaluatedOffer[] {
  return evaluateOffersForStudent(student, offers)
    .filter((entry) => entry.result.eligible)
    .sort((a, b) => {
      if (a.result.score !== b.result.score) {
        return b.result.score - a.result.score
      }
      return a.offer.id < b.offer.id ? -1 : a.offer.id > b.offer.id ? 1 : 0
    })
}
