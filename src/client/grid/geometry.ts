/**
 * Grid geometry and value presentation: pure helpers for the virtualized
 * grid. Column offsets are prefix sums over widths; the visible window
 * derives from scroll positions; cell display text/colors follow column
 * types. Everything here is O(visible) — hot-path safe at 10k+ rows.
 */
import {
  DEFAULT_COLUMN_WIDTH, formatNumber, isNumericType, type Cell, type Column, type TableDoc,
} from '../domain/types.ts'

/** Row height in px (uniform in v1). */
export const ROW_HEIGHT = 32

/** Header title-row height in px. */
export const HEADER_HEIGHT = 32

/** Column-letter row height in px (A/B/C… above the title row, like Excel). */
export const LETTER_ROW_HEIGHT = 20

/** Total sticky header height (letter row + title row). */
export const TOTAL_HEADER_HEIGHT = LETTER_ROW_HEIGHT + HEADER_HEIGHT

/** Row-number gutter width in px. */
export const ROW_HEADER_WIDTH = 46

/** Rows/cols rendered beyond the viewport edges (scroll seam coverage). */
export const OVERSCAN = 4

/** Blank rows always rendered below the data (excel-style infinite canvas). */
export const MIN_GRID_ROWS = 60

/** Blank columns always rendered right of the data. */
export const MIN_GRID_COLS = 12

/**
 * A virtual blank column occupying the right-hand empty grid area. Rendered
 * cells are empty; clicking one creates a real column in place. The id keeps
 * a stable prefix so {@link isBlankColumn} recognizes it.
 */
export function blankColumn(index: number): Column {
  return {
    id: `__blank:${index}`,
    name: '',
    type: 'text',
    width: DEFAULT_COLUMN_WIDTH,
    frozen: false,
    hidden: false,
    required: false,
  }
}

/** Whether a column is a virtual blank filler column. */
export function isBlankColumn(column: Column): boolean {
  return column.id.startsWith('__blank:')
}

/** Prefix sums of column widths: offsets[i] is the left edge of column i. */
export function columnOffsets(columns: readonly Column[]): { offsets: number[]; total: number } {
  const offsets: number[] = []
  let total = 0
  for (const column of columns) {
    offsets.push(total)
    total += column.width
  }
  return { offsets, total }
}

/** Width of the frozen strip (row-number gutter + frozen columns). */
export function frozenWidth(columns: readonly Column[]): number {
  let width = ROW_HEADER_WIDTH
  for (const column of columns) {
    if (column.frozen) width += column.width
  }
  return width
}

/** Visible row index range for a scroll offset. */
export function visibleRowRange(scrollTop: number, viewportHeight: number, rowCount: number): { start: number; end: number } {
  const bodyTop = Math.max(0, scrollTop - HEADER_HEIGHT)
  const start = Math.max(0, Math.floor(bodyTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(rowCount, Math.ceil((bodyTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
  return { start, end }
}

/** Visible column index range (excluding frozen columns, which always render).
 * Scroll coordinates are relative to the canvas origin, whose first
 * ROW_HEADER_WIDTH pixels are the row-number gutter. */
export function visibleColumnRange(
  scrollLeft: number,
  viewportWidth: number,
  columns: readonly Column[],
  offsets: readonly number[],
): { start: number; end: number } {
  const frozen = columns.reduce((n, c) => n + (c.frozen ? 1 : 0), 0)
  let start = frozen
  let column = columns[start]
  // Skip columns scrolled out of view; offsets may trail the column list in
  // defensive callers, hence the ?? 0 for the offset arm.
  while (column !== undefined && ROW_HEADER_WIDTH + (offsets[start] ?? 0) + column.width < scrollLeft) {
    start += 1
    column = columns[start]
  }
  let end = start
  while (end < columns.length && ROW_HEADER_WIDTH + (offsets[end] ?? 0) < scrollLeft + viewportWidth) end += 1
  start = Math.max(frozen, start - OVERSCAN)
  end = Math.min(columns.length, end + OVERSCAN)
  return { start, end }
}

/** Display text for a cell (formulas resolve through the caller's cache). */
export function cellText(column: Column, value: Cell['value']): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? '✓' : ''
  if (typeof value === 'number' && isNumericType(column.type)) return formatNumber(column.type, value)
  return String(value)
}

/** Chip background for a dropdown option label, or ''. */
export function optionColor(column: Column, label: Cell['value']): string {
  if (column.options === undefined || typeof label !== 'string') return ''
  return column.options.find(o => o.label === label)?.color ?? ''
}

/** Numeric stats over a selection's cells (status bar). */
export interface SelectionStats {
  sum: number
  avg: number
  max: number
  min: number
  count: number
  numericCount: number
}

/** Aggregate numeric values in a rectangular selection. */
export function selectionStats(
  table: TableDoc,
  r0: number,
  r1: number,
  c0: number,
  c1: number,
): SelectionStats | null {
  let sum = 0
  let max = -Infinity
  let min = Infinity
  let numericCount = 0
  let total = 0
  // slice() bounds the row window without ever yielding undefined rows.
  for (const row of table.rows.slice(r0, r1 + 1)) {
    for (let c = c0; c <= c1 && c < table.columns.length; c += 1) {
      const column = table.columns[c]
      if (column === undefined || !isNumericType(column.type)) continue
      const value = row.cells[column.id]?.value
      if (typeof value !== 'number') continue
      sum += value
      max = Math.max(max, value)
      min = Math.min(min, value)
      numericCount += 1
      total += 1
    }
  }
  if (numericCount === 0) return null
  return {
    sum, avg: sum / numericCount, max, min,
    count: total, numericCount,
  }
}
