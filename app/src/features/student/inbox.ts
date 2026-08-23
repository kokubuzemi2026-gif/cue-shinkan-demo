import type {
  Club,
  ClubOffer,
  MatchResult,
  OfferDelivery,
  OfferReadMark,
  OfferResponse,
  StudentPreference,
} from '../../domain/types'

// 受信箱の状態は4種。返答があれば返答を優先し、なければ開封記録で未読/未回答を分ける
export type OfferStatus = 'unread' | 'unanswered' | 'thinking' | 'answered'

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  unread: '未読',
  unanswered: '未回答',
  thinking: '保留',
  answered: '回答済み',
}

export type InboxItem = {
  offer: ClubOffer
  club: Club
  result: MatchResult
  response: OfferResponse | null
  read: boolean
  status: OfferStatus
}

export type InboxView = {
  items: InboxItem[]
  paused: boolean
}

export function deriveOfferStatus(read: boolean, response: OfferResponse | null): OfferStatus {
  if (response !== null) {
    return response.choice === 'thinking' ? 'thinking' : 'answered'
  }
  return read ? 'unanswered' : 'unread'
}

// 受信箱の表示集合を組み立てる（docs/decisions.md D023。D020の暫定再評価を置換）。
// - 正本は保存済みの配信イベント。表示集合と各itemのscore・理由・注意点は
//   配信時点のsnapshotで固定され、パスポート編集・受信停止・週上限の変更では
//   変化しない（現在のpreferenceは新規配信の判定だけに使われる・D020/D021）。
// - 並びは配信の新しい順（同時刻はオファーID昇順）で決定的にする。
//   新規配信は必ず先頭に未読で現れる
export function buildInboxView(
  student: StudentPreference,
  deliveries: OfferDelivery[],
  clubs: Club[],
  responses: OfferResponse[],
  reads: OfferReadMark[],
): InboxView {
  const clubById = new Map(clubs.map((club) => [club.id, club]))
  const received = deliveries
    .filter((delivery) =>
      delivery.recipients.some((recipient) => recipient.studentId === student.id),
    )
    .sort((a, b) => {
      const aTime = Date.parse(a.deliveredAt)
      const bTime = Date.parse(b.deliveredAt)
      if (aTime !== bTime) return bTime - aTime
      return a.offer.id < b.offer.id ? -1 : a.offer.id > b.offer.id ? 1 : 0
    })

  const items: InboxItem[] = []
  for (const delivery of received) {
    const offer = delivery.offer
    const club = clubById.get(offer.clubId)
    // 参照切れデータは表示しない（クラッシュさせない）
    if (club === undefined) continue
    const snapshot = delivery.recipients.find(
      (recipient) => recipient.studentId === student.id,
    )
    if (snapshot === undefined) continue
    // 表示根拠は配信時snapshotそのもの。ここでcalculateMatchを再計算しない
    const result: MatchResult = {
      eligible: true,
      score: snapshot.score,
      reasons: snapshot.reasons,
      cautions: snapshot.cautions,
    }
    const response =
      responses.find(
        (candidate) => candidate.offerId === offer.id && candidate.studentId === student.id,
      ) ?? null
    const read = reads.some(
      (candidate) => candidate.offerId === offer.id && candidate.studentId === student.id,
    )
    items.push({ offer, club, result, response, read, status: deriveOfferStatus(read, response) })
  }

  return { items, paused: student.reception.paused }
}

// 詳細表示中のオファーが表示集合から消えたかどうか（選択破棄の判定）。
// 条件変更で非適合になった詳細を保持し続けると、条件を戻したときに
// 古い詳細が勝手に再表示されるため、消えた時点で選択を破棄する
export function isSelectionStale(selectedOfferId: string | null, items: InboxItem[]): boolean {
  return selectedOfferId !== null && !items.some((item) => item.offer.id === selectedOfferId)
}

// 既読の記録。すでに記録済みなら同一配列参照を返し、呼び出し側は保存をスキップできる。
// readAtは初回開封時刻を保持する（開くたびに上書きしない）
export function markRead(reads: OfferReadMark[], mark: OfferReadMark): OfferReadMark[] {
  const exists = reads.some(
    (candidate) => candidate.offerId === mark.offerId && candidate.studentId === mark.studentId,
  )
  return exists ? reads : [...reads, mark]
}

// 返答の追加・上書き。(offerId, studentId)ごとに1件へ正規化する
export function upsertResponse(
  responses: OfferResponse[],
  next: OfferResponse,
): OfferResponse[] {
  const index = responses.findIndex(
    (candidate) => candidate.offerId === next.offerId && candidate.studentId === next.studentId,
  )
  if (index === -1) {
    return [...responses, next]
  }
  const copied = [...responses]
  copied[index] = next
  return copied
}

// 参加費の表示（D019: 1回あたり単位を明示）
export function formatEventFee(yen: number): string {
  return yen === 0 ? '参加費無料' : `1回${yen.toLocaleString('ja-JP')}円`
}

// 申込期限（YYYY-MM-DD）の表示。Dateを使わず文字列分解でタイムゾーン非依存にする
export function formatDeadline(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  const monthNumber = Number(month)
  const dayNumber = Number(day)
  if (
    !Number.isInteger(monthNumber) ||
    !Number.isInteger(dayNumber) ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31
  ) {
    return isoDate
  }
  return `${monthNumber}月${dayNumber}日まで`
}
