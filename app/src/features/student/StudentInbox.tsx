import { useEffect, useRef, useState } from 'react'

import { demoClubs, demoOffers, demoStudent } from '../../data/demoData'
import type {
  OfferReadMark,
  OfferResponse,
  ResponseChoice,
  StudentPreference,
} from '../../domain/types'
import { offerReadStore } from '../../storage/readStore'
import { offerResponseStore } from '../../storage/responseStore'
import { buildInboxView, markRead, upsertResponse } from './inbox'
import { OfferCard } from './OfferCard'
import { OfferDetail } from './OfferDetail'
import { withReceptionPaused } from './passportForm'

const SAVE_FAILED_MESSAGE =
  '端末への保存に失敗しました。表示中の状態はこの画面では保持されています。'

type StudentInboxProps = {
  // Appが持つ保存済みパスポート。未保存時はdemoStudentで評価する（受入条件の初期表示）
  preference: StudentPreference | null
  savePreference: (next: StudentPreference) => boolean
  onNavigateHome: () => void
}

// オファー受信箱。一覧と詳細を1タブ内で切り替え、既読・返答をlocalStorageへ永続化する。
// 表示集合はD020の暫定仕様（docs/decisions.md）に従いbuildInboxViewが導出する。
export function StudentInbox({ preference, savePreference, onNavigateHome }: StudentInboxProps) {
  const student = preference ?? demoStudent
  const [responses, setResponses] = useState<OfferResponse[]>(
    () => offerResponseStore.load() ?? [],
  )
  const [reads, setReads] = useState<OfferReadMark[]>(() => offerReadStore.load() ?? [])
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  // 再開通知は、その再開で保存したpreferenceが最新である間だけ表示する
  // （パスポート編集など別の保存が起きると自動的に消える）
  const [resumeNoticeFor, setResumeNoticeFor] = useState<StudentPreference | null>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const wasDetailOpenRef = useRef(false)

  const view = buildInboxView(student, demoOffers, demoClubs, responses, reads)
  const selected =
    selectedOfferId === null
      ? undefined
      : view.items.find((item) => item.offer.id === selectedOfferId)

  // 詳細から一覧へ戻ったときだけ、一覧見出しへフォーカスを戻す
  useEffect(() => {
    if (selectedOfferId === null && wasDetailOpenRef.current) {
      wasDetailOpenRef.current = false
      window.scrollTo(0, 0)
      listHeadingRef.current?.focus({ preventScroll: true })
    }
  }, [selectedOfferId])

  const openDetail = (offerId: string) => {
    // 開封=既読の保存。開封だけでは返答を一切保存しない
    const nextReads = markRead(reads, {
      offerId,
      studentId: student.id,
      readAt: new Date().toISOString(),
    })
    if (nextReads !== reads) {
      const ok = offerReadStore.save(nextReads)
      setReads(nextReads)
      if (!ok) setSaveFailed(true)
    }
    wasDetailOpenRef.current = true
    setResumeNoticeFor(null)
    setSelectedOfferId(offerId)
  }

  const respond = (offerId: string, choice: ResponseChoice) => {
    const next = upsertResponse(responses, {
      offerId,
      studentId: student.id,
      choice,
      respondedAt: new Date().toISOString(),
    })
    const ok = offerResponseStore.save(next)
    setResponses(next)
    setSaveFailed(!ok)
  }

  const resumeReception = () => {
    const next = withReceptionPaused(student, false)
    const ok = savePreference(next)
    setSaveFailed(!ok)
    setResumeNoticeFor(next)
  }

  if (selected !== undefined) {
    return (
      <OfferDetail
        item={selected}
        onBack={() => setSelectedOfferId(null)}
        onRespond={(choice) => respond(selected.offer.id, choice)}
      />
    )
  }

  return (
    <>
      <h1 className="page-title" tabIndex={-1} ref={listHeadingRef}>
        受信箱
      </h1>
      {saveFailed && <p className="save-warning">{SAVE_FAILED_MESSAGE}</p>}

      {view.paused && (
        <div className="paused-banner">
          <p>
            オファーの受信を停止しています。停止中は新しい案内が届きません。届いている案内はこのまま見られます。
          </p>
          <button type="button" className="button button-primary" onClick={resumeReception}>
            オファー受信を再開
          </button>
        </div>
      )}
      <p aria-live="polite" className="inbox-status-line">
        {!view.paused && resumeNoticeFor !== null && resumeNoticeFor === preference && (
          <span className="status-notice">オファーの受信を再開しました</span>
        )}
      </p>

      {view.items.length === 0 ? (
        <section className="placeholder-card" aria-label="オファーなし">
          <span className="placeholder-chip">オファー 0件</span>
          <p className="placeholder-text">
            届いているオファーはまだありません。興味パスポートの条件に合う新歓案内が届くと、ここに表示されます。
          </p>
          <button type="button" className="button button-secondary" onClick={onNavigateHome}>
            条件を見直す
          </button>
        </section>
      ) : (
        <>
          <p className="inbox-lead">
            あなたが受け取ると決めた条件に合う団体からだけ届いています。
          </p>
          <ul className="offer-list">
            {view.items.map((item) => (
              <li key={item.offer.id}>
                <OfferCard item={item} onOpen={openDetail} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
