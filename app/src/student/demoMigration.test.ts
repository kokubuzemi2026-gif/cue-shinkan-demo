import { describe, expect, it } from 'vitest'

import type { StudentPreference } from '../domain/types'
import type { StorageLike } from '../storage/appStorage'
import { DEMO_STORAGE_KEYS } from '../storage/demoReset'
import {
  STUDENT_PREFERENCE_KEY,
  STUDENT_PREFERENCE_SCHEMA_VERSION,
} from '../storage/preferenceStore'
import { OFFER_DELIVERIES_KEY } from '../storage/deliveryStore'
import { SELF_DISPLAY_NAME, SELF_STUDENT_ID } from '../serverdata/passportApi'
import { clearDemoStorage, planDemoMigration, runDemoMigration } from './demoMigration'

// 旧デモ（cue-demo:*）からの一回限り移行の計画と実行。
// - 有効なパスポートだけを検証付きで持ち込み、他の3キー（配信・既読・返答）は破棄する
// - 保存成功時のみキーを削除する（失敗時はデータを失わず次回再試行）
// - 再実行しても重複・消失が起きない（冪等）

function createFakeStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

const DEMO_PREFERENCE: StudentPreference = {
  id: 'student-demo-1',
  displayName: 'あなた',
  interests: ['outdoor', 'photo'],
  purposes: ['friends'],
  style: 'moderate',
  frequency: 'monthly_1_2',
  availableDays: ['weekend'],
  experience: 'none',
  maxFeePerEventYen: 2000,
  reception: { paused: false, allowedCategories: ['outdoor'], weeklyLimit: 3 },
}

function encodePreference(preference: StudentPreference): string {
  return JSON.stringify({
    schemaVersion: STUDENT_PREFERENCE_SCHEMA_VERSION,
    data: preference,
  })
}

function remainingDemoKeys(storage: StorageLike): string[] {
  return DEMO_STORAGE_KEYS.filter((key) => storage.getItem(key) !== null)
}

describe('planDemoMigration', () => {
  it('有効なデモパスポートがあればimport計画になり、ID・表示名は自己表示値へ正規化される', () => {
    const storage = createFakeStorage({
      [STUDENT_PREFERENCE_KEY]: encodePreference(DEMO_PREFERENCE),
    })
    const plan = planDemoMigration(storage)
    expect(plan.kind).toBe('import')
    if (plan.kind === 'import') {
      expect(plan.preference.id).toBe(SELF_STUDENT_ID)
      expect(plan.preference.displayName).toBe(SELF_DISPLAY_NAME)
      expect(plan.preference.interests).toEqual(['outdoor', 'photo'])
    }
  })

  it('壊れたJSON・schema不一致はcleanup-onlyとして扱う（無検証で取り込まない）', () => {
    const storage = createFakeStorage({ [STUDENT_PREFERENCE_KEY]: '{broken json' })
    expect(planDemoMigration(storage)).toEqual({ kind: 'cleanup-only' })
  })

  it('必須項目が空の改ざんデータは取り込まない', () => {
    const storage = createFakeStorage({
      [STUDENT_PREFERENCE_KEY]: encodePreference({ ...DEMO_PREFERENCE, interests: [] }),
    })
    expect(planDemoMigration(storage)).toEqual({ kind: 'cleanup-only' })
  })

  it('パスポート以外のデモキーだけが残っている場合もcleanup-only', () => {
    const storage = createFakeStorage({ [OFFER_DELIVERIES_KEY]: '[]' })
    expect(planDemoMigration(storage)).toEqual({ kind: 'cleanup-only' })
  })

  it('デモキーが1つも無ければnone', () => {
    expect(planDemoMigration(createFakeStorage())).toEqual({ kind: 'none' })
    expect(planDemoMigration(null)).toEqual({ kind: 'none' })
  })
})

describe('runDemoMigration', () => {
  it('サーバー未登録なら保存し、成功時に4キーすべてを削除する', async () => {
    const storage = createFakeStorage({
      [STUDENT_PREFERENCE_KEY]: encodePreference(DEMO_PREFERENCE),
      [OFFER_DELIVERIES_KEY]: '[]',
    })
    const savedPreferences: StudentPreference[] = []
    const outcome = await runDemoMigration(storage, false, async (preference) => {
      savedPreferences.push(preference)
      return true
    })
    expect(outcome).toBe('imported')
    expect(savedPreferences).toHaveLength(1)
    expect(savedPreferences[0]?.interests).toEqual(['outdoor', 'photo'])
    expect(remainingDemoKeys(storage)).toEqual([])
  })

  it('サーバーに既にパスポートがあれば持ち込まず、キーだけ削除する', async () => {
    const storage = createFakeStorage({
      [STUDENT_PREFERENCE_KEY]: encodePreference(DEMO_PREFERENCE),
    })
    let saveCalls = 0
    const outcome = await runDemoMigration(storage, true, async () => {
      saveCalls += 1
      return true
    })
    expect(outcome).toBe('cleaned')
    expect(saveCalls).toBe(0)
    expect(remainingDemoKeys(storage)).toEqual([])
  })

  it('保存に失敗したらキーを残し、次回に再試行できる', async () => {
    const storage = createFakeStorage({
      [STUDENT_PREFERENCE_KEY]: encodePreference(DEMO_PREFERENCE),
    })
    const outcome = await runDemoMigration(storage, false, async () => false)
    expect(outcome).toBe('kept')
    expect(storage.getItem(STUDENT_PREFERENCE_KEY)).not.toBeNull()
  })

  it('二重実行しても2回目はnoneで、保存は再実行されない（冪等）', async () => {
    const storage = createFakeStorage({
      [STUDENT_PREFERENCE_KEY]: encodePreference(DEMO_PREFERENCE),
    })
    let saveCalls = 0
    const save = async () => {
      saveCalls += 1
      return true
    }
    expect(await runDemoMigration(storage, false, save)).toBe('imported')
    expect(await runDemoMigration(storage, false, save)).toBe('none')
    expect(saveCalls).toBe(1)
  })

  it('clearDemoStorageは4キーだけを削除し、他のキーへ触れない', () => {
    const storage = createFakeStorage({
      [STUDENT_PREFERENCE_KEY]: 'x',
      'sb-auth-token': 'keep',
      unrelated: 'keep',
    })
    clearDemoStorage(storage)
    expect(remainingDemoKeys(storage)).toEqual([])
    expect(storage.getItem('sb-auth-token')).toBe('keep')
    expect(storage.getItem('unrelated')).toBe('keep')
  })
})
