import type { DemoRole } from '../domain/role'
import { RoleSwitcher } from './RoleSwitcher'

type AppHeaderProps = {
  role: DemoRole
  onRoleChange: (role: DemoRole) => void
  // wizard入力中の集中モード。ロール切替を隠し、未保存draftの喪失を防ぐ
  hideRoleSwitcher?: boolean
}

export function AppHeader({ role, onRoleChange, hideRoleSwitcher = false }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-top">
        <span className="brand">
          CUE<span className="brand-sub">（仮）</span>
        </span>
        <span className="demo-badge">デモ用架空データ</span>
      </div>
      {!hideRoleSwitcher && <RoleSwitcher role={role} onChange={onRoleChange} />}
    </header>
  )
}
