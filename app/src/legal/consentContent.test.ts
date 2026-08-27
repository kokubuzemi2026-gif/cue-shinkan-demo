import { describe, expect, it } from 'vitest'

import { CONSENT_SUMMARY } from './consentContent'

// 同意画面の要点が、実装・ドラフトと食い違わないことを固定する（対応表の一部）。
// 文言を緩めても気づけるよう、核心のキーワードを検査する
describe('CONSENT_SUMMARY', () => {
  it('5つの要点があり、それぞれ本文を持つ', () => {
    expect(CONSENT_SUMMARY).toHaveLength(5)
    for (const point of CONSENT_SUMMARY) {
      expect(point.title.length).toBeGreaterThan(0)
      expect(point.body.length).toBeGreaterThan(0)
    }
  })

  it('団体に個人が見えないことを明示している（D029）', () => {
    const all = CONSENT_SUMMARY.map((p) => p.body).join('')
    expect(all).toContain('氏名')
    expect(all).toContain('見えません')
  })

  it('連絡先は「行ってみたい」の後だけ、を明示している（D033）', () => {
    const all = CONSENT_SUMMARY.map((p) => p.body).join('')
    expect(all).toContain('行ってみたい')
    expect(all).toContain('連絡先')
  })

  it('いつでも削除できることを明示している（D046）', () => {
    const all = CONSENT_SUMMARY.map((p) => p.title + p.body).join('')
    expect(all).toContain('削除')
  })
})
