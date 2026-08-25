import type { OfferDraft } from '../features/club/offerComposer'
import type { FunnelCounts } from '../features/club/funnel'
import type { ClubOffer } from '../domain/types'
import type { Database } from '../lib/database.types'
import type { CueSupabaseClient } from '../lib/supabaseClient'

// 団体側オファーのサーバー入出力。
// 送信・プレビューはSECURITY DEFINER RPCで、返るのは匿名件数のみ（D007/D029）。
// 受信者一覧・学生IDはクライアントへ一切届かない

export type AudiencePreview = {
  matchedCount: number
  limitedCount: number
  deliverableCount: number
  duplicateEvent: boolean
  sentThisWeek: number
  weeklyLimit: number
}

export type SendOfferResult = {
  deliveryId: string
  matchedCount: number
  limitedCount: number
  deliverableCount: number
}

// ダッシュボード1行分。オファーsnapshot・匿名ファネル・配信時刻（週枠表示用）のみ
export type ServerCampaign = {
  deliveryId: string
  deliveredAt: string
  offer: ClubOffer
  funnel: FunnelCounts
}

type OfferRpcArgs = Database['public']['Functions']['send_offer']['Args']

// 検証済みdraftをRPC引数へ変換する（trim・検証の正本はサーバー側にもある）
export function draftToOfferArgs(organizationId: string, draft: OfferDraft): OfferRpcArgs {
  return {
    org_id: organizationId,
    event_name: draft.eventName.trim(),
    description: draft.description.trim(),
    reason_note: draft.reasonNote.trim(),
    date_text: draft.dateText.trim(),
    place: draft.place.trim(),
    event_days: [...draft.eventDays],
    frequency: draft.frequency,
    fee_per_event_yen: draft.feePerEventYen,
    beginner_friendly: draft.beginnerFriendly,
    intensity: draft.intensity,
    target_categories: [...draft.targetCategories],
    target_purposes: [...draft.targetPurposes],
    capacity: draft.capacity,
    deadline: draft.deadline,
  }
}

// 送信確認画面の表示用に、draftからオファー表示モデルを組み立てる
// （IDはサーバー採番のため、確定前は表示専用のプレースホルダー）
export function draftToClubOffer(organizationId: string, draft: OfferDraft): ClubOffer {
  return {
    id: 'draft',
    clubId: organizationId,
    eventName: draft.eventName.trim(),
    description: draft.description.trim(),
    reasonNote: draft.reasonNote.trim(),
    dateText: draft.dateText.trim(),
    place: draft.place.trim(),
    eventDays: [...draft.eventDays],
    frequency: draft.frequency,
    feePerEventYen: draft.feePerEventYen,
    beginnerFriendly: draft.beginnerFriendly,
    intensity: draft.intensity,
    targetCategories: [...draft.targetCategories],
    targetPurposes: [...draft.targetPurposes],
    capacity: draft.capacity,
    deadline: draft.deadline,
  }
}

type CampaignRow =
  Database['public']['Functions']['list_org_campaigns']['Returns'][number]

export function campaignRowToView(organizationId: string, row: CampaignRow): ServerCampaign {
  return {
    deliveryId: row.delivery_id,
    deliveredAt: row.delivered_at,
    offer: {
      id: row.delivery_id,
      clubId: organizationId,
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
    funnel: {
      delivered: row.delivered_count,
      viewed: row.viewed_count,
      engaged: row.engaged_count,
      planned: row.planned_count,
    },
  }
}

export async function previewOfferAudience(
  client: CueSupabaseClient,
  organizationId: string,
  draft: OfferDraft,
): Promise<AudiencePreview> {
  const { data, error } = await client.rpc(
    'preview_offer_audience',
    draftToOfferArgs(organizationId, draft),
  )
  if (error) throw error
  const row = data?.[0]
  if (row === undefined) throw new Error('empty_rpc_result')
  return {
    matchedCount: row.matched_count,
    limitedCount: row.limited_count,
    deliverableCount: row.deliverable_count,
    duplicateEvent: row.duplicate_event,
    sentThisWeek: row.sent_this_week,
    weeklyLimit: row.weekly_limit,
  }
}

export async function sendOffer(
  client: CueSupabaseClient,
  organizationId: string,
  draft: OfferDraft,
): Promise<SendOfferResult> {
  const { data, error } = await client.rpc('send_offer', draftToOfferArgs(organizationId, draft))
  if (error) throw error
  const row = data?.[0]
  if (row === undefined) throw new Error('empty_rpc_result')
  return {
    deliveryId: row.delivery_id,
    matchedCount: row.matched_count,
    limitedCount: row.limited_count,
    deliverableCount: row.deliverable_count,
  }
}

export async function fetchOrgCampaigns(
  client: CueSupabaseClient,
  organizationId: string,
): Promise<ServerCampaign[]> {
  const { data, error } = await client.rpc('list_org_campaigns', { org_id: organizationId })
  if (error) throw error
  return (data ?? []).map((row) => campaignRowToView(organizationId, row))
}

export async function updateOrganizationContact(
  client: CueSupabaseClient,
  organizationId: string,
  label: string,
  handle: string,
): Promise<void> {
  const { error } = await client.rpc('update_organization_contact', {
    org_id: organizationId,
    new_label: label,
    new_handle: handle,
  })
  if (error) throw error
}
