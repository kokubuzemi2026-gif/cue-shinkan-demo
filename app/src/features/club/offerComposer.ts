import type {
  ActivityStyle,
  ClubOffer,
  DaySlot,
  Frequency,
  InterestCategory,
  OfferDelivery,
  Purpose,
} from '../../domain/types'
import { nextCreatedOfferId } from './delivery'

// デモで操作する団体は六甲アウトドア会に固定する（複数団体の切替はスコープ外）
export const DEMO_CLUB_ID = 'club-rokko-outdoor'

// 送信前のオファー入力draft。送信確定（配信イベント保存）まではReact stateだけで持ち、
// localStorageへは保存しない（正本は送信確定時のOfferDeliveryのみ・D023）
export type OfferDraft = {
  eventName: string
  description: string
  reasonNote: string
  dateText: string
  place: string
  feePerEventYen: number
  capacity: number
  deadline: string
  eventDays: DaySlot[]
  frequency: Frequency
  intensity: ActivityStyle
  beginnerFriendly: boolean
  targetCategories: InterestCategory[]
  targetPurposes: Purpose[]
}

// 90秒デモ用のプリセット（値はこの1箇所に集約。日付の再調整はTask 006で可能）。
// 2026年9月12日は土曜日で、表記「（土）」とeventDays=['weekend']が整合する。
// 申込期限2026-09-10は木曜日のため、曜日を付けず「9月10日まで」とだけ表示する。
// マッチングに関わる6条件（対象カテゴリ・目的・曜日・頻度・本気度・初心者歓迎）は
// 六甲山ハイクと同一のため、canonical母集団では同じ12人がeligibleになる
export const NEW_CAMPAIGN_PRESET: OfferDraft = {
  eventName: 'はじめてのテント泊体験会',
  description:
    'テントの設営から夜ごはん作りまで、スタッフと一緒にゆっくり体験する1日イベントです。道具はすべて貸出があります。',
  reasonNote:
    'アウトドアをこれから始めたい新入生に、道具がなくても試せる1日から入ってほしいからです。',
  dateText: '9月12日（土）10:00〜16:00',
  place: '北テラス広場 集合',
  feePerEventYen: 1500,
  capacity: 10,
  deadline: '2026-09-10',
  eventDays: ['weekend'],
  frequency: 'monthly_1_2',
  intensity: 'moderate',
  beginnerFriendly: true,
  targetCategories: ['outdoor'],
  targetPurposes: ['friends', 'challenge'],
}

// フォームのタップ選択肢（参加費・定員・申込期限）。テキスト入力を増やさず、
// 90秒デモで迷わない範囲に絞る
export const FEE_CHOICES_YEN = [0, 500, 1000, 1500, 2000, 2500] as const
export const CAPACITY_CHOICES = [6, 8, 10, 12, 20] as const
export const DEADLINE_CHOICES = ['2026-09-10', '2026-09-17', '2026-09-24'] as const

export function createOfferDraft(): OfferDraft {
  return {
    ...NEW_CAMPAIGN_PRESET,
    eventDays: [...NEW_CAMPAIGN_PRESET.eventDays],
    targetCategories: [...NEW_CAMPAIGN_PRESET.targetCategories],
    targetPurposes: [...NEW_CAMPAIGN_PRESET.targetPurposes],
  }
}

// 複数選択チップの共通トグル（再タップで解除・入力配列は変更しない）
export function toggleDraftValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

export type DraftValidation = { ok: true } | { ok: false; messages: string[] }

// 空のキャンペーン（誰にも説明できない案内）を送らせないための検証。
// 数値・enum系はチップ選択のみのため検証対象はテキストと複数選択の空だけ
export function validateOfferDraft(draft: OfferDraft): DraftValidation {
  const messages: string[] = []
  if (draft.eventName.trim().length === 0) messages.push('イベント名を入力してください')
  if (draft.description.trim().length === 0) messages.push('イベント紹介を入力してください')
  if (draft.dateText.trim().length === 0) messages.push('開催日時を入力してください')
  if (draft.place.trim().length === 0) messages.push('場所を入力してください')
  if (draft.reasonNote.trim().length === 0) messages.push('届けたい理由を入力してください')
  if (draft.targetCategories.length === 0)
    messages.push('対象の興味カテゴリを1件以上選んでください')
  if (draft.targetPurposes.length === 0)
    messages.push('対象の活動目的を1件以上選んでください')
  if (draft.eventDays.length === 0) messages.push('開催曜日を1件以上選んでください')
  return messages.length === 0 ? { ok: true } : { ok: false, messages }
}

// 検証済みdraftからオファーを組み立てる。IDは既存配信から採番し、団体は固定
export function buildClubOffer(draft: OfferDraft, deliveries: OfferDelivery[]): ClubOffer {
  return {
    id: nextCreatedOfferId(deliveries),
    clubId: DEMO_CLUB_ID,
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
