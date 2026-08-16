/** Domain type helpers and display formatters. */
import { describe, expect, it } from 'vitest'
import {
  coerceCellValue, commentKey, formatNumber, historyKey, isNumericType, isTextType,
  newId, DEFAULT_COLUMN_WIDTH, USER_COLUMN_TYPES, RECYCLE_TTL_MS,
} from '../src/client/domain/types.ts'
import { formatRelative, templateIcon } from '../src/client/format.ts'

const t = ((key: string, params?: Record<string, unknown>) => {
  const text = key
  if (params === undefined) return text
  const v = params.n
  const suffix = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''
  return `${text}:${suffix}`
})

describe('coerceCellValue', () => {
  it('coerces by type and rejects invalid numerics', () => {
    expect(coerceCellValue('number', '42')).toBe(42)
    expect(coerceCellValue('number', 'abc')).toBeNull()
    expect(coerceCellValue('percent', '0.5')).toBe(0.5)
    expect(coerceCellValue('currency', '12.3')).toBe(12.3)
    expect(coerceCellValue('text', 'hi')).toBe('hi')
    expect(coerceCellValue('multiSelect', 'a,b')).toBe('a,b')
    expect(coerceCellValue('date', '2025-08-01')).toBe('2025-08-01')
  })

  it('coerces checkbox words', () => {
    expect(coerceCellValue('checkbox', '是')).toBe(true)
    expect(coerceCellValue('checkbox', 'no')).toBe(false)
    expect(coerceCellValue('checkbox', 'maybe')).toBeNull()
    expect(coerceCellValue('checkbox', '')).toBeNull()
  })
})

describe('type predicates', () => {
  it('classifies column types', () => {
    expect(isNumericType('number')).toBe(true)
    expect(isNumericType('currency')).toBe(true)
    expect(isNumericType('text')).toBe(false)
    expect(isTextType('select')).toBe(true)
    expect(isTextType('textarea')).toBe(true)
    expect(isTextType('number')).toBe(false)
  })
})

describe('formatNumber', () => {
  it('formats per type', () => {
    expect(formatNumber('percent', 0.25)).toBe('25%')
    expect(formatNumber('currency', 1234.5)).toContain('1,234.5')
    expect(formatNumber('rating', 4)).toBe('4★')
    expect(formatNumber('progress', 80)).toBe('80%')
    expect(formatNumber('number', 7)).toBe('7')
  })
})

describe('keys and ids', () => {
  it('builds stable keys and unique ids', () => {
    expect(commentKey('r1', 'c1')).toBe('r1:c1')
    expect(historyKey('t', 'r', 'c')).toBe('t/r/c')
    expect(newId()).not.toBe(newId())
    expect(DEFAULT_COLUMN_WIDTH).toBe(140)
    expect(USER_COLUMN_TYPES).toContain('select')
    expect(RECYCLE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})

describe('formatRelative', () => {
  it('renders relative buckets and falls back to dates', () => {
    const now = Date.now()
    expect(formatRelative(now, t)).toBe('time.just')
    expect(formatRelative(now - 60_000 * 5, t)).toBe('time.minutes:5')
    expect(formatRelative(now - 3_600_000 * 2, t)).toBe('time.hours:2')
    expect(formatRelative(now - 86_400_000 * 3, t)).toBe('time.days:3')
    const old = formatRelative(now - 86_400_000 * 20, t)
    expect(old).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('templateIcon', () => {
  it('maps template ids to glyphs', () => {
    expect(templateIcon('crm')).toBe('👥')
    expect(templateIcon('project')).toBe('📋')
    expect(templateIcon('finance')).toBe('💰')
    expect(templateIcon('attendance')).toBe('⏰')
    expect(templateIcon('todo')).toBe('✅')
    expect(templateIcon('inventory')).toBe('📦')
    expect(templateIcon('unknown')).toBe('📄')
    expect(templateIcon(undefined)).toBe('📄')
  })
})
