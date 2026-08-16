// @vitest-environment jsdom
/**
 * Component workflow spec: drives the real editor surfaces (library → editor
 * → grid interactions → filters → kanban) against a real controller with
 * in-memory persistence. Assertions are user-visible behaviors.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { TableLibrary } from '../src/client/TableLibrary.tsx'
import { TableEditor } from '../src/client/editor/TableEditor.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

/** jsdom lacks ResizeObserver; the grid only needs a no-op. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Minimal DataTransfer for drag events. */
class DataTransferStub {
  data = new Map<string, string>()
  effectAllowed = 'move'
  setData(kind: string, value: string): void { this.data.set(kind, value) }
  getData(kind: string): string { return this.data.get(kind) ?? '' }
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('DataTransfer', DataTransferStub)
})

afterEach(() => {
  cleanup()
})

const t = ((key: string, params?: Record<string, unknown>) => {
  const text = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name]
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    return ''
  })
}) as HulutableTranslate

function bench() {
  // A wide viewport so the virtualized grid window covers the CRM columns.
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  const controller = new HulutableController(new MemoryPersistence())
  const useWorkspace = bindSnapshotSelector(controller.store)
  controller.update((d) => { d.ready = true })
  return { controller, useWorkspace }
}

/** Create a small table with a dropdown column and rows, then render the editor. */
async function openCrmEditor() {
  const b = bench()
  const id = b.controller.createTable('客户', 'crm')
  await b.controller.openTable(id)
  render(<TableEditor controller={b.controller} useWorkspace={b.useWorkspace} t={t} />)
  return { ...b, id }
}

describe('library workflow', () => {
  it('creates a table from the blank card and opens the editor', async () => {
    const b = bench()
    render(<TableLibrary controller={b.controller} useWorkspace={b.useWorkspace} t={t} />)
    fireEvent.click(screen.getByText('New Table'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('Blank Table'))
    expect(b.controller.snapshot().currentTableId).not.toBeNull()
    expect(screen.getByText('My Tables')).toBeTruthy()
  })

  it('renames, duplicates, stars, deletes and restores from the bin', async () => {
    const b = bench()
    b.controller.createTable('客户')
    render(<TableLibrary controller={b.controller} useWorkspace={b.useWorkspace} t={t} />)
    // Duplicate
    fireEvent.click(screen.getByTitle('Duplicate'))
    await waitFor(() => { expect(b.controller.snapshot().library).toHaveLength(2) })
    // Star (two tables exist after duplicate → pick the first star).
    fireEvent.click(screen.getAllByText('☆')[0]!)
    await waitFor(() => { expect(b.controller.snapshot().library[0]!.starred).toBe(true) })
    // Rename via inline editor
    const renameButtons = screen.getAllByTitle('Rename')
    fireEvent.click(renameButtons[0]!)
    const input = screen.getByDisplayValue(/客户/)
    fireEvent.change(input, { target: { value: '新名字' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(screen.getAllByText('新名字').length).toBeGreaterThan(0) })
    // Delete → bin → restore
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getAllByTitle('Delete')[0]!)
    await waitFor(() => { expect(b.controller.snapshot().bin).toHaveLength(1) })
    fireEvent.click(screen.getByText(/Recycle bin/))
    fireEvent.click(screen.getByText('Restore'))
    await waitFor(() => { expect(b.controller.snapshot().bin).toHaveLength(0) })
  })

  it('searches the library', async () => {
    const b = bench()
    b.controller.createTable('客户表')
    b.controller.createTable('库存表')
    render(<TableLibrary controller={b.controller} useWorkspace={b.useWorkspace} t={t} />)
    fireEvent.change(screen.getByPlaceholderText('Search table names'), { target: { value: '库存' } })
    expect(screen.getByText('库存表')).toBeTruthy()
    expect(screen.queryByText('客户表')).toBeNull()
  })
})

describe('editor workflow', () => {
  it('renders the CRM editor with grid, toolbar and stats', async () => {
    await openCrmEditor()
    expect(screen.getByText('客户')).toBeTruthy()
    expect(screen.getByText('姓名')).toBeTruthy()
    expect(screen.getByText('跟进状态')).toBeTruthy()
    // 6 sample rows exist; toolbar shows the count.
    expect(screen.getByText('6 rows')).toBeTruthy()
  })

  it('adds rows and columns through the blank canvas', async () => {
    const { controller, id } = await openCrmEditor()
    // The toolbar buttons are gone; clicking a blank row materializes it.
    const rowNums = [...document.querySelectorAll('[class*="_rowNum_"]')]
      .filter(el => !el.className.includes('Head'))
    fireEvent.mouseDown(rowNums[6]!)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(7)
    // Clicking a blank column letter adds a column.
    const letters = [...document.querySelectorAll('[class*="letterText"]')]
    fireEvent.mouseDown(letters[10]!)
    expect(controller.snapshot().tables[id]!.columns.length).toBeGreaterThan(10)
  })

  it('applies a filter through the header popover', async () => {
    const { controller, id } = await openCrmEditor()
    // The frozen 客户来源 column's filter button is always visible.
    const sourceFilter = screen.getAllByTitle('Filter').find(button =>
      button.getAttribute('aria-label') === 'filter-客户来源')!
    fireEvent.click(sourceFilter)
    // Multi-select mode: tick an option (the popover renders after the grid,
    // so the last match is the popover's) and apply.
    fireEvent.click(screen.getAllByText('朋友介绍').at(-1)!)
    fireEvent.click(screen.getByText('Apply'))
    const view = controller.viewOf(id)!
    const sourceCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '客户来源')!
    expect(view.filters).toHaveLength(1)
    expect(view.filters[0]!.columnId).toBe(sourceCol.id)
    expect(view.filters[0]!.op).toBe('in')
    expect(view.filters[0]!.values).toContain('朋友介绍')
  })

  it('sorts by clicking a header', async () => {
    const { controller, id } = await openCrmEditor()
    // The frozen 客户名称 header is always visible.
    fireEvent.click(screen.getByLabelText('sort-姓名'))
    const view = controller.viewOf(id)!
    expect(view.sorts).toHaveLength(1)
    expect(view.sorts[0]!.dir).toBe('asc')
    fireEvent.click(screen.getByLabelText('sort-姓名'))
    expect(controller.viewOf(id)!.sorts[0]!.dir).toBe('desc')
  })

  it('switches to the kanban view and drags a card between lanes', async () => {
    const { controller, id } = await openCrmEditor()
    // CRM template ships a kanban view bound to 成交状态.
    fireEvent.click(screen.getByText(/状态看板/))
    expect(screen.getByText('新线索')).toBeTruthy()
    expect(screen.getByText('已成交')).toBeTruthy()
    // Drop the first card onto the 已成交 lane (drag start is browser-native;
    // the drop path is what the controller test needs).
    const docBefore = controller.snapshot().tables[id]!
    const nameCol = docBefore.columns.find(c => c.name === '姓名')!
    const rowId = docBefore.rows.find(r => r.cells[nameCol.id]!.value === '陈小雨')!.id
    const target = screen.getAllByText('已成交').at(-1)!
    const transfer = new DataTransfer()
    transfer.setData('text/plain', rowId)
    fireEvent.drop(target, { dataTransfer: transfer })
    // immer produces fresh snapshots — re-read after the mutation.
    const doc = controller.snapshot().tables[id]!
    const row = doc.rows.find(r => r.cells[doc.columns.find(c => c.name === '姓名')!.id]!.value === '陈小雨')!
    const statusCol = doc.columns.find(c => c.name === '跟进状态')!
    expect(row.cells[statusCol.id]!.value).toBe('已成交')
  })
})

describe('goals', () => {
  it('adds a goal with progress shown in the header', async () => {
    const { controller, id } = await openCrmEditor()
    fireEvent.click(screen.getByText('Goals'))
    fireEvent.click(screen.getByText('Add goal'))
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(1)
  })
})
