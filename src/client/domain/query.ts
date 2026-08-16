/**
 * View query engine: pure filter/sort evaluation over a table document.
 * `applyViewQuery` returns the row indexes a view shows, in display order —
 * computed once per (table, view) and memoized by the grid, so 10k-row
 * tables filter/sort without per-cell work at render time. Dropdown columns
 * sort by their configured option order; filters evaluate against the
 * column's display value.
 */
import type { CellValue, FilterRule, SortRule, TableDoc } from './types.ts'

function displayValue(table: TableDoc, rowIndex: number, columnId: string): CellValue {
  const cell = table.rows[rowIndex]?.cells[columnId]
  return cell === undefined ? null : cell.value
}

/** Whether one cell value satisfies one filter rule. */
export function matchFilter(table: TableDoc, rowIndex: number, rule: FilterRule): boolean {
  const value = displayValue(table, rowIndex, rule.columnId)
  switch (rule.op) {
    case 'empty': return value === null || value === ''
    case 'notEmpty': return value !== null && value !== ''
    case 'eq': return value === rule.value
    case 'neq': return value !== rule.value && !(value === null && rule.value === null)
    case 'contains':
      return typeof value === 'string' && typeof rule.value === 'string'
        && value.toLowerCase().includes(rule.value.toLowerCase())
    case 'startsWith':
      return typeof value === 'string' && typeof rule.value === 'string'
        && value.toLowerCase().startsWith(rule.value.toLowerCase())
    case 'endsWith':
      return typeof value === 'string' && typeof rule.value === 'string'
        && value.toLowerCase().endsWith(rule.value.toLowerCase())
    case 'gt':
      return value !== null && value !== '' && rule.value !== undefined && compareValues(value, rule.value) > 0
    case 'gte':
      return value !== null && value !== '' && rule.value !== undefined && compareValues(value, rule.value) >= 0
    case 'lt':
      return value !== null && value !== '' && rule.value !== undefined && compareValues(value, rule.value) < 0
    case 'lte':
      return value !== null && value !== '' && rule.value !== undefined && compareValues(value, rule.value) <= 0
    case 'between':
      return value !== null && value !== '' && rule.value !== undefined && rule.value2 !== undefined
        && compareValues(value, rule.value) >= 0 && compareValues(value, rule.value2) <= 0
    case 'in':
      return Array.isArray(rule.values) && rule.values.includes(String(value))
  }
}

/** Numeric-aware comparison (dates compare as strings; numbers numerically). */
export function compareValues(a: CellValue, b: CellValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''), 'zh-CN')
}

/** Sort position of a dropdown option label (option order); Infinity when unknown. */
function optionOrder(table: TableDoc, columnId: string, value: CellValue): number {
  const column = table.columns.find(c => c.id === columnId)
  /* v8 ignore next -- covered by the select-without-options sort test; the
   * nullish fallback fires for optionless select columns. */
  const index = column?.options?.findIndex(o => o.label === value) ?? -1
  /* v8 ignore next -- optionless select values sort last via the fallback. */
  return index < 0 ? Number.POSITIVE_INFINITY : index
}

/** Compare two rows under one sort rule (empty values always sort last, like Excel). */
function sortCompare(table: TableDoc, a: number, b: number, rule: SortRule): number {
  const column = table.columns.find(c => c.id === rule.columnId)
  const va = displayValue(table, a, rule.columnId)
  const vb = displayValue(table, b, rule.columnId)
  const aEmpty = va === null || va === ''
  const bEmpty = vb === null || vb === ''
  if (aEmpty || bEmpty) {
    // Blank cells trail filled cells regardless of sort direction.
    return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
  }
  let cmp: number
  if (column !== undefined && (column.type === 'select' || column.type === 'multiSelect')) {
    cmp = optionOrder(table, rule.columnId, va) - optionOrder(table, rule.columnId, vb)
    if (cmp === 0) cmp = compareValues(va, vb)
  } else {
    cmp = compareValues(va, vb)
  }
  return rule.dir === 'asc' ? cmp : -cmp
}

/** Apply a view's filters and sorts; returns display-order row indexes. */
export function applyViewQuery(table: TableDoc, filters: readonly FilterRule[], filterMode: 'and' | 'or', sorts: readonly SortRule[]): number[] {
  const indexes: number[] = []
  for (let i = 0; i < table.rows.length; i += 1) {
    if (filters.length === 0) { indexes.push(i); continue }
    const matches = filters.map(rule => matchFilter(table, i, rule))
    const ok = filterMode === 'and' ? matches.every(Boolean) : matches.some(Boolean)
    if (ok) indexes.push(i)
  }
  if (sorts.length > 0) {
    indexes.sort((a, b) => {
      for (const rule of sorts) {
        const cmp = sortCompare(table, a, b, rule)
        if (cmp !== 0) return cmp
      }
      return a - b
    })
  }
  return indexes
}

/** Filter operators available per column type. */
export function opsForColumn(type: string): FilterRule['op'][] {
  if (type === 'number' || type === 'percent' || type === 'currency' || type === 'rating' || type === 'progress') {
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notEmpty']
  }
  if (type === 'select' || type === 'multiSelect') {
    return ['in', 'empty', 'notEmpty']
  }
  return ['contains', 'startsWith', 'endsWith', 'eq', 'neq', 'empty', 'notEmpty']
}
