import type { FunnelCounts } from './funnel'

// 団体向けファネルの開示規則（D037・英国ONSの10-5ルールを参考）。
// 抑制と丸めの判定はサーバー（list_org_campaigns）が正本で、ここは表示モデルのみ。
// 抑制されたセルを「0人」と表示しないことが、この層の責務。

export type DisclosedFunnel = {
  // 配信人数が集計に必要な人数（10人）に満たない場合はfalse。全セルが非開示
  available: boolean
  delivered: number | null
  viewed: number | null
  engaged: number | null
  planned: number | null
}

export type FunnelMetricKey = 'delivered' | 'viewed' | 'engaged' | 'planned'

// 集計に必要な最小配信人数と、セル単位の抑制しきい値（サーバーと同値）
export const FUNNEL_MIN_DELIVERED = 10

export const FUNNEL_UNAVAILABLE_TEXT = '集計に必要な人数未満'
export const FUNNEL_SUPPRESSED_TEXT = '—'

export const FUNNEL_NOTE =
  '新入生の個人が特定されないよう、少人数の集計は表示せず、表示する数値は5人単位に丸めています。「—」は0人ではなく非表示です。'

// 型ガード: サーバー由来の開示済みファネルか、Phase 1デモの実数ファネルか
export function isDisclosedFunnel(
  funnel: FunnelCounts | DisclosedFunnel,
): funnel is DisclosedFunnel {
  return 'available' in funnel
}

// デモ（localStorage・架空データ）の実数はそのまま開示扱いにする
export function exactToDisclosed(counts: FunnelCounts): DisclosedFunnel {
  return {
    available: true,
    delivered: counts.delivered,
    viewed: counts.viewed,
    engaged: counts.engaged,
    planned: counts.planned,
  }
}

export function toDisclosedFunnel(funnel: FunnelCounts | DisclosedFunnel): DisclosedFunnel {
  return isDisclosedFunnel(funnel) ? funnel : exactToDisclosed(funnel)
}

// 1セルの表示文字列。抑制・非開示は必ず0以外の文字列になる
export function funnelCellText(funnel: DisclosedFunnel, key: FunnelMetricKey): string {
  if (!funnel.available) return FUNNEL_SUPPRESSED_TEXT
  const value = funnel[key]
  return value === null ? FUNNEL_SUPPRESSED_TEXT : `${value}`
}

// スクリーンリーダー向けの読み上げ（色・記号だけに意味を持たせない）
export function funnelCellAriaLabel(funnel: DisclosedFunnel, key: FunnelMetricKey): string {
  if (!funnel.available) return FUNNEL_UNAVAILABLE_TEXT
  const value = funnel[key]
  return value === null ? '10人未満のため非表示' : `約${value}人`
}
