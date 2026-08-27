import { describe, expect, it } from 'vitest'

import {
  FUNNEL_MIN_DELIVERED,
  FUNNEL_SUPPRESSED_TEXT,
  FUNNEL_UNAVAILABLE_TEXT,
  exactToDisclosed,
  funnelCellAriaLabel,
  funnelCellText,
  isDisclosedFunnel,
  toDisclosedFunnel,
  type DisclosedFunnel,
} from './funnelDisclosure'

const UNAVAILABLE: DisclosedFunnel = {
  available: false,
  rounded: true,
  delivered: null,
  viewed: null,
  engaged: null,
  planned: null,
}

const PARTIAL: DisclosedFunnel = {
  available: true,
  rounded: true,
  delivered: 15,
  viewed: 10,
  engaged: null,
  planned: null,
}

describe('funnelDisclosure', () => {
  it('配信10人未満は全セルを非表示にし、0人と表示しない', () => {
    expect(FUNNEL_MIN_DELIVERED).toBe(10)
    for (const key of ['delivered', 'viewed', 'engaged', 'planned'] as const) {
      expect(funnelCellText(UNAVAILABLE, key)).toBe(FUNNEL_SUPPRESSED_TEXT)
      expect(funnelCellText(UNAVAILABLE, key)).not.toBe('0')
      expect(funnelCellAriaLabel(UNAVAILABLE, key)).toBe(FUNNEL_UNAVAILABLE_TEXT)
    }
  })

  it('抑制されたセルだけを非表示にし、開示されたセルは数値を出す', () => {
    expect(funnelCellText(PARTIAL, 'delivered')).toBe('15')
    expect(funnelCellText(PARTIAL, 'viewed')).toBe('10')
    expect(funnelCellText(PARTIAL, 'engaged')).toBe(FUNNEL_SUPPRESSED_TEXT)
    expect(funnelCellText(PARTIAL, 'planned')).toBe(FUNNEL_SUPPRESSED_TEXT)
  })

  it('抑制セルは0人ではなく「10人未満のため非表示」と読み上げる', () => {
    // 色・記号だけに意味を持たせない（AGENTS.md UI/UX）
    expect(funnelCellAriaLabel(PARTIAL, 'engaged')).toBe('10人未満のため非表示')
    expect(funnelCellAriaLabel(PARTIAL, 'delivered')).toBe('約15人')
  })

  it('丸めていない実数（Phase 1デモ）は「約」を付けずに読み上げる', () => {
    const exact = exactToDisclosed({ delivered: 3, viewed: 2, engaged: 2, planned: 1 })
    expect(funnelCellAriaLabel(exact, 'delivered')).toBe('3人')
  })

  it('0という開示値と抑制を取り違えない', () => {
    const zeroDisclosed: DisclosedFunnel = { ...PARTIAL, viewed: 0 }
    expect(funnelCellText(zeroDisclosed, 'viewed')).toBe('0')
    expect(funnelCellAriaLabel(zeroDisclosed, 'viewed')).toBe('約0人')
    expect(funnelCellText(PARTIAL, 'engaged')).not.toBe('0')
  })

  it('Phase 1デモの実数ファネルはそのまま開示扱いにする', () => {
    const exact = { delivered: 3, viewed: 2, engaged: 2, planned: 1 }
    expect(isDisclosedFunnel(exact)).toBe(false)
    expect(exactToDisclosed(exact)).toEqual({
      available: true,
      rounded: false,
      delivered: 3,
      viewed: 2,
      engaged: 2,
      planned: 1,
    })
    expect(toDisclosedFunnel(exact).delivered).toBe(3)
    expect(toDisclosedFunnel(UNAVAILABLE)).toBe(UNAVAILABLE)
    expect(isDisclosedFunnel(UNAVAILABLE)).toBe(true)
  })
})
