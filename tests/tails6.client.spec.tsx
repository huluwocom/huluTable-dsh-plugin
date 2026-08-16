// @vitest-environment jsdom
/** Tail coverage: CalendarView, KanbanView drag lifecycle, FilterPopover. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { CalendarView } from '../src/client/views/CalendarView.tsx'
import { KanbanView } from '../src/client/views/KanbanView.tsx'
import { FilterPopover } from '../src/client/grid/FilterPopover.tsx'
import { newId, type View } from '../src/client/domain/types.ts'
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

/** Minimal DataTransfer for drag events (jsdom lacks it). */
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

describe('CalendarView tails', () => {
  it('handles textarea titles, null dates, empty titles and the Today button', () => {
    const { controller, id, doc } = crm()
    const dateCol = doc.columns.find(c => c.name === '下次联系日期')!
    const titleCol = doc.columns.find(c => c.name === '姓名')!
    const now = new Date()
    const day = '10'
    const curDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${day}`
    controller.update((d) => {
      const table = d.tables[id]!
      // Four events on the same (current-month) day: title fallbacks and the more hint.
      table.rows[0]!.cells[dateCol.id]!.value = curDate
      table.rows[0]!.cells[titleCol.id] = { value: '' }
      table.rows[1]!.cells[dateCol.id]!.value = curDate
      table.rows[2]!.cells[dateCol.id]!.value = curDate
      table.rows[2]!.cells[titleCol.id] = { value: '星河' }
    })
    controller.update((d) => {
      // A fourth event row plus a null-date row (skipped by the calendar).
      d.tables[id]!.rows.push(
        { id: newId(), cells: { [dateCol.id]: { value: curDate }, [titleCol.id]: { value: '第四个' } } },
        { id: newId(), cells: { [dateCol.id]: { value: null } } },
      )
    })
    const calendar = {
      ...doc.views[0]!,
      kind: 'calendar' as const,
      calendarColumnId: dateCol.id,
    }
    render(<CalendarView table={controller.snapshot().tables[id]!} view={calendar} t={t} />)
    // The empty title falls back to its date; the other events show titles.
    expect(screen.getByText(curDate)).toBeTruthy()
    expect(screen.getByText('星河')).toBeTruthy()
    // Three events shown, the fourth becomes the +1 hint.
    expect(screen.getByText('+1')).toBeTruthy()
    // Today returns to the current month after navigating away.
    fireEvent.click(screen.getByText('‹'))
    fireEvent.click(screen.getByText(/Today/))
    expect(screen.getByText(`${now.getFullYear()} 年 ${now.getMonth() + 1} 月`)).toBeTruthy()
  })

  it('renders date-only events without a title column', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const id = controller.createTable('t')
    const now = new Date()
    const curDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`
    controller.update((d) => {
      const doc = d.tables[id]!
      doc.columns = [{ id: 'd', name: '日期', type: 'date', width: 100, frozen: false, hidden: false, required: false }]
      doc.rows = [{ id: newId(), cells: { d: { value: curDate } } }]
    })
    const doc = controller.snapshot().tables[id]!
    const calendar: View = {
      id: 'v', name: '日历', kind: 'calendar', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      calendarColumnId: 'd',
    }
    render(<CalendarView table={doc} view={calendar} t={t} />)
    // No text/textarea column → the event falls back to its date.
    expect(screen.getByText(curDate)).toBeTruthy()
  })

  it('derives titles from a textarea-only column and empty title cells', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const id = controller.createTable('t')
    const now = new Date()
    const curDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`
    controller.update((d) => {
      const doc = d.tables[id]!
      doc.columns = [
        { id: 'd', name: '日期', type: 'date', width: 100, frozen: false, hidden: false, required: false },
        { id: 'note', name: '备注', type: 'textarea', width: 100, frozen: false, hidden: false, required: false },
      ]
      doc.rows = [
        { id: newId(), cells: { d: { value: curDate }, note: { value: '回访' } } },
        { id: newId(), cells: { d: { value: curDate } } },
      ]
    })
    const doc = controller.snapshot().tables[id]!
    const calendar: View = {
      id: 'v', name: '日历', kind: 'calendar', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      calendarColumnId: 'd',
    }
    render(<CalendarView table={doc} view={calendar} t={t} />)
    expect(screen.getByText('回访')).toBeTruthy()
    // The row without a note cell falls back to its date.
    expect(screen.getByText(curDate)).toBeTruthy()
  })
})

describe('KanbanView drag lifecycle', () => {
  it('drag start/over/end style lanes and drop on the unset lane clears', () => {
    const { controller, id, doc } = crm()
    const kanban = doc.views.find(v => v.kind === 'kanban')!
    render(<KanbanView table={doc} view={kanban} controller={controller} t={t} />)
    // A drag-over before any drag starts is ignored.
    fireEvent.dragOver(screen.getAllByText('已流失').at(-1)!, { dataTransfer: new DataTransfer() })
    const card = screen.getAllByText('陈小雨')[0]!
    const transfer = new DataTransfer()
    fireEvent.dragStart(card, { dataTransfer: transfer })
    // Dragging over another lane tracks the target.
    fireEvent.dragOver(screen.getAllByText('已流失').at(-1)!, { dataTransfer: transfer })
    // Ending the drag clears the drag state.
    fireEvent.dragEnd(card, { dataTransfer: transfer })
    // Dropping the card on the unset lane writes null.
    fireEvent.dragStart(card, { dataTransfer: transfer })
    fireEvent.drop(screen.getByText('Unset'), { dataTransfer: transfer })
    const statusCol = doc.columns.find(c => c.name === '跟进状态')!
    const row = controller.snapshot().tables[id]!.rows.find(r => r.cells[doc.columns.find(c => c.name === '姓名')!.id]!.value === '陈小雨')!
    expect(row.cells[statusCol.id]!.value).toBeNull()
  })

  it('renders cards without a numeric column and with missing title cells', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const id = controller.createTable('t')
    controller.update((d) => {
      const doc = d.tables[id]!
      doc.columns = [
        {
          id: 'st', name: '状态', type: 'select', width: 100, frozen: false, hidden: false, required: false,
          options: [{ id: 'a', label: '进行中', color: '' }],
        },
        { id: 'name', name: '客户', type: 'text', width: 100, frozen: false, hidden: false, required: false },
      ]
      doc.rows = [
        { id: newId(), cells: { st: { value: '进行中' } } },
        { id: newId(), cells: { st: { value: '进行中' }, name: { value: '有名字' } } },
      ]
    })
    const doc = controller.snapshot().tables[id]!
    const view: View = {
      id: 'v', name: '看板', kind: 'kanban', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      groupColumnId: 'st',
    }
    render(<KanbanView table={doc} view={view} controller={controller} t={t} />)
    expect(screen.getByText('有名字')).toBeTruthy()
    // The row without a title cell renders an empty card title.
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0)
  })
})

describe('FilterPopover tails', () => {
  it('stays open on inside events and adds unchecked options with empty colors', () => {
    const { controller, doc } = crm()
    const col = doc.columns.find(c => c.name === '跟进状态')!
    const view = doc.views[0]!
    const onClose = vi.fn()
    const view1 = render(<FilterPopover table={doc} column={col} view={view} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(screen.getByText('跟进状态'))
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    // Checking an option adds it; unchecking removes it again.
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByText('Apply'))
    expect(controller.viewOf(doc.id)!.filters).toHaveLength(0)
    // An option with an empty color renders without a chip style.
    controller.update((d) => {
      const col = d.tables[doc.id]!.columns.find(c => c.name === '跟进状态')!
      col.options = [...col.options!, { id: 'plain', label: '无色', color: '' }]
    })
    view1.rerender(
      <FilterPopover
        table={controller.snapshot().tables[doc.id]!}
        column={controller.snapshot().tables[doc.id]!.columns.find(c => c.name === '跟进状态')!}
        view={controller.viewOf(doc.id)!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={onClose}
      />,
    )
    expect(screen.getByText('无色')).toBeTruthy()
  })

  it('applies via Enter in between fields and renders optionless selects', () => {
    const { controller, doc } = crm()
    const amountCol = doc.columns.find(c => c.name === '预算')!
    const view = doc.views[0]!
    const onClose = vi.fn()
    const view1 = render(
      <FilterPopover table={doc} column={amountCol} view={view} x={0} y={0} t={t} controller={controller} onClose={onClose} />,
    )
    fireEvent.change(screen.getByLabelText('Filter op'), { target: { value: 'between' } })
    const min = screen.getByPlaceholderText('Min')
    fireEvent.change(min, { target: { value: '10' } })
    fireEvent.keyDown(min, { key: 'a' })
    fireEvent.keyDown(min, { key: 'Enter' })
    let rule = controller.viewOf(doc.id)!.filters[0]!
    expect(rule.op).toBe('between')
    expect(rule.value).toBe('10')
    expect(onClose).toHaveBeenCalledOnce()
    // Reopen: a non-Enter key on the max input does nothing, Enter applies.
    view1.rerender(
      <FilterPopover
        table={controller.snapshot().tables[doc.id]!}
        column={controller.snapshot().tables[doc.id]!.columns.find(c => c.name === '预算')!}
        view={controller.viewOf(doc.id)!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByLabelText('Filter op'), { target: { value: 'between' } })
    const max = screen.getByPlaceholderText('Max')
    fireEvent.change(max, { target: { value: '99' } })
    fireEvent.keyDown(max, { key: 'a' })
    fireEvent.keyDown(max, { key: 'Enter' })
    rule = controller.viewOf(doc.id)!.filters[0]!
    expect(rule.value2).toBe('99')
    expect(onClose).toHaveBeenCalledTimes(2)
    // A select column without options renders an empty option list.
    const bare: typeof amountCol = {
      id: 's2', name: '裸选择', type: 'select', width: 100, frozen: false, hidden: false, required: false,
    }
    view1.rerender(
      <FilterPopover table={doc} column={bare} view={doc.views[0]!} x={0} y={0} t={t} controller={controller} onClose={onClose} />,
    )
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})

describe('calendar earliest jump', () => {
  it('jumps to the month of the earliest date', () => {
    const { controller, id, doc } = crm()
    const view = doc.views.find(v => v.kind === 'calendar')!
    controller.setActiveView(id, view.id)
    const rerender = render(<CalendarView table={controller.snapshot().tables[id]!} view={controller.viewOf(id)!} t={t} />)
    fireEvent.click(screen.getByText('Earliest'))
    // The earliest CRM date is 2025-08-15 → August 2025.
    expect(screen.getByText(/2025 年 8 月/)).toBeTruthy()
    rerender.unmount()
  })
})
