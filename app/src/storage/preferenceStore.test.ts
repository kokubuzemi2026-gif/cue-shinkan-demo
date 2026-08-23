import { describe, expect, it } from 'vitest'

import { demoStudent } from '../data/demoData'
import type { StorageLike } from './appStorage'
import {
  createStudentPreferenceStore,
  isStudentPreference,
  STUDENT_PREFERENCE_KEY,
  STUDENT_PREFERENCE_SCHEMA_VERSION,
} from './preferenceStore'

type FakeStorage = StorageLike & { dump(): Record<string, string> }

function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    dump: () => Object.fromEntries(map),
  }
}

function envelope(schemaVersion: number, data: unknown): string {
  return JSON.stringify({ schemaVersion, data })
}

describe('studentPreferenceStore', () => {
  it('保存した内容をそのまま読み込める', () => {
    const store = createStudentPreferenceStore(createFakeStorage())
    expect(store.save(demoStudent)).toBe(true)
    expect(store.load()).toEqual(demoStudent)
  })

  it('未保存のときはnullを返す', () => {
    const store = createStudentPreferenceStore(createFakeStorage())
    expect(store.load()).toBeNull()
  })

  it('保存形式はschemaVersionつきのエンベロープになる', () => {
    const storage = createFakeStorage()
    const store = createStudentPreferenceStore(storage)
    store.save(demoStudent)
    const raw = storage.dump()[STUDENT_PREFERENCE_KEY]
    expect(raw).toBeDefined()
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: STUDENT_PREFERENCE_SCHEMA_VERSION,
      data: demoStudent,
    })
  })

  it('破損したJSONはnullとして扱い、例外を投げない', () => {
    const storage = createFakeStorage({ [STUDENT_PREFERENCE_KEY]: '{oops' })
    const store = createStudentPreferenceStore(storage)
    expect(() => store.load()).not.toThrow()
    expect(store.load()).toBeNull()
  })

  it('schemaVersionが一致しないデータはnullとして扱う', () => {
    const storage = createFakeStorage({
      [STUDENT_PREFERENCE_KEY]: envelope(0, demoStudent),
    })
    const store = createStudentPreferenceStore(storage)
    expect(store.load()).toBeNull()
  })

  it('エンベロープは正しくても型が不正なデータはnullとして扱う', () => {
    const brokenInterests = { ...demoStudent, interests: 'x' }
    const brokenLimit = {
      ...demoStudent,
      reception: { ...demoStudent.reception, weeklyLimit: 9 },
    }
    for (const broken of [brokenInterests, brokenLimit]) {
      const storage = createFakeStorage({
        [STUDENT_PREFERENCE_KEY]: envelope(STUDENT_PREFERENCE_SCHEMA_VERSION, broken),
      })
      expect(createStudentPreferenceStore(storage).load()).toBeNull()
    }
  })

  it('getItemが例外を投げてもloadはnullで縮退する', () => {
    const storage = createFakeStorage()
    storage.getItem = () => {
      throw new Error('blocked')
    }
    expect(createStudentPreferenceStore(storage).load()).toBeNull()
  })

  it('setItemが例外を投げてもsaveはfalseで縮退する', () => {
    const storage = createFakeStorage()
    storage.setItem = () => {
      throw new Error('quota')
    }
    expect(createStudentPreferenceStore(storage).save(demoStudent)).toBe(false)
  })

  it('clearで削除するとloadはnullへ戻る', () => {
    const store = createStudentPreferenceStore(createFakeStorage())
    store.save(demoStudent)
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('Storageが使えない環境ではloadはnull、saveはfalseになる', () => {
    const store = createStudentPreferenceStore(null)
    expect(store.load()).toBeNull()
    expect(store.save(demoStudent)).toBe(false)
    expect(() => store.clear()).not.toThrow()
  })
})

describe('isStudentPreference', () => {
  it('デモ学生データを正しい形と判定する', () => {
    expect(isStudentPreference(demoStudent)).toBe(true)
  })

  it('ドメイン定数にない値を含むデータを拒否する', () => {
    expect(isStudentPreference({ ...demoStudent, interests: ['games'] })).toBe(false)
    expect(isStudentPreference({ ...demoStudent, style: 'extreme' })).toBe(false)
    expect(isStudentPreference({ ...demoStudent, maxFeePerEventYen: Number.NaN })).toBe(false)
    expect(isStudentPreference(null)).toBe(false)
  })
})
