import { useEffect, useRef, useState } from 'react'

import { demoClubs, demoStudent } from '../../data/demoData'
import type {
  OfferDelivery,
  OfferReadMark,
  OfferResponse,
  ResponseChoice,
  StudentPreference,
} from '../../domain/types'
import { offerReadStore } from '../../storage/readStore'
import { offerResponseStore } from '../../storage/responseStore'
import type { ArrivalEvent, ArrivalState } from './arrival'
import { buildInboxView, isSelectionStale, markRead, upsertResponse } from './inbox'
import { OfferCard } from './OfferCard'
import { OfferDetail } from './OfferDetail'
import { withReceptionPaused } from './passportForm'

const SAVE_FAILED_MESSAGE =
  '端末への保存に失敗しました。表示中の状態はこの画面では保持されています。'

type StudentInboxProps = {
  // Appが持つ保存済みパスポート。未保存時はdemoStudentを自分として扱う
  preference: StudentPreference | null
  // Appが持つ配信イベント正本（D023）。団体側と同じ状態を共有する
  deliveries: OfferDelivery[]
  // 到着状態（tasks/006）。pending=演出＋「新着」/ settled=「新着」のみ / null=通常
  arrival: ArrivalState
  onArrivalEvent: (event: ArrivalEvent) => void
  savePreference: (next: StudentPreference) => boolean
  onNavigateHome: () => void
}

// オファー受信箱。一覧と詳細を1タブ内で切り替え、既読・返答をlocalStorageへ永続化する。
// 表示集合は保存済み配信イベント（docs/decisions.md D023）からbuildInboxViewが導出する。
export function StudentInbox({
  preference,
  deliveries,
  arrival,
  onArrivalEvent,
  savePreference,
  onNavigateHome,
}: StudentInboxProps) {
  const student = preference ?? demoStudent
  const [responses, setResponses] = useState<OfferResponse[]>(
    () => offerResponseStore.load() ?? [],
  )
  const [reads, setReads] = useState<OfferReadMark[]>(() => offerReadStore.load() ?? [])
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  // 保存失敗は保存元ごとに管理し、一方の成功で他方の未解決エラーを消さない。
  // 同じ保存元の書込が後で成功したときだけ、その保存元の失敗を解除する
  const [readSaveFailed, setReadSaveFailed] = useState(false)
  const [responseSaveFailed, setResponseSaveFailed] = useState(false)
  const [resumeSaveFailed, setResumeSaveFailed] = useState(false)
  // 再開通知は、その再開で保存したpreferenceが最新である間だけ表示する
  // （パスポート編集など別の保存が起きると自動的に消える）
  const [resumeNoticeFor, setResumeNoticeFor] = useState<StudentPreference | null>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const wasDetailOpenRef = useRef(false)

  const view = buildInboxView(student, deliveries, demoClubs, responses, reads)
  // 到着対象が現在の表示集合に実在するときだけ読み上げ通知を出す
  const arrivalItem =
    arrival === null
      ? undefined
      : view.items.find((item) => item.offer.id === arrival.offerId)
  const selected =
    selectedOfferId === null
      ? undefined
      : view.items.find((item) => item.offer.id === selectedOfferId)
  const selectionStale = isSelectionStale(selectedOfferId, view.items)

  // 表示集合から対象が消えたら（条件変更で非適合化など）選択IDを破棄する。
  // データ（返答・既読）自体は消さない。破棄で下の効果が走り、通常の一覧復帰と同じ扱いになる
  useEffect(() => {
    if (selectionStale) {
      setSelectedOfferId(null)
    }
  }, [selectionStale])

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
      setReadSaveFailed(!ok)
    }
    // 到着状態は「対象の詳細を開いた」ときだけ消費される（IDが違えば維持）
    onArrivalEvent({ type: 'opened', offerId })
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
    setResponseSaveFailed(!ok)
  }

  const resumeReception = () => {
    const next = withReceptionPaused(student, false)
    const ok = savePreference(next)
    setResumeSaveFailed(!ok)
    setResumeNoticeFor(next)
  }

  const saveFailed = readSaveFailed || responseSaveFailed || resumeSaveFailed

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
      {!view.paused && resumeNoticeFor !== null && resumeNoticeFor === preference && (
        <p role="status" className="inbox-resume-notice">
          オファーの受信を再開しました
        </p>
      )}

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
          {/* 停止バナー表示中は同趣旨の説明が重複するため、受信中のみ表示する */}
          {!view.paused && (
            <p className="inbox-lead">選んだ条件に合う新歓案内だけが届いています。</p>
          )}
          {/* 新着の読み上げ通知。テキストはofferIdにのみ依存し、
              phase遷移（pending→settled）で再読み上げされない。他のlive regionと入れ子にしない */}
          {arrivalItem !== undefined && (
            <p role="status" className="visually-hidden">
              新しいオファーが届きました: {arrivalItem.offer.eventName}
            </p>
          )}
          <ul className="offer-list">
            {view.items.map((item) => (
              <li key={item.offer.id}>
                <OfferCard
                  item={item}
                  onOpen={openDetail}
                  arrivalPhase={
                    arrival !== null && arrival.offerId === item.offer.id ? arrival.phase : null
                  }
                  onArrivalSettled={(offerId) =>
                    onArrivalEvent({ type: 'animationSettled', offerId })
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
