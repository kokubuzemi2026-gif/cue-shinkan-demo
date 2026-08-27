// 対象規模の区分（D036）。団体へは正確な人数を出さず、この6区分だけを表示する。
// 生の人数はサーバー（private.audience_band）でのみ扱い、API応答・クライアント状態には現れない。

export const AUDIENCE_BANDS = ['0', '1-4', '5-9', '10-24', '25-49', '50+'] as const

export type AudienceBand = (typeof AUDIENCE_BANDS)[number]

// 匿名性を保てる配信の最小人数。サーバー（send_offer）が正本で、ここは表示用の同値
export const MIN_DELIVERABLE_AUDIENCE = 5

const BAND_LABELS: Record<AudienceBand, string> = {
  '0': '0人',
  '1-4': '1〜4人',
  '5-9': '5〜9人',
  '10-24': '10〜24人',
  '25-49': '25〜49人',
  '50+': '50人以上',
}

// サーバーの区分文字列を型へ落とす。未知の値は最も保守的な '0' として扱う
// （配信できない側へ倒す。人数を推測した既定値は置かない）
export function parseAudienceBand(raw: string | null | undefined): AudienceBand {
  return (AUDIENCE_BANDS as readonly string[]).includes(raw ?? '')
    ? (raw as AudienceBand)
    : '0'
}

export function audienceBandLabel(band: AudienceBand): string {
  return BAND_LABELS[band]
}

// この区分で配信できるか（0人・1〜4人は匿名性を保てないため配信しない）
export function canDeliverBand(band: AudienceBand): boolean {
  return band !== '0' && band !== '1-4'
}

// 配信できない区分の理由。できる場合はnull
export function audienceBandBlockReason(band: AudienceBand): string | null {
  if (band === '0') return '現在の条件に合う新入生がいないため送信できません'
  if (band === '1-4') {
    return `対象の新入生が${MIN_DELIVERABLE_AUDIENCE}人未満のため、個人が特定されないよう送信できません。条件を広げてください`
  }
  return null
}

// 区分表示であることの説明（正確な人数を出さない理由を利用者へ伝える）
export const AUDIENCE_BAND_NOTE =
  '新入生の個人が特定されないよう、対象人数はおおよその区分で表示しています。'
