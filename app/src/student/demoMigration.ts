import type { StudentPreference } from '../domain/types'
import type { StorageLike } from '../storage/appStorage'
import { DEMO_STORAGE_KEYS } from '../storage/demoReset'
import { createStudentPreferenceStore } from '../storage/preferenceStore'
import { SELF_DISPLAY_NAME, SELF_STUDENT_ID } from '../serverdata/passportApi'

// Phase 1デモ（cue-demo:*）からの一回限りの持ち込み移行。
//
// 移行するのは本人が自分で入力した興味パスポート（cue-demo:student-preference）だけ。
// 配信・既読・返答（offer-deliveries / offer-reads / offer-responses）は架空の
// デモ団体・デモ学生IDに紐づく演出データであり、サーバーの実データへは持ち込まず破棄する。
//
// 冪等性: 成功時（import / cleanup）は4キーを削除するため、再実行は常にnoneになる。
// 保存失敗時はキーを残し、次回起動時に同じ移行を再試行する（データを失わない）。
// localStorage由来の値は信頼せず、既存のschema検証（isStudentPreference）に加えて
// wizardの必須条件（興味・目的・曜日が1件以上）を満たすものだけを移行する。
// サーバー側のsave_student_passport RPCでも再検証される。

export type DemoMigrationPlan =
  | { kind: 'import'; preference: StudentPreference }
  | { kind: 'cleanup-only' }
  | { kind: 'none' }

export type DemoMigrationOutcome = 'imported' | 'cleaned' | 'kept' | 'none'

function hasAnyDemoKey(storage: StorageLike): boolean {
  return DEMO_STORAGE_KEYS.some((key) => {
    try {
      return storage.getItem(key) !== null
    } catch {
      return false
    }
  })
}

// wizardが保証する必須条件。これを満たさない値はサーバーへ送らず破棄する
function isImportablePreference(preference: StudentPreference): boolean {
  return (
    preference.interests.length >= 1 &&
    preference.purposes.length >= 1 &&
    preference.availableDays.length >= 1
  )
}

export function planDemoMigration(storage: StorageLike | null): DemoMigrationPlan {
  if (storage === null) return { kind: 'none' }
  const stored = createStudentPreferenceStore(storage).load()
  if (stored !== null && isImportablePreference(stored)) {
    return {
      kind: 'import',
      // デモ側のID・表示名は持ち込まない（サーバーの自己表示値へ正規化する）
      preference: { ...stored, id: SELF_STUDENT_ID, displayName: SELF_DISPLAY_NAME },
    }
  }
  return hasAnyDemoKey(storage) ? { kind: 'cleanup-only' } : { kind: 'none' }
}

export function clearDemoStorage(storage: StorageLike | null): void {
  if (storage === null) return
  for (const key of DEMO_STORAGE_KEYS) {
    try {
      storage.removeItem(key)
    } catch {
      // 削除失敗は次回起動時に再試行される
    }
  }
}

// 認証済み学生コンテキストの初期化時に1回だけ呼ぶ。
// - サーバーに既にパスポートがある場合は持ち込まず、デモキーを削除するだけ
// - サーバー未登録かつ有効なデモパスポートがあれば、saveが成功したときだけ削除する
export async function runDemoMigration(
  storage: StorageLike | null,
  hasServerPassport: boolean,
  save: (preference: StudentPreference) => Promise<boolean>,
): Promise<DemoMigrationOutcome> {
  const plan = planDemoMigration(storage)
  if (plan.kind === 'none') return 'none'
  if (hasServerPassport || plan.kind === 'cleanup-only') {
    clearDemoStorage(storage)
    return 'cleaned'
  }
  const saved = await save(plan.preference)
  if (!saved) {
    // 通信失敗等ではデモデータを残し、次回に再試行する
    return 'kept'
  }
  clearDemoStorage(storage)
  return 'imported'
}
