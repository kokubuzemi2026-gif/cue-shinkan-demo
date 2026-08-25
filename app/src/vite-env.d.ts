/// <reference types="vite/client" />

// ブラウザへ公開してよいのはこの2値だけ（docs/auth_and_authorization.md §9）。
// secret key / service-role key / DBパスワード等をVITE_*へ追加しない
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
