import type { ReactNode } from 'react'

export type StudentTab = 'home' | 'inbox' | 'settings'

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="bottom-nav-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const NAV_ITEMS: { key: StudentTab; label: string; icon: ReactNode }[] = [
  {
    key: 'home',
    label: 'ホーム',
    icon: (
      <NavIcon>
        <path d="M4 11.2 12 4.5l8 6.7" />
        <path d="M6.2 10.4V19h11.6v-8.6" />
      </NavIcon>
    ),
  },
  {
    key: 'inbox',
    label: '受信箱',
    icon: (
      <NavIcon>
        <rect x="4" y="6.5" width="16" height="12" rx="2.4" />
        <path d="m4.8 8.6 7.2 5 7.2-5" />
      </NavIcon>
    ),
  },
  {
    key: 'settings',
    label: '設定',
    icon: (
      <NavIcon>
        <path d="M4.5 8.2h2.6" />
        <path d="M12 8.2h7.5" />
        <circle cx="9.5" cy="8.2" r="2.4" />
        <path d="M4.5 15.8h7.5" />
        <path d="M17 15.8h2.5" />
        <circle cx="14.5" cy="15.8" r="2.4" />
      </NavIcon>
    ),
  },
]

type BottomNavProps = {
  activeTab: StudentTab
  onSelect: (tab: StudentTab) => void
}

// Task 003でタブ切替を接続。受信箱・設定タブの中身は後続タスクで実装する。
export function BottomNav({ activeTab, onSelect }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="新入生メニュー">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className="bottom-nav-item"
          aria-current={activeTab === item.key ? 'page' : undefined}
          onClick={() => onSelect(item.key)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
