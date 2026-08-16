/**
 * Excel I/O: table → xlsx/csv export (browser download) and xlsx/csv →
 * parsed-grid import with column type inference. SheetJS does the heavy
 * lifting; the exported sheet keeps the column order and dropdown labels.
 */
import * as XLSX from 'xlsx/xlsx.mjs'
import type { CellValue, Column, ColumnType, Row, TableDoc } from '../domain/types.ts'

/** Serialize a row's cell values into export strings. */
export function rowToStrings(table: TableDoc, row: Row): string[] {
  return table.columns.map((column) => {
    const value = row.cells[column.id]?.value
    if (value === null || value === undefined) return ''
    if (typeof value === 'boolean') return value ? '是' : '否'
    if (Array.isArray(value)) return value.join('、')
    return String(value)
  })
}

/** Build the export grid (headers + rows) for a table and row subset. */
export function buildExportGrid(table: TableDoc, rowIndexes?: readonly number[]): string[][] {
  const grid: string[][] = [table.columns.map(c => c.name)]
  const indexes = rowIndexes ?? table.rows.map((_, i) => i)
  for (const i of indexes) {
    const row = table.rows[i]
    if (row !== undefined) grid.push(rowToStrings(table, row))
  }
  return grid
}

/** Trigger a browser download. */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  downloadBlob(filename, blob)
}

/** Trigger a browser download from a Blob. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 2000)
}

/** Serialize a table to an .xlsx ArrayBuffer. */
export function toXlsx(doc: TableDoc, rowIndexes?: readonly number[]): ArrayBuffer {
  const grid = buildExportGrid(doc, rowIndexes)
  const worksheet = XLSX.utils.aoa_to_sheet(grid)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, doc.name.slice(0, 31) || 'Sheet1')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** Serialize a table to CSV text. */
export function toCsv(doc: TableDoc, rowIndexes?: readonly number[]): string {
  const grid = buildExportGrid(doc, rowIndexes)
  const worksheet = XLSX.utils.aoa_to_sheet(grid)
  return XLSX.utils.sheet_to_csv(worksheet)
}

/** One parsed import: headers plus raw string rows. */
export interface ParsedImport {
  headers: string[]
  rows: string[][]
}

/** Parse an xlsx/csv ArrayBuffer into headers + raw rows. */
export function parseImport(data: ArrayBuffer, fileName: string): ParsedImport {
  const workbook = XLSX.read(data, { type: 'array' })
  /* v8 ignore next -- SheetJS always produces at least one sheet from readable input. */
  const sheetName = workbook.SheetNames[0] ?? ''
  /* v8 ignore next -- the sheet lookup above always hits. */
  const worksheet = workbook.Sheets[sheetName] ?? XLSX.utils.aoa_to_sheet([])
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' })
  const raw = aoa.map(line => line.map((v) => {
    /* v8 ignore next -- defval '' means SheetJS never yields nullish cells here. */
    if (v === null || v === undefined) return ''
    /* v8 ignore next -- without cellDates, SheetJS parses cells as string/number/boolean primitives only. */
    if (typeof v === 'object') return JSON.stringify(v)
    /* v8 ignore next -- SheetJS cell values are never bigint/symbol/function. */
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return ''
    return String(v)
  }))
  const headers = raw[0]?.map((h, i) => h.trim() === '' ? `列 ${i + 1}` : h.trim()) ?? []
  const rows = raw.slice(1).filter(line => line.some(v => v !== ''))
  void fileName
  return { headers, rows }
}

/** Infer a column type from non-empty sample values. */
export function inferColumnType(samples: readonly string[]): ColumnType {
  const nonEmpty = samples.filter(v => v !== '')
  if (nonEmpty.length === 0) return 'text'
  if (nonEmpty.every(v => /^[+-]?\d+(\.\d+)?$/.test(v.trim()))) return 'number'
  if (nonEmpty.every(v => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(v.trim()))) return 'date'
  if (nonEmpty.every(v => ['是', '否', 'true', 'false', '1', '0', '√', '×'].includes(v.trim().toLowerCase()))) return 'checkbox'
  return 'text'
}

/** Build columns for an imported grid. */
export function buildImportColumns(headers: readonly string[], rows: readonly string[][]): Column[] {
  return headers.map((name, c) => ({
    id: crypto.randomUUID(),
    name,
    type: inferColumnType(rows.map(row => row[c] ?? '')),
    width: 140,
    frozen: false,
    hidden: false,
    required: false,
  }))
}

/** Coerce an imported raw string to the column type. */
export function coerceImportValue(type: ColumnType, raw: string): CellValue {
  if (raw === '') return null
  switch (type) {
    case 'number':
    case 'percent':
    case 'currency':
    case 'rating':
    case 'progress': {
      const n = Number(raw)
      return Number.isFinite(n) ? n : raw
    }
    case 'checkbox': {
      const t = raw.trim().toLowerCase()
      if (['true', '1', '是', '√', 'yes', 'y'].includes(t)) return true
      if (['false', '0', '否', '×', 'no', 'n'].includes(t)) return false
      return raw
    }
    default: return raw
  }
}
