import { defineConfig } from '@playwright/test'

// Task 008 E2E（app/e2e/）。ローカルSupabaseスタック（npm run db:start）が起動済みで、
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が.env.localまたは環境変数に
// 設定されていることを前提にする（CIは.github/workflows/ci.ymlのe2eジョブが設定する）。
//
// 機密対策: OTP・招待トークンを扱うため、trace / video / screenshot をすべて無効にし、
// 失敗時のアーティファクトへ秘密値が残らないようにする。
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
    // 秘密値をアーティファクトへ残さない
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
