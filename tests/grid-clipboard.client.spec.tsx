// @vitest-environment jsdom
/** Grid clipboard: Ctrl+C/Ctrl+V through the keyboard path. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController, type HulutableState } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { Grid } from '../src/client/grid/Grid.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
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

describe('Grid clipboard', () => {
  it('copies the selection and pastes over it', async () => {
    const { controller } = await openCrm()
    const id = controller.snapshot().currentTableId!
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => Promise.resolve())
    vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('甲\t乙\n丙\t丁')
    const grid = document.querySelector('[tabindex="0"]') as HTMLElement
    // Select A1:B2 via keyboard (shift keeps the top-left anchor).
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(grid, { key: 'c', ctrlKey: true })
    expect(writeSpy).toHaveBeenCalledOnce()
    const payload = writeSpy.mock.calls[0]![0]
    expect(payload).toContain('陈小雨')
    expect(payload).toContain('陈小雨')
    // Paste onto the selection start.
    fireEvent.keyDown(grid, { key: 'v', ctrlKey: true })
    await new Promise(r => setTimeout(r, 0))
    const table = controller.snapshot().tables[id]!
    const nameCol = table.columns[0]!
    const contactCol = table.columns[1]!
    expect(table.rows[0]!.cells[nameCol.id]!.value).toBe('甲')
    expect(table.rows[0]!.cells[contactCol.id]!.value).toBe('乙')
    expect(table.rows[1]!.cells[nameCol.id]!.value).toBe('丙')
    // Undo via keyboard shortcut.
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('陈小雨')
    fireEvent.keyDown(grid, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('甲')
    // Redo via Ctrl+Y.
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(grid, { key: 'y', ctrlKey: true })
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('甲')
  })
})
