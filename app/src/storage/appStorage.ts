// localStorageへのアクセスは必ずこのモジュール経由にする（docs/implementation_plan.md §6）。
// 例外・JSON破損・schema不一致はすべて「値なし」へ縮退させ、画面をクラッシュさせない。
// 保存内容をconsoleへ出さない（docs/matching_and_safety.md §8）。

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type JsonStore<T> = {
  load(): T | null
  save(value: T): boolean
  clear(): void
}

type Envelope = {
  schemaVersion: number
  data: unknown
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { schemaVersion?: unknown }).schemaVersion === 'number' &&
    'data' in value
  )
}

// schemaVersionが一致し、validateを通ったdataだけを返す汎用JSONストア。
// 旧バージョンのデータは移行せず「未保存」として扱う（デモでは破棄が安全側）。
// 将来バージョンを上げる場合は、ここへ移行処理を追加する。
export function createJsonStore<T>(
  storage: StorageLike | null,
  key: string,
  schemaVersion: number,
  validate: (value: unknown) => value is T,
): JsonStore<T> {
  return {
    load() {
      if (!storage) return null
      try {
        const raw = storage.getItem(key)
        if (raw === null) return null
        const parsed: unknown = JSON.parse(raw)
        if (!isEnvelope(parsed) || parsed.schemaVersion !== schemaVersion) return null
        return validate(parsed.data) ? parsed.data : null
      } catch {
        return null
      }
    },
    save(value) {
      if (!storage) return false
      try {
        storage.setItem(key, JSON.stringify({ schemaVersion, data: value }))
        return true
      } catch {
        return false
      }
    },
    clear() {
      if (!storage) return
      try {
        storage.removeItem(key)
      } catch {
        // 削除失敗は致命ではないため無視する
      }
    },
  }
}

// ブラウザ以外（Vitestのnode環境など）やアクセス不可の環境ではnullを返し、
// storeは「常に未保存・保存失敗」として安全に動く。
export function getDefaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
