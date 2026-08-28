// Cloudflare TurnstileのCAPTCHA連携（Task 021・D057）。
// sitekey（VITE_TURNSTILE_SITE_KEY）が未設定なら本機能は完全に不活性で、
// 従来どおりウィジェットを描画せずcaptchaTokenも送らない
// （ローカルスタック・CIはSupabase側のCAPTCHAが無効のため、この経路になる）。
// secret keyはSupabase Dashboardだけが保持し、アプリ・リポジトリへは置かない

export function readTurnstileSiteKey(): string | null {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY
  if (typeof key !== 'string' || key.trim().length === 0) {
    return null
  }
  return key.trim()
}

// window.turnstile の使用箇所だけの最小型（公式の型パッケージは追加しない）
export type TurnstileRenderOptions = {
  sitekey: string
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
  'timeout-callback': () => void
}

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let loadPromise: Promise<TurnstileApi> | null = null

// スクリプトを1回だけ読み込む。読み込めない環境（オフライン等）ではrejectし、
// 呼び出し側がエラー表示に落とす（ログインを黙って無効化しない）
export function loadTurnstile(): Promise<TurnstileApi> {
  if (loadPromise !== null) {
    return loadPromise
  }
  loadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile !== undefined) {
      resolve(window.turnstile)
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => {
      if (window.turnstile !== undefined) {
        resolve(window.turnstile)
      } else {
        // こちらも失敗をキャッシュしない（onerrorと同じ扱いで再試行可能にする）
        loadPromise = null
        reject(new Error('turnstile_unavailable'))
      }
    }
    script.onerror = () => {
      // 失敗した読み込みをキャッシュしない（再試行できるように戻す）
      loadPromise = null
      reject(new Error('turnstile_load_failed'))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}
