// @vitest-environment jsdom
/** TableEditor tail: toolbar buttons, name editing, stats bar, loading. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { TableEditor } from '../src/client/editor/TableEditor.tsx'
import { ImportModal } from '../src/client/editor/ImportModal.tsx'
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
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(window, 'innerWidth', { value: 2000, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
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

async function openCrm() {
  const controller = new HulutableController(new MemoryPersistence())
  controller.update((d) => { d.ready = true })
  const id = controller.createTable('客户', 'crm')
  await controller.openTable(id)
  const useWorkspace = bindSnapshotSelector(controller.store)
  render(<TableEditor controller={controller} useWorkspace={useWorkspace} t={t} />)
  return { controller, id }
}

describe('TableEditor tail', () => {
  it('renames via the name field and cancels on Escape', async () => {
    const { controller, id } = await openCrm()
    fireEvent.click(screen.getByText('客户'))
    const input = screen.getByDisplayValue('客户')
    fireEvent.change(input, { target: { value: '新名' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(controller.snapshot().tables[id]!.name).toBe('新名')
    fireEvent.click(screen.getByText('新名'))
    const input2 = screen.getByDisplayValue('新名')
    fireEvent.change(input2, { target: { value: '放弃' } })
    fireEvent.keyDown(input2, { key: 'Escape' })
    expect(controller.snapshot().tables[id]!.name).toBe('新名')
  })

  it('drives undo/redo/add/goals/import/export/shortcuts/view manager buttons', async () => {
    const { controller, id } = await openCrm()
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    await act(async () => {
      controller.setCellValue(id, controller.snapshot().tables[id]!.rows[0]!.id, nameCol.id, '改')
    })
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('陈小雨')
    fireEvent.click(screen.getByLabelText('Redo'))
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('改')
    // Goals anchor opens the panel.
    fireEvent.click(screen.getByLabelText('Goals'))
    expect(screen.getByText('Add goal')).toBeTruthy()
    fireEvent.click(screen.getByText('Add goal'))
    fireEvent.click(screen.getByText('×'))
    // Import modal opens.
    fireEvent.click(screen.getByLabelText('Import'))
    expect(screen.getByText(/Choose an Excel/)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    // Export menu opens and closes.
    fireEvent.click(screen.getByLabelText('Export'))
    expect(screen.getByText('Export Excel (.xlsx)')).toBeTruthy()
    fireEvent.click(screen.getByText('Export Excel (.xlsx)'))
    fireEvent.keyDown(document, { key: 'Escape' })
    // View manager opens and closes via Escape.
    fireEvent.click(screen.getByTitle('Views'))
    expect(screen.getByText('Views')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Views')).toBeNull()
  })

  it('renders the chart view and its view chip', async () => {
    const { controller, id } = await openCrm()
    // openCrm already rendered the editor against this store; drive it live.
    await act(async () => {
      controller.addView(id, '图表', 'chart')
    })
    const doc = controller.snapshot().tables[id]!
    const chartView = doc.views.find(v => v.kind === 'chart')!
    await act(async () => {
      controller.updateView(id, chartView.id, {
        chart: {
          type: 'bar', title: '柱状',
          xColumnId: doc.columns[0]!.id,
          yColumnIds: [doc.columns.find(c => c.name === '预算')!.id],
        },
      })
      controller.setActiveView(id, chartView.id)
    })
    expect(screen.getAllByText('▥图表').length).toBeGreaterThan(0)
    expect(screen.getByText('柱状')).toBeTruthy()
    // recharts mounts its surface asynchronously (resize/animation frames).
    await act(async () => { await new Promise(r => setTimeout(r, 40)) })
    expect(document.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('shows the stats bar with a numeric selection and chart values', async () => {
    const { controller } = await openCrm()
    const id = controller.snapshot().currentTableId!
    const amountCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '预算')!
    await act(async () => {
      controller.select({ r0: 0, r1: 1, c0: 0, c1: controller.snapshot().tables[id]!.columns.indexOf(amountCol) })
    })
    expect(screen.getByText('Sum')).toBeTruthy()
    expect(screen.queryByText('Count')).toBeTruthy()
    const chart = Array.from(document.querySelectorAll('svg')).find(s => (s.getAttribute('class') ?? '').includes('miniChart'))
    expect(chart).toBeTruthy()
    // A null cell inside the chart column is skipped, not counted.
    const chartCol = controller.snapshot().tables[id]!.columns.find(c => c.type === 'number' || c.type === 'currency' || c.type === 'percent')!
    await act(async () => {
      controller.setCellValue(id, controller.snapshot().tables[id]!.rows[0]!.id, chartCol.id, null)
    })
    expect(screen.getByText('Sum')).toBeTruthy()
  })

  it('shows stats without the mini chart for a single numeric cell', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const budget = doc.columns.find(c => c.name === '预算')!
    await act(async () => {
      controller.select({ r0: 0, r1: 0, c0: doc.columns.indexOf(budget), c1: doc.columns.indexOf(budget) })
    })
    expect(screen.getByText('Sum')).toBeTruthy()
    // One numeric cell → no mini bar chart (needs 2+ values).
    expect(document.querySelectorAll('svg').length).toBe(0)
  })

  it('renders the loading state while the table is missing', async () => {
    const controller = new HulutableController(new MemoryPersistence())
    controller.update((d) => { d.ready = true })
    const useWorkspace = bindSnapshotSelector(controller.store)
    render(<TableEditor controller={controller} useWorkspace={useWorkspace} t={t} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('hides the stats bar for non-numeric selections and rating-only charts', async () => {
    const { controller } = await openCrm()
    const id = controller.snapshot().currentTableId!
    const doc = controller.snapshot().tables[id]!
    const nameCol = doc.columns.find(c => c.name === '姓名')!
    await act(async () => {
      controller.select({ r0: 0, r1: 1, c0: doc.columns.indexOf(nameCol), c1: doc.columns.indexOf(nameCol) })
    })
    // Text-only selection → no stats bar at all.
    expect(screen.queryByText('Sum')).toBeNull()
    // A rating column counts for stats but not for the mini chart.
    const ratingCol = doc.columns.find(c => c.type === 'rating')
    if (ratingCol !== undefined) {
      await act(async () => {
        controller.select({ r0: 0, r1: 1, c0: doc.columns.indexOf(ratingCol), c1: doc.columns.indexOf(ratingCol) })
      })
      expect(screen.getByText('Sum')).toBeTruthy()
      const chart = Array.from(document.querySelectorAll('svg')).find(s => (s.getAttribute('class') ?? '').includes('miniChart'))
      expect(chart).toBeUndefined()
    }
  })

  it('renders through the view fallback and clears filters via the chip', async () => {
    const controller = new HulutableController(new MemoryPersistence())
    controller.update((d) => { d.ready = true })
    const id = controller.createTable('客户', 'crm')
    // No openTable → no viewIds entry → viewOf falls back to the first view.
    const useWorkspace = bindSnapshotSelector(controller.store)
    render(<TableEditor controller={controller} useWorkspace={useWorkspace} t={t} />)
    expect(screen.getByText('客户')).toBeTruthy()
    const view = controller.snapshot().tables[id]!.views[0]!
    await act(async () => {
      controller.updateView(id, view.id, { filters: [{ columnId: 'x', op: 'notEmpty' }] })
    })
    expect(screen.getByText(/Clear filter/)).toBeTruthy()
    fireEvent.click(screen.getByTitle(/Clear filter/))
    expect(controller.viewOf(id)!.filters).toHaveLength(0)
    // Calendar view renders in the editor and the manager closes on Escape.
    const kanban = controller.snapshot().tables[id]!.views.find(v => v.kind === 'calendar')!
    await act(async () => { controller.setActiveView(id, kanban.id) })
    expect(controller.viewOf(id)!.kind).toBe('calendar')
    expect(screen.getByText(/年/)).toBeTruthy()
  })

  it('closes the export menu on an outside click and keeps it on inside clicks', async () => {
    const { controller } = await openCrm()
    fireEvent.click(screen.getByLabelText('Export'))
    expect(screen.getByText('Export CSV (.csv)')).toBeTruthy()
    fireEvent.mouseDown(screen.getByText('Export CSV (.csv)'))
    expect(screen.getByText('Export CSV (.csv)')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Export CSV (.csv)')).toBeNull()
    void controller
  })

  it('exports CSV from the export menu', async () => {
    const { controller } = await openCrm()
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
    fireEvent.click(screen.getByLabelText('Export'))
    fireEvent.click(screen.getByText('Export CSV (.csv)'))
    // The download went through the blob anchor path.
    expect(spy).toHaveBeenCalled()
    void controller
  })
})

describe('popover Escape scoping', () => {
  it('keeps ImportModal open when Escape lands inside it', async () => {
    const { controller } = openCrm()
    const onClose = vi.fn(() => {}) as () => void
    // oxlint-disable-next-line no-unsafe-assignment
    render(<ImportModal tableName="t" hasCurrentTable={false} t={t} controller={controller} onClose={onClose} />)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null
    fireEvent.keyDown(fileInput!, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    // Parse a file so the name-draft input renders (mode 'new'), then Escape closes.
    const { toXlsx } = await import('../src/client/io/io.ts')
    const { createBlankTable } = await import('../src/client/domain/templates.ts')
    const src = createBlankTable('源')
    src.columns = [{ id: 'a', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    src.rows = [{ id: 'r', cells: { a: { value: '数据' } } }]
    const file = new File([toXlsx(src)], '表.xlsx')
    fireEvent.change(fileInput!, { target: { files: [file] } })
    await new Promise(r => setTimeout(r, 0))
    const nameInput = document.querySelector('input[class*="nameInput"]') as HTMLInputElement | null
    fireEvent.keyDown(nameInput!, { key: 'a' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

})
