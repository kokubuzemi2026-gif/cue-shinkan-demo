import { describe, expect, it } from 'vitest'

import {
  DEFAULT_NOTIFICATION_MODE,
  NOTIFICATION_MODES,
  NOTIFICATION_MODE_OPTIONS,
  notificationModeLabel,
  parseNotificationMode,
} from './notificationApi'

describe('notificationApi', () => {
  it('3種類の受け取り方をすべて扱える', () => {
    expect([...NOTIFICATION_MODES]).toEqual(['each', 'daily', 'off'])
    for (const mode of NOTIFICATION_MODES) {
      expect(parseNotificationMode(mode)).toBe(mode)
    }
  })

  it('未知・欠損の値は既定へ倒さずnullを返す', () => {
    // 「読めなかった」ことを呼び出し側が区別できるようにする。
    // 勝手にeachへ倒すと、offにした学生へ通知が復活したように見えかねない
    expect(parseNotificationMode('weekly')).toBeNull()
    expect(parseNotificationMode('')).toBeNull()
    expect(parseNotificationMode(null)).toBeNull()
    expect(parseNotificationMode(undefined)).toBeNull()
  })

  it('既定はサーバー側（enqueueのcoalesce）と同じeach', () => {
    expect(DEFAULT_NOTIFICATION_MODE).toBe('each')
  })

  it('選択肢は3つで、止める選択肢が最後にある', () => {
    expect(NOTIFICATION_MODE_OPTIONS).toHaveLength(3)
    expect(NOTIFICATION_MODE_OPTIONS[NOTIFICATION_MODE_OPTIONS.length - 1]?.mode).toBe('off')
    for (const option of NOTIFICATION_MODE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.description.length).toBeGreaterThan(0)
    }
  })

  it('選択肢の説明に団体名・希望条件・返答状態が現れない', () => {
    // メール本文と同じく、設定画面にも配信の中身は出さない
    const text = NOTIFICATION_MODE_OPTIONS.map((o) => `${o.label}${o.description}`).join('')
    for (const forbidden of ['団体', 'サークル', '予算', '曜日', '行ってみたい', '見送']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('ラベルを引ける', () => {
    expect(notificationModeLabel('each')).toBe('オファーごとに通知')
    expect(notificationModeLabel('daily')).toBe('1日1回のまとめ')
    expect(notificationModeLabel('off')).toBe('通知しない')
  })
})
