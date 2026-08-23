import { eventFingerprint } from '../domain/delivery'
import {
  ACTIVITY_STYLES,
  DAY_SLOTS,
  FREQUENCIES,
  INTEREST_CATEGORIES,
  PURPOSES,
  type ClubOffer,
  type DeliveredMatchSnapshot,
  type OfferDelivery,
} from '../domain/types'
import {
  createJsonStore,
  getDefaultStorage,
  type JsonStore,
  type StorageLike,
} from './appStorage'

export const OFFER_DELIVERIES_KEY = 'cue-demo:offer-deliveries'
export const OFFER_DELIVERIES_SCHEMA_VERSION = 1

// 配信イベントは送信済みキャンペーンと受信箱の唯一の正本（docs/decisions.md D023）。
// オファーsnapshot・受信者snapshot・再送禁止の不変条件までここで検証し、
// 1件でも破れていればstore全体をnullへ縮退させる（既存3ストアと同じ方針。
// レコード横断の重複検証はstore全体の性質のため、部分破棄では整合を保証できない）。
// nullはApp側でcanonicalシードへの再シード扱いになる。

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function isNonEmptyArrayOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T[] {
  return (
    Array.isArray(value) && value.length >= 1 && value.every((item) => isOneOf(item, allowed))
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isOfferSnapshot(value: unknown): value is ClubOffer {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.clubId) &&
    isNonEmptyString(candidate.eventName) &&
    isNonEmptyString(candidate.description) &&
    isNonEmptyString(candidate.reasonNote) &&
    isNonEmptyString(candidate.dateText) &&
    isNonEmptyString(candidate.place) &&
    isNonEmptyArrayOf(candidate.eventDays, DAY_SLOTS) &&
    isOneOf(candidate.frequency, FREQUENCIES) &&
    typeof candidate.feePerEventYen === 'number' &&
    Number.isFinite(candidate.feePerEventYen) &&
    candidate.feePerEventYen >= 0 &&
    typeof candidate.beginnerFriendly === 'boolean' &&
    isOneOf(candidate.intensity, ACTIVITY_STYLES) &&
    isNonEmptyArrayOf(candidate.targetCategories, INTEREST_CATEGORIES) &&
    isNonEmptyArrayOf(candidate.targetPurposes, PURPOSES) &&
    typeof candidate.capacity === 'number' &&
    Number.isFinite(candidate.capacity) &&
    candidate.capacity >= 1 &&
    isNonEmptyString(candidate.deadline)
  )
}

function isRecipientSnapshot(value: unknown): value is DeliveredMatchSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isNonEmptyString(candidate.studentId) &&
    typeof candidate.score === 'number' &&
    Number.isFinite(candidate.score) &&
    candidate.score >= 0 &&
    candidate.score <= 100 &&
    Array.isArray(candidate.reasons) &&
    candidate.reasons.length >= 1 &&
    candidate.reasons.length <= 3 &&
    candidate.reasons.every(isNonEmptyString) &&
    Array.isArray(candidate.cautions) &&
    candidate.cautions.length <= 2 &&
    candidate.cautions.every(isNonEmptyString)
  )
}

function isOfferDelivery(value: unknown): value is OfferDelivery {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (
    !isNonEmptyString(candidate.id) ||
    !isIsoTimestamp(candidate.deliveredAt) ||
    !isOfferSnapshot(candidate.offer) ||
    !Array.isArray(candidate.recipients) ||
    !candidate.recipients.every(isRecipientSnapshot)
  ) {
    return false
  }
  // 同一配信内の受信者重複は二重配信の兆候のため不正とする
  const recipientIds = (candidate.recipients as DeliveredMatchSnapshot[]).map(
    (recipient) => recipient.studentId,
  )
  return new Set(recipientIds).size === recipientIds.length
}

export function isOfferDeliveryList(value: unknown): value is OfferDelivery[] {
  if (!Array.isArray(value) || !value.every(isOfferDelivery)) return false
  // 再送禁止（D023）の永続層防衛: delivery ID・offer ID・event fingerprintの重複を拒否する
  const deliveryIds = value.map((delivery) => delivery.id)
  if (new Set(deliveryIds).size !== deliveryIds.length) return false
  const offerIds = value.map((delivery) => delivery.offer.id)
  if (new Set(offerIds).size !== offerIds.length) return false
  const fingerprints = value.map((delivery) => eventFingerprint(delivery.offer))
  return new Set(fingerprints).size === fingerprints.length
}

export function createOfferDeliveryStore(
  storage: StorageLike | null,
): JsonStore<OfferDelivery[]> {
  return createJsonStore(
    storage,
    OFFER_DELIVERIES_KEY,
    OFFER_DELIVERIES_SCHEMA_VERSION,
    isOfferDeliveryList,
  )
}

// アプリ本体が使う唯一のインスタンス。loadがnullのときApp側はcanonicalシードで再構築する
export const offerDeliveryStore = createOfferDeliveryStore(getDefaultStorage())
