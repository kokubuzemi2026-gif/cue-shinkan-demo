import { ROLE_LABELS, type DemoRole } from '../domain/role'

const ROLES: DemoRole[] = ['student', 'club']

type RoleSwitcherProps = {
  role: DemoRole
  onChange: (role: DemoRole) => void
}

export function RoleSwitcher({ role, onChange }: RoleSwitcherProps) {
  return (
    <div className="role-switcher" role="group" aria-label="デモ用ロール切替">
      {ROLES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          className="role-switcher-button"
          aria-pressed={role === candidate}
          onClick={() => onChange(candidate)}
        >
          {ROLE_LABELS[candidate]}
        </button>
      ))}
    </div>
  )
}
