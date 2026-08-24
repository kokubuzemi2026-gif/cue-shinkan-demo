import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/auth.css'
import { AppRoot } from './AppRoot'
import { consumeInviteTokenFromUrl } from './org/inviteLink'

// reload後に以前のスクロール位置へ復元しない。アプリは全ビューで先頭表示へ統一している
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

// 招待トークン（#invite=）はcreateRootより前にここで1回だけ取り出し、
// 直ちにURLから除去する。以後はメモリ（props/state）にのみ存在し、
// storage・ログ・画面へ出さない。StrictModeの二重評価でも冪等（2回目はhashが無い）
const initialInviteToken = consumeInviteTokenFromUrl(window.location, window.history)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot initialInviteToken={initialInviteToken} />
  </StrictMode>,
)
