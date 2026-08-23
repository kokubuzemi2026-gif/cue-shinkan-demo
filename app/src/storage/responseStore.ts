import { RESPONSE_CHOICES, type OfferResponse } from '../domain/types'
import {
  createJsonStore,
  getDefaultStorage,
  type JsonStore,
  type StorageLike,
} from './appStorage'

export const OFFER_RESPONSES_KEY = 'cue-demo:offer-responses'
export const OFFER_RESPONSES_SCHEMA_VERSION = 1

function isOfferResponse(value: unknown): value is OfferResponse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.offerId === 'string' &&
    candidate.offerId.length > 0 &&
    typeof candidate.studentId === 'string' &&
    candidate.studentId.length > 0 &&
    typeof candidate.choice === 'string' &&
    (RESPONSE_CHOICES as readonly string[]).includes(candidate.choice) &&
    typeof candidate.respondedAt === 'string'
  )
}

export function isOfferResponseList(value: unknown): value is OfferResponse[] {
  return Array.isArray(value) && value.every(isOfferResponse)
}

export function createOfferResponseStore(
  storage: StorageLike | null,
): JsonStore<OfferResponse[]> {
  return createJsonStore(
    storage,
    OFFER_RESPONSES_KEY,
    OFFER_RESPONSES_SCHEMA_VERSION,
    isOfferResponseList,
  )
}

// アプリ本体が使う唯一のインスタンス。loadがnullのとき呼び出し側は[]として扱う
export const offerResponseStore = createOfferResponseStore(getDefaultStorage())
