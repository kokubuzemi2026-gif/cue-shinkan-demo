import type { OfferReadMark } from '../domain/types'
import {
  createJsonStore,
  getDefaultStorage,
  type JsonStore,
  type StorageLike,
} from './appStorage'

export const OFFER_READS_KEY = 'cue-demo:offer-reads'
export const OFFER_READS_SCHEMA_VERSION = 1

// 既読は返答と独立のストアに置く。破損しても返答ストアには影響せず、
// 状態導出は返答優先のため保留・回答済みは失われない（未読・未回答のみ縮退）。
function isOfferReadMark(value: unknown): value is OfferReadMark {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.offerId === 'string' &&
    candidate.offerId.length > 0 &&
    typeof candidate.studentId === 'string' &&
    candidate.studentId.length > 0 &&
    typeof candidate.readAt === 'string'
  )
}

export function isOfferReadMarkList(value: unknown): value is OfferReadMark[] {
  return Array.isArray(value) && value.every(isOfferReadMark)
}

export function createOfferReadStore(storage: StorageLike | null): JsonStore<OfferReadMark[]> {
  return createJsonStore(storage, OFFER_READS_KEY, OFFER_READS_SCHEMA_VERSION, isOfferReadMarkList)
}

// アプリ本体が使う唯一のインスタンス。loadがnullのとき呼び出し側は[]として扱う
export const offerReadStore = createOfferReadStore(getDefaultStorage())
