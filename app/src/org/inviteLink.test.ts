import { describe, expect, it } from 'vitest'

import {
  buildInviteUrl,
  consumeInviteTokenFromUrl,
  parseInviteToken,
  urlWithoutInviteHash,
} from './inviteLink'

const TOKEN = 'a'.repeat(64)

describe('parseInviteToken', () => {
  it('正しい形式（#invite= + hex64）だけを受理する', () => {
    expect(parseInviteToken(`#invite=${TOKEN}`)).toBe(TOKEN)
  })

  it.each([
    '', // hashなし
    '#', // 空hash
    '#invite=', // トークンなし
    `#invite=${'a'.repeat(63)}`, // 長さ不足
    `#invite=${'a'.repeat(65)}`, // 長さ超過
    `#invite=${'A'.repeat(64)}`, // 大文字hexは発行しない形式
    `#invite=${'g'.repeat(64)}`, // hex外文字
    `#other=${TOKEN}`, // 別のhashキー
    `#invite=${TOKEN}&x=1`, // 余分な後続
  ])('不正な形式を拒否する: %j', (hash) => {
    expect(parseInviteToken(hash)).toBeNull()
  })
})

describe('urlWithoutInviteHash / consumeInviteTokenFromUrl', () => {
  it('除去後URLにトークンが含まれない', () => {
    const url = urlWithoutInviteHash({ pathname: '/cue-shinkan-demo/', search: '' })
    expect(url).toBe('/cue-shinkan-demo/')
    expect(url).not.toContain(TOKEN)
  })

  it('トークンを1回で取り出し、URLから即座に除去する', () => {
    const calls: string[] = []
    const token = consumeInviteTokenFromUrl(
      { hash: `#invite=${TOKEN}`, pathname: '/cue-shinkan-demo/', search: '?x=1' },
      { replaceState: (_data, _unused, url) => calls.push(url) },
    )
    expect(token).toBe(TOKEN)
    expect(calls).toEqual(['/cue-shinkan-demo/?x=1'])
    expect(calls[0]).not.toContain('invite')
  })

  it('トークンが無ければ何もしない（replaceStateも呼ばない）', () => {
    const calls: string[] = []
    const token = consumeInviteTokenFromUrl(
      { hash: '', pathname: '/cue-shinkan-demo/', search: '' },
      { replaceState: (_data, _unused, url) => calls.push(url) },
    )
    expect(token).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('buildInviteUrl', () => {
  it('base URL末尾のスラッシュ有無に関わらず同じ形式になる', () => {
    const expected = `https://example.test/cue-shinkan-demo/#invite=${TOKEN}`
    expect(buildInviteUrl('https://example.test/cue-shinkan-demo/', TOKEN)).toBe(expected)
    expect(buildInviteUrl('https://example.test/cue-shinkan-demo', TOKEN)).toBe(expected)
  })

  it('生成→解析が往復できる', () => {
    const url = new URL(buildInviteUrl('https://example.test/app/', TOKEN))
    expect(parseInviteToken(url.hash)).toBe(TOKEN)
  })
})
