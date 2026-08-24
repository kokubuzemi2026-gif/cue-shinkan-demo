import type { DemoRole } from '../domain/role'
import { RoleSwitcher } from './RoleSwitcher'

type AppHeaderProps = {
  role: DemoRole
  onRoleChange: (role: DemoRole) => void
  // wizard入力中の集中モード。ロール切替を隠し、未保存draftの喪失を防ぐ
  hideRoleSwitcher?: boolean
  // デモ操作（初期状態へ戻す確認ダイアログ）を開く。両ロール・集中モード中も常設
  onOpenDemoReset: () => void
}

export function AppHeader({
  role,
  onRoleChange,
  hideRoleSwitcher = false,
  onOpenDemoReset,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-top">
        <span className="brand">
          CUE<span className="brand-sub">（仮）</span>
        </span>
        {/* 視覚はこれまでのバッジのまま、44pxのタップ領域を持つボタンとして開く */}
        <button
          type="button"
          className="demo-badge-button"
          aria-haspopup="dialog"
          aria-label="デモ操作（最初からやり直す）"
          onClick={onOpenDemoReset}
        >
          <span className="demo-badge">デモ用架空データ</span>
        </button>
      </div>
      {!hideRoleSwitcher && <RoleSwitcher role={role} onChange={onRoleChange} />}
    </header>
  )
}
