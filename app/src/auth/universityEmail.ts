// 大学メールの正規化と判定（docs/auth_and_authorization.md §2）。
// 判定表はDB側 private.is_university_email()（supabase/migrations）と完全に同一。
// クライアント判定はUX用の第一ゲートであり、正本はサーバー側のis_university_user()。

export const UNIVERSITY_EMAIL_DOMAIN = 'stu.kobe-u.ac.jp'

// 規則: ローカル部は空でなく「@」「+」「空白」を含まない / ドメインは完全一致。
// 学籍番号の文字種など、これ以上に狭い形式は推測しない（decisions.md D028）
const UNIVERSITY_EMAIL_PATTERN = /^[^@+\s]+@stu\.kobe-u\.ac\.jp$/

// 唯一の正規化関数。検証とsignInWithOtp()・verifyOtp()の双方へ、
// この関数を通した値だけを渡す（生の入力値をSupabaseへ送らない）
export function normalizeUniversityEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

// 正規化済みの値を判定する（SQL側はlower(btrim())を前段適用して同一規則）
export function isUniversityEmail(email: string): boolean {
  return UNIVERSITY_EMAIL_PATTERN.test(email)
}
