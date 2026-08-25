import { deriveOfferStatus, type InboxItem } from '../features/student/inbox'
import type { ResponseChoice } from '../domain/types'
import type { Database } from '../lib/database.types'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { SELF_STUDENT_ID } from './passportApi'

// 受信箱のサーバー入出力。表示集合と各行のscore・理由・注意点は
// 配信時点のsnapshot（list_my_inboxの戻り値）で固定される（D023）。
// InboxItem（features/student/inbox.ts）へ変換して既存のOfferCard表示部品を再利用する

export type InboxRow =
  Database['public']['Functions']['list_my_inbox']['Returns'][number]

export function inboxRowToItem(row: InboxRow): InboxItem {
  const read = row.read_at !== null
  const response =
    row.response_choice === null
      ? null
      : {
          offerId: row.delivery_id,
          studentId: SELF_STUDENT_ID,
          choice: row.response_choice,
          respondedAt: row.responded_at ?? '',
        }
  return {
    offer: {
      // サーバーモデルでは配信ID=キャンペーンIDがオファーの識別子
      id: row.delivery_id,
      clubId: row.organization_id,
      eventName: row.event_name,
      description: row.description,
      reasonNote: row.reason_note,
      dateText: row.date_text,
      place: row.place,
      eventDays: [...row.event_days],
      frequency: row.frequency,
      feePerEventYen: row.fee_per_event_yen,
      beginnerFriendly: row.beginner_friendly,
      intensity: row.intensity,
      targetCategories: [...row.target_categories],
      targetPurposes: [...row.target_purposes],
      capacity: row.capacity,
      deadline: row.deadline,
    },
    club: {
      id: row.organization_id,
      name: row.org_name,
      // 配信できるのは認証済み団体のみ（send_offerがverifiedを必須にする）
      verified: true,
      description: row.org_description,
      contact: { label: row.org_contact_label, handle: row.org_contact_handle },
    },
    result: {
      eligible: true,
      score: row.score,
      reasons: [...row.reasons],
      cautions: [...row.cautions],
    },
    response,
    read,
    status: deriveOfferStatus(read, response),
  }
}

export async function fetchMyInbox(client: CueSupabaseClient): Promise<InboxItem[]> {
  const { data, error } = await client.rpc('list_my_inbox')
  if (error) throw error
  return (data ?? []).map(inboxRowToItem)
}

export async function markOfferRead(
  client: CueSupabaseClient,
  deliveryId: string,
): Promise<void> {
  const { error } = await client.rpc('mark_offer_read', { delivery_id: deliveryId })
  if (error) throw error
}

export async function respondToOffer(
  client: CueSupabaseClient,
  deliveryId: string,
  choice: ResponseChoice,
): Promise<void> {
  const { error } = await client.rpc('respond_to_offer', {
    delivery_id: deliveryId,
    choice,
  })
  if (error) throw error
}
