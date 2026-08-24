import { describe, expect, it } from 'vitest'

import { demoOffers } from '../../data/demoData'
import {
  buildClubOffer,
  createOfferDraft,
  DEMO_CLUB_ID,
  NEW_CAMPAIGN_PRESET,
  toggleDraftValue,
  validateOfferDraft,
} from './offerComposer'

const rokkoHike = demoOffers.find((offer) => offer.id === 'offer-rokko-hike')!

describe('NEW_CAMPAIGN_PRESET', () => {
  it('未来日付（9月12日=土曜・期限9月10日）で、曜日表記とeventDaysが整合する', () => {
    expect(NEW_CAMPAIGN_PRESET.eventName).toBe('はじめてのテント泊体験会')
    expect(NEW_CAMPAIGN_PRESET.dateText).toBe('9月12日（土）10:00〜16:00')
    expect(NEW_CAMPAIGN_PRESET.deadline).toBe('2026-09-10')
    // 2026-09-12は土曜日（getUTCDay=6）。表記「（土）」とweekendの整合を固定する
    expect(new Date('2026-09-12T00:00:00.000Z').getUTCDay()).toBe(6)
    expect(NEW_CAMPAIGN_PRESET.eventDays).toEqual(['weekend'])
    expect(NEW_CAMPAIGN_PRESET.feePerEventYen).toBe(1500)
    expect(NEW_CAMPAIGN_PRESET.capacity).toBe(10)
  })

  it('マッチに関わる6条件が六甲山ハイクと同一で、canonical母集団なら同じ12人が対象になる', () => {
    expect(NEW_CAMPAIGN_PRESET.targetCategories).toEqual(rokkoHike.targetCategories)
    expect(NEW_CAMPAIGN_PRESET.targetPurposes).toEqual(rokkoHike.targetPurposes)
    expect(NEW_CAMPAIGN_PRESET.eventDays).toEqual(rokkoHike.eventDays)
    expect(NEW_CAMPAIGN_PRESET.frequency).toBe(rokkoHike.frequency)
    expect(NEW_CAMPAIGN_PRESET.intensity).toBe(rokkoHike.intensity)
    expect(NEW_CAMPAIGN_PRESET.beginnerFriendly).toBe(rokkoHike.beginnerFriendly)
    // 費用も同額のため、費用要素の適合まで六甲ハイクと同一になる
    expect(NEW_CAMPAIGN_PRESET.feePerEventYen).toBe(rokkoHike.feePerEventYen)
  })
})

describe('validateOfferDraft', () => {
  it('テキスト空・複数選択0件をそれぞれの文言でブロックする（空キャンペーンの防止）', () => {
    const cases: Array<[Partial<ReturnType<typeof createOfferDraft>>, string]> = [
      [{ eventName: '  ' }, 'イベント名を入力してください'],
      [{ description: '' }, 'イベント紹介を入力してください'],
      [{ dateText: '' }, '開催日時を入力してください'],
      [{ place: '' }, '場所を入力してください'],
      [{ reasonNote: '' }, '届けたい理由を入力してください'],
      [{ targetCategories: [] }, '対象の興味カテゴリを1件以上選んでください'],
      [{ targetPurposes: [] }, '対象の活動目的を1件以上選んでください'],
      [{ eventDays: [] }, '開催曜日を1件以上選んでください'],
    ]
    for (const [override, message] of cases) {
      const result = validateOfferDraft({ ...createOfferDraft(), ...override })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.messages).toContain(message)
      }
    }
    expect(validateOfferDraft(createOfferDraft())).toEqual({ ok: true })
  })
})

describe('buildClubOffer / draft操作', () => {
  it('検証済みdraftから完全なClubOfferを組み立て、IDは既存配信から採番・団体は固定になる', () => {
    const existing = [
      {
        id: 'delivery-offer-created-1',
        deliveredAt: '2026-08-22T09:00:00.000Z',
        offer: { ...rokkoHike, id: 'offer-created-1' },
        recipients: [],
      },
    ]
    const draft = { ...createOfferDraft(), eventName: '  余白つきイベント名  ' }
    const offer = buildClubOffer(draft, existing, [])
    expect(offer.id).toBe('offer-created-2')
    // 既読・返答が参照する予約済みIDも採番に反映される（破損再シード後の防衛）
    expect(buildClubOffer(draft, existing, ['offer-created-9']).id).toBe('offer-created-10')
    expect(offer.clubId).toBe(DEMO_CLUB_ID)
    expect(offer.eventName).toBe('余白つきイベント名')
    expect(offer.eventDays).toEqual(draft.eventDays)
    expect(offer.eventDays).not.toBe(draft.eventDays)
    expect(offer.targetCategories).not.toBe(draft.targetCategories)
    expect(offer.capacity).toBe(10)
    expect(offer.deadline).toBe('2026-09-10')
  })

  it('createOfferDraftはプリセットの独立コピーを返し、toggleDraftValueは非破壊で追加・解除する', () => {
    const draft = createOfferDraft()
    draft.targetCategories.push('music')
    expect(NEW_CAMPAIGN_PRESET.targetCategories).toEqual(['outdoor'])

    const added = toggleDraftValue(NEW_CAMPAIGN_PRESET.eventDays, 'weekday_night')
    expect(added).toEqual(['weekend', 'weekday_night'])
    const removed = toggleDraftValue(added, 'weekend')
    expect(removed).toEqual(['weekday_night'])
    expect(NEW_CAMPAIGN_PRESET.eventDays).toEqual(['weekend'])
  })
})
