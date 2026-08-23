import {
  buildMatchSnapshots,
  eventFingerprint,
  isWithinWeeklyWindow,
} from '../../domain/delivery'
import type {
  ClubOffer,
  DeliveredMatchSnapshot,
  OfferDelivery,
  StudentPreference,
} from '../../domain/types'

// 団体側の配信判定・再送禁止・週枠の純ロジック。demoデータへ依存せず、
// 学生・オファー・配信履歴・現在時刻はすべて引数で受け取る。
// AudienceEvaluationは受信者snapshotを含む内部用の型で、送信処理の中だけで使い、
// UIコンポーネントのpropsへは渡さない。UIへはAudienceSummaryの人数3値だけを渡す

// 団体は1週間（D021のローリング7日間）に3キャンペーンまで（docs/matching_and_safety.md §5）
export const CLUB_WEEKLY_CAMPAIGN_LIMIT = 3

export type AudienceEvaluation = {
  matchedCount: number
  limitedCount: number
  deliverableCount: number
  recipients: DeliveredMatchSnapshot[]
}

export type AudienceSummary = {
  matchedCount: number
  limitedCount: number
  deliverableCount: number
}

// 学生が直近7日間（D021）に受信した配信の数
function receivedInWindow(
  deliveries: OfferDelivery[],
  studentId: string,
  nowIso: string,
): number {
  return deliveries.filter(
    (delivery) =>
      isWithinWeeklyWindow(delivery.deliveredAt, nowIso) &&
      delivery.recipients.some((recipient) => recipient.studentId === studentId),
  ).length
}

// 配信対象のプレビュー。matched = calculateMatch（唯一の判定源）でeligibleな学生数
// （受信停止・カテゴリ不許可・65点未満は除外済み）。そのうち週上限（D021）に達している
// 学生をlimitedとして分け、実際に配信できるrecipientsを確定する
export function previewAudience(
  students: StudentPreference[],
  offer: ClubOffer,
  deliveries: OfferDelivery[],
  nowIso: string,
): AudienceEvaluation {
  const matched = buildMatchSnapshots(students, offer)
  const limitById = new Map(
    students.map((student) => [student.id, student.reception.weeklyLimit]),
  )
  const recipients: DeliveredMatchSnapshot[] = []
  let limitedCount = 0
  for (const snapshot of matched) {
    const weeklyLimit = limitById.get(snapshot.studentId) ?? 0
    if (receivedInWindow(deliveries, snapshot.studentId, nowIso) >= weeklyLimit) {
      limitedCount += 1
      continue
    }
    recipients.push(snapshot)
  }
  return {
    matchedCount: matched.length,
    limitedCount,
    deliverableCount: recipients.length,
    recipients,
  }
}

// UI境界: 人数3値だけを残し、受信者snapshotを構造的に落とす
export function toAudienceSummary(evaluation: AudienceEvaluation): AudienceSummary {
  return {
    matchedCount: evaluation.matchedCount,
    limitedCount: evaluation.limitedCount,
    deliverableCount: evaluation.deliverableCount,
  }
}

// 同一配信（同一delivery ID・同一offer ID）が既にあれば同一配列参照を返す。
// 呼び出し側はmarkReadと同じ参照比較で書込をスキップでき、二度押しが冪等になる
export function appendDelivery(
  deliveries: OfferDelivery[],
  delivery: OfferDelivery,
): OfferDelivery[] {
  const exists = deliveries.some(
    (candidate) => candidate.id === delivery.id || candidate.offer.id === delivery.offer.id,
  )
  return exists ? deliveries : [...deliveries, delivery]
}

// 別のoffer IDでも同一イベント（D023のfingerprint一致）なら再送として検出する
export function findDuplicateEvent(
  deliveries: OfferDelivery[],
  offer: ClubOffer,
): OfferDelivery | null {
  const fingerprint = eventFingerprint(offer)
  return (
    deliveries.find((delivery) => eventFingerprint(delivery.offer) === fingerprint) ?? null
  )
}

// 作成オファーのID採番。既存配信のoffer-created-Nの最大suffix+1（欠番があっても衝突しない）
export function nextCreatedOfferId(deliveries: OfferDelivery[]): string {
  let maxSuffix = 0
  for (const delivery of deliveries) {
    const matched = /^offer-created-(\d+)$/.exec(delivery.offer.id)
    if (matched !== null) {
      maxSuffix = Math.max(maxSuffix, Number(matched[1]))
    }
  }
  return `offer-created-${maxSuffix + 1}`
}

// 団体が直近7日間（D021）に送信したキャンペーン数（週3枠の判定に使う）
export function clubSentInWindow(
  deliveries: OfferDelivery[],
  clubId: string,
  nowIso: string,
): number {
  return deliveries.filter(
    (delivery) =>
      delivery.offer.clubId === clubId && isWithinWeeklyWindow(delivery.deliveredAt, nowIso),
  ).length
}
