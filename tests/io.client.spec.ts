/** Excel I/O: xlsx/csv round trips, header/type inference, import coercion. */
import { vi, describe, expect, it } from 'vitest'
import {
  buildExportGrid, buildImportColumns, coerceImportValue, inferColumnType,
  parseImport, toCsv, toXlsx,
} from '../src/client/io/io.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type TableDoc } from '../src/client/domain/types.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

function table(): TableDoc {
  const doc = createBlankTable('客户表')
  doc.columns = [
    { id: 'name', name: '姓名', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    { id: 'amount', name: '预算', type: 'currency', width: 100, frozen: false, hidden: false, required: false },
    { id: 'date', name: '成交日期', type: 'date', width: 100, frozen: false, hidden: false, required: false },
  ]
  doc.rows = [
    { id: newId(), cells: { name: { value: '张三' }, amount: { value: 1000 }, date: { value: '2025-08-01' } } },
    { id: newId(), cells: { name: { value: '李四' }, amount: { value: 2500 }, date: { value: '2025-08-05' } } },
  ]
  return doc
}

describe('export', () => {
  it('builds the export grid with headers and values', () => {
    const grid = buildExportGrid(table())
    expect(grid[0]).toEqual(['姓名', '预算', '成交日期'])
    expect(grid[1]).toEqual(['张三', '1000', '2025-08-01'])
  })

  it('round-trips xlsx through SheetJS', () => {
    const doc = table()
    const buffer = toXlsx(doc)
    const parsed = parseImport(buffer, '客户表.xlsx')
    expect(parsed.headers).toEqual(['姓名', '预算', '成交日期'])
    expect(parsed.rows[0]).toEqual(['张三', '1000', '2025-08-01'])
  })

  it('produces CSV text with headers', () => {
    const csv = toCsv(table())
    expect(csv).toContain('姓名,预算,成交日期')
    expect(csv).toContain('张三')
  })
})

describe('import', () => {
  it('parses an xlsx buffer back into headers and rows', () => {
    const doc = table()
    const buffer = toXlsx(doc)
    const parsed = parseImport(buffer, '客户表.xlsx')
    expect(parsed.headers).toEqual(['姓名', '预算', '成交日期'])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toEqual(['张三', '1000', '2025-08-01'])
  })

  it('infers column types from samples', () => {
    expect(inferColumnType(['1', '2.5', ''])).toBe('number')
    expect(inferColumnType(['2025-08-01', '2025/8/2'])).toBe('date')
    expect(inferColumnType(['是', '否'])).toBe('checkbox')
    expect(inferColumnType(['张三', '李四'])).toBe('text')
    expect(inferColumnType([])).toBe('text')
  })

  it('builds import columns with inferred types', () => {
    const columns = buildImportColumns(['名称', '金额'], [['张三', '100'], ['李四', '200']])
    expect(columns[0]!.type).toBe('text')
    expect(columns[1]!.type).toBe('number')
  })

  it('coerces import values by type', () => {
    expect(coerceImportValue('number', '12.5')).toBe(12.5)
    expect(coerceImportValue('number', 'abc')).toBe('abc')
    expect(coerceImportValue('checkbox', '是')).toBe(true)
    expect(coerceImportValue('date', '2025-08-01')).toBe('2025-08-01')
    expect(coerceImportValue('text', '')).toBeNull()
  })
})
