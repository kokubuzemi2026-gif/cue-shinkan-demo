import type { OfferDelivery } from '../../domain/types'

// 「新着」到着状態の純モデル（tasks/006）。timer・DOMを持たず決定的。
// アニメーション（phase='pending'のみ）と新着表示（pending/settled両方）を分離し、
// animationendで演出だけが終わっても、詳細を開く・受信箱を離れるまで
// 「新着」チップと読み上げ状態は維持される。既読（unread/read）とは独立の概念で、
// 並び順・snapshot・返答へは一切影響しない。stateは非永続（reload/リセットで消滅）

export type ArrivalPhase = 'pending' | 'settled'

export type ArrivalState = { offerId: string; phase: ArrivalPhase } | null

// animationSettled・openedはofferIdを持ち、現在の対象と一致するときだけ作用する。
// 新着Bの表示中に古いカードAのanimationendや詳細openが起きても、Bの新着を消さない
export type ArrivalEvent =
  | { type: 'delivered'; offerId: string }
  | { type: 'animationSettled'; offerId: string }
  | { type: 'opened'; offerId: string }
  | { type: 'leftInbox' }

export function nextArrivalState(state: ArrivalState, event: ArrivalEvent): ArrivalState {
  switch (event.type) {
    case 'delivered':
      // 最後に実際に自分へ届いたofferが対象（上書き）
      return { offerId: event.offerId, phase: 'pending' }
    case 'animationSettled':
      return state !== null && state.offerId === event.offerId
        ? { offerId: state.offerId, phase: 'settled' }
        : state
    case 'opened':
      return state !== null && state.offerId === event.offerId ? null : state
    case 'leftInbox':
      return null
  }
}

// recipientゲート: 保存された配信のrecipientsにメイン学生が含まれるときだけ
// deliveredイベントを返す。含まれない送信（受信停止中・カテゴリ不許可・
// weeklyLimit到達・score不足）はnull＝到着状態を変更しない（偽の新着通知を防ぐ）。
// mainStudentIdは呼び出し側が現在の正本（preference ?? demoStudent）のidから渡す
export function arrivalEventForDelivery(
  delivery: OfferDelivery,
  mainStudentId: string,
): ArrivalEvent | null {
  const isRecipient = delivery.recipients.some(
    (recipient) => recipient.studentId === mainStudentId,
  )
  return isRecipient ? { type: 'delivered', offerId: delivery.offer.id } : null
}
