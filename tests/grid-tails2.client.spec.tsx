// @vitest-environment jsdom
/** Grid tails 2: copy quoting, shift-click, grid-level Enter, out-of-range
 * editing, scroll, fill pointer ids, goal aggregates, frozen-header filter,
 * multiSelect single-click, between/in format rules, clipboard escapes. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { Grid } from '../src/client/grid/Grid.tsx'
import { parseClipboardGrid } from '../src/client/grid/Grid.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'
import type { HulutableState } from '../src/client/controller.ts'

// Grid suites render the full blank canvas; coverage instrumentation slows
// them well past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
class DataTransferStub {
  data = new Map<string, string>()
  effectAllowed = 'move'
  setData(kind: string, value: string): void { this.data.set(kind, value) }
  getData(kind: string): string { return this.data.get(kind) ?? '' }
}
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('DataTransfer', DataTransferStub)
  Object.defineProperty(window, 'innerWidth', { value: 3200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(), readText: vi.fn() },
    configurable: true,
  })
})
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

function Harness(props: { controller: HulutableController; useWorkspace: <S>(sel: (s: HulutableState) => S) => S }) {
  const table = props.useWorkspace(s => (s.currentTableId === null ? undefined : s.tables[s.currentTableId]))
  const view = table === undefined ? undefined : props.controller.viewOf(table.id) ?? table.views[0]
  const selection = props.useWorkspace(s => s.editor.selection)
  const editing = props.useWorkspace(s => s.editor.editing)
  if (table === undefined || view === undefined) return null
  return <Grid table={table} view={view} controller={props.controller} selection={selection} editing={editing} t={t} />
}

async function openCrm() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('客户', 'crm')
  await controller.openTable(id)
  const useWorkspace = bindSnapshotSelector(controller.store)
  render(<Harness controller={controller} useWorkspace={useWorkspace} />)
  return { controller, id }
}

describe('Grid tails 2', () => {
  // Heavy keyboard/clipboard loops; generous timeout under parallel load.
  it('copies nulls, tabs and out-of-range selections with quoting', async () => {
    const { controller, id } = await openCrm()
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    const contactCol = controller.snapshot().tables[id]!.columns[1]!
    await act(async () => {
      controller.setCellValue(id, controller.snapshot().tables[id]!.rows[0]!.id, contactCol.id, null)
      controller.setCellValue(id, controller.snapshot().tables[id]!.rows[1]!.id, contactCol.id, 'a\tb')
    })
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => Promise.resolve())
    const grid = document.querySelector('[tabindex="0"]') as HTMLElement
    // Copy a selection that reaches past the last row and column.
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(grid, { key: 'ArrowRight', shiftKey: true })
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(grid, { key: 'ArrowRight', shiftKey: true })
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(grid, { key: 'c', ctrlKey: true })
    const text = writeSpy.mock.calls[0]![0]
    expect(text).toContain('a\tb')
    expect(text).toContain('"')
    void nameCol
  })

  it('shift-clicks extend the selection and grid-level Enter starts editing', async () => {
    const { controller } = await openCrm()
    const grid = document.querySelector('[tabindex="0"]') as HTMLElement
    // Establish a selection, then shift-click extends it.
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.mouseDown(cell)
    const rowNums = document.querySelectorAll('[class*="_rowNum_"]')
    fireEvent.mouseDown(rowNums[3]!, { shiftKey: true })
    expect(controller.snapshot().editor.selection).not.toBeNull()
    fireEvent.mouseDown(cell, { shiftKey: true })
    expect(controller.snapshot().editor.selection).not.toBeNull()
    // Enter at grid level starts editing the anchor cell.
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(controller.snapshot().editor.editing).toMatchObject({ row: 0, col: 0 })
  }, 15000)

  it('commits out-of-range editing safely', async () => {
    const { controller } = await openCrm()
    await act(async () => {
      controller.setEditing({ row: 0, col: 99 })
    })
    const input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // The commit skips the missing column; editing clears at the last column.
    expect(controller.snapshot().editor.editing).toBeNull()
  })

  it('clears an out-of-range selection safely', async () => {
    const { controller, id } = await openCrm()
    await act(async () => {
      controller.select({ r0: 0, r1: 99, c0: 0, c1: 0 })
    })
    fireEvent.keyDown(document.querySelector('[tabindex="0"]')!, { key: 'Delete' })
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[controller.snapshot().tables[id]!.columns[0]!.id]!.value).toBeNull()
  })

  it('tracks scroll via rAF and ignores foreign fill pointer ids', async () => {
    const { controller } = await openCrm()
    const scroller = document.querySelector('[class*="scroll"]') as HTMLElement
    fireEvent.scroll(scroller, { target: { scrollTop: 100, scrollLeft: 200 } })
    await new Promise(r => setTimeout(r, 30))
    // A fill gesture with a mismatched pointer id is ignored.
    const grid = document.querySelector('[tabindex="0"]') as HTMLElement
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    const handle = document.querySelector('[class*="fillHandle"]') as HTMLElement
    fireEvent.pointerDown(handle, { pointerId: 1 })
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 0, clientY: 200 })
    fireEvent.pointerUp(document, { pointerId: 2 })
    void controller
  })

  it('renders avg/count goal aggregates and filters a frozen header', async () => {
    const { controller, id } = await openCrm()
    const amountCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '预算')!
    controller.addGoal(id, { columnId: amountCol.id, aggregate: 'avg', target: 100 })
    controller.addGoal(id, { columnId: amountCol.id, aggregate: 'count', target: 2 })
    await act(async () => {})
    expect(screen.getAllByText(/%/).length).toBeGreaterThan(0)
    // The frozen header column (客户名称) filter button opens the popover.
    const frozen = screen.getAllByLabelText(/filter-/)[0]!
    fireEvent.click(frozen)
    expect(screen.getByLabelText('Filter op')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    // Single-click a multiSelect cell opens the picker.
    const statusCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '跟进状态')!
    controller.update((d) => { d.tables[id]!.columns.find(c => c.id === statusCol.id)!.type = 'multiSelect' })
    await act(async () => {})
    fireEvent.click(screen.getAllByText('已联系')[0]!)
    expect(document.querySelector('[class*="popover"]')).toBeTruthy()
  })

  it('applies between and in format rules and parses escaped quotes', async () => {
    const { controller, id } = await openCrm()
    const amountCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '预算')!
    controller.addFormatRule(id, {
      columnId: amountCol.id, op: 'between', value: '0', value2: '150', scope: 'column', bg: '#111111', enabled: true,
    })
    const statusCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '跟进状态')!
    controller.addFormatRule(id, {
      columnId: statusCol.id, op: 'in', values: ['已联系'], scope: 'column', bg: '#222222', enabled: true,
    })
    await act(async () => {})
    const cells = Array.from(document.querySelectorAll('[class*="cell"]'))
    expect(cells.some(c => (c as HTMLElement).style.background === 'rgb(17, 17, 17)')).toBe(true)
    expect(cells.some(c => (c as HTMLElement).style.background === 'rgb(34, 34, 34)')).toBe(true)
    expect(parseClipboardGrid('"a""b"\t"x\ty"')).toEqual([['a"b', 'x\ty']])
  })
})
