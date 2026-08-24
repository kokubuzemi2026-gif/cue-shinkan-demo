import { describe, expect, it } from 'vitest'

import { isUniversityEmail, normalizeUniversityEmail } from './universityEmail'

// 判定表はsupabase/tests/02_domain_functions_test.sql（DB側）と同一に保つ
const ALLOWED_AFTER_NORMALIZE = [
  'a@stu.kobe-u.ac.jp',
  'A@STU.KOBE-U.AC.JP', // 大文字ドメインは正規化（toLowerCase）後に一致
  '  a@stu.kobe-u.ac.jp  ', // 前後空白は正規化（trim）後に一致
] as const

const REJECTED_AFTER_NORMALIZE = [
  's1234567+tag@stu.kobe-u.ac.jp', // plus addressing
  'a@x.stu.kobe-u.ac.jp', // サブドメイン
  'a@stukobe-u.ac.jp', // 類似ドメイン（ドット欠落）
  'a@stu.kobe-u.ac.jp.evil.com', // 後置ドメイン
  'a@kobe-u.ac.jp', // 別ドメイン（大学本体）
  'a@gmail.com', // 別ドメイン
  '', // 空
  'a@', // ドメイン無し
  '@stu.kobe-u.ac.jp', // ローカル部無し
  'nodomain', // @無し
  'a@b@stu.kobe-u.ac.jp', // @二重
  'a b@stu.kobe-u.ac.jp', // 内部空白（trimでは除去されない）
  'a\tb@stu.kobe-u.ac.jp', // 内部タブ
  'a\nb@stu.kobe-u.ac.jp', // 内部改行
] as const

describe('normalizeUniversityEmail', () => {
  it('前後の空白を除去し小文字化する', () => {
    expect(normalizeUniversityEmail('  A@STU.KOBE-U.AC.JP  ')).toBe('a@stu.kobe-u.ac.jp')
  })

  it('内部の空白は除去しない（正規化で不正メールを有効化しない）', () => {
    expect(normalizeUniversityEmail('a b@stu.kobe-u.ac.jp')).toBe('a b@stu.kobe-u.ac.jp')
  })

  it('plus addressingを書き換えない（判定側で拒否する）', () => {
    expect(normalizeUniversityEmail('s1234567+tag@stu.kobe-u.ac.jp')).toBe(
      's1234567+tag@stu.kobe-u.ac.jp',
    )
  })
})

describe('isUniversityEmail（正規化後の判定表）', () => {
  it.each(ALLOWED_AFTER_NORMALIZE)('許可: %j', (raw) => {
    expect(isUniversityEmail(normalizeUniversityEmail(raw))).toBe(true)
  })

  it.each(REJECTED_AFTER_NORMALIZE)('拒否: %j', (raw) => {
    expect(isUniversityEmail(normalizeUniversityEmail(raw))).toBe(false)
  })

  it('正規化を通さない大文字ドメインは判定しない前提（契約の確認）', () => {
    // 呼び出し側は必ずnormalizeUniversityEmailを通す契約。
    // 判定関数自体は大文字を許可しない（SQL側と同じく正規化が前段にある）
    expect(isUniversityEmail('A@STU.KOBE-U.AC.JP')).toBe(false)
  })
})
