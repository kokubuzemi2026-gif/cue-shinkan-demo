export type DemoRole = 'student' | 'club'

export const ROLE_LABELS: Record<DemoRole, string> = {
  student: '新入生',
  club: '団体',
}

export function getRoleHeading(role: DemoRole): string {
  return role === 'student' ? '新入生ホーム' : '団体ダッシュボード'
}
