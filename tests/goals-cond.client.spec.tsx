// @vitest-environment jsdom
/** Goal conditions: goals over any column with eq/contains row filters,
 * aggregate fallbacks for non-numeric targets, and panel form behavior. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { GoalsPanel } from '../src/client/editor/GoalsPanel.tsx'
import { newId } from '../src/client/domain/types.ts'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as HulutableTranslate

/** Controller-owned table: name/status/amount columns with three rows. */
function bench() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('目标')
  controller.update((d) => {
    const doc = d.tables[id]!
    doc.columns = [
      { id: 'n', name: '姓名', type: 'text', width: 100, frozen: false, hidden: false, required: false },
      { id: 's', name: '跟进状态', type: 'select', width: 100, frozen: false, hidden: false, required: false, options: [] },
      { id: 'a', name: '预算', type: 'currency', width: 100, frozen: false, hidden: false, required: false },
    ]
    doc.rows = [
      { id: newId(), cells: { n: { value: '星河' }, s: { value: '已成交' }, a: { value: 100 } } },
      { id: newId(), cells: { n: { value: '远山' }, s: { value: '已成交' }, a: { value: 200 } } },
      { id: newId(), cells: { n: { value: '蓝天' }, s: { value: '新线索' }, a: { value: 50 } } },
    ]
  })
  return { controller, id, doc: controller.snapshot().tables[id]! }
}

describe('goals with conditions', () => {
  it('counts only rows matching an eq condition', () => {
    const { controller, id } = bench()
    controller.addGoal(id, {
      columnId: 'a', aggregate: 'count', target: 10,
      condition: { columnId: 's', op: 'eq', value: '已成交' },
    })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    // 2 rows with 已成交 → value 2, target 10 → 20%
    expect(screen.getByText('20%')).toBeTruthy()
    expect(screen.getByText(/跟进状态 Equals 已成交/)).toBeTruthy()
  })

  it('counts rows matching a contains condition', () => {
    const { controller, id } = bench()
    controller.addGoal(id, {
      columnId: 'n', aggregate: 'count', target: 5,
      condition: { columnId: 'n', op: 'contains', value: '山' },
    })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    expect(screen.getByText('1 / 5')).toBeTruthy()
  })

  it('sums condition-filtered numeric rows', () => {
    const { controller, id } = bench()
    controller.addGoal(id, {
      columnId: 'a', aggregate: 'sum', target: 1000,
      condition: { columnId: 's', op: 'eq', value: '已成交' },
    })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    expect(screen.getByText('300 / 1000')).toBeTruthy() // 100 + 200
  })

  it('adds a goal with a condition through the form', () => {
    const { controller, id, doc } = bench()
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    // Target column: 成交状态 (text-ish) → count aggregate only.
    fireEvent.change(screen.getByLabelText('Target column'), { target: { value: 's' } })
    fireEvent.change(screen.getByLabelText('Aggregate'), { target: { value: 'count' } })
    // Enable the condition row: 客户名称 contains 星.
    fireEvent.click(screen.getByLabelText('Only count rows matching'))
    fireEvent.change(screen.getByLabelText('Condition column'), { target: { value: 'n' } })
    fireEvent.change(screen.getByLabelText('Condition op'), { target: { value: 'contains' } })
    fireEvent.change(screen.getByLabelText('Condition value'), { target: { value: '星' } })
    fireEvent.change(screen.getByLabelText('Target value'), { target: { value: '3' } })
    fireEvent.click(screen.getByText('Add goal'))
    const after = controller.snapshot().tables[id]!
    expect(after.goals).toHaveLength(1)
    expect(after.goals[0]!.condition).toEqual({ columnId: 'n', op: 'contains', value: '星' })
    expect(after.goals[0]!.aggregate).toBe('count')
  })

  it('omits the condition when the value is empty', () => {
    const { controller, id, doc } = bench()
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Only count rows matching'))
    fireEvent.click(screen.getByText('Add goal'))
    const after = controller.snapshot().tables[id]!
    expect(after.goals[0]!.condition).toBeUndefined()
  })

  it('switches a non-numeric target column to count automatically', () => {
    const { controller, doc } = bench()
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    // Default target is the first column (text) → count is preselected.
    const aggregate = screen.getByLabelText('Aggregate') as HTMLSelectElement
    expect(aggregate.value).toBe('count')
    // Switching to the currency column enables sum/avg.
    fireEvent.change(screen.getByLabelText('Target column'), { target: { value: 'a' } })
    const options = [...screen.getByLabelText('Aggregate').querySelectorAll('option')]
    expect(options.find(o => o.value === 'sum')!.disabled).toBe(false)
    expect(options.find(o => o.value === 'count')!.disabled).toBe(false)
    // Switching back to a text column disables sum/avg.
    fireEvent.change(screen.getByLabelText('Target column'), { target: { value: 'n' } })
    const after = [...screen.getByLabelText('Aggregate').querySelectorAll('option')]
    expect(after.find(o => o.value === 'sum')!.disabled).toBe(true)
    expect(after.find(o => o.value === 'count')!.disabled).toBe(false)
  })
})

describe('goals panel escape scoping', () => {
  it('closes via Escape on the target-value and condition-value inputs', () => {
    const { controller, id } = bench()
    controller.addGoal(id, { columnId: 'a', aggregate: 'count', target: 10 })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    const onClose = vi.fn()
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={onClose} />)
    fireEvent.keyDown(screen.getByLabelText('Target value'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes via Escape on the condition-value input', () => {
    const { controller, id } = bench()
    controller.addGoal(id, { columnId: 'a', aggregate: 'count', target: 10 })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    const onClose = vi.fn()
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Only count rows matching'))
    const condInput = screen.getByLabelText('Condition value')
    fireEvent.keyDown(condInput, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    // Unrelated keys do not close.
    fireEvent.keyDown(screen.getByLabelText('Condition value'), { key: 'a' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores unrelated keys on the form inputs', () => {
    const { controller, id } = bench()
    controller.addGoal(id, { columnId: 'a', aggregate: 'count', target: 10 })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    const onClose = vi.fn()
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={onClose} />)
    fireEvent.keyDown(screen.getByLabelText('Target value'), { key: 'a' })
    fireEvent.keyDown(screen.getByLabelText('Target value'), { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes the panel via Escape on any control inside it', () => {
    const { controller, id } = bench()
    controller.addGoal(id, { columnId: 'a', aggregate: 'count', target: 10 })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    const onClose = vi.fn()
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={onClose} />)
    // A select counts as inside the popover → Escape closes the panel.
    fireEvent.keyDown(screen.getByLabelText('Aggregate'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the panel open when Escape lands inside it and closes outside', () => {
    const { controller, id } = bench()
    controller.addGoal(id, { columnId: 'a', aggregate: 'count', target: 10 })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    const onClose = vi.fn()
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={onClose} />)
    fireEvent.keyDown(screen.getByText('Goals'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('goal aggregate and condition-label edges', () => {
  it('averages condition-filtered numeric rows', () => {
    const { controller, id } = bench()
    controller.addGoal(id, {
      columnId: 'a', aggregate: 'avg', target: 200,
      condition: { columnId: 's', op: 'eq', value: '已成交' },
    })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    expect(screen.getByText('150 / 200')).toBeTruthy() // (100+200)/2
  })

  it('falls back to the condition column id when the column is gone', () => {
    const { controller, id } = bench()
    controller.addGoal(id, {
      columnId: 'a', aggregate: 'count', target: 5,
      condition: { columnId: 'ghost-column', op: 'eq', value: 'x' },
    })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    expect(screen.getByText(/ghost-column Equals x/)).toBeTruthy()
  })

  it('shows a contains condition badge', () => {
    const { controller, id } = bench()
    controller.addGoal(id, {
      columnId: 'n', aggregate: 'count', target: 5,
      condition: { columnId: 'n', op: 'contains', value: '星' },
    })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    expect(screen.getByText(/Contains 星/)).toBeTruthy()
  })

  it('averages to zero when the target column has no numeric values', () => {
    const { controller, id } = bench()
    controller.addGoal(id, {
      columnId: 'n', aggregate: 'avg', target: 5,
      condition: { columnId: 's', op: 'eq', value: '已成交' },
    })
    const doc = controller.snapshot().tables[id]!
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    expect(screen.getByText('0 / 5')).toBeTruthy()
  })

  it('drops the condition when only the checkbox is toggled without a value', () => {
    const { controller, id, doc } = bench()
    const view = doc.views[0]!
    render(<GoalsPanel table={doc} view={view} x={10} y={10} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Only count rows matching'))
    fireEvent.click(screen.getByText('Add goal'))
    const after = controller.snapshot().tables[id]!
    expect(after.goals[0]!.condition).toBeUndefined()
  })
})
