import { useEffect, useRef, useState } from 'react'

import { serverErrorMessage } from '../serverdata/apiText'
import {
  NOTIFICATION_MODE_OPTIONS,
  fetchNotificationMode,
  saveNotificationMode,
  type NotificationMode,
} from '../serverdata/notificationApi'
import type { CueSupabaseClient } from '../lib/supabaseClient'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; mode: NotificationMode }

type NotificationSettingsProps = {
  client: CueSupabaseClient
}

// メール通知の受け取り方（Task 010 / D040）。
// 学生がいつでも変更・停止できることが要件のため、保存は即時・取り消し可能にし、
// 「通知しない」を他と同じ重みで並べる（止めにくくしない）
export function NotificationSettings({ client }: NotificationSettingsProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    void (async () => {
      try {
        const mode = await fetchNotificationMode(client)
        if (active) setState({ status: 'ready', mode })
      } catch (error) {
        if (active) setState({ status: 'error', message: serverErrorMessage(error) })
      }
    })()
    return () => {
      active = false
    }
  }, [client, reloadCount])

  // radiogroupは矢印キーで選択を移せることが期待される。
  // roving tabindexと組み合わせ、キーボードだけで3択を選べるようにする
  const moveFocus = (fromIndex: number, delta: number) => {
    const count = NOTIFICATION_MODE_OPTIONS.length
    const next = (fromIndex + delta + count) % count
    const option = NOTIFICATION_MODE_OPTIONS[next]
    if (option === undefined) return
    optionRefs.current[next]?.focus()
    choose(option.mode)
  }

  const choose = (mode: NotificationMode) => {
    if (state.status !== 'ready' || saving || state.mode === mode) return
    const previous = state.mode
    // 楽観更新。失敗したら前の選択へ戻し、何が保存されているかを画面と一致させる
    setState({ status: 'ready', mode })
    setSaving(true)
    setSaveError(null)
    setSavedNotice(false)
    void (async () => {
      try {
        await saveNotificationMode(client, mode)
        setSavedNotice(true)
      } catch (error) {
        setState({ status: 'ready', mode: previous })
        setSaveError(serverErrorMessage(error))
      } finally {
        setSaving(false)
      }
    })()
  }

  useEffect(() => {
    if (state.status === 'ready') headingRef.current?.focus()
  }, [state.status])

  if (state.status === 'loading') {
    return (
      <section className="placeholder-card" aria-label="読み込み中">
        <p className="placeholder-text">通知設定を読み込んでいます…</p>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="auth-card" aria-label="再試行の案内">
        <h1 className="page-title" tabIndex={-1} ref={headingRef}>
          メール通知
        </h1>
        <p className="form-error" role="alert">
          {state.message}
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

  return (
    <section className="auth-card" aria-label="メール通知の設定">
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>
        メール通知
      </h1>
      <p className="club-flow-lead">
        新しい案内が届いたことを、大学メールでお知らせします。いつでも変更・停止できます。
      </p>

      {/* radiogroupにして、キーボードだけで選べるようにする */}
      <div className="notification-options" role="radiogroup" aria-label="通知の受け取り方">
        {NOTIFICATION_MODE_OPTIONS.map((option, index) => {
          const selected = state.mode === option.mode
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              // 選択中だけをタブ順に載せる（roving tabindex）
              tabIndex={selected ? 0 : -1}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              className={`notification-option${selected ? ' is-selected' : ''}`}
              // 保存中もフォーカスを失わせない。二重送信はchoose側で防いでいる
              aria-disabled={saving}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  moveFocus(index, 1)
                } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  moveFocus(index, -1)
                }
              }}
              onClick={() => choose(option.mode)}
            >
              <span className="notification-option-label">
                {/* 色だけに意味を持たせない（選択中は記号でも示す） */}
                <span aria-hidden="true" className="notification-option-mark">
                  {selected ? '●' : '○'}
                </span>
                {option.label}
              </span>
              <span className="notification-option-description">{option.description}</span>
            </button>
          )
        })}
      </div>

      <div className="wizard-error-region" role="status">
        {saving && <p className="club-field-helper">保存しています…</p>}
        {!saving && saveError !== null && (
          <p className="wizard-error" role="alert">
            {saveError}
          </p>
        )}
        {!saving && saveError === null && savedNotice && (
          <p className="club-field-helper">保存しました。</p>
        )}
      </div>

      <p className="club-privacy-note">
        メールには案内の件数と受信箱へのリンクだけを載せます。あなたの希望条件や、どの団体から
        届いたか、どう返答したかは書きません。
      </p>
    </section>
  )
}
