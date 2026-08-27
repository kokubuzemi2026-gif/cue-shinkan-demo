import { useEffect, useRef } from 'react'

// Task 016: 画面が切り替わったときのフォーカス移動。
//
// CUEはルーティングライブラリを使わず、stateで画面そのものを差し替える。
// そのため画面が変わると、フォーカスは「消えたボタン」から`body`へ落ちる。
// スクリーンリーダーは新しい画面を読み上げず、キーボード利用者は毎回
// 先頭からTabをやり直すことになる。
//
// screenKeyが変わるたびに（＝画面またはステップが変わるたびに）見出しへ移し、
// スクロール位置も先頭へ戻す。見出し側には `tabIndex={-1}` が必要。
// `preventScroll`で、フォーカスによる意図しないスクロールを避ける。
export function useScreenFocus<T extends HTMLElement>(screenKey: unknown) {
  const ref = useRef<T>(null)
  useEffect(() => {
    window.scrollTo(0, 0)
    ref.current?.focus({ preventScroll: true })
  }, [screenKey])
  return ref
}
