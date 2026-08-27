import { describe, expect, it } from 'vitest'

// playwright.config.ts をソースとして読み、秘密値対策の1行が残っていることを固定する。
import playwrightConfigSource from '../../playwright.config.ts?raw'

// なぜテキストで見るのか:
// CIのe2eジョブは PLAYWRIGHT_NO_COPY_PROMPT=1 を env で明示している。そのため
// **CIではconfig側の代入が一度も発火せず**、configの1行が消えてもCIは green のまま
// ローカル実行だけが漏れるようになる。その回帰をここで止める。
describe('playwright.config.ts の秘密値対策', () => {
  it('PLAYWRIGHT_NO_COPY_PROMPT の既定値を立てている', () => {
    expect(playwrightConfigSource).toContain('PLAYWRIGHT_NO_COPY_PROMPT')
  })

  it('||= で代入している（??= だと空文字を渡されたときに保護が外れる）', () => {
    // `??=` は null / undefined のときしか代入しない。
    // PLAYWRIGHT_NO_COPY_PROMPT="" を渡すと config は '' のまま残し、
    // Playwright 側の `if (process.env.PLAYWRIGHT_NO_COPY_PROMPT)` も偽になるため、
    // 保護だけが黙って外れる
    expect(playwrightConfigSource).toContain("process.env.PLAYWRIGHT_NO_COPY_PROMPT ||= '1'")
    expect(playwrightConfigSource).not.toContain('PLAYWRIGHT_NO_COPY_PROMPT ??=')
  })

  it('trace / video / screenshot を無効にしている', () => {
    for (const line of ["trace: 'off'", "video: 'off'", "screenshot: 'off'"]) {
      expect(playwrightConfigSource).toContain(line)
    }
  })
})
