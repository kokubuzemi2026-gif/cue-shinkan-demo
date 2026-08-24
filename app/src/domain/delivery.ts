import { calculateMatch } from './matching'
import type {
  ClubOffer,
  DeliveredMatchSnapshot,
  OfferDelivery,
  StudentPreference,
} from './types'

// 配信snapshot・同一イベント判定・週境界のドメイン規則（docs/decisions.md D021・D023）。
// storage層（deliveryStoreの検証）とfeatures層・data層（seed生成）の双方が使うため、
// OfferReadMarkと同じ理由でdomainに置く。すべて純関数で、現在時刻は引数nowIsoで注入する。

// D021: 週上限の「週」は判定時点から遡る7日間のローリングウィンドウ。
// now − 7日 < deliveredAt ≤ now（下限exclusive・上限inclusive・未来時刻は数えない）
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function isWithinWeeklyWindow(deliveredAtIso: string, nowIso: string): boolean {
  const deliveredAt = Date.parse(deliveredAtIso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(deliveredAt) || !Number.isFinite(now)) return false
  return now - WEEKLY_WINDOW_MS < deliveredAt && deliveredAt <= now
}

// D023: 同一イベントの識別子。IDを変えた実質再送も、団体・イベント名・日時・場所の
// 一致で検出する。NFKC正規化→小文字化→空白（全角含む）除去で表記ゆれを吸収する
function normalizeEventText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '')
}

export function eventFingerprint(offer: ClubOffer): string {
  return [
    offer.clubId,
    normalizeEventText(offer.eventName),
    normalizeEventText(offer.dateText),
    normalizeEventText(offer.place),
  ].join('|')
}

// 配信対象のマッチ結果snapshotを作る。適合判定・スコア・理由・注意点は
// calculateMatchの結果をそのまま固定し、ここでは一切加工しない（唯一の判定源）
export function buildMatchSnapshots(
  students: StudentPreference[],
  offer: ClubOffer,
): DeliveredMatchSnapshot[] {
  const snapshots: DeliveredMatchSnapshot[] = []
  for (const student of students) {
    const result = calculateMatch(student, offer)
    if (!result.eligible) continue
    snapshots.push({
      studentId: student.id,
      score: result.score,
      reasons: result.reasons,
      cautions: result.cautions,
    })
  }
  return snapshots
}

export function buildDelivery(
  offer: ClubOffer,
  recipients: DeliveredMatchSnapshot[],
  deliveredAt: string,
): OfferDelivery {
  return { id: `delivery-${offer.id}`, offer, deliveredAt, recipients }
}
