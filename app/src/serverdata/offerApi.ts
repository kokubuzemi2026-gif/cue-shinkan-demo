import type { OfferDraft } from '../features/club/offerComposer'
import type { AudienceBand } from '../features/club/audienceBand'
import { parseAudienceBand } from '../features/club/audienceBand'
import type { DisclosedFunnel } from '../features/club/funnelDisclosure'
import type { ClubOffer } from '../domain/types'
import type { Database } from '../lib/database.types'
import type { CueSupabaseClient } from '../lib/supabaseClient'

// 団体側オファーのサーバー入出力。
// 送信・プレビューはSECURITY DEFINER RPCで、返るのは匿名の区分のみ（D007/D029/D036）。
// 受信者一覧・学生ID・生の対象人数はクライアントへ一切届かない。
// この層に人数を復元する変換を置かない（区分・抑制済みの値をそのまま運ぶ）

export type AudiencePreview = {
  // 正確な人数ではなく6区分。生の人数はクライアント状態に存在しない（D036）
  audienceBand: AudienceBand
  duplicateEvent: boolean
  // 団体自身の枠情報（学生の情報ではないため正確な値）
  sentThisWeek: number
  weeklyLimit: number
  previewConditionsUsed: number
  previewConditionsLimit: number
  // 同一条件は24時間固定。いつ算出された区分かを団体へ示す（D038）
  bandComputedAt: string
}

export type SendOfferResult = {
  deliveryId: string
  audienceBand: AudienceBand
}

// ダッシュボード1行分。オファーsnapshot・抑制済みファネル・配信時刻（週枠表示用）のみ
export type ServerCampaign = {
  deliveryId: string
  deliveredAt: string
  offer: ClubOffer
  funnel: DisclosedFunnel
  snapshotDate: string
  // 運営が停止したオファー（D044）。停止理由の本文はサーバーが返さない
  stopped: boolean
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
    // 抑制されたセルはサーバーがNULLを返す。0へ潰さずnullのまま運ぶ（D037）
    funnel: {
      available: row.funnel_available,
      rounded: true,
      delivered: nullableCount(row.delivered_count),
      viewed: nullableCount(row.viewed_count),
      engaged: nullableCount(row.engaged_count),
      planned: nullableCount(row.planned_count),
    },
    snapshotDate: row.snapshot_date,
    stopped: row.stopped,
  }
}

// 生成型はreturns tableの列をnon-nullとして出力するが、抑制されたセルは実際にはNULLで届く。
// 0と区別できないと「抑制」を「0人」と誤表示するため、ここでnullへ正規化する
function nullableCount(value: number | null | undefined): number | null {
  return typeof value === 'number' ? value : null
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
    audienceBand: parseAudienceBand(row.audience_band),
    duplicateEvent: row.duplicate_event,
    sentThisWeek: row.sent_this_week,
    weeklyLimit: row.weekly_limit,
    previewConditionsUsed: row.preview_conditions_used,
    previewConditionsLimit: row.preview_conditions_limit,
    bandComputedAt: row.band_computed_at,
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
    audienceBand: parseAudienceBand(row.audience_band),
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
