import { getDefaultStorage, type StorageLike } from './appStorage'
import { OFFER_DELIVERIES_KEY } from './deliveryStore'
import { STUDENT_PREFERENCE_KEY } from './preferenceStore'
import { OFFER_READS_KEY } from './readStore'
import { OFFER_RESPONSES_KEY } from './responseStore'

// 「デモを最初から」のためのstorage初期化（tasks/006）。
// これはStorageLike注入式の決定的なstorage操作で、Reactやreloadを知らない。
// CUEが所有する4キーだけを対象にし、localStorage.clear()は使わない。
// キー文字列は各storeのexport定数を参照し、ここで重複定義しない。
export const DEMO_STORAGE_KEYS = [
  STUDENT_PREFERENCE_KEY,
  OFFER_RESPONSES_KEY,
  OFFER_READS_KEY,
  OFFER_DELIVERIES_KEY,
] as const

export type DemoResetResult =
  | { ok: true }
  | { ok: false; reason: 'storage-unavailable' | 'reset-failed'; rollback: 'complete' | 'partial' }

// snapshotの値: string=元の値あり / null=元から不存在 / UNKNOWN=読取例外で値不明
const UNKNOWN = Symbol('unknown')
type SnapshotValue = string | null | typeof UNKNOWN

// 同期localStorageにはtransactionがないため、削除前に元値をsnapshotし、
// 途中失敗時はbest-effortでrollbackする。
// 手順: ①snapshot ②4キー削除 ③全削除を検証 ④失敗ならsnapshotへrollback ⑤rollbackを再検証。
// 検証に通ったときだけ ok:true（呼び出し側はこの後にreloadする。検証→reload間に書込はない）
export function resetDemoStorage(storage: StorageLike | null): DemoResetResult {
  if (storage === null) {
    // 何も触れていないので、状態は変更されていない
    return { ok: false, reason: 'storage-unavailable', rollback: 'complete' }
  }

  const snapshot = new Map<string, SnapshotValue>()
  for (const key of DEMO_STORAGE_KEYS) {
    try {
      snapshot.set(key, storage.getItem(key))
    } catch {
      // 値が読めないキーは復元不能（rollback時にpartial要因になる）
      snapshot.set(key, UNKNOWN)
    }
  }

  for (const key of DEMO_STORAGE_KEYS) {
    try {
      storage.removeItem(key)
    } catch {
      // 残存は検証で拾う
    }
  }

  const remaining: string[] = []
  for (const key of DEMO_STORAGE_KEYS) {
    try {
      if (storage.getItem(key) !== null) remaining.push(key)
    } catch {
      remaining.push(key)
    }
  }
  if (remaining.length === 0) {
    return { ok: true }
  }

  // best-effort rollback: 元値ありはsetItem・元から不存在はremoveItem・値不明は復元不能
  let rollbackComplete = true
  for (const key of DEMO_STORAGE_KEYS) {
    // snapshotループで全キーを設定済み。null（元から不存在）は正当な値のため
    // ??で潰さず、型上のundefinedだけをnull（不存在扱い）へ寄せる
    const original: SnapshotValue = snapshot.has(key) ? (snapshot.get(key) ?? null) : UNKNOWN
    try {
      if (original === UNKNOWN) {
        rollbackComplete = false
      } else if (original === null) {
        storage.removeItem(key)
      } else {
        storage.setItem(key, original)
      }
    } catch {
      rollbackComplete = false
    }
  }
  // rollback後の再検証: 現在値がsnapshotと一致しているか（値・不存在とも）
  for (const key of DEMO_STORAGE_KEYS) {
    const original: SnapshotValue = snapshot.has(key) ? (snapshot.get(key) ?? null) : UNKNOWN
    if (original === UNKNOWN) continue
    try {
      if (storage.getItem(key) !== original) rollbackComplete = false
    } catch {
      rollbackComplete = false
    }
  }

  return {
    ok: false,
    reason: 'reset-failed',
    rollback: rollbackComplete ? 'complete' : 'partial',
  }
}

// ---- リセット完了フラグ（sessionStorage・一時マーカー） ----
// localStorageの第5schemaではない。reload前に立て、reload後の起動時に1回だけ消費して
// 「デモを初期状態に戻しました」の通知に使う。消費はmain.tsx（createRootより前）で行い、
// React StrictModeの二重評価で通知が消えないようにする。

export const RESET_COMPLETED_FLAG = 'cue-demo:reset-completed'

// window.sessionStorageの評価自体が例外を投げる環境があるため、safe getterを通す
export function getSessionStorageSafe(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

// フラグを立てる。保存できなくてもリセット自体は成功扱い（通知が出ないだけ）
export function markResetCompleted(session: StorageLike | null): void {
  if (session === null) return
  try {
    session.setItem(RESET_COMPLETED_FLAG, '1')
  } catch {
    // 通知は諦める（リスクとしてPR/計画に明記）
  }
}

// フラグを読み、あれば即削除してtrueを1回だけ返す
export function consumeResetCompleted(session: StorageLike | null): boolean {
  if (session === null) return false
  try {
    const present = session.getItem(RESET_COMPLETED_FLAG) !== null
    if (present) session.removeItem(RESET_COMPLETED_FLAG)
    return present
  } catch {
    return false
  }
}

// アプリ本体用: 対象は常にlocalStorage（既存storeと同じ取得経路）
export function resetDemoStorageDefault(): DemoResetResult {
  return resetDemoStorage(getDefaultStorage())
}
