import { describe, expect, it } from 'vitest'

import { demoStudent } from '../../data/demoData'
import { createStudentPreferenceStore, isStudentPreference } from '../../storage/preferenceStore'
import type { StorageLike } from '../../storage/appStorage'
import {
  BUDGET_OPTIONS,
  buildPreference,
  createDraft,
  formatBudgetLabel,
  formatWeeklyLimitLabel,
  PASSPORT_STEP_COUNT,
  PASSPORT_STEPS,
  passportReducer,
  validateStep,
  WEEKLY_LIMIT_OPTIONS,
  withReceptionPaused,
  type PassportAction,
  type PassportDraft,
} from './passportForm'

function deepFreeze(draft: PassportDraft): PassportDraft {
  Object.freeze(draft.interests)
  Object.freeze(draft.purposes)
  Object.freeze(draft.availableDays)
  Object.freeze(draft.allowedCategories)
  return Object.freeze(draft)
}

describe('createDraft / buildPreference', () => {
  it('デモ学生のシードを未変更のまま完了すると、内容がメイン学生の初期値と一致する', () => {
    const draft = createDraft(demoStudent)
    expect(buildPreference(draft, demoStudent)).toEqual(demoStudent)
  })

  it('保存内容のキー集合がStudentPreferenceと過不足なく一致する', () => {
    const built = buildPreference(createDraft(demoStudent), demoStudent)
    expect(Object.keys(built).sort()).toEqual(Object.keys(demoStudent).sort())
    expect(Object.keys(built.reception).sort()).toEqual(Object.keys(demoStudent.reception).sort())
  })

  it('idとdisplayNameは入力に関わらずシード元から引き継ぐ', () => {
    const base = { ...demoStudent, id: 'student-other', displayName: '別名' }
    const built = buildPreference(createDraft(demoStudent), base)
    expect(built.id).toBe('student-other')
    expect(built.displayName).toBe('別名')
  })

  it('draftとシード元は配列を共有しない', () => {
    const draft = createDraft(demoStudent)
    expect(draft.interests).not.toBe(demoStudent.interests)
    expect(draft.allowedCategories).not.toBe(demoStudent.reception.allowedCategories)
    const built = buildPreference(draft, demoStudent)
    expect(built.interests).not.toBe(draft.interests)
    expect(built.reception.allowedCategories).not.toBe(draft.allowedCategories)
  })
})

describe('passportReducer', () => {
  it('複数選択は選択順の末尾へ追加され、再タップで解除される', () => {
    const draft = createDraft(demoStudent)
    const added = passportReducer(draft, { type: 'toggleInterest', value: 'music' })
    expect(added.interests).toEqual(['outdoor', 'photo', 'travel', 'music'])
    const removed = passportReducer(added, { type: 'toggleInterest', value: 'music' })
    expect(removed.interests).toEqual(['outdoor', 'photo', 'travel'])
  })

  it('単一選択は値を置き換える', () => {
    const draft = createDraft(demoStudent)
    const next = passportReducer(draft, { type: 'setStyle', value: 'serious' })
    expect(next.style).toBe('serious')
    expect(next.frequency).toBe(draft.frequency)
    expect(passportReducer(next, { type: 'setMaxFee', value: 500 }).maxFeePerEventYen).toBe(500)
    expect(passportReducer(next, { type: 'setWeeklyLimit', value: 5 }).weeklyLimit).toBe(5)
  })

  it('受信ON/OFFがreceptionPausedへ反映される', () => {
    const draft = createDraft(demoStudent)
    const paused = passportReducer(draft, { type: 'setReceptionPaused', value: true })
    expect(paused.receptionPaused).toBe(true)
    expect(
      passportReducer(paused, { type: 'setReceptionPaused', value: false }).receptionPaused,
    ).toBe(false)
  })

  it('入力中のdraftを破壊しない（凍結済みdraftでも全アクションが動く）', () => {
    const actions: PassportAction[] = [
      { type: 'toggleInterest', value: 'music' },
      { type: 'togglePurpose', value: 'creation' },
      { type: 'setStyle', value: 'relaxed' },
      { type: 'setFrequency', value: 'weekly_1' },
      { type: 'toggleDay', value: 'weekday_night' },
      { type: 'setExperience', value: 'some' },
      { type: 'setMaxFee', value: 1000 },
      { type: 'setReceptionPaused', value: true },
      { type: 'toggleAllowedCategory', value: 'volunteer' },
      { type: 'setWeeklyLimit', value: 1 },
      { type: 'reset', value: createDraft(demoStudent) },
    ]
    for (const action of actions) {
      const frozen = deepFreeze(createDraft(demoStudent))
      const next = passportReducer(frozen, action)
      expect(next).not.toBe(frozen)
      expect(frozen).toEqual(createDraft(demoStudent))
    }
  })

  it('resetは渡した内容の独立したコピーになる', () => {
    const source = createDraft(demoStudent)
    const next = passportReducer(
      passportReducer(source, { type: 'toggleInterest', value: 'music' }),
      { type: 'reset', value: source },
    )
    expect(next).toEqual(source)
    expect(next).not.toBe(source)
    expect(next.interests).not.toBe(source.interests)
  })
})

describe('validateStep', () => {
  const base = createDraft(demoStudent)

  it('step1: 興味が0件なら進めない', () => {
    expect(validateStep({ ...base, interests: [] }, 1)).toEqual({
      ok: false,
      message: '興味を1つ以上選んでください',
    })
    expect(validateStep(base, 1)).toEqual({ ok: true })
  })

  it('step2: 目的が0件なら進めない', () => {
    expect(validateStep({ ...base, purposes: [] }, 2)).toEqual({
      ok: false,
      message: '目的を1つ以上選んでください',
    })
    expect(validateStep(base, 2)).toEqual({ ok: true })
  })

  it('step3: 曜日が0件なら進めない', () => {
    expect(validateStep({ ...base, availableDays: [] }, 3)).toEqual({
      ok: false,
      message: '参加できる曜日を1つ以上選んでください',
    })
    expect(validateStep(base, 3)).toEqual({ ok: true })
  })

  it('step4: 受信ONでカテゴリ0件なら進めず、受信停止なら0件でも完了できる', () => {
    expect(
      validateStep({ ...base, receptionPaused: false, allowedCategories: [] }, 4),
    ).toEqual({
      ok: false,
      message: '受け取るカテゴリを1つ以上選ぶか、受信を停止してください',
    })
    expect(validateStep({ ...base, receptionPaused: true, allowedCategories: [] }, 4)).toEqual({
      ok: true,
    })
    expect(validateStep(base, 4)).toEqual({ ok: true })
  })
})

describe('選択肢プリセット', () => {
  it('予算プリセットはデモ学生の2,000円を含み、正の昇順になっている', () => {
    expect(BUDGET_OPTIONS).toContain(demoStudent.maxFeePerEventYen)
    expect([...BUDGET_OPTIONS]).toEqual([...BUDGET_OPTIONS].sort((a, b) => a - b))
    expect(BUDGET_OPTIONS.every((yen) => Number.isInteger(yen) && yen > 0)).toBe(true)
  })

  it('週上限プリセットは1〜5件（matching_and_safety §5）', () => {
    expect([...WEEKLY_LIMIT_OPTIONS]).toEqual([1, 2, 3, 4, 5])
  })

  it('どのプリセットで保存してもストアの型検証を通る', () => {
    const draft = createDraft(demoStudent)
    for (const yen of BUDGET_OPTIONS) {
      const built = buildPreference({ ...draft, maxFeePerEventYen: yen }, demoStudent)
      expect(isStudentPreference(built)).toBe(true)
    }
    for (const limit of WEEKLY_LIMIT_OPTIONS) {
      const built = buildPreference({ ...draft, weeklyLimit: limit }, demoStudent)
      expect(isStudentPreference(built)).toBe(true)
    }
  })

  it('表示ラベルが日本語円表記・週n件になる', () => {
    expect(formatBudgetLabel(2000)).toBe('〜2,000円')
    expect(formatWeeklyLimitLabel(3)).toBe('週3件')
  })
})

describe('withReceptionPaused', () => {
  it('reception.pausedだけを差し替え、他のフィールドは変えない', () => {
    const stopped = withReceptionPaused(demoStudent, true)
    expect(stopped.reception.paused).toBe(true)
    expect(stopped).toEqual({
      ...demoStudent,
      reception: { ...demoStudent.reception, paused: true },
    })
    const resumed = withReceptionPaused(stopped, false)
    expect(resumed).toEqual(demoStudent)
  })

  it('入力を破壊せず、ストアの型検証も通る', () => {
    const frozen = Object.freeze({
      ...demoStudent,
      reception: Object.freeze({ ...demoStudent.reception }),
    })
    const next = withReceptionPaused(frozen, true)
    expect(next).not.toBe(frozen)
    expect(frozen.reception.paused).toBe(false)
    expect(isStudentPreference(next)).toBe(true)
  })

  it('再開した設定はlocalStorage adapterへ保存・復元できる', () => {
    const map = new Map<string, string>()
    const storage: StorageLike = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
      removeItem: (key) => {
        map.delete(key)
      },
    }
    const store = createStudentPreferenceStore(storage)
    store.save(withReceptionPaused(demoStudent, true))
    expect(store.load()?.reception.paused).toBe(true)
    const stored = store.load()
    expect(stored).not.toBeNull()
    if (stored) {
      store.save(withReceptionPaused(stored, false))
    }
    expect(store.load()?.reception.paused).toBe(false)
    expect(store.load()).toEqual(demoStudent)
  })
})

describe('PASSPORT_STEPS', () => {
  it('4ステップで、step1はtasks/003の指定見出しになっている', () => {
    expect(PASSPORT_STEP_COUNT).toBe(4)
    expect(PASSPORT_STEPS).toHaveLength(4)
    expect(PASSPORT_STEPS.map((meta) => meta.step)).toEqual([1, 2, 3, 4])
    expect(PASSPORT_STEPS[0].heading).toBe('どんなきっかけが届いたら、ちょっと嬉しい？')
  })
})
