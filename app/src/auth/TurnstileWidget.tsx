import { useEffect, useRef, useState } from 'react'

import { loadTurnstile } from './turnstile'

type TurnstileWidgetProps = {
  siteKey: string
  // token取得でstring、期限切れ・エラー・リセットでnullを通知する
  onToken: (token: string | null) => void
  // 親が増やすたびにウィジェットをリセットする（トークンは/otp 1回ごとの単回使用）
  resetSignal: number
}

// Turnstileウィジェットの描画とライフサイクル管理。
// 表示・トークン管理のみを担い、送信可否の判断は親（SignInScreen）が行う
export function TurnstileWidget({ siteKey, onToken, resetSignal }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // callbackの中から最新のonTokenを呼ぶ（renderは1回だけのため）
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    let cancelled = false
    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || containerRef.current === null || widgetIdRef.current !== null) {
          return
        }
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
          'timeout-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true)
        }
      })
    return () => {
      cancelled = true
      // 画面切替（メール⇄コード）でウィジェットが消えるときは、取得済み
      // トークンも一緒に破棄する。表示されているウィジェットと親の保持する
      // トークンを常に一致させ、見えないウィジェット由来のトークンで
      // 送信できる状態を作らない
      onTokenRef.current(null)
      if (widgetIdRef.current !== null && window.turnstile !== undefined) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current !== null && window.turnstile !== undefined) {
      onTokenRef.current(null)
      window.turnstile.reset(widgetIdRef.current)
    }
  }, [resetSignal])

  if (loadFailed) {
    return (
      <p className="form-error" role="alert">
        確認（CAPTCHA）を読み込めませんでした。通信環境を確認して、ページを再読み込みしてください。
      </p>
    )
  }
  return <div ref={containerRef} className="turnstile-widget" />
}
