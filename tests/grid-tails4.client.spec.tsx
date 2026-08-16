// @vitest-environment jsdom
/** Grid tails 4: shift-click without selection, out-of-range editing rows,
 * empty clear ranges, frozen/non-frozen header selects, non-frozen cell
 * interactions and popover dismissal. */
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
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(window, 'innerWidth', { value: 3200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
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

describe('Grid tails 4', () => {
  it('shift-click without a prior selection starts a plain drag', async () => {
    const { controller } = await openCrm()
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.mouseDown(cell, { shiftKey: true })
    // Without a prior selection the shift branch skips entirely.
    expect(controller.snapshot().editor.selection).toBeNull()
  })

  it('edits from an out-of-range row through the row fallback', async () => {
    const { controller, id } = await openCrm()
    await act(async () => {
      controller.setEditing({ row: 99, col: 0 })
    })
    const input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '回退行' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // The view-row fallback commits to row 0.
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('回退行')
  })

  it('delete with an out-of-range column range is a safe no-op', async () => {
    const { controller } = await openCrm()
    await act(async () => {
      controller.select({ r0: 0, r1: 0, c0: 99, c1: 99 })
    })
    fireEvent.keyDown(document.querySelector('[tabindex="0"]')!, { key: 'Delete' })
    expect(controller.snapshot().editor.selection).toEqual({ r0: 0, r1: 0, c0: 99, c1: 99 })
  })

  it('header mousedowns select whole columns on frozen and plain headers', async () => {
    const { controller, id } = await openCrm()
    const cols = controller.snapshot().tables[id]!.columns.length
    fireEvent.mouseDown(screen.getByText('姓名'))
    expect(controller.snapshot().editor.selection).toEqual({ r0: 0, r1: 5, c0: 0, c1: 0 })
    fireEvent.mouseDown(screen.getByText('预算'))
    const amountIdx = controller.snapshot().tables[id]!.columns.findIndex(c => c.name === '预算')
    expect(controller.snapshot().editor.selection).toEqual({ r0: 0, r1: 5, c0: amountIdx, c1: amountIdx })
    void cols
  })

  it('double-clicks a non-frozen cell and dismisses popovers via Escape', async () => {
    const { controller, id } = await openCrm()
    const contactCol = controller.snapshot().tables[id]!.columns[1]!
    const cell = screen.getAllByText('女')[0]!
    fireEvent.doubleClick(cell)
    expect(controller.snapshot().editor.editing).toMatchObject({ row: 0, col: 1 })
    fireEvent.keyDown(document.querySelector('input[class*="editInput"]')!, { key: 'Escape' })
    // A comment on a non-frozen cell opens and closes via Escape.
    controller.setComment(id, controller.snapshot().tables[id]!.rows[0]!.id, contactCol.id, '批注')
    await act(async () => {})
    fireEvent.mouseEnter(cell, { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByLabelText('comment'))
    expect(screen.getByText('批注')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('批注')).toBeNull()
  })
})
