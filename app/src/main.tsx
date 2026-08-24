import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.tsx'
import { consumeResetCompleted, getSessionStorageSafe } from './storage/demoReset'

// reload後に以前のスクロール位置へ復元しない。アプリは全ビューで先頭表示へ統一しており、
// デモリセット後の初期ホームも必ずscrollY=0から始まる
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

// リセット完了フラグはcreateRootより前にここで1回だけ消費する。
// render中やuseState初期化で消費するとReact StrictModeの二重評価で通知が消えるため、
// 結果は純粋なboolean propとしてAppへ渡す
const initialResetCompleted = consumeResetCompleted(getSessionStorageSafe())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App initialResetCompleted={initialResetCompleted} />
  </StrictMode>,
)
