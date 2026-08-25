import react from '@vitejs/plugin-react'
// Vitestのtest設定を型付きで書くため、viteでなくvitest/configのdefineConfigを使う
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // リポジトリ配下のGitHub Pages（https://kokubuzemi2026-gif.github.io/cue-shinkan-demo/）で
  // asset URLを解決するための固定base。リポジトリ名を変更する場合はここも更新する
  base: '/cue-shinkan-demo/',
  plugins: [react()],
  test: {
    // Playwright E2E（app/e2e/ の *.spec.ts）はVitestの対象外にする
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
