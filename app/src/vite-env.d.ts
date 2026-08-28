/// <reference types="vite/client" />

// ブラウザへ公開してよいのはこの3値だけ（docs/auth_and_authorization.md §9）。
// VITE_TURNSTILE_SITE_KEYはTurnstileのSite Key（公開値・任意設定・D057）。
// secret key / service-role key / TurnstileのSecret Key / DBパスワード等をVITE_*へ追加しない
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
