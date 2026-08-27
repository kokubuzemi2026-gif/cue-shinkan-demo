import type {
  ClubOffer,
  OfferDelivery,
  OfferReadMark,
  OfferResponse,
} from '../../domain/types'
import type { DisclosedFunnel } from './funnelDisclosure'

// 団体ファネル（D022）。配信イベント・既読・返答から導出し、独立保存しない。
// すべて受信者集合との積をstudentId単位で重複排除した匿名の件数で、
// 個人を特定できる情報（studentId・属性・snapshot）は返り値に含めない

export type FunnelCounts = {
  delivered: number
  viewed: number
  engaged: number
  planned: number
}

// ダッシュボード1行分。オファーsnapshotと匿名件数のみで、受信者情報は持たない。
// funnelはPhase 1デモの実数（FunnelCounts）と、サーバー由来の抑制済み値
// （DisclosedFunnel・D037）のどちらも受け取る
export type CampaignView = {
  offer: ClubOffer
  funnel: FunnelCounts | DisclosedFunnel
  // 集計の基準日（サーバー由来のときだけ入る。1日1回の安定したsnapshot・D037）
  snapshotDate?: string
  // 運営が停止したオファー（D044）。ローカルデモの配信は常にfalse
  stopped?: boolean
}

export function buildFunnel(
  delivery: OfferDelivery,
  reads: OfferReadMark[],
  responses: OfferResponse[],
): FunnelCounts {
  const recipientIds = new Set(delivery.recipients.map((recipient) => recipient.studentId))
  const offerId = delivery.offer.id

  // 閲覧 = read markまたは何らかのresponseを持つ受信者。返答はUI上、詳細を開かないと
  // できないため閲覧の実態があり、既読保存だけが失敗しても
  // 配信 ≥ 閲覧 ≥ 関心 ≥ 参加意向 の単調性が保たれる（D022）
  const viewed = new Set<string>()
  for (const read of reads) {
    if (read.offerId === offerId && recipientIds.has(read.studentId)) {
      viewed.add(read.studentId)
    }
  }
  const engaged = new Set<string>()
  const planned = new Set<string>()
  for (const response of responses) {
    if (response.offerId !== offerId || !recipientIds.has(response.studentId)) continue
    viewed.add(response.studentId)
    if (response.choice === 'interested' || response.choice === 'thinking') {
      engaged.add(response.studentId)
    }
    if (response.choice === 'interested') {
      planned.add(response.studentId)
    }
  }

  return {
    delivered: recipientIds.size,
    viewed: viewed.size,
    engaged: engaged.size,
    planned: planned.size,
  }
}

// 当該団体の送信済みキャンペーンを新しい順（同時刻はoffer ID昇順）で返す
export function listClubCampaigns(
  deliveries: OfferDelivery[],
  reads: OfferReadMark[],
  responses: OfferResponse[],
  clubId: string,
): CampaignView[] {
  return deliveries
    .filter((delivery) => delivery.offer.clubId === clubId)
    .sort((a, b) => {
      const aTime = Date.parse(a.deliveredAt)
      const bTime = Date.parse(b.deliveredAt)
      if (aTime !== bTime) return bTime - aTime
      return a.offer.id < b.offer.id ? -1 : a.offer.id > b.offer.id ? 1 : 0
    })
    .map((delivery) => ({
      offer: delivery.offer,
      funnel: buildFunnel(delivery, reads, responses),
    }))
}
