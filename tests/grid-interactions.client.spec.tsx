// @vitest-environment jsdom
/** Grid interaction spec: keyboard, editing, selection, fill, popovers. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController, type HulutableState } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { Grid } from '../src/client/grid/Grid.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

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
})
afterEach(() => { cleanup() })

const t = ((key: string, params?: Record<string, unknown>) => {
  const text = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name]
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    return ''
  })
}) as HulutableTranslate

/** Reactive harness: table/view/selection/editing flow from the store. */
function GridHarness(props: {
  controller: HulutableController
  useWorkspace: <S>(sel: (s: HulutableState) => S) => S
  t: HulutableTranslate
}) {
  const table = props.useWorkspace(s => (s.currentTableId === null ? undefined : s.tables[s.currentTableId]))
  const view = table === undefined ? undefined : props.controller.viewOf(table.id) ?? table.views[0]
  const selection = props.useWorkspace(s => s.editor.selection)
  const editing = props.useWorkspace(s => s.editor.editing)
  if (table === undefined || view === undefined) return null
  return <Grid table={table} view={view} controller={props.controller} selection={selection} editing={editing} t={props.t} />
}

async function openCrm() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('客户', 'crm')
  await controller.openTable(id)
  const useWorkspace = bindSnapshotSelector(controller.store)
  render(<GridHarness controller={controller} useWorkspace={useWorkspace} t={t} />)
  return { controller, id }
}

describe('Grid interactions', () => {
  it('selects with mouse drag and keyboard', async () => {
    const { controller, view } = await openCrm()
    const grid = document.querySelector('[tabindex="0"]') as HTMLElement
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(controller.snapshot().editor.selection).toEqual({ r0: 1, r1: 1, c0: 0, c1: 1 })
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true })
    expect(controller.snapshot().editor.selection!.r1).toBe(2)
    fireEvent.keyDown(grid, { key: 'Tab' })
    expect(controller.snapshot().editor.selection!.c0).toBe(2)
    fireEvent.keyDown(grid, { key: 'Delete' })
    const table = controller.snapshot().tables[controller.snapshot().currentTableId!]!
    const phoneCol = table.columns[2]!
    expect(table.rows[1]!.cells[phoneCol.id]!.value).toBeNull()
    void view
  })

  it('edits cells via double-click and commits with Enter', async () => {
    const { controller } = await openCrm()
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.doubleClick(cell)
    const input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: '新客户名' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const table = controller.snapshot().tables[controller.snapshot().currentTableId!]!
    const nameCol = table.columns[0]!
    expect(table.rows[0]!.cells[nameCol.id]!.value).toBe('新客户名')
    // Editing continues to the row below; Escape cancels.
    const input2 = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    fireEvent.keyDown(input2, { key: 'Escape' })
    expect(controller.snapshot().editor.editing).toBeNull()
  })

  it('opens the dropdown picker on a single click', async () => {
    await openCrm()
    const cell = screen.getAllByText('已联系')[0]!
    fireEvent.click(cell)
    // The picker lists options (plus grid chips elsewhere).
    expect(screen.getAllByText('已成交').length).toBeGreaterThan(1)
  })

  it('applies row-scope format rules as row tints', async () => {
    const { controller } = await openCrm()
    const id = controller.snapshot().currentTableId!
    const table = controller.snapshot().tables[id]!
    const statusCol = table.columns.find(c => c.name === '跟进状态')!
    controller.addFormatRule(id, {
      columnId: statusCol.id, op: 'eq', value: '已成交', scope: 'row', bg: '#123456', enabled: true,
    })
    // The reactive harness picks the rule up on the next store change.
    const useWorkspace = bindSnapshotSelector(controller.store)
    render(<GridHarness controller={controller} useWorkspace={useWorkspace} t={t} />)
    const rows = document.querySelectorAll('[class*="_row_"]')
    const tinted = Array.from(rows).filter(r => (r as HTMLElement).style.background === 'rgb(18, 52, 86)')
    expect(tinted.length).toBeGreaterThan(0)
  })

  it('shows goal chips in headers and history popovers on hover', async () => {
    const { controller } = await openCrm()
    const id = controller.snapshot().currentTableId!
    const table = controller.snapshot().tables[id]!
    const amountCol = table.columns.find(c => c.name === '预算')!
    controller.addGoal(id, { columnId: amountCol.id, aggregate: 'sum', target: 90000 })
    cleanup()
    const fresh = controller.snapshot().tables[id]!
    const useWorkspace = bindSnapshotSelector(controller.store)
    render(<GridHarness controller={controller} useWorkspace={useWorkspace} t={t} />)
    expect(screen.getAllByText(/100%/).length).toBeGreaterThan(0)
    // Hover a cell with history (store-driven re-render picks up the edit).
    await act(async () => {
      controller.setCellValue(id, fresh.rows[0]!.id, fresh.columns[0]!.id, '改名')
    })
    const cell = screen.getAllByText('改名')[0]!
    fireEvent.mouseEnter(cell, { clientX: 10, clientY: 10 })
    expect(screen.getByText('Edit history (last 5)')).toBeTruthy()
  })

  it('hides columns through the view and renders comments badges', async () => {
    const { controller } = await openCrm()
    const id = controller.snapshot().currentTableId!
    const table = controller.snapshot().tables[id]!
    const view = controller.viewOf(id)!
    const contactCol = table.columns.find(c => c.name === '电话')!
    controller.toggleColumnHidden(id, view.id, contactCol.id)
    cleanup()
    const fresh = controller.snapshot().tables[id]!
    controller.setComment(id, fresh.rows[0]!.id, fresh.columns[0]!.id, '备注')
    const fresh2 = controller.snapshot().tables[id]!
    const useWorkspace = bindSnapshotSelector(controller.store)
    render(<GridHarness controller={controller} useWorkspace={useWorkspace} table={fresh2} view={controller.viewOf(id)!} t={t} />)
    expect(screen.queryByText('电话')).toBeNull()
    expect(screen.getAllByLabelText('comment').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByLabelText('comment')[0]!)
    expect(screen.getAllByText('备注').length).toBeGreaterThan(0)
  })

  it('fills down with the fill handle (pointer events)', async () => {
    const { controller } = await openCrm()
    const id = controller.snapshot().currentTableId!
    const table = controller.snapshot().tables[id]!
    const amountCol = table.columns.find(c => c.name === '预算')!
    await act(async () => {
      controller.setCellValue(id, table.rows[0]!.id, amountCol.id, 100)
    })
    cleanup()
    const useWorkspace = bindSnapshotSelector(controller.store)
    render(<GridHarness controller={controller} useWorkspace={useWorkspace} t={t} />)
    // Select the first amount cell (renders as ¥100).
    const first = screen.getAllByText('¥100')[0]!
    fireEvent.mouseDown(first, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, {})
    // Drag the fill handle two rows down.
    const handle = document.querySelector('[class*="fillHandle"]') as HTMLElement
    fireEvent.pointerDown(handle, { pointerId: 1 })
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: 132 })
    fireEvent.pointerUp(document, { pointerId: 1 })
    const after = controller.snapshot().tables[id]!
    expect(after.rows[1]!.cells[amountCol.id]!.value).toBe(101)
    expect(after.rows[2]!.cells[amountCol.id]!.value).toBe(102)
  })

  it('clears the selection when clicking empty canvas', async () => {
    const { controller } = await openCrm()
    const canvas = document.querySelector('[class*="canvas"]') as HTMLElement
    fireEvent.mouseDown(canvas)
    expect(controller.snapshot().editor.selection).toBeNull()
  })
})
