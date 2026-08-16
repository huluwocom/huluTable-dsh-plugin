// @vitest-environment jsdom
/** Kanban/calendar views and the editor bars (fx + command). */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { KanbanView } from '../src/client/views/KanbanView.tsx'
import { CalendarView } from '../src/client/views/CalendarView.tsx'
import { FormulaBar } from '../src/client/editor/FormulaBar.tsx'
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

function openCrm() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('客户', 'crm')
  const doc = controller.snapshot().tables[id]!
  return { controller, id, doc }
}

describe('KanbanView', () => {
  it('renders lanes from options plus the unset lane', () => {
    const { controller, id, doc } = openCrm()
    const kanban = doc.views.find(v => v.kind === 'kanban')!
    render(<KanbanView table={doc} view={kanban} controller={controller} t={t} />)
    expect(screen.getByText('新线索')).toBeTruthy()
    expect(screen.getByText('已成交')).toBeTruthy()
    expect(screen.getByText('Unset')).toBeTruthy()
    // Cards show the title column value.
    expect(screen.getAllByText('陈小雨').length).toBeGreaterThan(0)
    void id
  })

  it('shows a hint when the group column is missing', () => {
    const { controller, doc } = openCrm()
    const view = { ...doc.views.find(v => v.kind === 'kanban')!, groupColumnId: undefined }
    render(<KanbanView table={doc} view={view} controller={controller} t={t} />)
    expect(screen.getByText(/Pick a group column/)).toBeTruthy()
  })

  it('moves cards between lanes on drop', () => {
    const { controller, id, doc } = openCrm()
    const kanban = doc.views.find(v => v.kind === 'kanban')!
    const nameCol = doc.columns.find(c => c.name === '姓名')!
    const statusCol = doc.columns.find(c => c.name === '跟进状态')!
    const rowId = doc.rows.find(r => r.cells[nameCol.id]!.value === '陈小雨')!.id
    render(<KanbanView table={doc} view={kanban} controller={controller} t={t} />)
    const transfer = new DataTransfer()
    transfer.setData('text/plain', rowId)
    fireEvent.drop(screen.getAllByText('已成交').at(-1)!, { dataTransfer: transfer })
    expect(controller.snapshot().tables[id]!.rows.find(r => r.id === rowId)!.cells[statusCol.id]!.value).toBe('已成交')
  })

  it('drops an empty payload without changes', () => {
    const { controller, id, doc } = openCrm()
    const kanban = doc.views.find(v => v.kind === 'kanban')!
    render(<KanbanView table={doc} view={kanban} controller={controller} t={t} />)
    const before = controller.snapshot().tables[id]!.rows.map(r => r.cells[doc.columns.find(c => c.name === '跟进状态')!.id]!.value)
    fireEvent.drop(screen.getAllByText('已成交').at(-1)!, { dataTransfer: new DataTransfer() })
    const after = controller.snapshot().tables[id]!.rows.map(r => r.cells[doc.columns.find(c => c.name === '跟进状态')!.id]!.value)
    expect(after).toEqual(before)
  })
})

describe('CalendarView', () => {
  it('renders the month grid with events and navigates', () => {
    const { doc } = openCrm()
    const dateCol = doc.columns.find(c => c.name === '下次联系日期')!
    const calendar = {
      ...doc.views[0]!,
      kind: 'calendar' as const,
      calendarColumnId: dateCol.id,
    }
    const view = render(<CalendarView table={doc} view={calendar} t={t} />)
    // Navigate to the month of the template's first date (2025-08).
    const firstDate = String(doc.rows[0]!.cells[dateCol.id]!.value)
    const target = new Date(firstDate)
    for (let guard = 0; guard < 24; guard += 1) {
      const now = new Date()
      const title = screen.getByText(/年/).textContent ?? ''
      const match = /(\d{4}) 年 (\d{1,2}) 月/.exec(title)
      if (match !== null && Number(match[1]) === target.getFullYear() && Number(match[2]) === target.getMonth() + 1) break
      fireEvent.click(screen.getByText(now.getTime() > target.getTime() ? '‹' : '›'))
    }
    expect(screen.getByText(/2025 年 8 月/)).toBeTruthy()
    expect(screen.getAllByText(/陈小雨/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('‹'))
    expect(screen.getByText(/2025 年 7 月/)).toBeTruthy()
    fireEvent.click(screen.getByText('›'))
    fireEvent.click(screen.getByText('›'))
    expect(screen.getByText(/2025 年 9 月/)).toBeTruthy()
    void view
  })

  it('shows a hint when the calendar column is missing', () => {
    const { doc } = openCrm()
    render(<CalendarView table={doc} view={doc.views[0]!} t={t} />)
    expect(screen.getByText(/Pick a date column/)).toBeTruthy()
  })
})

describe('FormulaBar', () => {
  it('shows the address and commits values and formulas', () => {
    const { controller, id, doc } = openCrm()
    const selection = { r0: 0, r1: 0, c0: 0, c1: 0 }
    const view = render(<FormulaBar table={doc} selection={selection} t={t} controller={controller} />)
    expect(screen.getByText('A1')).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('陈小雨'), { target: { value: '=1+1' } })
    fireEvent.keyDown(screen.getByDisplayValue('=1+1'), { key: 'Enter' })
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.formula).toBe('=1+1')
    // Escape reverts the input.
    view.rerender(<FormulaBar table={controller.snapshot().tables[id]!} selection={selection} t={t} controller={controller} />)
    fireEvent.keyDown(screen.getByDisplayValue('=1+1'), { key: 'Escape' })
    expect(screen.getByDisplayValue('=1+1')).toBeTruthy()
    // No selection → hint bar.
    view.rerender(<FormulaBar table={doc} selection={null} t={t} controller={controller} />)
    expect(screen.getByText('Select a cell to edit its value or formula')).toBeTruthy()
  })

  it('inserts a formula template', () => {
    const { controller, doc } = openCrm()
    render(<FormulaBar table={doc} selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }} t={t} controller={controller} />)
    fireEvent.click(screen.getByText('Formulas'))
    fireEvent.click(screen.getByText('SUM'))
    expect(screen.getByDisplayValue('=SUM(A1:A1)')).toBeTruthy()
  })
})

export { bindSnapshotSelector }
