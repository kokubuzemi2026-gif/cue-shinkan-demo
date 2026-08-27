import { useEffect, useRef, useState } from 'react'

import '../styles/club.css'

import type { Club } from '../domain/types'
import { CLUB_WEEKLY_CAMPAIGN_LIMIT } from '../features/club/delivery'
import { isWithinWeeklyWindow } from '../domain/delivery'
import { ClubDashboard } from '../features/club/ClubDashboard'
import { OfferComposer } from '../features/club/OfferComposer'
import { SendConfirm } from '../features/club/SendConfirm'
import type { AudienceBand } from '../features/club/audienceBand'
import { AUDIENCE_BAND_NOTE, audienceBandLabel } from '../features/club/audienceBand'
import { validateOfferDraft, type OfferDraft } from '../features/club/offerComposer'
import type { CueSupabaseClient } from '../lib/supabaseClient'
import { serverErrorMessage } from '../serverdata/apiText'
import {
  draftToClubOffer,
  fetchOrgCampaigns,
  previewOfferAudience,
  sendOffer,
  type AudiencePreview,
  type ServerCampaign,
} from '../serverdata/offerApi'

type OrgOffersPanelProps = {
  client: CueSupabaseClient
  organizationId: string
  // オファーの作成・送信はowner/adminのみ（閲覧は全担当者）
  canSend: boolean
  // 公式窓口の保存などで親から再読込を指示するトークン
  refreshToken: number
  // 作成・確認・完了の間は親が他セクションを隠し、入力へ集中させる（Phase 1の集中モードと同趣旨）
  onFocusModeChange: (active: boolean) => void
}

type PanelView = 'dashboard' | 'compose' | 'confirm' | 'done'

type OrgRow = {
  name: string
  description: string
  contact_label: string
  contact_handle: string
}

type CampaignState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; campaigns: ServerCampaign[] }

type ConfirmState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: AudiencePreview }

// 送信前の空draft。デモ用プリセット（NEW_CAMPAIGN_PRESET）は使わない
function createBlankOfferDraft(): OfferDraft {
  return {
    eventName: '',
    description: '',
    reasonNote: '',
    dateText: '',
    place: '',
    feePerEventYen: 0,
    capacity: 10,
    deadline: '2026-09-10',
    eventDays: [],
    frequency: 'monthly_1_2',
    intensity: 'moderate',
    beginnerFriendly: true,
    targetCategories: [],
    targetPurposes: [],
  }
}

// 認証済み団体のオファー作成・配信・ファネル（Task 009）。
// 対象人数・ファネルはサーバーRPCの匿名件数のみで、学生の個人情報・一覧は
// この画面のどのpropsにも存在しない（D007/D029）
export function OrgOffersPanel({
  client,
  organizationId,
  canSend,
  refreshToken,
  onFocusModeChange,
}: OrgOffersPanelProps) {
  const [view, setView] = useState<PanelView>('dashboard')
  const [orgRow, setOrgRow] = useState<OrgRow | null>(null)
  const [campaignState, setCampaignState] = useState<CampaignState>({ status: 'loading' })
  const [draft, setDraft] = useState<OfferDraft>(createBlankOfferDraft)
  const [composeErrors, setComposeErrors] = useState<string[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState>({ status: 'loading' })
  const [commitNotice, setCommitNotice] = useState<string | null>(null)
  const [doneBand, setDoneBand] = useState<AudienceBand>('0')
  const [reloadCount, setReloadCount] = useState(0)
  const sendingRef = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // 団体表示情報（公式窓口を含む）とキャンペーン+ファネルの取得。
  // 再取得中は表示中の内容を保持する
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [orgResult, campaigns] = await Promise.all([
          client
            .from('organizations')
            .select('name, description, contact_label, contact_handle')
            .eq('id', organizationId)
            .maybeSingle(),
          fetchOrgCampaigns(client, organizationId),
        ])
        if (!active) return
        if (orgResult.error) throw orgResult.error
        if (orgResult.data !== null) {
          setOrgRow(orgResult.data)
        }
        setCampaignState({ status: 'ready', campaigns })
      } catch {
        if (!active) return
        setCampaignState((previous) =>
          previous.status === 'ready' ? previous : { status: 'error' },
        )
      }
    })()
    return () => {
      active = false
    }
  }, [client, organizationId, refreshToken, reloadCount])

  // 画面切替のたびにスクロールを先頭へ戻し、見出しへフォーカスを移す
  useEffect(() => {
    window.scrollTo(0, 0)
    headingRef.current?.focus({ preventScroll: true })
  }, [view])

  // 集中モードの通知。ダッシュボード・アンマウントの全経路で必ず解除する
  useEffect(() => {
    onFocusModeChange(view !== 'dashboard')
  }, [view, onFocusModeChange])
  useEffect(() => () => onFocusModeChange(false), [onFocusModeChange])

  const startCompose = () => {
    setDraft(createBlankOfferDraft())
    setComposeErrors([])
    setCommitNotice(null)
    setView('compose')
  }

  const goConfirm = () => {
    const validation = validateOfferDraft(draft)
    if (!validation.ok) {
      setComposeErrors(validation.messages)
      return
    }
    setComposeErrors([])
    setCommitNotice(null)
    sendingRef.current = false
    setConfirmState({ status: 'loading' })
    setView('confirm')
    void (async () => {
      try {
        const preview = await previewOfferAudience(client, organizationId, draft)
        setConfirmState({ status: 'ready', preview })
      } catch (error) {
        setConfirmState({ status: 'error', message: serverErrorMessage(error) })
      }
    })()
  }

  const send = () => {
    if (confirmState.status !== 'ready' || sendingRef.current) return
    sendingRef.current = true
    void (async () => {
      try {
        const result = await sendOffer(client, organizationId, draft)
        setDoneBand(result.audienceBand)
        setView('done')
        setReloadCount((count) => count + 1)
      } catch (error) {
        // 送信できなかった場合は理由を表示して確認画面に留まる（配信正本は書き換わっていない）
        sendingRef.current = false
        setCommitNotice(serverErrorMessage(error))
      }
    })()
  }

  if (view === 'compose') {
    return (
      <OfferComposer
        draft={draft}
        onChange={setDraft}
        errors={composeErrors}
        onConfirm={goConfirm}
        onCancel={() => setView('dashboard')}
        headingRef={headingRef}
      />
    )
  }

  if (view === 'confirm') {
    if (confirmState.status === 'loading') {
      return (
        <section className="placeholder-card" aria-label="対象を確認中">
          <p className="placeholder-text">配信対象を確認しています…</p>
        </section>
      )
    }
    if (confirmState.status === 'error') {
      return (
        <section className="auth-card" aria-label="再試行の案内">
          <h1 className="page-title" tabIndex={-1} ref={headingRef}>
            送信の確認
          </h1>
          <p className="form-error" role="alert">
            {confirmState.message}
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setView('compose')}
          >
            入力へもどる
          </button>
        </section>
      )
    }
    return (
      <SendConfirm
        offer={draftToClubOffer(organizationId, draft)}
        band={confirmState.preview.audienceBand}
        sentThisWeek={confirmState.preview.sentThisWeek}
        weeklyLimit={confirmState.preview.weeklyLimit}
        duplicate={confirmState.preview.duplicateEvent}
        commitNotice={commitNotice}
        onSend={send}
        onBack={() => setView('compose')}
        headingRef={headingRef}
      />
    )
  }

  if (view === 'done') {
    return (
      <div className="done-card">
        <span className="done-check" aria-hidden="true">
          ✓
        </span>
        <h1 className="page-title" tabIndex={-1} ref={headingRef}>
          {audienceBandLabel(doneBand)}の新入生へ配信しました
        </h1>
        <p className="done-body">
          条件に合い、今週の受信上限に達していない新入生にだけ届いています。学生が返答すると、ダッシュボードの数字が更新されます。
        </p>
        <p className="done-body">{AUDIENCE_BAND_NOTE}</p>
        <button
          type="button"
          className="button button-primary done-cta"
          onClick={() => setView('dashboard')}
        >
          ダッシュボードへもどる
        </button>
      </div>
    )
  }

  if (campaignState.status === 'loading') {
    return (
      <section className="placeholder-card" aria-label="読み込み中">
        <p className="placeholder-text">キャンペーンを読み込んでいます…</p>
      </section>
    )
  }

  if (campaignState.status === 'error' || orgRow === null) {
    return (
      <section className="auth-card" aria-label="再試行の案内">
        <h2 className="auth-card-title">オファー配信</h2>
        <p className="auth-text">
          キャンペーン情報を読み込めませんでした。通信環境を確認して再試行してください。
        </p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => setReloadCount((count) => count + 1)}
        >
          再試行
        </button>
      </section>
    )
  }

  const club: Club = {
    id: organizationId,
    name: orgRow.name,
    verified: true,
    description: orgRow.description,
    contact: { label: orgRow.contact_label, handle: orgRow.contact_handle },
  }
  const nowIso = new Date().toISOString()
  const sentThisWeek = campaignState.campaigns.filter((campaign) =>
    isWithinWeeklyWindow(campaign.deliveredAt, nowIso),
  ).length

  return (
    <ClubDashboard
      club={club}
      campaigns={campaignState.campaigns.map((campaign) => ({
        offer: campaign.offer,
        funnel: campaign.funnel,
      }))}
      sentThisWeek={sentThisWeek}
      weeklyLimit={CLUB_WEEKLY_CAMPAIGN_LIMIT}
      onCreate={startCompose}
      headingRef={headingRef}
      canCreate={canSend}
    />
  )
}
