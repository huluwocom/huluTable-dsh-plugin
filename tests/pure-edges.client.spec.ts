/** Edge branches: query ops, geometry presentation, io serialization, templates. */
import { vi, describe, expect, it } from 'vitest'
import { applyViewQuery, compareValues, matchFilter, opsForColumn } from '../src/client/domain/query.ts'
import { cellText, selectionStats, visibleColumnRange } from '../src/client/grid/geometry.ts'
import { buildExportGrid, buildImportColumns, coerceImportValue, inferColumnType, parseImport, rowToStrings, toCsv, toXlsx } from '../src/client/io/io.ts'
import { createBlankTable, createTableFromTemplate, crmTemplate, localizeTemplate } from '../src/client/domain/templates.ts'
import { newId, type TableDoc } from '../src/client/domain/types.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

function table(): TableDoc {
  const doc = createBlankTable('t')
  doc.columns = [
    { id: 'txt', name: '文本', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    { id: 'num', name: '数字', type: 'number', width: 100, frozen: false, hidden: false, required: false },
    { id: 'flag', name: '标记', type: 'checkbox', width: 100, frozen: false, hidden: false, required: false },
  ]
  const mk = (txt: string, num: number, flag: boolean | null) => ({
    id: newId(), cells: { txt: { value: txt }, num: { value: num }, flag: { value: flag } },
  })
  doc.rows = [mk('abc', 10, true), mk('xyz', 20, null), mk('', 30, false)]
  return doc
}

describe('query edge branches', () => {
  it('matches neq and string comparisons', () => {
    const doc = table()
    expect(matchFilter(doc, 0, { columnId: 'txt', op: 'neq', value: 'abc' })).toBe(false)
    expect(matchFilter(doc, 1, { columnId: 'txt', op: 'neq', value: 'abc' })).toBe(true)
    expect(matchFilter(doc, 0, { columnId: 'txt', op: 'gt', value: 'aaa' })).toBe(true)
    expect(matchFilter(doc, 0, { columnId: 'txt', op: 'gte', value: 'abc' })).toBe(true)
    expect(matchFilter(doc, 0, { columnId: 'txt', op: 'lt', value: 'abd' })).toBe(true)
    expect(matchFilter(doc, 0, { columnId: 'txt', op: 'lte', value: 'abc' })).toBe(true)
    expect(matchFilter(doc, 0, { columnId: 'txt', op: 'between', value: 'aaa', value2: 'abd' })).toBe(true)
    expect(matchFilter(doc, 2, { columnId: 'txt', op: 'gt', value: 'a' })).toBe(false)
  })

  it('matches empty-string cells and boolean values', () => {
    const doc = table()
    expect(matchFilter(doc, 2, { columnId: 'txt', op: 'eq', value: '' })).toBe(true)
    expect(matchFilter(doc, 2, { columnId: 'txt', op: 'empty' })).toBe(true)
    expect(matchFilter(doc, 0, { columnId: 'flag', op: 'eq', value: true })).toBe(true)
  })

  it('offers ops for other column types', () => {
    expect(opsForColumn('textarea')).toContain('contains')
    expect(opsForColumn('checkbox')).toContain('eq')
    expect(compareValues(1, '1')).toBe(0)
  })

  it('sorts with dropdown option order and empty fallbacks', () => {
    const doc = table()
    doc.columns[0]!.type = 'select'
    doc.columns[0]!.options = [{ id: 'a', label: 'xyz', color: '' }, { id: 'b', label: 'abc', color: '' }]
    const rows = applyViewQuery(doc, [], 'and', [{ columnId: 'txt', dir: 'asc' }])
    // xyz (option idx 0) < abc (option idx 1) < '' (unknown → Infinity).
    expect(rows).toEqual([1, 0, 2])
  })
})

describe('geometry edge branches', () => {
  it('serializes boolean and array cell values', () => {
    const doc = table()
    expect(cellText(doc.columns[2]!, doc.rows[0]!.cells.flag!.value)).toBe('✓')
    expect(cellText(doc.columns[0]!, null)).toBe('')
    const col = { ...doc.columns[0]!, type: 'multiSelect' as const }
    expect(cellText(col, ['a', 'b'])).toBe('a,b')
  })

  it('clamps visible columns to the ends', () => {
    const doc = table()
    const offsets = [0, 100, 200]
    expect(visibleColumnRange(0, 500, doc.columns, offsets)).toEqual({ start: 0, end: 3 })
    expect(visibleColumnRange(1000, 500, doc.columns, offsets)).toEqual({ start: 0, end: 3 })
  })

  it('aggregates with mixed cells and null stats', () => {
    const doc = table()
    const stats = selectionStats(doc, 0, 2, 0, 2)!
    expect(stats.count).toBe(3)
    expect(selectionStats(doc, 0, 0, 0, 0)).toBeNull()
  })
})

describe('io edge branches', () => {
  it('serializes booleans and arrays in export rows', () => {
    const doc = table()
    doc.columns.push({ id: 'tags', name: '标签', type: 'multiSelect', width: 100, frozen: false, hidden: false, required: false })
    doc.rows[0]!.cells.tags = { value: ['a', 'b'] }
    const grid = buildExportGrid(doc)
    expect(grid[1]).toContain('是')
    expect(grid[1]).toContain('a、b')
    expect(rowToStrings(doc, doc.rows[2]!)).toContain('否')
  })

  it('coerces numeric strings with fallback and infers types', () => {
    expect(coerceImportValue('number', '12')).toBe(12)
    expect(coerceImportValue('number', 'abc')).toBe('abc')
    expect(coerceImportValue('checkbox', '是')).toBe(true)
    expect(coerceImportValue('checkbox', '？')).toBe('？')
    expect(inferColumnType(['1', 'abc'])).toBe('text')
  })

  it('parses imports with empty headers and missing sheets', () => {
    const empty = new Uint8Array(0).buffer
    const parsed = parseImport(empty, 'x.csv')
    expect(parsed.headers).toEqual(['列 1'])
    expect(buildImportColumns([], [])).toHaveLength(0)
    // Round-trip through xlsx for a table with a long name.
    const doc = table()
    doc.name = '这是一个非常长的表格名称用来测试导出截断行为超过三十一个字符的限制'
    const buffer = toXlsx(doc)
    expect(buffer.byteLength).toBeGreaterThan(0)
    expect(toCsv(doc)).toContain('文本')
  })
})

describe('templates edge branches', () => {
  it('localizes template surfaces by language', () => {
    const zh = localizeTemplate(crmTemplate, 'zh')
    expect(zh.name).toBe('客户管理')
    expect(zh.columns[0]!.name).toBe('姓名')
    expect(zh.rows[0]![0]).toBe('陈小雨')
    const en = localizeTemplate(crmTemplate, 'en')
    expect(en.name).toBe('Customer CRM')
    expect(en.columns[0]!.name).toBe('Name')
    expect(en.rows[0]![0]).toBe('Emily Chen')
    // Unknown languages fall back to zh.
    expect(localizeTemplate(crmTemplate, 'fr').name).toBe('客户管理')
  })

  it('creates a localized table from the crm template with its demo views', () => {
    const doc = createTableFromTemplate(crmTemplate, '客户管理', localizeTemplate(crmTemplate, 'zh'))
    expect(doc.rows).toHaveLength(6)
    // Every row aligns with the column list (no stray cells).
    for (const row of doc.rows) {
      expect(Object.keys(row.cells).length).toBeLessThanOrEqual(doc.columns.length)
    }
    const kinds = doc.views.map(v => v.kind)
    expect(kinds).toContain('grid')
    expect(kinds).toContain('kanban')
    expect(kinds).toContain('calendar')
    expect(kinds).toContain('chart')
    const chartView = doc.views.find(v => v.kind === 'chart')!
    expect(chartView.chart).toBeDefined()
    expect(chartView.chart!.xColumnId).toBe(doc.columns.find(c => c.name === '客户来源')!.id)
  })

  it('skips empty template cells and resolves missing group columns', () => {
    const doc = createTableFromTemplate(crmTemplate, '客户', localizeTemplate(crmTemplate, 'zh'))
    expect(doc.rows.length).toBeGreaterThan(0)
    const view = createTableFromTemplate({
      ...crmTemplate,
      views: [{
        name: '无分组', kind: 'kanban' as const, filters: [], filterMode: 'and' as const,
        sorts: [], hiddenColumns: [], groupColumnName: '不存在的列',
      }],
    }, 'x', localizeTemplate(crmTemplate, 'zh'))
    expect(view.views[0]!.groupColumnId).toBeUndefined()
  })

  it('resolves chart views and skips unresolved chart names', () => {
    const doc = createTableFromTemplate({
      ...crmTemplate,
      views: [{
        name: '图', kind: 'chart' as const, filters: [], filterMode: 'and' as const,
        sorts: [], hiddenColumns: [], chart: { type: 'bar', title: '柱', xColumnName: '客户来源', yColumnNames: ['预算'] },
      }],
    }, '带图', localizeTemplate(crmTemplate, 'zh'))
    const chart = doc.views[0]!.chart!
    expect(chart.xColumnId).toBe(doc.columns.find(c => c.name === '客户来源')!.id)
    expect(chart.yColumnIds).toEqual([doc.columns.find(c => c.name === '预算')!.id])
    // A chart naming a missing x column stays unbound.
    const ghost = createTableFromTemplate({
      ...crmTemplate,
      views: [{
        name: '空图', kind: 'chart' as const, filters: [], filterMode: 'and' as const,
        sorts: [], hiddenColumns: [], chart: { type: 'bar', title: '', xColumnName: '不存在', yColumnNames: ['预算'] },
      }],
    }, '空图', localizeTemplate(crmTemplate, 'zh'))
    expect(ghost.views[0]!.chart).toBeUndefined()
    // Empty y names also leave the chart unbound.
    const noY = createTableFromTemplate({
      ...crmTemplate,
      views: [{
        name: '无Y', kind: 'chart' as const, filters: [], filterMode: 'and' as const,
        sorts: [], hiddenColumns: [], chart: { type: 'bar', title: '', xColumnName: '客户来源', yColumnNames: [] },
      }],
    }, '无Y', localizeTemplate(crmTemplate, 'zh'))
    expect(noY.views[0]!.chart).toBeUndefined()
    // A chart without an x name at all stays unbound too.
    const noX = createTableFromTemplate({
      ...crmTemplate,
      views: [{
        name: '无X', kind: 'chart' as const, filters: [], filterMode: 'and' as const,
        sorts: [], hiddenColumns: [], chart: { type: 'bar', title: '', yColumnNames: ['预算'] },
      }],
    }, '无X', localizeTemplate(crmTemplate, 'zh'))
    expect(noX.views[0]!.chart).toBeUndefined()
    // A chart without a yColumnNames array resolves no series.
    const noYArr = createTableFromTemplate({
      ...crmTemplate,
      views: [{
        name: '无Y2', kind: 'chart' as const, filters: [], filterMode: 'and' as const,
        sorts: [], hiddenColumns: [], chart: { type: 'bar', title: '', xColumnName: '客户来源' },
      }],
    }, '无Y2', localizeTemplate(crmTemplate, 'zh'))
    expect(noYArr.views[0]!.chart).toBeUndefined()
  })

  it('keeps the default view when a template declares none', () => {
    const { views: _views, ...bare } = crmTemplate
    const doc = createTableFromTemplate(bare, '无视图', localizeTemplate(crmTemplate, 'zh'))
    expect(doc.views).toHaveLength(1)
    expect(doc.views[0]!.kind).toBe('grid')
  })

  it('resolves calendar bindings from template view names', () => {
    const doc = createTableFromTemplate({
      ...crmTemplate,
      views: [{
        name: '日历', kind: 'calendar' as const, filters: [], filterMode: 'and' as const,
        sorts: [], hiddenColumns: [], calendarColumnName: '下次联系日期',
      }],
    }, '带日历', localizeTemplate(crmTemplate, 'zh'))
    expect(doc.views[0]!.calendarColumnId).toBe(
      doc.columns.find(c => c.name === '下次联系日期')!.id,
    )
    // A calendar view naming a missing column stays unbound.
    const missing = createTableFromTemplate({
      ...crmTemplate,
      views: [{
        name: '空日历', kind: 'calendar' as const, filters: [], filterMode: 'and' as const,
        sorts: [], hiddenColumns: [], calendarColumnName: '不存在的日期列',
      }],
    }, '空日历', localizeTemplate(crmTemplate, 'zh'))
    expect(missing.views[0]!.calendarColumnId).toBeUndefined()
  })
})
