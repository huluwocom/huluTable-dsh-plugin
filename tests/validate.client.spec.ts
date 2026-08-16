/** Cell validation matrix: required, type shape, format validators. */
import { describe, expect, it } from 'vitest'
import { validateCell, typeCheck } from '../src/client/domain/validate.ts'
import type { Column } from '../src/client/domain/types.ts'

function col(overrides: Partial<Column>): Column {
  return { id: 'c', name: 'C', type: 'text', width: 100, frozen: false, hidden: false, required: false, ...overrides }
}

describe('validateCell', () => {
  it('accepts empty when not required and rejects empty when required', () => {
    expect(validateCell(col({}), null)).toBeNull()
    expect(validateCell(col({ required: true }), null)).toBe('required')
    expect(validateCell(col({ required: true }), '')).toBe('required')
  })

  it('validates phone', () => {
    expect(validateCell(col({ validation: { kind: 'phone' } }), '13812345678')).toBeNull()
    expect(validateCell(col({ validation: { kind: 'phone' } }), '12345')).toBe('phone')
  })

  it('validates email', () => {
    expect(validateCell(col({ validation: { kind: 'email' } }), 'a@b.com')).toBeNull()
    expect(validateCell(col({ validation: { kind: 'email' } }), 'not-an-email')).toBe('email')
  })

  it('validates url', () => {
    expect(validateCell(col({ validation: { kind: 'url' } }), 'https://example.com')).toBeNull()
    expect(validateCell(col({ validation: { kind: 'url' } }), 'hello')).toBe('url')
  })

  it('validates number and integer', () => {
    expect(validateCell(col({ validation: { kind: 'number' } }), '12.5')).toBeNull()
    expect(validateCell(col({ validation: { kind: 'number' } }), 'abc')).toBe('number')
    expect(validateCell(col({ validation: { kind: 'integer' } }), '42')).toBeNull()
    expect(validateCell(col({ validation: { kind: 'integer' } }), '4.2')).toBe('integer')
  })

  it('validates ranges', () => {
    const v = col({ validation: { kind: 'numberRange', min: 0, max: 100 } })
    expect(validateCell(v, '50')).toBeNull()
    expect(validateCell(v, '-1')).toBe('min')
    expect(validateCell(v, '101')).toBe('max')
    const len = col({ validation: { kind: 'lengthRange', min: 2, max: 4 } })
    expect(validateCell(len, 'ab')).toBeNull()
    expect(validateCell(len, 'a')).toBe('min')
    expect(validateCell(len, 'abcde')).toBe('max')
  })

  it('validates custom regex and tolerates broken patterns', () => {
    const v = col({ validation: { kind: 'regex', pattern: '^[A-Z]{2}\\d{3}$' } })
    expect(validateCell(v, 'AB123')).toBeNull()
    expect(validateCell(v, 'abc')).toBe('regex')
    const broken = col({ validation: { kind: 'regex', pattern: '(' } })
    expect(validateCell(broken, 'anything')).toBeNull()
  })
})

describe('typeCheck', () => {
  it('rejects non-numeric input for numeric types', () => {
    expect(typeCheck('number', '12')).toBe(true)
    expect(typeCheck('number', 'abc')).toBe(false)
    expect(typeCheck('percent', '0.5')).toBe(true)
    expect(typeCheck('currency', '12.34')).toBe(true)
  })

  it('accepts checkbox words and rejects others', () => {
    expect(typeCheck('checkbox', '是')).toBe(true)
    expect(typeCheck('checkbox', 'no')).toBe(true)
    expect(typeCheck('checkbox', 'maybe')).toBe(false)
  })

  it('accepts anything for text types', () => {
    expect(typeCheck('text', 'anything')).toBe(true)
    expect(typeCheck('date', '2025-08-01')).toBe(true)
  })

  it('accepts empty raw input for any type', () => {
    expect(typeCheck('number', '')).toBe(true)
    expect(typeCheck('checkbox', '')).toBe(true)
  })

  it('skips validators for boolean values', () => {
    expect(validateCell(col({ required: true }), true)).toBeNull()
  })

  it('rejects non-numeric text in number ranges', () => {
    const v = col({ validation: { kind: 'numberRange', min: 0, max: 100 } })
    expect(validateCell(v, 'abc')).toBe('number')
  })

  it('treats a regex validation without a pattern as valid', () => {
    expect(validateCell(col({ validation: { kind: 'regex' } }), 'anything')).toBeNull()
    expect(validateCell(col({ validation: { kind: 'regex', pattern: '' } }), 'anything')).toBeNull()
  })
})
