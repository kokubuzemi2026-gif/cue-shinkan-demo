import { describe, expect, it } from 'vitest'

import type { OfferDraft } from '../features/club/offerComposer'
import { serverErrorCode, serverErrorMessage } from './apiText'
import { inboxRowToItem, type InboxRow } from './inboxApi'
import {
  campaignRowToView,
  draftToClubOffer,
  draftToOfferArgs,
} from './offerApi'
import {
  passportRowToPreference,
  preferenceToSaveArgs,
  SELF_DISPLAY_NAME,
  SELF_STUDENT_ID,
  type PassportRow,
} from './passportApi'

// serverdata層の変換の正しさ（サーバー行 ⇄ ドメイン型）。
// RPCの引数名（snake_case）と列の対応がずれると保存・表示が壊れるため、全項目を検証する

const PASSPORT_ROW: PassportRow = {
  user_id: '11111111-1111-1111-1111-111111111111',
  interests: ['outdoor', 'photo'],
  purposes: ['friends'],
  style: 'moderate',
  frequency: 'monthly_1_2',
  available_days: ['weekend'],
  experience: 'none',
  max_fee_per_event_yen: 2000,
  reception_paused: false,
  reception_categories: ['outdoor'],
  reception_weekly_limit: 3,
  created_at: '2026-08-25T00:00:00Z',
  updated_at: '2026-08-25T00:00:00Z',
}

describe('passportApi', () => {
  it('サーバー行をStudentPreferenceへ変換する（UUIDを表示IDへ流通させない）', () => {
    const preference = passportRowToPreference(PASSPORT_ROW)
    expect(preference).toEqual({
      id: SELF_STUDENT_ID,
      displayName: SELF_DISPLAY_NAME,
      interests: ['outdoor', 'photo'],
      purposes: ['friends'],
      style: 'moderate',
      frequency: 'monthly_1_2',
      availableDays: ['weekend'],
      experience: 'none',
      maxFeePerEventYen: 2000,
      reception: { paused: false, allowedCategories: ['outdoor'], weeklyLimit: 3 },
    })
    // 行のUUIDがpreferenceのどこにも現れない
    expect(JSON.stringify(preference)).not.toContain('1111')
  })

  it('StudentPreferenceを保存RPC引数へ変換する（往復で内容が保たれる）', () => {
    const preference = passportRowToPreference(PASSPORT_ROW)
    const args = preferenceToSaveArgs(preference)
    expect(args).toEqual({
      interests: ['outdoor', 'photo'],
      purposes: ['friends'],
      style: 'moderate',
      frequency: 'monthly_1_2',
      available_days: ['weekend'],
      experience: 'none',
      max_fee_per_event_yen: 2000,
      reception_paused: false,
      reception_categories: ['outdoor'],
      reception_weekly_limit: 3,
    })
  })
})

const INBOX_ROW: InboxRow = {
  delivery_id: '22222222-2222-2222-2222-222222222222',
  delivered_at: '2026-08-25T01:00:00Z',
  organization_id: '33333333-3333-3333-3333-333333333333',
  org_name: '六甲アウトドア会',
  org_description: '山歩きの会',
  org_contact_label: '公式Instagram',
  org_contact_handle: '@rokko',
  event_name: 'はじめての六甲山ハイク',
  description: '説明文',
  reason_note: '理由文',
  date_text: '9月13日（土）9:00',
  place: '六甲ケーブル下',
  event_days: ['weekend'],
  frequency: 'monthly_1_2',
  fee_per_event_yen: 1500,
  beginner_friendly: true,
  intensity: 'moderate',
  target_categories: ['outdoor'],
  target_purposes: ['friends', 'challenge'],
  capacity: 12,
  deadline: '2026-09-11',
  score: 100,
  reasons: ['アウトドアに興味がある'],
  cautions: [],
  read_at: null,
  response_choice: null,
  responded_at: null,
}

describe('inboxApi', () => {
  it('未読・未返答の受信行をInboxItemへ変換する', () => {
    const item = inboxRowToItem(INBOX_ROW)
    expect(item.offer.id).toBe(INBOX_ROW.delivery_id)
    expect(item.offer.eventName).toBe('はじめての六甲山ハイク')
    expect(item.club.name).toBe('六甲アウトドア会')
    expect(item.club.verified).toBe(true)
    expect(item.club.contact).toEqual({ label: '公式Instagram', handle: '@rokko' })
    expect(item.result).toEqual({
      eligible: true,
      score: 100,
      reasons: ['アウトドアに興味がある'],
      cautions: [],
    })
    expect(item.read).toBe(false)
    expect(item.response).toBeNull()
    expect(item.status).toBe('unread')
  })

  it('既読・保留の受信行は状態thinkingになる', () => {
    const item = inboxRowToItem({
      ...INBOX_ROW,
      read_at: '2026-08-25T02:00:00Z',
      response_choice: 'thinking',
      responded_at: '2026-08-25T02:01:00Z',
    })
    expect(item.read).toBe(true)
    expect(item.response?.choice).toBe('thinking')
    expect(item.status).toBe('thinking')
  })

  it('既読のみの受信行は状態unansweredになる', () => {
    const item = inboxRowToItem({ ...INBOX_ROW, read_at: '2026-08-25T02:00:00Z' })
    expect(item.status).toBe('unanswered')
  })
})

const DRAFT: OfferDraft = {
  eventName: ' テント泊体験会 ',
  description: ' 説明 ',
  reasonNote: ' 理由 ',
  dateText: ' 9月12日（土） ',
  place: ' 北テラス広場 ',
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

describe('offerApi', () => {
  it('draftを送信RPC引数へ変換する（trim済み・snake_case対応）', () => {
    const args = draftToOfferArgs('44444444-4444-4444-4444-444444444444', DRAFT)
    expect(args).toEqual({
      org_id: '44444444-4444-4444-4444-444444444444',
      event_name: 'テント泊体験会',
      description: '説明',
      reason_note: '理由',
      date_text: '9月12日（土）',
      place: '北テラス広場',
      event_days: ['weekend'],
      frequency: 'monthly_1_2',
      fee_per_event_yen: 1500,
      beginner_friendly: true,
      intensity: 'moderate',
      target_categories: ['outdoor'],
      target_purposes: ['friends', 'challenge'],
      capacity: 10,
      deadline: '2026-09-10',
    })
  })

  it('draftから確認画面用のオファー表示モデルを組み立てる', () => {
    const offer = draftToClubOffer('44444444-4444-4444-4444-444444444444', DRAFT)
    expect(offer.eventName).toBe('テント泊体験会')
    expect(offer.clubId).toBe('44444444-4444-4444-4444-444444444444')
    expect(offer.deadline).toBe('2026-09-10')
  })

  it('キャンペーン行をダッシュボード表示（匿名ファネル）へ変換する', () => {
    const view = campaignRowToView('44444444-4444-4444-4444-444444444444', {
      delivery_id: '55555555-5555-5555-5555-555555555555',
      delivered_at: '2026-08-25T03:00:00Z',
      event_name: 'テント泊体験会',
      description: '説明',
      reason_note: '理由',
      date_text: '9月12日（土）',
      place: '北テラス広場',
      event_days: ['weekend'],
      frequency: 'monthly_1_2',
      fee_per_event_yen: 1500,
      beginner_friendly: true,
      intensity: 'moderate',
      target_categories: ['outdoor'],
      target_purposes: ['friends', 'challenge'],
      capacity: 10,
      deadline: '2026-09-10',
      funnel_available: true,
      delivered_count: 15,
      viewed_count: 10,
      engaged_count: 10,
      planned_count: 10,
      snapshot_date: '2026-08-25',
    })
    expect(view.offer.id).toBe('55555555-5555-5555-5555-555555555555')
    expect(view.deliveredAt).toBe('2026-08-25T03:00:00Z')
    expect(view.snapshotDate).toBe('2026-08-25')
    expect(view.funnel).toEqual({
      available: true,
      rounded: true,
      delivered: 15,
      viewed: 10,
      engaged: 10,
      planned: 10,
    })
  })

  it('抑制されたセル（NULL）を0へ潰さずnullのまま運ぶ', () => {
    // サーバーは配信10人未満・セル10人未満をNULLで返す。生成型はnon-nullだが実際はNULLが届く
    const row = {
      delivery_id: '55555555-5555-5555-5555-555555555555',
      delivered_at: '2026-08-25T03:00:00Z',
      event_name: 'テント泊体験会',
      description: '説明',
      reason_note: '理由',
      date_text: '9月12日（土）',
      place: '北テラス広場',
      event_days: ['weekend'],
      frequency: 'monthly_1_2',
      fee_per_event_yen: 1500,
      beginner_friendly: true,
      intensity: 'moderate',
      target_categories: ['outdoor'],
      target_purposes: ['friends', 'challenge'],
      capacity: 10,
      deadline: '2026-09-10',
      funnel_available: false,
      delivered_count: null,
      viewed_count: null,
      engaged_count: null,
      planned_count: null,
      snapshot_date: '2026-08-25',
    } as unknown as Parameters<typeof campaignRowToView>[1]
    const view = campaignRowToView('44444444-4444-4444-4444-444444444444', row)
    expect(view.funnel).toEqual({
      available: false,
      rounded: true,
      delivered: null,
      viewed: null,
      engaged: null,
      planned: null,
    })
  })
})

describe('apiText', () => {
  it('既知のRPCエラーは定型文へ変換される', () => {
    expect(serverErrorMessage({ message: 'duplicate_event' })).toBe(
      '同じイベントはすでに配信済みのため、再送できません',
    )
    expect(serverErrorMessage({ message: 'weekly_limit_reached' })).toBe(
      '今週の作成上限（3件）に達しているため送信できません',
    )
    expect(serverErrorMessage({ message: 'no_recipients' })).toBe(
      '現在の条件で配信できる新入生がいないため送信できません',
    )
    expect(serverErrorCode({ message: 'not_student' })).toBe('not_student')
  })

  it('未知のエラーは内容を出さず汎用文言になる', () => {
    expect(serverErrorCode({ message: 'stack trace with secret@stu.kobe-u.ac.jp' })).toBe('unknown')
    const text = serverErrorMessage({ message: 'stack trace with secret@stu.kobe-u.ac.jp' })
    expect(text).not.toContain('@')
    expect(text).toContain('処理に失敗しました')
  })
})
