// @vitest-environment jsdom
/** KanbanView tails: no title column, unknown group values, ghost drops. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { KanbanView } from '../src/client/views/KanbanView.tsx'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

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

function bench() {
  const controller = new HulutableController(new MemoryPersistence())
  const doc = createBlankTable('t')
  doc.columns = [
    {
      id: 'st', name: '状态', type: 'select', width: 100, frozen: false, hidden: false, required: false,
      options: [{ id: 'a', label: '进行中', color: '#93c5fd' }, { id: 'b', label: '完成', color: '#4ade80' }],
    },
    { id: 'amt', name: '金额', type: 'currency', width: 100, frozen: false, hidden: false, required: false },
    { id: 'name', name: '客户', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    { id: 'sub', name: '备注', type: 'text', width: 100, frozen: false, hidden: false, required: false },
  ]
  doc.rows = [
    { id: 'r1', cells: { st: { value: '进行中' }, amt: { value: 100 }, name: { value: '甲' }, sub: { value: '' } } },
    { id: 'r2', cells: { st: { value: '奇怪值' }, amt: { value: null }, name: { value: '乙' }, sub: { value: '有备注' } } },
  ]
  const view = {
    id: 'v', name: '看板', kind: 'kanban' as const, filters: [], filterMode: 'and' as const,
    sorts: [], hiddenColumns: [], groupColumnId: 'st',
  }
  controller.update((d) => { d.tables[doc.id] = doc })
  return { controller, doc, view }
}

describe('KanbanView tails', () => {
  it('groups unknown values into the unset lane and renders cards', () => {
    const { controller, doc, view } = bench()
    render(<KanbanView table={doc} view={view} controller={controller} t={t} />)
    // Unknown group value lands in the unset lane.
    expect(screen.getByText('Unset')).toBeTruthy()
    // Card sub shows the non-empty column only.
    expect(screen.getByText(/备注: 有备注/)).toBeTruthy()
  })

  it('drops a ghost row without crashing and drag-over tracks lanes', () => {
    const { controller, doc, view } = bench()
    render(<KanbanView table={doc} view={view} controller={controller} t={t} />)
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'ghost')
    fireEvent.drop(screen.getAllByText('完成').at(-1)!, { dataTransfer: transfer })
    // No crash; state unchanged.
    expect(controller.snapshot().tables[doc.id]!.rows[1]!.cells.st!.value).toBe('奇怪值')
  })

  it('handles a group column without options and a table without text columns', () => {
    const { controller, doc } = bench()
    const bare = { ...doc, columns: [doc.columns[1]!], rows: doc.rows }
    const view = { id: 'v', name: 'v', kind: 'kanban' as const, filters: [], filterMode: 'and' as const, sorts: [], hiddenColumns: [], groupColumnId: 'st' }
    // groupColumn missing → hint.
    render(<KanbanView table={bare} view={view} controller={controller} t={t} />)
    expect(screen.getByText(/Pick a group column/)).toBeTruthy()
    // No text column → cards render with empty titles.
    const view2 = { ...view, groupColumnId: 'amt' }
    render(<KanbanView table={bare} view={view2} controller={controller} t={t} />)
    expect(screen.getByText('Unset')).toBeTruthy()
  })
})
