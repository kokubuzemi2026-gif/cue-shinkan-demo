import { deriveOfferStatus, type InboxItem } from '../features/student/inbox'
import type { ResponseChoice } from '../domain/types'
import type { Database } from '../lib/database.types'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { SELF_STUDENT_ID } from './passportApi'

// 受信箱のサーバー入出力。表示集合と各行のscore・理由・注意点は
// 配信時点のsnapshot（list_my_inboxの戻り値）で固定される（D023）。
// InboxItem（features/student/inbox.ts）へ変換して既存のOfferCard表示部品を再利用する

type GeneratedInboxRow =
  Database['public']['Functions']['list_my_inbox']['Returns'][number]

// 生成型（supabase gen types）はRETURNS TABLEの列のnull可否を表現できない。
// 実際にはread_at・返答はLEFT JOIN由来でnullになり得るため、ここで実挙動へ広げる
// （生成型の行は構造的にこの型へ代入可能で、database.types.tsは生成出力と一致を保つ）
export type InboxRow = Omit<GeneratedInboxRow, 'read_at' | 'responded_at' | 'response_choice'> & {
  read_at: string | null
  responded_at: string | null
  response_choice: Database['public']['Enums']['response_choice'] | null
}

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
    // D044: 運営が停止したオファー。受信箱には残すが返答導線と窓口を閉じる
    stopped: row.stopped,
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
