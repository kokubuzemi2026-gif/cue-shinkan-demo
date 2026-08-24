import { useEffect, useRef, useState } from 'react'

import { demoClubs } from '../../data/demoData'
import type {
  ClubOffer,
  OfferDelivery,
  OfferReadMark,
  OfferResponse,
} from '../../domain/types'
import { offerReadStore } from '../../storage/readStore'
import { offerResponseStore } from '../../storage/responseStore'
import { ClubDashboard } from './ClubDashboard'
import {
  CLUB_WEEKLY_CAMPAIGN_LIMIT,
  clubSentInWindow,
  findDuplicateEvent,
  type AudienceSummary,
  type CommitOutcome,
} from './delivery'
import { listClubCampaigns } from './funnel'
import { OfferComposer } from './OfferComposer'
import {
  buildClubOffer,
  createOfferDraft,
  DEMO_CLUB_ID,
  validateOfferDraft,
  type OfferDraft,
} from './offerComposer'
import { SendConfirm } from './SendConfirm'
import { SendDone } from './SendDone'

type ClubView = 'dashboard' | 'compose' | 'confirm' | 'done'

// 送信確認画面の表示は、確認へ進んだ時点の評価で固定する（人数3値・枠・重複判定）。
// 送信確定時はApp側のcommitDeliveryが最新状態で再判定するため、ここの値は表示専用
type ConfirmInfo = {
  offer: ClubOffer
  summary: AudienceSummary
  sentThisWeek: number
  duplicate: boolean
}

type ClubHomeProps = {
  // 配信イベント正本（App持ち上げ・D023）
  deliveries: OfferDelivery[]
  // 対象人数の評価はApp側で行い、団体UIには匿名の人数3値だけが渡る
  summarizeAudience: (offer: ClubOffer) => AudienceSummary
  // 送信確定。重複・0人・枠到達の再判定と1回の永続化はApp側で行う
  commitDelivery: (offer: ClubOffer) => CommitOutcome
  onFocusModeChange: (active: boolean) => void
  openStudentInbox: () => void
}

// 団体ロールのルート。ダッシュボード→作成→確認→完了の4画面を切り替える。
// 受信者snapshot・studentId・学生の設定は、この配下のどのコンポーネントの
// propsにも渡さない（人数と匿名集計のみ・D007/D024）
export function ClubHome({
  deliveries,
  summarizeAudience,
  commitDelivery,
  onFocusModeChange,
  openStudentInbox,
}: ClubHomeProps) {
  const [view, setView] = useState<ClubView>('dashboard')
  const [draft, setDraft] = useState<OfferDraft>(createOfferDraft)
  const [composeErrors, setComposeErrors] = useState<string[]>([])
  const [confirmInfo, setConfirmInfo] = useState<ConfirmInfo | null>(null)
  const [commitNotice, setCommitNotice] = useState<string | null>(null)
  const [doneSummary, setDoneSummary] = useState<AudienceSummary | null>(null)
  const [doneSaveFailed, setDoneSaveFailed] = useState(false)
  // 送信の二度押しガード（appendDeliveryの冪等化に加えたUI側の一次防衛）
  const sendingRef = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // 学生の行動記録はファネル集計のための読み取り専用。ロール切替のたびに
  // ClubHomeがマウントし直されるため、その時点の最新が反映される
  const [reads] = useState<OfferReadMark[]>(() => offerReadStore.load() ?? [])
  const [responses] = useState<OfferResponse[]>(() => offerResponseStore.load() ?? [])

  // 集中モード: 作成・確認中はロール切替を隠して未保存draftの喪失を防ぐ。
  // 完了・ダッシュボード・アンマウントの全経路で必ず解除する
  useEffect(() => {
    onFocusModeChange(view === 'compose' || view === 'confirm')
  }, [view, onFocusModeChange])
  useEffect(() => () => onFocusModeChange(false), [onFocusModeChange])

  // 画面切替のたびにスクロールを先頭へ戻し、見出しへフォーカスを移す
  useEffect(() => {
    window.scrollTo(0, 0)
    headingRef.current?.focus({ preventScroll: true })
  }, [view])

  const club = demoClubs.find((candidate) => candidate.id === DEMO_CLUB_ID)
  if (club === undefined) return null

  const startCompose = () => {
    setDraft(createOfferDraft())
    setComposeErrors([])
    setCommitNotice(null)
    setView('compose')
  }

  const cancelCompose = () => {
    // 「やめる」はdraftを破棄してダッシュボードへ戻る
    setComposeErrors([])
    setView('dashboard')
  }

  const goConfirm = () => {
    const validation = validateOfferDraft(draft)
    if (!validation.ok) {
      setComposeErrors(validation.messages)
      return
    }
    setComposeErrors([])
    // 採番の予約済みID: 既読・返答が参照するofferIdを含める。deliveryストアだけが
    // 破損して再シードされた後も、残存する行動記録のIDを再利用しない
    const reservedOfferIds = [
      ...responses.map((response) => response.offerId),
      ...reads.map((mark) => mark.offerId),
    ]
    const offer = buildClubOffer(draft, deliveries, reservedOfferIds)
    const nowIso = new Date().toISOString()
    setConfirmInfo({
      offer,
      summary: summarizeAudience(offer),
      sentThisWeek: clubSentInWindow(deliveries, DEMO_CLUB_ID, nowIso),
      duplicate: findDuplicateEvent(deliveries, offer) !== null,
    })
    sendingRef.current = false
    setCommitNotice(null)
    setView('confirm')
  }

  const send = () => {
    if (confirmInfo === null || sendingRef.current) return
    sendingRef.current = true
    const outcome = commitDelivery(confirmInfo.offer)
    if (outcome.kind === 'sent' || outcome.kind === 'sent-save-failed') {
      setDoneSummary(outcome.summary)
      setDoneSaveFailed(outcome.kind === 'sent-save-failed')
      setView('done')
      return
    }
    // 送信できなかった場合は理由を表示して確認画面に留まる（storeは書き換わっていない）
    sendingRef.current = false
    setCommitNotice(
      outcome.kind === 'duplicate'
        ? '同じイベントはすでに配信済みのため、再送できません'
        : outcome.kind === 'limit-reached'
          ? '今週の作成上限（3件）に達しているため送信できません'
          : '現在の条件で配信できる新入生がいないため送信できません',
    )
  }

  if (view === 'compose') {
    return (
      <OfferComposer
        draft={draft}
        onChange={setDraft}
        errors={composeErrors}
        onConfirm={goConfirm}
        onCancel={cancelCompose}
        headingRef={headingRef}
      />
    )
  }

  if (view === 'confirm' && confirmInfo !== null) {
    return (
      <SendConfirm
        offer={confirmInfo.offer}
        summary={confirmInfo.summary}
        sentThisWeek={confirmInfo.sentThisWeek}
        weeklyLimit={CLUB_WEEKLY_CAMPAIGN_LIMIT}
        duplicate={confirmInfo.duplicate}
        commitNotice={commitNotice}
        onSend={send}
        onBack={() => setView('compose')}
        headingRef={headingRef}
      />
    )
  }

  if (view === 'done' && doneSummary !== null) {
    return (
      <SendDone
        deliverableCount={doneSummary.deliverableCount}
        saveFailed={doneSaveFailed}
        onOpenInbox={openStudentInbox}
        onBackToDashboard={() => setView('dashboard')}
        headingRef={headingRef}
      />
    )
  }

  return (
    <ClubDashboard
      club={club}
      campaigns={listClubCampaigns(deliveries, reads, responses, DEMO_CLUB_ID)}
      sentThisWeek={clubSentInWindow(deliveries, DEMO_CLUB_ID, new Date().toISOString())}
      weeklyLimit={CLUB_WEEKLY_CAMPAIGN_LIMIT}
      onCreate={startCompose}
      headingRef={headingRef}
    />
  )
}
