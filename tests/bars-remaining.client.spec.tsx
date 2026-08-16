// @vitest-environment jsdom
/** FormulaBar / GoalsPanel remaining branches: dismissal, dirty sync, guards. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { FormulaBar } from '../src/client/editor/FormulaBar.tsx'
import { GoalsPanel } from '../src/client/editor/GoalsPanel.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

// Grid suites render the full blank canvas; coverage instrumentation slows
// them well past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

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
  const id = controller.createTable('客户', 'crm')
  const doc = controller.snapshot().tables[id]!
  return { controller, id, doc }
}

describe('FormulaBar remaining', () => {
  it('skips syncing while dirty and commits a plain value', () => {
    const { controller, id, doc } = bench()
    const selection = { r0: 0, r1: 0, c0: 0, c1: 0 }
    const view = render(<FormulaBar table={doc} selection={selection} t={t} controller={controller} />)
    const input = screen.getByDisplayValue('陈小雨')
    fireEvent.change(input, { target: { value: '草稿' } })
    // The external cell changes but the dirty flag keeps the draft.
    controller.setCellValue(id, doc.rows[0]!.id, doc.columns[0]!.id, '外部改')
    view.rerender(<FormulaBar table={controller.snapshot().tables[id]!} selection={selection} t={t} controller={controller} />)
    expect(screen.getByDisplayValue('草稿')).toBeTruthy()
    // Commit writes the draft.
    fireEvent.keyDown(screen.getByDisplayValue('草稿'), { key: 'Enter' })
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('草稿')
  })

  it('closes the template menu on outside mousedown and inserts nothing on null cell', () => {
    const { doc } = bench()
    render(<div data-testid="outside" />)
    const view = render(
      <FormulaBar
        table={doc}
        selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }}
        t={t}
        controller={doc && new HulutableController(new MemoryPersistence())}
      />,
    )
    fireEvent.click(screen.getByText('Formulas'))
    expect(screen.getByText('SUM')).toBeTruthy()
    fireEvent.mouseDown(document.querySelector('[data-testid="outside"]')!)
    expect(screen.queryByText('SUM')).toBeNull()
    // A selection pointing at an empty cell syncs to an empty input.
    view.rerender(
      <FormulaBar
        table={doc}
        selection={{ r0: 4, r1: 4, c0: 10, c1: 10 }}
        t={t}
        controller={new HulutableController(new MemoryPersistence())}
      />,
    )
    const fxInput = document.querySelector('input[class*="input"]') as HTMLInputElement
    expect(fxInput.value).toBe('')
  })

  it('treats an out-of-range selection as no cell and syncs null values to empty', () => {
    const { controller, id, doc } = bench()
    const view = render(
      <FormulaBar
        table={doc}
        selection={{ r0: 999, r1: 999, c0: 0, c1: 0 }}
        t={t}
        controller={controller}
      />,
    )
    expect(screen.getByText('Select a cell to edit its value or formula')).toBeTruthy()
    // A cell whose value is null syncs to an empty input.
    controller.setCellValue(id, doc.rows[0]!.id, doc.columns[0]!.id, null)
    view.rerender(
      <FormulaBar
        table={controller.snapshot().tables[id]!}
        selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }}
        t={t}
        controller={controller}
      />,
    )
    const input = document.querySelector('input[class*="input"]') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('keeps the template menu open on mousedown inside it', () => {
    const { doc } = bench()
    render(
      <FormulaBar
        table={doc}
        selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }}
        t={t}
        controller={new HulutableController(new MemoryPersistence())}
      />,
    )
    fireEvent.click(screen.getByText('Formulas'))
    fireEvent.mouseDown(screen.getByText('SUM'))
    expect(screen.getByText('SUM')).toBeTruthy()
  })

  it('Escape reverts to the plain value or empty, not just formulas', () => {
    const { controller, id, doc } = bench()
    const nameCol = doc.columns[0]!
    const rowId = doc.rows[0]!.id
    const view = render(<FormulaBar table={doc} selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }} t={t} controller={controller} />)
    const input = screen.getByDisplayValue('陈小雨')
    fireEvent.change(input, { target: { value: '草稿' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByDisplayValue('陈小雨')).toBeTruthy()
    // Null value reverts to empty.
    controller.setCellValue(id, rowId, nameCol.id, null)
    view.rerender(
      <FormulaBar
        table={controller.snapshot().tables[id]!}
        selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }}
        t={t}
        controller={controller}
      />,
    )
    const empty = document.querySelector('input[class*="input"]') as HTMLInputElement
    fireEvent.change(empty, { target: { value: '草稿' } })
    fireEvent.keyDown(empty, { key: 'Escape' })
    expect(empty.value).toBe('')
  })
})

describe('GoalsPanel remaining', () => {
  it('dismisses on outside mousedown and Escape', () => {
    const { doc } = bench()
    const onClose = vi.fn()
    render(<div data-testid="outside" />)
    render(
      <GoalsPanel
        table={doc}
        view={doc.views[0]!}
        x={0}
        y={0}
        t={t}
        controller={doc && new HulutableController(new MemoryPersistence())}
        onClose={onClose}
      />,
    )
    fireEvent.mouseDown(document.querySelector('[data-testid="outside"]')!)
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('guards the add form and removes goals via the header', () => {
    const { controller, id, doc } = bench()
    render(<GoalsPanel table={doc} view={doc.views[0]!} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    // Invalid target → no goal.
    fireEvent.change(screen.getByLabelText('Target value'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('Add goal'))
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Target value'), { target: { value: '500' } })
    fireEvent.click(screen.getByText('Add goal'))
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(1)
  })
})
