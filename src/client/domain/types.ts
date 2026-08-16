/**
 * huluTable domain model: the table document shape persisted to IndexedDB.
 * Plain JSON-compatible data — no classes, no functions — so documents round
 * trip through structuredClone/JSON and immer drafts without ceremony.
 */

/** Stable column type ids. */
export type ColumnType =
  | 'text' | 'textarea'
  | 'number' | 'percent' | 'currency'
  | 'date' | 'time' | 'datetime'
  | 'select' | 'multiSelect' | 'checkbox'
  | 'email' | 'phone' | 'url'
  | 'rating' | 'progress'
  | 'createdAt' | 'updatedAt'

/** JSON-safe cell value. Dates stay ISO strings; createdAt/updatedAt are epoch ms. */
export type CellValue = string | number | boolean | string[] | null

/** One dropdown option: label is the stored value, color drives the chip/background. */
export interface SelectOption {
  id: string
  label: string
  /** Hex color like '#22c55e'; empty means no tint. */
  color: string
}

/** Cascading dropdown configuration (B列选项随 A 列联动). */
export interface LinkedSelect {
  /** 'map': explicit A→B option-id mapping; 'source': B options come from another column's values. */
  mode: 'map' | 'source'
  /** Column whose value filters/keys this column's options (mode 'source': allowed = that column's current distinct values). */
  sourceColumnId?: string
  /** mode 'map': source option id → allowed option ids of THIS column. */
  map?: Record<string, string[]>
  /** Whether a value outside the configured options may be typed. */
  allowCustom: boolean
}

/** Per-column input validation (标题栏配置管理). */
export interface ColumnValidation {
  kind: 'none' | 'phone' | 'email' | 'url' | 'number' | 'integer' | 'numberRange' | 'lengthRange' | 'regex'
  /** numberRange/lengthRange bounds (inclusive). */
  min?: number
  max?: number
  /** regex kind: the pattern source. */
  pattern?: string
}

/** Cell presentation format (bold/align/wrap). */
export interface CellFormat {
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
}

/** One column of a table. */
export interface Column {
  id: string
  name: string
  type: ColumnType
  width: number
  /** Frozen = pinned to the left of the scrollable region. */
  frozen: boolean
  hidden: boolean
  required: boolean
  /** Default applied to new rows. */
  default?: CellValue
  /** Helper text shown in the column menu. */
  description?: string
  /** select/multiSelect option list. */
  options?: SelectOption[]
  /** Cascading dropdown config (select/multiSelect). */
  linked?: LinkedSelect
  validation?: ColumnValidation
  format?: CellFormat
}

/** One cell: value plus optional formula (starts with '='). */
export interface Cell {
  value: CellValue
  formula?: string
}

/** One row: cells keyed by column id. */
export interface Row {
  id: string
  cells: Record<string, Cell>
  /** Row-local timestamps, maintained for createdAt/updatedAt columns. */
  createdAt?: number
  updatedAt?: number
}

/** Column filter operator set. */
export type FilterOp =
  | 'contains' | 'startsWith' | 'endsWith' | 'eq' | 'neq'
  | 'empty' | 'notEmpty'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'in'

export interface FilterRule {
  columnId: string
  op: FilterOp
  value?: CellValue
  value2?: CellValue
  /** 'in' selection (dropdown multi-pick), labels. */
  values?: string[]
}

export interface SortRule {
  columnId: string
  dir: 'asc' | 'desc'
}

/** Chart rendering configuration (chart views). */
export interface ChartConfig {
  type: 'line' | 'bar' | 'pie' | 'funnel'
  /** Chart title (optional). */
  title: string
  /** Category axis column (line/bar) or slice/segment column (pie/funnel). */
  xColumnId: string
  /** Value columns: line/bar render one series each; pie/funnel aggregate the first. */
  yColumnIds: string[]
  /** Canvas width in px. */
  width?: number
  /** Canvas height in px. */
  height?: number
  /** Canvas background: follow the theme or force light/dark. */
  background?: 'auto' | 'light' | 'dark'
}

/** A named combination of filter/sort/column visibility (+ group/calendar bindings). */
export interface View {
  id: string
  name: string
  kind: 'grid' | 'kanban' | 'calendar' | 'chart'
  filters: FilterRule[]
  /** AND across rules, or OR. */
  filterMode: 'and' | 'or'
  sorts: SortRule[]
  hiddenColumns: string[]
  /** kanban: the select column grouping lanes by option. */
  groupColumnId?: string
  /** calendar: the date/datetime column placing events. */
  calendarColumnId?: string
  /** chart: rendering configuration. */
  chart?: ChartConfig
}

/** Column-level goal with a progress bar (成交金额目标等). */
export interface Goal {
  id: string
  columnId: string
  label?: string
  aggregate: 'sum' | 'avg' | 'count'
  target: number
  /**
   * Optional row filter: only rows whose `condition.columnId` matches
   * `value` (op 'eq' exact, 'contains' fuzzy) count toward the goal.
   */
  condition?: { columnId: string; op: 'eq' | 'contains'; value: string } | undefined
}

/** Conditional-formatting rule: when a column matches, tint the row or column. */
export interface FormatRule {
  id: string
  name?: string
  columnId: string
  op: 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'empty' | 'notEmpty' | 'in'
  value?: CellValue
  value2?: CellValue
  values?: string[]
  scope: 'row' | 'column'
  bg?: string
  text?: string
  enabled: boolean
}

export interface CellComment {
  id: string
  text: string
  createdAt: number
}

/** Edit-history snapshot of one cell change (last 5 kept). */
export interface CellHistoryEntry {
  ts: number
  before: CellValue
  after: CellValue
}

/** History key: `${tableId}/${rowId}/${columnId}`. */
export type CellHistoryKey = string

/** The table document (one row of the `tables` object store). */
export interface TableDoc {
  id: string
  name: string
  templateId?: string
  tags: string[]
  starred: boolean
  createdAt: number
  updatedAt: number
  /** Set when the table sits in the recycle bin (30-day TTL). */
  deletedAt?: number
  columns: Column[]
  rows: Row[]
  views: View[]
  goals: Goal[]
  formatRules: FormatRule[]
  /** Cell comments keyed by `${rowId}:${columnId}`. */
  comments: Record<string, CellComment[]>
}

/** Library row: the lightweight projection shown in the table list. */
export interface LibraryRow {
  id: string
  name: string
  templateId?: string
  tags: string[]
  starred: boolean
  rowCount: number
  colCount: number
  createdAt: number
  updatedAt: number
  /** Present when the table sits in the recycle bin. */
  deletedAt?: number
}

/** Stable, collision-free id. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Cell comment key for one cell. */
export function commentKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`
}

/** History storage key for one cell. */
export function historyKey(tableId: string, rowId: string, columnId: string): string {
  return `${tableId}/${rowId}/${columnId}`
}

/** Default new column width. */
export const DEFAULT_COLUMN_WIDTH = 140

/** Column types that carry a plain text value. */
export const TEXT_LIKE: readonly ColumnType[] = ['text', 'textarea', 'email', 'phone', 'url']

/** Column types that carry a number. */
export const NUMBER_LIKE: readonly ColumnType[] = ['number', 'percent', 'currency', 'rating', 'progress']

/** Column types that carry a date-ish string. */
export const DATE_LIKE: readonly ColumnType[] = ['date', 'time', 'datetime']

/** Column types that carry options (dropdown). */
export const OPTION_LIKE: readonly ColumnType[] = ['select', 'multiSelect']

/** Column types that are auto-maintained timestamps. */
export const AUTO_TIME: readonly ColumnType[] = ['createdAt', 'updatedAt']

/** All selectable column types (auto-time columns are added explicitly in column settings). */
export const USER_COLUMN_TYPES: readonly ColumnType[] = [
  'text', 'textarea', 'number', 'percent', 'currency',
  'date', 'time', 'datetime', 'select', 'multiSelect', 'checkbox',
  'email', 'phone', 'url', 'rating', 'progress',
]

/** Recycle-bin TTL. */
export const RECYCLE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Whether a column type's value is a plain single string. */
export function isTextType(type: ColumnType): boolean {
  return TEXT_LIKE.includes(type) || type === 'date' || type === 'time' || type === 'datetime' || type === 'select'
}

/** Whether a column type's value is numeric. */
export function isNumericType(type: ColumnType): boolean {
  return NUMBER_LIKE.includes(type)
}

/** Coerce a raw input to the column type's stored shape; null when invalid. */
export function coerceCellValue(type: ColumnType, raw: string): CellValue | null {
  if (raw === '') return null
  if (type === 'checkbox') {
    const t = raw.trim().toLowerCase()
    if (['true', '1', '是', '√', 'yes', 'y'].includes(t)) return true
    if (['false', '0', '否', '×', 'no', 'n'].includes(t)) return false
    return null
  }
  if (isNumericType(type)) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (type === 'multiSelect') return raw
  return raw
}

/** Format a numeric value for display in percent/currency/rating/progress columns. */
export function formatNumber(type: ColumnType, value: number): string {
  switch (type) {
    case 'percent': return `${Math.round(value * 100)}%`
    case 'currency': return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
    case 'rating': return `${value}★`
    case 'progress': return `${Math.round(value)}%`
    default: return String(value)
  }
}
