/**
 * Cell input validation: required-ness, column-type shape, and the per-column
 * format validators (phone/email/url/number/length/custom regex). Pure
 * functions — the store and the editor both use them, and tests cover the
 * table-driven matrix here.
 */
import type { CellValue, Column } from './types.ts'

/** Return the first validation error for a cell value, or null when acceptable. */
export function validateCell(
  column: Column,
  value: CellValue,
): string | null {
  if (value === null || value === '') {
    return column.required ? 'required' : null
  }
  if (typeof value === 'boolean') return null
  const text = String(value)
  const v = column.validation ?? { kind: 'none' }
  switch (v.kind) {
    case 'none': return null
    case 'phone': return /^1[3-9]\d{9}$/.test(text) ? null : 'phone'
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? null : 'email'
    case 'url': return /^https?:\/\/\S+$/i.test(text) || /^www\.\S+$/i.test(text) ? null : 'url'
    case 'number': return Number.isFinite(Number(text)) ? null : 'number'
    case 'integer': return /^-?\d+$/.test(text) ? null : 'integer'
    case 'numberRange': {
      const n = Number(text)
      if (!Number.isFinite(n)) return 'number'
      if (v.min !== undefined && n < v.min) return 'min'
      if (v.max !== undefined && n > v.max) return 'max'
      return null
    }
    case 'lengthRange': {
      if (v.min !== undefined && text.length < v.min) return 'min'
      if (v.max !== undefined && text.length > v.max) return 'max'
      return null
    }
    case 'regex': {
      if (v.pattern === undefined || v.pattern === '') return null
      try {
        return new RegExp(v.pattern).test(text) ? null : 'regex'
      } catch {
        return null
      }
    }
  }
}

/** Whether a raw input is acceptable for a column's type shape (pre-save). */
export function typeCheck(type: Column['type'], raw: string): boolean {
  if (raw === '') return true
  switch (type) {
    case 'checkbox': return ['true', 'false', '1', '0', '是', '否', '√', '×', 'yes', 'no', 'y', 'n'].includes(raw.trim().toLowerCase())
    case 'number':
    case 'percent':
    case 'currency':
    case 'rating':
    case 'progress': return Number.isFinite(Number(raw))
    default: return true
  }
}
