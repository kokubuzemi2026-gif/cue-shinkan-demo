import { describe, expect, it } from 'vitest'

import {
  AUDIENCE_BANDS,
  MIN_DELIVERABLE_AUDIENCE,
  audienceBandBlockReason,
  audienceBandLabel,
  canDeliverBand,
  parseAudienceBand,
} from './audienceBand'

describe('audienceBand', () => {
  it('サーバーの区分文字列を6値すべて受け取れる', () => {
    for (const band of AUDIENCE_BANDS) {
      expect(parseAudienceBand(band)).toBe(band)
    }
  })

  it('未知・欠損の値は配信できない側（0）へ倒す', () => {
    // 人数を推測した既定値を置かない。安全側は「配信しない」
    expect(parseAudienceBand('7')).toBe('0')
    expect(parseAudienceBand('')).toBe('0')
    expect(parseAudienceBand(null)).toBe('0')
    expect(parseAudienceBand(undefined)).toBe('0')
    expect(canDeliverBand(parseAudienceBand('unexpected'))).toBe(false)
  })

  it('区分ラベルは人数の幅を示し、正確な人数を出さない', () => {
    expect(audienceBandLabel('0')).toBe('0人')
    expect(audienceBandLabel('1-4')).toBe('1〜4人')
    expect(audienceBandLabel('5-9')).toBe('5〜9人')
    expect(audienceBandLabel('10-24')).toBe('10〜24人')
    expect(audienceBandLabel('25-49')).toBe('25〜49人')
    expect(audienceBandLabel('50+')).toBe('50人以上')
    // 0人以外のラベルは必ず幅を持つ（「12人」のような確定人数の表記を作らない）
    for (const band of AUDIENCE_BANDS) {
      if (band === '0') continue
      expect(audienceBandLabel(band)).toMatch(/[〜以上]/u)
    }
  })

  it('最小人数未満の区分では配信できない（D036）', () => {
    expect(MIN_DELIVERABLE_AUDIENCE).toBe(5)
    expect(canDeliverBand('0')).toBe(false)
    expect(canDeliverBand('1-4')).toBe(false)
    expect(canDeliverBand('5-9')).toBe(true)
    expect(canDeliverBand('10-24')).toBe(true)
    expect(canDeliverBand('25-49')).toBe(true)
    expect(canDeliverBand('50+')).toBe(true)
  })

  it('配信できない区分には理由があり、できる区分には無い', () => {
    expect(audienceBandBlockReason('0')).toContain('合う新入生がいない')
    expect(audienceBandBlockReason('1-4')).toContain('5人未満')
    expect(audienceBandBlockReason('5-9')).toBeNull()
    expect(audienceBandBlockReason('50+')).toBeNull()
  })
})
