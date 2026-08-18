import type { DemoRole } from '../domain/role'
import { RoleSwitcher } from './RoleSwitcher'

type AppHeaderProps = {
  role: DemoRole
  onRoleChange: (role: DemoRole) => void
}

export function AppHeader({ role, onRoleChange }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-top">
        <span className="brand">
          CUE<span className="brand-sub">（仮）</span>
        </span>
        <span className="demo-badge">デモ用架空データ</span>
      </div>
      <RoleSwitcher role={role} onChange={onRoleChange} />
    </header>
  )
}
