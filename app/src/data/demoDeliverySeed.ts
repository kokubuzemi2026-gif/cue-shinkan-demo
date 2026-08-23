import { buildDelivery, buildMatchSnapshots } from '../domain/delivery'
import type { OfferDelivery } from '../domain/types'
import { demoOffers, demoStudent } from './demoData'
import { anonymousStudentPool } from './demoStudentPool'

// 初期3件の配信履歴シード（docs/decisions.md D024）。
// 現在の保存済みパスポートではなく、canonicalなdemoStudent＋匿名プール＋demoOffersの
// 固定入力だけから決定的に生成する。パスポートを編集した環境でも過去履歴は不変で、
// offer.id（offer-rokko-hike等）を保持するためTask 004期の既読・返答レコードと接続する。
// deliveredAtは、デモ実施時点の週上限ウィンドウ（D021）に入らない過去日付の固定値とし、
// 新しい順の並びがTask 004の初期表示（六甲→Harbor→TableTalk）と一致するよう段差をつける。
const SEED_CAMPAIGNS: ReadonlyArray<{ offerId: string; deliveredAt: string }> = [
  { offerId: 'offer-rokko-hike', deliveredAt: '2026-04-10T00:00:00.000Z' },
  { offerId: 'offer-photo-walk', deliveredAt: '2026-04-09T00:00:00.000Z' },
  { offerId: 'offer-cafe-night', deliveredAt: '2026-04-08T00:00:00.000Z' },
]

export function buildSeedDeliveries(): OfferDelivery[] {
  const students = [demoStudent, ...anonymousStudentPool]
  const deliveries: OfferDelivery[] = []
  for (const campaign of SEED_CAMPAIGNS) {
    const offer = demoOffers.find((candidate) => candidate.id === campaign.offerId)
    if (offer === undefined) continue
    deliveries.push(
      buildDelivery(offer, buildMatchSnapshots(students, offer), campaign.deliveredAt),
    )
  }
  return deliveries
}
