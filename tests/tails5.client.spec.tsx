// @vitest-environment jsdom
/** Tail coverage: GoalsPanel, ViewManager, TableLibrary, OptionPicker, io. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as XLSX from 'xlsx/xlsx.mjs'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { GoalsPanel } from '../src/client/editor/GoalsPanel.tsx'
import { ViewManager } from '../src/client/editor/ViewManager.tsx'
import { TableLibrary } from '../src/client/TableLibrary.tsx'
import { OptionPicker } from '../src/client/grid/OptionPicker.tsx'
import {
  buildExportGrid, buildImportColumns, coerceImportValue, parseImport, toXlsx,
} from '../src/client/io/io.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { en } from '../src/client/locales.ts'
import type { Column } from '../src/client/domain/types.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

// Grid suites render the full blank canvas; coverage instrumentation slows
// them well past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const t = ((key: string, params?: Record<string, unknown>) => {
  const text = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name]
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    return ''
  })
}) as HulutableTranslate

function crm() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('客户', 'crm')
  const doc = controller.snapshot().tables[id]!
  return { controller, id, doc }
}

describe('GoalsPanel tails', () => {
  it('renders numeric stats and degenerate goals without dismissing on inside events', () => {
    const { controller, id, doc } = crm()
    const amountCol = doc.columns.find(c => c.name === '预算')!
    controller.addGoal(id, { columnId: amountCol.id, aggregate: 'sum', target: 100000 })
    // A goal on a missing column and a zero target.
    controller.addGoal(id, { columnId: 'ghost', aggregate: 'count', target: 0 })
    const onClose = vi.fn()
    render(
      <GoalsPanel
        table={controller.snapshot().tables[id]!}
        view={doc.views[0]!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={onClose}
      />,
    )
    // Inside mousedown and unrelated keys do not dismiss.
    fireEvent.mouseDown(screen.getByText('Goals'))
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    // Both goal rows render; the ghost goal falls back to its id.
    expect(screen.getByText(/ghost/)).toBeTruthy()
    expect(screen.getByText('0%')).toBeTruthy()
    // Changing the selects works and a zero target is accepted.
    fireEvent.change(screen.getByLabelText('Target column'), { target: { value: amountCol.id } })
    fireEvent.change(screen.getByLabelText('Aggregate'), { target: { value: 'avg' } })
    fireEvent.change(screen.getByLabelText('Target value'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('Add goal'))
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(3)
  })

  it('no-ops the add form without numeric columns', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const id = controller.createTable('空白')
    render(
      <GoalsPanel
        table={controller.snapshot().tables[id]!}
        view={controller.snapshot().tables[id]!.views[0]!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Target value'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('Add goal'))
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(0)
  })
})

describe('ViewManager tails', () => {
  it('activates rows, handles rename keys and adds kanban/calendar views', () => {
    const { controller, id, doc } = crm()
    const onClose = vi.fn()
    const view = render(
      <ViewManager table={doc} activeView={doc.views[0]!} t={t} controller={controller} onClose={onClose} />,
    )
    // Inside mousedown and unrelated keys do not dismiss.
    fireEvent.mouseDown(screen.getByText('Views'))
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    // Clicking a view row activates it.
    fireEvent.click(screen.getByText('全部客户'))
    const gridView = doc.views[0]!
    expect(controller.snapshot().editor.viewIds[id]).toBe(gridView.id)
    // The kanban and calendar add buttons create views.
    fireEvent.click(screen.getByText(/Kanban view/))
    fireEvent.click(screen.getByText(/Calendar view/))
    expect(controller.snapshot().tables[id]!.views.map(v => v.kind)).toContain('kanban')
    expect(controller.snapshot().tables[id]!.views.map(v => v.kind)).toContain('calendar')
    // Rename input: unrelated key, input click, Escape closes the panel.
    fireEvent.click(screen.getAllByLabelText('Rename view')[0]!)
    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'a' })
    fireEvent.click(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    void view
  })

  it('adds a chart view and binds its configuration', () => {
    const { controller, id } = crm()
    const onClose = vi.fn()
    const useWorkspace = bindSnapshotSelector(controller.store)
    // Subscription harness: the manager re-renders as the store patches the
    // active view's chart config (static props would freeze the form state).
    function VmHarness() {
      const table = useWorkspace(s => (s.currentTableId === null ? undefined : s.tables[s.currentTableId]))!
      const view = controller.viewOf(table.id) ?? table.views[0]!
      return <ViewManager table={table} activeView={view} t={t} controller={controller} onClose={onClose} />
    }
    render(<VmHarness />)
    fireEvent.click(screen.getByText(/Chart view/))
    // The template ships its own chart view; the test binds the NEW one.
    const chartView = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart').at(-1)!
    expect(chartView).toBeTruthy()
    fireEvent.click(screen.getByText(chartView.name))
    // Type / title / x column / y toggles patch the chart config.
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'bar' } })
    fireEvent.change(screen.getByLabelText('Chart title'), { target: { value: '成交漏斗' } })
    const doc = controller.snapshot().tables[id]!
    const statusCol = doc.columns.find(c => c.name === '跟进状态')!
    const amountCol = doc.columns.find(c => c.name === '预算')!
    fireEvent.change(screen.getByLabelText('X axis (category column)'), { target: { value: statusCol.id } })
    fireEvent.click(screen.getByRole('checkbox', { name: '预算' }))
    // The template's own chart view is untouched; assert on the NEW one.
    const updated = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart').at(-1)!
    expect(updated.chart).toEqual({
      type: 'bar', title: '成交漏斗', xColumnId: statusCol.id, yColumnIds: [amountCol.id],
    })
    // Toggling the same column again removes it from the series list.
    fireEvent.click(screen.getByRole('checkbox', { name: '预算' }))
    const removed = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart').at(-1)!
    expect(removed.chart!.yColumnIds).toEqual([])
  })

  it('binds chart size and background settings', () => {
    const { controller, id } = crm()
    const useWorkspace = bindSnapshotSelector(controller.store)
    function VmHarness() {
      const table = useWorkspace(s => (s.currentTableId === null ? undefined : s.tables[s.currentTableId]))!
      const view = controller.viewOf(table.id) ?? table.views[0]!
      return <ViewManager table={table} activeView={view} t={t} controller={controller} onClose={() => {}} />
    }
    render(<VmHarness />)
    fireEvent.click(screen.getByText(/Chart view/))
    const chartView = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart').at(-1)!
    fireEvent.click(screen.getByText(chartView.name))
    fireEvent.change(screen.getByLabelText('Chart width'), { target: { value: '900' } })
    fireEvent.change(screen.getByLabelText('Chart height'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Chart background'), { target: { value: 'dark' } })
    const updated = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart').at(-1)!
    expect(updated.chart).toMatchObject({ width: 900, height: 500, background: 'dark' })
    // Out-of-range values clamp.
    fireEvent.change(screen.getByLabelText('Chart width'), { target: { value: '99999' } })
    const clamped = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart').at(-1)!
    expect(clamped.chart!.width).toBe(1400)
    // A non-numeric width falls back to the default.
    fireEvent.change(screen.getByLabelText('Chart width'), { target: { value: 'abc' } })
    const fallback = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart').at(-1)!
    expect(fallback.chart!.width).toBe(760)
    fireEvent.change(screen.getByLabelText('Chart height'), { target: { value: 'abc' } })
    const hFallback = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart').at(-1)!
    expect(hFallback.chart!.height).toBe(380)
  })

  it('shows the empty group option for a kanban view without a bound column', () => {
    const { controller, doc } = crm()
    const kanban = doc.views.find(v => v.kind === 'kanban')!
    const bare: typeof kanban = {
      id: kanban.id, name: kanban.name, kind: 'kanban', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
    }
    render(<ViewManager table={doc} activeView={bare} t={t} controller={controller} onClose={() => {}} />)
    const select = screen.getByLabelText('Group column') as HTMLSelectElement
    expect(select.value).toBe('')
  })
})

describe('TableLibrary tails', () => {
  function benchReady() {
    const controller = new HulutableController(new MemoryPersistence())
    controller.update((d) => { d.ready = true })
    return { controller, useWorkspace: bindSnapshotSelector(controller.store) }
  }

  it('shows template badges and tags and tolerates rename input clicks', () => {
    const { controller, useWorkspace } = benchReady()
    const id = controller.createTable('客户', 'crm')
    controller.setTags(id, ['重点'])
    render(<TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} />)
    expect(screen.getByText('Template')).toBeTruthy()
    expect(screen.getByText('重点')).toBeTruthy()
    fireEvent.click(screen.getAllByTitle('Rename')[0]!)
    const input = screen.getByDisplayValue('客户')
    fireEvent.click(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(controller.snapshot().tables[id]!.name).toBe('客户')
  })

  it('purges on confirm and shows bin rows without a deletedAt stamp', async () => {
    const { controller, useWorkspace } = benchReady()
    const id = controller.createTable('客户')
    render(<TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} />)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getAllByTitle('Delete')[0]!)
    await waitFor(() => { expect(controller.snapshot().bin).toHaveLength(1) })
    // A bin row whose deletedAt is missing falls back to updatedAt.
    controller.update((d) => {
      d.bin.push({
        id: 'raw', name: '无时间', tags: [], starred: false, rowCount: 0, colCount: 0, createdAt: 1, updatedAt: 2,
      })
    })
    fireEvent.click(screen.getByText(/Recycle bin/))
    expect(screen.getByText('无时间')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Delete forever')[0]!)
    expect(controller.snapshot().bin).toHaveLength(1)
    void id
  })

  it('shows the no-match message for a search without hits', () => {
    const { controller, useWorkspace } = benchReady()
    controller.createTable('客户')
    render(<TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} />)
    fireEvent.change(screen.getByPlaceholderText('Search table names'), { target: { value: 'zzz' } })
    expect(screen.getByText('No matching tables')).toBeTruthy()
  })
})

describe('OptionPicker tails', () => {
  function selectColumn(overrides: Partial<Column> = {}): Column {
    return {
      id: 's', name: '状态', type: 'select', width: 100, frozen: false, hidden: false, required: false,
      options: [{ id: 'a', label: '进行中', color: '' }], ...overrides,
    }
  }

  it('keeps open on inside events, renders optionless columns and custom input', () => {
    const { controller, doc } = crm()
    const onClose = vi.fn()
    controller.update((d) => {
      const statusCol = d.tables[doc.id]!.columns.find(c => c.name === '跟进状态')!
      statusCol.linked = { mode: 'map', allowCustom: true }
    })
    const statusCol = controller.snapshot().tables[doc.id]!.columns.find(c => c.name === '跟进状态')!
    const view = render(
      <OptionPicker table={doc} column={statusCol} rowData={doc.rows[0]} x={0} y={0} t={t} controller={controller} onClose={onClose} />,
    )
    fireEvent.mouseDown(screen.getByText('跟进状态'))
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    // Custom value commits on Enter, not on other keys.
    const custom = screen.getByPlaceholderText('Type a custom value')
    fireEvent.change(custom, { target: { value: '自定义' } })
    fireEvent.keyDown(custom, { key: 'a' })
    fireEvent.keyDown(custom, { key: 'Enter' })
    const row = controller.snapshot().tables[doc.id]!.rows[0]!
    expect(row.cells[statusCol.id]!.value).toBe('自定义')
    // A column without options renders an empty list.
    const bare = selectColumn()
    delete bare.options
    view.rerender(
      <OptionPicker table={doc} column={bare} rowData={doc.rows[0]} x={0} y={0} t={t} controller={controller} onClose={onClose} />,
    )
    expect(screen.queryByText('进行中')).toBeNull()
  })

  it('toggles multi-select values from an array cell', () => {
    const { controller, doc } = crm()
    const multi = {
      id: 'm', name: '多选', type: 'multiSelect' as const, width: 100, frozen: false, hidden: false, required: false,
      options: [{ id: 'a', label: '甲', color: '' }],
    }
    controller.update((d) => {
      d.tables[doc.id]!.columns.push({ ...multi })
    })
    const row = doc.rows[0]!
    controller.setCellValue(doc.id, row.id, 'm', ['甲'])
    render(
      <OptionPicker
        table={controller.snapshot().tables[doc.id]!}
        column={multi}
        rowData={controller.snapshot().tables[doc.id]!.rows[0]}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('甲'))
    expect(controller.snapshot().tables[doc.id]!.rows[0]!.cells.m!.value).toBeNull()
  })
})

describe('io tails', () => {
  it('skips out-of-range rows and falls back the sheet name', () => {
    const doc = createBlankTable('')
    doc.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    doc.rows = [{ id: 'r1', cells: { a: { value: 'v' } } }]
    const grid = buildExportGrid(doc, [0, 999])
    expect(grid).toHaveLength(2)
    const buffer = toXlsx(doc)
    expect(buffer.byteLength).toBeGreaterThan(0)
  })

  it('parses an empty-sheet workbook and mixed primitive cells', () => {
    // A workbook whose single sheet has no cells → no headers, no rows.
    const empty = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(empty, XLSX.utils.aoa_to_sheet([]), 'S')
    const emptyBuffer = XLSX.write(empty, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const parsed = parseImport(emptyBuffer, 'empty.xlsx')
    expect(parsed.headers).toEqual([])
    expect(parsed.rows).toEqual([])
    // Numbers and booleans stringify through the primitive branch.
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['数', '布尔', '文本'], [42, true, 'x']]),
      'S',
    )
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const mixed = parseImport(buffer, 'mixed.xlsx')
    expect(mixed.rows[0]![1]).toBe('true')
    expect(mixed.rows[0]![0]).toBe('42')
  })

  it('builds import columns for ragged rows and coerces checkbox falses', () => {
    const cols = buildImportColumns(['a', 'b'], [['x'], ['y', 'z']])
    expect(cols[1]!.type).toBe('text')
    expect(coerceImportValue('checkbox', '否')).toBe(false)
    expect(coerceImportValue('checkbox', 'maybe')).toBe('maybe')
  })
})
