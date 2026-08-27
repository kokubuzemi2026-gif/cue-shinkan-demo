import { defineConfig } from '@playwright/test'

// Task 008 E2E（app/e2e/）。ローカルSupabaseスタック（npm run db:start）が起動済みで、
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が.env.localまたは環境変数に
// 設定されていることを前提にする（CIは.github/workflows/ci.ymlのe2eジョブが設定する）。
//
// 機密対策: OTP・招待トークンを扱うため、trace / video / screenshot をすべて無効にする。
//
// **それだけでは足りない。** Playwright 1.51以降は、テストが失敗すると必ず
// `page.ariaSnapshot()` を撮って `test-results/<test>/error-context.md` へ書き出す。
// これは trace / video / screenshot の設定とは無関係で、aria snapshotには
// `input` / `textarea` の**値がそのまま入る**（実際に走らせて確認した:
// 既定では `- textbox "code" [active] [ref=e2]: "123456"` が残り、下記の環境変数を
// 立てるとファイルは作られるがページ内容は一切入らない）。
// OTPコードと一度だけ表示される招待URLが該当するため、明示的に止める。
//
// 止まらない経路が2つある。どちらもopt-inなので、使うときに気をつける。
//   1. `toMatchAriaSnapshot` の失敗 — aria yamlが `# Error details` へ埋め込まれ、
//      CIログにも出る。**OTP・招待URLが出ている画面では使わない**
//   2. CLIの `--trace on` — 下の `use.trace: 'off'` を上書きし、trace.zipへ入力値が入る
// `??=` ではなく `||=`。`PLAYWRIGHT_NO_COPY_PROMPT=""` を渡されたとき、
// `??=` は空文字を上書きしないのに Playwright 側の `if (env)` は偽になり、
// **保護だけが黙って外れる**（実際に入力値がファイルへ落ちることを確認した）
process.env.PLAYWRIGHT_NO_COPY_PROMPT ||= '1'

export default defineConfig({
  testDir: './e2e',
  // 状態を積み上げる一連のシナリオのため直列実行
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/',
    // 秘密値をアーティファクトへ残さない（上のPLAYWRIGHT_NO_COPY_PROMPTと対で効く）
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    // mobile first: 幅390pxを既定表示にして全手順を検証する
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run dev',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:5173/cue-shinkan-demo/',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
