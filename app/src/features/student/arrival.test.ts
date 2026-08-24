import { describe, expect, it } from 'vitest'

import { demoStudent } from '../../data/demoData'
import { buildSeedDeliveries } from '../../data/demoDeliverySeed'
import { anonymousStudentPool } from '../../data/demoStudentPool'
import { buildDelivery } from '../../domain/delivery'
import type { OfferDelivery, StudentPreference } from '../../domain/types'
import { buildClubOffer, createOfferDraft } from '../club/offerComposer'
import { previewAudience } from '../club/delivery'
import { arrivalEventForDelivery, nextArrivalState, type ArrivalState } from './arrival'

// 期待値はリテラル固定。実装出力から期待値を生成しない

const NOW = '2026-08-23T12:00:00.000Z'
const seedDeliveries = buildSeedDeliveries()
const presetOffer = buildClubOffer(createOfferDraft(), seedDeliveries, [])

const PENDING_B: ArrivalState = { offerId: 'offer-created-2', phase: 'pending' }

describe('nextArrivalState: 演出と新着状態の分離', () => {
  it('deliveredでpendingになり、別のdeliveredで上書きされる（最後に届いたofferが対象）', () => {
    const first = nextArrivalState(null, { type: 'delivered', offerId: 'offer-created-1' })
    expect(first).toEqual({ offerId: 'offer-created-1', phase: 'pending' })
    const second = nextArrivalState(first, { type: 'delivered', offerId: 'offer-created-2' })
    expect(second).toEqual({ offerId: 'offer-created-2', phase: 'pending' })
  })

  it('同一IDのanimationSettledでsettledへ移り、offerIdは維持される（チップ継続の根拠）', () => {
    const settled = nextArrivalState(
      { offerId: 'offer-created-1', phase: 'pending' },
      { type: 'animationSettled', offerId: 'offer-created-1' },
    )
    expect(settled).toEqual({ offerId: 'offer-created-1', phase: 'settled' })
  })

  it('settled後もopened/leftInboxまで状態を維持する（settledへの再settledも決定的に同一）', () => {
    const settled: ArrivalState = { offerId: 'offer-created-1', phase: 'settled' }
    expect(
      nextArrivalState(settled, { type: 'animationSettled', offerId: 'offer-created-1' }),
    ).toEqual(settled)
  })

  it('【stale animationend】新着Bのpending中に旧Aのanimationendが来てもBをsettled化しない', () => {
    expect(
      nextArrivalState(PENDING_B, { type: 'animationSettled', offerId: 'offer-created-1' }),
    ).toEqual(PENDING_B)
  })

  it('同一IDのopenedで消費される（pending・settledの両方から）', () => {
    expect(
      nextArrivalState(
        { offerId: 'offer-created-1', phase: 'pending' },
        { type: 'opened', offerId: 'offer-created-1' },
      ),
    ).toBeNull()
    expect(
      nextArrivalState(
        { offerId: 'offer-created-1', phase: 'settled' },
        { type: 'opened', offerId: 'offer-created-1' },
      ),
    ).toBeNull()
  })

  it('【stale opened】新着Bの表示中に旧Aの詳細を開いてもBの「新着」を消さない', () => {
    expect(nextArrivalState(PENDING_B, { type: 'opened', offerId: 'offer-created-1' })).toEqual(
      PENDING_B,
    )
    expect(
      nextArrivalState(
        { offerId: 'offer-created-2', phase: 'settled' },
        { type: 'opened', offerId: 'offer-created-1' },
      ),
    ).toEqual({ offerId: 'offer-created-2', phase: 'settled' })
  })

  it('leftInboxで消費される（pending・settledの両方から）', () => {
    expect(
      nextArrivalState({ offerId: 'offer-created-1', phase: 'pending' }, { type: 'leftInbox' }),
    ).toBeNull()
    expect(
      nextArrivalState({ offerId: 'offer-created-1', phase: 'settled' }, { type: 'leftInbox' }),
    ).toBeNull()
  })

  it('null状態への各イベントはnullのまま（決定的・2回同一）', () => {
    const events = [
      { type: 'animationSettled', offerId: 'offer-created-1' },
      { type: 'opened', offerId: 'offer-created-1' },
      { type: 'leftInbox' },
    ] as const
    for (const event of events) {
      expect(nextArrivalState(null, event)).toBeNull()
      expect(nextArrivalState(null, event)).toBeNull()
    }
  })
})

describe('arrivalEventForDelivery: recipientゲート', () => {
  it('recipientsにメイン学生が含まれる配信はdeliveredイベントになる', () => {
    const delivery = buildDelivery(
      presetOffer,
      [
        {
          studentId: demoStudent.id,
          score: 100,
          reasons: ['アウトドアに興味がある'],
          cautions: [],
        },
      ],
      NOW,
    )
    expect(arrivalEventForDelivery(delivery, demoStudent.id)).toEqual({
      type: 'delivered',
      offerId: 'offer-created-1',
    })
  })

  it('recipientsに含まれない配信はnull（到着状態を変更しない根拠）', () => {
    const delivery = buildDelivery(
      presetOffer,
      [{ studentId: 'pool-05', score: 88, reasons: ['アウトドアに興味がある'], cautions: [] }],
      NOW,
    )
    expect(arrivalEventForDelivery(delivery, demoStudent.id)).toBeNull()
  })

  it('受信停止中の送信では自分がrecipient外になり、偽の新着通知が出ない', () => {
    const pausedMe: StudentPreference = {
      ...demoStudent,
      reception: { ...demoStudent.reception, paused: true },
    }
    const evaluation = previewAudience(
      [pausedMe, ...anonymousStudentPool],
      presetOffer,
      seedDeliveries,
      NOW,
    )
    const delivery = buildDelivery(presetOffer, evaluation.recipients, NOW)
    expect(delivery.recipients).toHaveLength(11)
    expect(arrivalEventForDelivery(delivery, pausedMe.id)).toBeNull()
  })

  it('weeklyLimit到達時の送信でも自分がrecipient外になり、偽の新着通知が出ない', () => {
    // 自分だけを受信者に持つウィンドウ内配信を上限(3)件分置き、自分をlimitedにする
    const mineInWindow = (suffix: number): OfferDelivery => ({
      id: `delivery-offer-created-${suffix}`,
      deliveredAt: '2026-08-22T09:00:00.000Z',
      offer: { ...presetOffer, id: `offer-created-${suffix}`, eventName: `既送${suffix}` },
      recipients: [
        {
          studentId: demoStudent.id,
          score: 100,
          reasons: ['アウトドアに興味がある'],
          cautions: [],
        },
      ],
    })
    const deliveries = [...seedDeliveries, mineInWindow(1), mineInWindow(2), mineInWindow(3)]
    const evaluation = previewAudience(
      [demoStudent, ...anonymousStudentPool],
      { ...presetOffer, id: 'offer-created-4' },
      deliveries,
      NOW,
    )
    const ids = evaluation.recipients.map((recipient) => recipient.studentId)
    expect(ids).not.toContain(demoStudent.id)
    const delivery = buildDelivery(
      { ...presetOffer, id: 'offer-created-4' },
      evaluation.recipients,
      NOW,
    )
    expect(arrivalEventForDelivery(delivery, demoStudent.id)).toBeNull()
  })
})
