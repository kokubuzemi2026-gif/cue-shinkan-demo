import type { Database } from '../lib/database.types'
import type { CueSupabaseClient } from '../lib/supabaseClient'

// メール通知設定のサーバー入出力（Task 010 / D040）。
// 通知の内容そのものはサーバー側で組み立てる。ここが扱うのは「受け取り方」だけで、
// 宛先メールアドレス・本文・団体名はクライアントへ一切届かない。

export type NotificationMode = Database['public']['Enums']['notification_mode']

export const NOTIFICATION_MODES = ['each', 'daily', 'off'] as const

// 行が無い学生の既定。サーバー側（enqueueのcoalesce）と同じ値でなければならない
export const DEFAULT_NOTIFICATION_MODE: NotificationMode = 'each'

type ModeOption = {
  mode: NotificationMode
  label: string
  description: string
}

// 表示順は「多い→少ない」。止める選択肢を最後に置き、探しやすくする
export const NOTIFICATION_MODE_OPTIONS: readonly ModeOption[] = [
  {
    mode: 'each',
    label: 'オファーごとに通知',
    description: '新しい案内が届くたびにメールでお知らせします。',
  },
  {
    mode: 'daily',
    label: '1日1回のまとめ',
    description: 'その日に届いた件数を、夕方に1通だけお知らせします。',
  },
  {
    mode: 'off',
    label: '通知しない',
    description: 'メールは送りません。案内はアプリの受信箱で確認できます。',
  },
] as const

// サーバーの値を型へ落とす。未知の値は既定（each）ではなく、
// 「読めなかった」ことが分かるようnullを返して呼び出し側に判断させる
export function parseNotificationMode(raw: string | null | undefined): NotificationMode | null {
  return (NOTIFICATION_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as NotificationMode)
    : null
}

export function notificationModeLabel(mode: NotificationMode): string {
  return NOTIFICATION_MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? ''
}

// 設定行が無い場合は既定（each）を返す。RLSにより自分の行しか読めない
export async function fetchNotificationMode(
  client: CueSupabaseClient,
): Promise<NotificationMode> {
  const { data, error } = await client
    .from('student_notification_settings')
    .select('mode')
    .maybeSingle()
  if (error) throw error
  return parseNotificationMode(data?.mode) ?? DEFAULT_NOTIFICATION_MODE
}

export async function saveNotificationMode(
  client: CueSupabaseClient,
  mode: NotificationMode,
): Promise<void> {
  const { error } = await client.rpc('save_notification_settings', { new_mode: mode })
  if (error) throw error
}
