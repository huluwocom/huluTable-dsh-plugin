/**
 * Editor operations: pure builders that turn user gestures into delta batches
 * (plus cell-history changes). No store access — the controller applies them.
 * The fill algorithm infers series (numeric deltas, date +1 day, numeric text
 * suffixes) from seed values, falling back to copy.
 */
import type { EditDelta } from './editlog.ts'
import {
  coerceCellValue, newId, type Cell, type Column,
  type ColumnType, type Row, type TableDoc,
} from './types.ts'
import { validateCell } from './validate.ts'

/** One user edit result: deltas plus history changes (and an optional error). */
export interface EditResult {
  deltas: EditDelta[]
  changes: { rowId: string; columnId: string; before: Cell['value']; after: Cell['value'] }[]
  error: string | null
}

/** Next default column name ("字段 1", "字段 2", ...). */
export function nextColumnName(columns: readonly Column[]): string {
  let n = 1
  const taken = new Set(columns.map(c => c.name))
  while (taken.has(`字段 ${n}`)) n += 1
  return `字段 ${n}`
}

/**
 * Number of leading frozen columns. The grid renders the frozen strip as a
 * prefix of the columns array, so this invariant must survive every reorder
 * and freeze/unfreeze edit: the first `k` columns are frozen, the rest are
 * not. Without it, the scroll zone re-renders frozen columns a second time
 * (a "double column" with a duplicated letter).
 */
export function leadingFrozenCount(table: TableDoc): number {
  let n = 0
  while (n < table.columns.length && table.columns[n]?.frozen === true) n += 1
  return n
}

function cellOf(row: Row, columnId: string): Cell {
  return row.cells[columnId] ?? { value: null }
}

/** Build a single-cell edit from raw text (type coercion + validation). */
export function buildCellEdit(
  table: TableDoc,
  rowId: string,
  columnId: string,
  raw: string,
): EditResult {
  const column = table.columns.find(c => c.id === columnId)
  const row = table.rows.find(r => r.id === rowId)
  if (column === undefined || row === undefined) return { deltas: [], changes: [], error: 'missing' }
  const before = cellOf(row, columnId)
  const value = coerceCellValue(column.type, raw)
  if (value === null && raw !== '') return { deltas: [], changes: [], error: 'type' }
  const validationError = validateCell(column, value)
  if (validationError !== null) return { deltas: [], changes: [], error: validationError }
  if (before.value === value) return { deltas: [], changes: [], error: null }
  const after: Cell = { value }
  return {
    deltas: [{ kind: 'cell', rowId, columnId, before, after }],
    changes: [{ rowId, columnId, before: before.value, after: value }],
    error: null,
  }
}

/** Build a single-cell edit for an already-typed value (dropdown click etc.). */
export function buildSetValue(
  table: TableDoc,
  rowId: string,
  columnId: string,
  value: Cell['value'],
): EditResult {
  const column = table.columns.find(c => c.id === columnId)
  const row = table.rows.find(r => r.id === rowId)
  if (column === undefined || row === undefined) return { deltas: [], changes: [], error: 'missing' }
  const before = cellOf(row, columnId)
  if (before.value === value) return { deltas: [], changes: [], error: null }
  const after: Cell = { value }
  return {
    deltas: [{ kind: 'cell', rowId, columnId, before, after }],
    changes: [{ rowId, columnId, before: before.value, after: value }],
    error: null,
  }
}

/** Build an add-rows edit. New rows carry timestamps; createdAt columns fill now. */
export function buildAddRows(table: TableDoc, index: number, count: number): EditResult {
  const now = Date.now()
  const rows: Row[] = []
  for (let i = 0; i < count; i += 1) {
    const row: Row = { id: newId(), cells: {}, createdAt: now, updatedAt: now }
    for (const column of table.columns) {
      if (column.type === 'createdAt') row.cells[column.id] = { value: now }
      else if (column.default !== undefined && column.default !== null) row.cells[column.id] = { value: column.default }
    }
    rows.push(row)
  }
  return {
    deltas: [{ kind: 'rowAdd', index: Math.min(index, table.rows.length), rows }],
    changes: [],
    error: null,
  }
}

/** Build a remove-rows edit (row objects captured for undo). */
export function buildRemoveRows(table: TableDoc, indexes: readonly number[]): EditResult {
  const sorted = [...indexes].sort((a, b) => a - b)
  const deltas: EditDelta[] = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const index = sorted[i]
    if (index === undefined || index < 0 || index >= table.rows.length) continue
    const rows = table.rows.slice(index, index + 1)
    deltas.push({ kind: 'rowRemove', index, rows })
  }
  return { deltas, changes: [], error: null }
}

/** Build an add-column edit at a position (cells stay empty; undo is symmetric). */
export function buildAddColumn(
  table: TableDoc,
  index: number,
  type: ColumnType = 'text',
  name?: string,
): EditResult {
  const at = Math.min(index, table.columns.length)
  // A column inserted into the leading frozen block joins the frozen pane
  // (positional freezing, like Excel) so the block stays a prefix.
  const frozen = at <= leadingFrozenCount(table)
  const column: Column = {
    id: newId(),
    name: name ?? nextColumnName(table.columns),
    type,
    width: 140,
    frozen,
    hidden: false,
    required: false,
  }
  return {
    deltas: [{ kind: 'columnAdd', index: at, column }],
    changes: [],
    error: null,
  }
}

/** Build a remove-column edit: captures the column plus every cell to undo. */
export function buildRemoveColumn(table: TableDoc, index: number): EditResult {
  const column = table.columns[index]
  if (column === undefined) return { deltas: [], changes: [], error: 'missing' }
  const cells = table.rows
    .filter(row => row.cells[column.id] !== undefined)
    .map(row => ({ rowId: row.id, cell: row.cells[column.id] as Cell }))
  return {
    deltas: [{ kind: 'columnRemove', index, column, cells }],
    changes: [],
    error: null,
  }
}

/** Build a column-update edit (rename, type change, options, validation...). */
export function buildUpdateColumn(
  table: TableDoc,
  columnId: string,
  patch: { [K in keyof Column]?: Column[K] | undefined },
): EditResult {
  const column = table.columns.find(c => c.id === columnId)
  if (column === undefined) return { deltas: [], changes: [], error: 'missing' }
  const before = { ...column }
  const after = { ...column, ...patch } as Column
  // A cleared field is a deleted key (exactOptionalPropertyTypes).
  for (const key of Object.keys(after) as (keyof Column)[]) {
    if (after[key] === undefined) Reflect.deleteProperty(after, key)
  }
  // Frozen columns must form the leading block: freezing a later column
  // pulls it into the block, unfreezing a leading one pushes it just out.
  const deltas: EditDelta[] = []
  const k = leadingFrozenCount(table)
  const index = table.columns.findIndex(c => c.id === columnId)
  if (patch.frozen === true && !column.frozen && index > k) {
    deltas.push({ kind: 'columnMove', columnId, from: index, to: k })
  } else if (patch.frozen === false && column.frozen && index < k && index !== k - 1) {
    deltas.push({ kind: 'columnMove', columnId, from: index, to: k - 1 })
  }
  deltas.push({ kind: 'columnUpdate', columnId, before, after })
  return { deltas, changes: [], error: null }
}

/** Build a move-column edit (reorders the columns array). */
export function buildMoveColumn(table: TableDoc, columnId: string, to: number): EditResult {
  const from = table.columns.findIndex(c => c.id === columnId)
  if (from < 0) return { deltas: [], changes: [], error: 'missing' }
  const clamped = Math.max(0, Math.min(to, table.columns.length - 1))
  if (from === clamped) return { deltas: [], changes: [], error: null }
  // Keep the frozen block a prefix: after the move, exactly the first
  // `k` columns are frozen (k = the leading frozen count before the move).
  const k = leadingFrozenCount(table)
  const after = [...table.columns]
  const [moved] = after.splice(from, 1)
  /* v8 ignore next -- from < columns.length always yields the moved column. */
  if (moved !== undefined) after.splice(clamped, 0, moved)
  const deltas: EditDelta[] = [{ kind: 'columnMove', columnId, from, to: clamped }]
  for (let i = 0; i < after.length; i += 1) {
    const c = after[i]
    /* v8 ignore next -- the loop is bounded by the array length. */
    if (c === undefined) continue
    const shouldFreeze = i < k
    if (c.frozen !== shouldFreeze) {
      deltas.push({
        kind: 'columnUpdate',
        columnId: c.id,
        before: { ...c },
        after: { ...c, frozen: shouldFreeze },
      })
    }
  }
  return { deltas, changes: [], error: null }
}

/** One fill cell: Excel-style extrapolation from the anchor's last value. */
function fillCellValue(
  seeds: Cell['value'][],
  last: Cell['value'],
  offset: number,
  mode: 'copy' | 'series',
): Cell['value'] {
  if (mode === 'copy' || seeds.length === 0) return last
  if (typeof last === 'number') {
    const step = inferNumericStep(seeds)
    return last + (step === 0 ? 1 : step) * offset
  }
  if (typeof last === 'string') {
    const date = parseDate(last)
    if (date !== null) return formatDate(new Date(date.getTime() + offset * 86_400_000))
    const suffix = /^(.*?)(\d+)$/.exec(last)
    if (suffix !== null) {
      const step = inferNumericStep(seeds.map(v => (typeof v === 'string' ? Number(suffix2num(v)) : 0)))
      const num = Number(suffix[2]) + (step === 0 ? 1 : step) * offset
      return `${suffix[1]}${num}`
    }
  }
  return last
}

/** Infer the constant step across seed values (0 when not inferable). */
function inferNumericStep(seeds: Cell['value'][]): number {
  const nums = seeds.map(v => (typeof v === 'number' ? v : Number(v))).filter(Number.isFinite)
  /* v8 ignore next -- with >= 2 numbers both indexes exist. */
  if (nums.length >= 2) return (nums[nums.length - 1] ?? 0) - (nums[0] ?? 0)
  /* v8 ignore next -- a non-empty seed list always yields >= 1 number, so the zero arm is unreachable. */
  return nums.length === 1 ? 1 : 0
}

function suffix2num(value: string): string {
  return /^(.*?)(\d+)$/.exec(value)?.[2] ?? ''
}

/** Parse 'YYYY-MM-DD' (and 'YYYY/MM/DD') into a Date, or null. */
export function parseDate(text: string): Date | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text.trim())
  if (match === null) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  /* v8 ignore next -- numeric Date construction rolls over instead of producing NaN. */
  return Number.isNaN(date.getTime()) ? null : date
}

/** Format a Date as YYYY-MM-DD. */
export function formatDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

/** Build a fill edit extending the anchor rectangle down and/or right. */
export function buildFill(
  table: TableDoc,
  anchor: { r0: number; r1: number; c0: number; c1: number },
  target: { r0: number; r1: number; c0: number; c1: number },
  mode: 'copy' | 'series',
  columns: readonly Column[] = table.columns,
): EditResult {
  const deltas: EditDelta[] = []
  const changes: { rowId: string; columnId: string; before: Cell['value']; after: Cell['value'] }[] = []
  const rowsEnd = Math.max(target.r1, anchor.r1)
  const colsEnd = Math.max(target.c1, anchor.c1)
  for (let r = anchor.r0; r <= rowsEnd; r += 1) {
    for (let c = anchor.c0; c <= colsEnd; c += 1) {
      // Inside the anchor rectangle: nothing to fill.
      if (r <= anchor.r1 && c <= anchor.c1) continue
      const row = table.rows[r]
      const column = columns[c]
      if (row === undefined || column === undefined) continue
      // Seeds = the anchor's values in this column; last = the anchor's
      // bottom value; offset counts rows/cols beyond the anchor edge.
      const seeds: Cell['value'][] = []
      for (let ar = anchor.r0; ar <= anchor.r1; ar += 1) {
        const sourceRow = table.rows[ar]
        if (sourceRow !== undefined) seeds.push(cellOf(sourceRow, column.id).value)
      }
      const bottomRow = table.rows[anchor.r1]
      const last = bottomRow === undefined ? null : cellOf(bottomRow, column.id).value
      const offset = (r - anchor.r1) + (c - anchor.c1)
      const before = cellOf(row, column.id)
      const value = fillCellValue(seeds, last, offset, mode)
      if (before.value === value) continue
      deltas.push({ kind: 'cell', rowId: row.id, columnId: column.id, before, after: { value } })
      changes.push({ rowId: row.id, columnId: column.id, before: before.value, after: value })
    }
  }
  return { deltas, changes, error: null }
}

/** Build a paste edit: grid values starting at an anchor row over display columns. */
export function buildPaste(
  table: TableDoc,
  anchorRow: number,
  columns: readonly Column[],
  grid: string[][],
): EditResult {
  const deltas: EditDelta[] = []
  const changes: { rowId: string; columnId: string; before: Cell['value']; after: Cell['value'] }[] = []
  let error: string | null = null
  grid.forEach((rowValues, dr) => {
    const row = table.rows[anchorRow + dr]
    if (row === undefined) return
    rowValues.forEach((raw, dc) => {
      const column = columns[dc]
      if (column === undefined) return
      const value = coerceCellValue(column.type, raw)
      if (value === null && raw !== '') {
        error = error ?? 'paste'
        return
      }
      const before = cellOf(row, column.id)
      const after: Cell = { value }
      if (before.value === value) return
      deltas.push({ kind: 'cell', rowId: row.id, columnId: column.id, before, after })
      changes.push({ rowId: row.id, columnId: column.id, before: before.value, after: value })
    })
  })
  return { deltas, changes, error }
}

/** Build a clear-cells edit over row/column ranges (column list = display columns). */
export function buildClear(
  table: TableDoc,
  r0: number,
  r1: number,
  columns: readonly Column[],
): EditResult {
  const deltas: EditDelta[] = []
  const changes: { rowId: string; columnId: string; before: Cell['value']; after: Cell['value'] }[] = []
  for (let r = r0; r <= r1; r += 1) {
    const row = table.rows[r]
    if (row === undefined) continue
    for (const column of columns) {
      const before = cellOf(row, column.id)
      if (before.value === null) continue
      deltas.push({ kind: 'cell', rowId: row.id, columnId: column.id, before, after: { value: null } })
      changes.push({ rowId: row.id, columnId: column.id, before: before.value, after: null })
    }
  }
  return { deltas, changes, error: null }
}

