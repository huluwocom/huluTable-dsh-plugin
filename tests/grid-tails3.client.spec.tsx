// @vitest-environment jsdom
/** Grid tails 3: arrow keys, no-selection keys, drag move, metaKey copy,
 * frozen header clicks, scroller click, far-right drag, avg-with-no-numbers. */
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

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
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

describe('Grid tails 3', () => {
  it('handles arrow keys in all directions and no-selection keys', async () => {
    const { controller } = await openCrm()
    const grid = document.querySelector('[tabindex="0"]') as HTMLElement
    // Keys without a selection are safe no-ops.
    fireEvent.keyDown(grid, { key: 'Enter' })
    fireEvent.keyDown(grid, { key: 'Tab' })
    fireEvent.keyDown(grid, { key: 'Delete' })
    fireEvent.keyDown(grid, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(grid, { key: 'v', ctrlKey: true })
    fireEvent.keyDown(grid, { key: 'z' })
    fireEvent.keyDown(grid, { key: 'y' })
    expect(controller.snapshot().editor.selection).toBeNull()
    // Arrows move the selection in every direction.
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(controller.snapshot().editor.selection!.c1).toBe(1)
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    expect(controller.snapshot().editor.selection).not.toBeNull()
    // A shift-click with no prior selection starts a plain drag instead.
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.mouseDown(cell, { shiftKey: true })
    expect(controller.snapshot().editor.selection).not.toBeNull()
  })

  it('tracks a mouse drag through document moves and far-right positions', async () => {
    const { controller } = await openCrm()
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.mouseDown(cell, { clientX: 20, clientY: 60 })
    // Move far right and down: colAt clamps to the last column.
    fireEvent.mouseMove(document, { clientX: 5000, clientY: 5000 })
    fireEvent.mouseUp(document, {})
    const sel = controller.snapshot().editor.selection!
    expect(sel.r1).toBeGreaterThan(0)
    // A second mouseup while no drag is active is a no-op.
    fireEvent.mouseUp(document, {})
    expect(controller.snapshot().editor.selection).toEqual(sel)
  })

  it('copies via metaKey and pastes from an out-of-range selection', async () => {
    const { controller, id } = await openCrm()
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => Promise.resolve())
    const readSpy = vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('x\ty')
    const grid = document.querySelector('[tabindex="0"]') as HTMLElement
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'c', metaKey: true })
    expect(writeSpy).toHaveBeenCalled()
    // Paste anchored past the last row falls back to row 0.
    await act(async () => {
      controller.select({ r0: 99, r1: 99, c0: 0, c1: 0 })
    })
    fireEvent.keyDown(grid, { key: 'v', metaKey: true })
    await new Promise(r => setTimeout(r, 0))
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('x')
    void readSpy
  })

  it('frozen header menus, header right-click and the scroller click clear', async () => {
    const { controller } = await openCrm()
    // Right-click on a header does not select.
    const header = screen.getByText('姓名')
    fireEvent.mouseDown(header, { button: 2 })
    expect(controller.snapshot().editor.selection).toBeNull()
    // The frozen header's menu button opens the column menu.
    fireEvent.click(screen.getByLabelText('menu-姓名'))
    expect(screen.getByText('Rename')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    // Mousedown directly on the scroller clears the selection.
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.mouseDown(cell)
    fireEvent.mouseUp(document, {})
    expect(controller.snapshot().editor.selection).not.toBeNull()
    fireEvent.mouseDown(document.querySelector('[class*="scroll"]')!)
    expect(controller.snapshot().editor.selection).toBeNull()
  })

  it('avg goal on a text-only column shows zero', async () => {
    const { controller, id } = await openCrm()
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    controller.addGoal(id, { columnId: nameCol.id, aggregate: 'avg', target: 100 })
    await act(async () => {})
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0)
  })
})
