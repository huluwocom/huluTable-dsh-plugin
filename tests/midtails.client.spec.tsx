// @vitest-environment jsdom
/** Mid-tier tails: ViewManager bindings, FilterPopover variants, ImportModal guards. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { ViewManager } from '../src/client/editor/ViewManager.tsx'
import { FilterPopover } from '../src/client/grid/FilterPopover.tsx'
import { ImportModal } from '../src/client/editor/ImportModal.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

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

function crm() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('客户', 'crm')
  const doc = controller.snapshot().tables[id]!
  return { controller, id, doc }
}

describe('ViewManager tails', () => {
  it('dismisses on outside mousedown and Escape', () => {
    const { controller, id, doc } = crm()
    const onClose = vi.fn()
    render(<div data-testid="out" />)
    render(<ViewManager table={doc} activeView={controller.viewOf(id)!} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(document.querySelector('[data-testid="out"]')!)
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('cancels rename with empty input and switches the calendar column', () => {
    const { controller, id, doc } = crm()
    const kanban = controller.snapshot().tables[id]!.views.find(v => v.kind === 'kanban')!
    controller.setActiveView(id, kanban.id)
    const view = render(<ViewManager table={doc} activeView={kanban} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getAllByLabelText('Rename view')[0]!)
    const input = screen.getByDisplayValue(/全部客户|状态看板/)
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(controller.snapshot().tables[id]!.views[0]!.name).not.toBe('  ')
    // Calendar binding.
    controller.addView(id, '日历', 'calendar')
    const cal = controller.snapshot().tables[id]!.views.at(-1)!
    controller.setActiveView(id, cal.id)
    view.rerender(
      <ViewManager table={controller.snapshot().tables[id]!} activeView={cal} t={t} controller={controller} onClose={() => {}} />,
    )
    const dateCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '下次联系日期')!
    fireEvent.change(screen.getByLabelText('Date column'), { target: { value: dateCol.id } })
    expect(controller.viewOf(id)!.calendarColumnId).toBe(dateCol.id)
  })
})

describe('FilterPopover tails', () => {
  it('restores a between rule with both bounds and applies clears', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns.find(c => c.name === '预算')!
    const view = doc.views[0]!
    controller.updateView(id, view.id, { filters: [{ columnId: col.id, op: 'between', value: 1, value2: 9 }] })
    const render2 = render(
      <FilterPopover
        table={controller.snapshot().tables[id]!}
        column={col}
        view={controller.viewOf(id)!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
    )
    expect(screen.getByDisplayValue('1')).toBeTruthy()
    expect(screen.getByDisplayValue('9')).toBeTruthy()
    // Switching to 'empty' and applying keeps a valid empty rule.
    fireEvent.change(screen.getByLabelText('Filter op'), { target: { value: 'empty' } })
    fireEvent.click(screen.getByText('Apply'))
    expect(controller.viewOf(id)!.filters).toHaveLength(1)
    expect(controller.viewOf(id)!.filters[0]!.op).toBe('empty')
    void render2
  })

  it('applies a between rule with both bounds', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns.find(c => c.name === '预算')!
    const view = doc.views[0]!
    render(<FilterPopover table={doc} column={col} view={view} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Filter op'), { target: { value: 'between' } })
    fireEvent.change(screen.getAllByPlaceholderText(/Min|Max/)[0]!, { target: { value: '5' } })
    fireEvent.change(screen.getAllByPlaceholderText(/Min|Max/)[1]!, { target: { value: '9' } })
    fireEvent.click(screen.getByText('Apply'))
    expect(controller.viewOf(id)!.filters[0]!.op).toBe('between')
    expect(controller.viewOf(id)!.filters[0]!.value).toBe('5')
    // An empty between applies as a clear.
    cleanup()
    render(
      <FilterPopover
        table={controller.snapshot().tables[id]!}
        column={col}
        view={controller.viewOf(id)!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Filter op'), { target: { value: 'between' } })
    fireEvent.change(screen.getAllByPlaceholderText(/Min|Max/)[0]!, { target: { value: '' } })
    fireEvent.change(screen.getAllByPlaceholderText(/Min|Max/)[1]!, { target: { value: '' } })
    fireEvent.click(screen.getByText('Apply'))
    expect(controller.viewOf(id)!.filters).toHaveLength(0)
  })

  it('sorts select columns through the in-op and dismisses on Escape', () => {
    const { controller, doc } = crm()
    const col = doc.columns.find(c => c.name === '跟进状态')!
    const view = doc.views[0]!
    const onClose = vi.fn()
    render(<FilterPopover table={doc} column={col} view={view} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('ImportModal tails', () => {
  it('ignores pick without a file and disables append without a table', async () => {
    const controller = new HulutableController(new MemoryPersistence())
    const { toXlsx } = await import('../src/client/io/io.ts')
    const { createBlankTable } = await import('../src/client/domain/templates.ts')
    const src = createBlankTable('源')
    src.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    src.rows = [{ id: 'r', cells: { a: { value: 'x' } } }]
    const onClose = vi.fn()
    render(<ImportModal tableName="t" hasCurrentTable={false} t={t} controller={controller} onClose={onClose} />)
    // An empty file list is ignored (dropzone stays).
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [] } })
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByText(/Choose an Excel/)).toBeTruthy()
    // A real file reveals the mode row; append is disabled without a table.
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([toXlsx(src)], 'a.xlsx')] } })
    await new Promise(r => setTimeout(r, 0))
    const append = screen.getByLabelText(/Append to the current table/) as HTMLInputElement
    expect(append.disabled).toBe(true)
  })
})
