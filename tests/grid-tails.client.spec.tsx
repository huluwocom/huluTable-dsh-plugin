// @vitest-environment jsdom
/** Grid tails: row numbers, header sort/filter/menu, keyboard shortcuts,
 * editing commit paths, column-scope rules, history-empty hover, row menus. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { Grid } from '../src/client/grid/Grid.tsx'
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

describe('Grid tails', () => {
  it('row numbers: context menu, shift-extend and plain select', async () => {
    const { controller } = await openCrm()
    const nums = document.querySelectorAll('[class*="_rowNum_"]')
    const cols = controller.snapshot().tables[controller.snapshot().currentTableId!]!.columns.length
    fireEvent.contextMenu(nums[0]!, { clientX: 10, clientY: 10 })
    expect(screen.getByText(/Insert row above/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Insert row above/))
    expect(controller.snapshot().tables[controller.snapshot().currentTableId!]!.rows).toHaveLength(7)
    // Plain row click selects the whole row.
    const nums2 = document.querySelectorAll('[class*="_rowNum_"]')
    fireEvent.mouseDown(nums2[1]!)
    expect(controller.snapshot().editor.selection).toEqual({ r0: 1, r1: 1, c0: 0, c1: cols - 1 })
    // Shift-click extends the selection.
    fireEvent.mouseDown(nums2[3]!, { shiftKey: true })
    expect(controller.snapshot().editor.selection).toEqual({ r0: 1, r1: 3, c0: 0, c1: cols - 1 })
  })

  it('header sort cycles, filters and menus open, goal chips with zero targets', async () => {
    const { controller, id } = await openCrm()
    const amountCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '预算')!
    // Sorting moved to the dedicated icon; clicking the title only selects.
    fireEvent.click(screen.getByLabelText('sort-预算'))
    expect(controller.viewOf(id)!.sorts).toEqual([{ columnId: amountCol.id, dir: 'asc' }])
    expect(screen.getAllByText('↑').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText('sort-预算'))
    expect(controller.viewOf(id)!.sorts).toEqual([{ columnId: amountCol.id, dir: 'desc' }])
    fireEvent.click(screen.getByLabelText('sort-预算'))
    expect(controller.viewOf(id)!.sorts).toEqual([])
    // Filter and menu buttons open their popovers.
    fireEvent.click(screen.getByLabelText('filter-预算'))
    expect(screen.getByLabelText('Filter op')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('menu-预算'))
    expect(screen.getByText('Rename')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    // A goal with a zero target shows a 0% chip.
    controller.addGoal(id, { columnId: amountCol.id, aggregate: 'sum', target: 0 })
    await act(async () => {})
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0)
  })

  it('keyboard shortcuts: F2 edit, undo/redo, editing Tab and blur commits', async () => {
    const { controller, id } = await openCrm()
    const grid = document.querySelector('[tabindex="0"]') as HTMLElement
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'F2' })
    let input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: '改一' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    // Tab commits and moves right.
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('改一')
    input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    expect(input).toBeTruthy()
    // Blur commits without moving.
    fireEvent.change(input, { target: { value: '改二' } })
    // Blurring the input commits without moving.
    fireEvent.focusOut(input)
    fireEvent.blur(input)
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[controller.snapshot().tables[id]!.columns[1]!.id]!.value).toBe('改二')
    const contactCol = controller.snapshot().tables[id]!.columns[1]!
    // Ctrl+Z undoes, Ctrl+Shift+Z redoes, Ctrl+Y redoes.
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[contactCol.id]!.value).toBe('女')
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('陈小雨')
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('改一')
    fireEvent.keyDown(grid, { key: 'y', ctrlKey: true })
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[contactCol.id]!.value).toBe('改二')
  })

  it('applies column-scope rules, hover without history, text single-clicks', async () => {
    const { controller, id } = await openCrm()
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    controller.addFormatRule(id, {
      columnId: nameCol.id, op: 'eq', value: '陈小雨', scope: 'column', bg: '#654321', enabled: true,
    })
    await act(async () => {})
    const cells = Array.from(document.querySelectorAll('[class*="cell"]'))
    expect(cells.some(c => (c as HTMLElement).style.background === 'rgb(101, 67, 33)')).toBe(true)
    // Hovering a cell without history renders no popover.
    const plain = screen.getAllByText('陈小雨')[0]!
    fireEvent.mouseEnter(plain, { clientX: 10, clientY: 10 })
    expect(screen.queryByText('Edit history (last 5)')).toBeNull()
    // Single-clicking a text cell does not open the picker.
    fireEvent.click(screen.getAllByText('陈小雨')[0]!)
    expect(screen.queryByText('Type a custom value')).toBeNull()
  })
})
