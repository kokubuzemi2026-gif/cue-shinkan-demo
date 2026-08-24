import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// ブラウザへ公開してよいのはproject URLとpublishable keyの2値だけ。
// どちらかが欠けている場合はnullを返し、AppRootがSetupNotice（安全な案内画面）を表示する。
// ビルド・実行ともクラッシュさせない（docs/auth_and_authorization.md §9）
export type SupabaseConfig = {
  url: string
  publishableKey: string
}

export function readSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (
    typeof url !== 'string' ||
    url.trim().length === 0 ||
    typeof publishableKey !== 'string' ||
    publishableKey.trim().length === 0
  ) {
    return null
  }
  return { url: url.trim(), publishableKey: publishableKey.trim() }
}

export type CueSupabaseClient = SupabaseClient<Database>

// GoTrueClientの多重生成警告を避けるため、モジュールスコープの単一インスタンスにする
let cachedClient: CueSupabaseClient | null | undefined

export function getSupabaseClient(): CueSupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient
  }
  const config = readSupabaseConfig()
  cachedClient =
    config === null
      ? null
      : createClient<Database>(config.url, config.publishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            // OAuth・Magic Linkのリダイレクトを使わないため無効化する。
            // 招待リンク（#invite=）のhash解析との干渉も避ける
            detectSessionInUrl: false,
          },
        })
  return cachedClient
}
