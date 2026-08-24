// 招待リンク（#invite=<token>）の解析・除去・生成（docs/auth_and_authorization.md §8）。
// トークンはhashフラグメントに載せる（サーバー・アクセスログへ送信されない）。
// 解析後は直ちにURLから除去し、メモリ以外（storage・ログ・画面）へ出さない

// F7が返す生トークンは256bit = hex 64文字
const INVITE_TOKEN_PATTERN = /^[0-9a-f]{64}$/

const INVITE_HASH_PREFIX = '#invite='

// '#invite=<64hex>' 形式のhashからトークンを取り出す。形式外はnull（不正値を持ち回らない）
export function parseInviteToken(hash: string): string | null {
  if (!hash.startsWith(INVITE_HASH_PREFIX)) {
    return null
  }
  const candidate = hash.slice(INVITE_HASH_PREFIX.length)
  return INVITE_TOKEN_PATTERN.test(candidate) ? candidate : null
}

// hashを除いた現在URL（history.replaceStateへ渡す値）。トークンを含まない
export function urlWithoutInviteHash(location: { pathname: string; search: string }): string {
  return `${location.pathname}${location.search}`
}

// 招待URLの組み立て（InviteCreatedDialogが一度だけ表示する）
export function buildInviteUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${trimmed}/${INVITE_HASH_PREFIX}${token}`
}

// 起動時に1回だけ呼ぶ薄い合成関数（main.tsxがcreateRoot前に使用）。
// トークンがあればURLから即座に除去して返す。StrictModeの二重実行でも冪等
export function consumeInviteTokenFromUrl(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState: (data: unknown, unused: string, url: string) => void },
): string | null {
  const token = parseInviteToken(location.hash)
  if (token === null) {
    return null
  }
  history.replaceState(null, '', urlWithoutInviteHash(location))
  return token
}
