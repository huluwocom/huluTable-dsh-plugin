// @vitest-environment jsdom
/** Formula bar: complete template insertion with inferred ranges, and the
 * ∑ auto-sum writing =SUM formulas below the selection. */
import { vi, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { FormulaBar, autoSum, buildTemplates } from '../src/client/editor/FormulaBar.tsx'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type Column } from '../src/client/domain/types.ts'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

afterEach(() => { cleanup() })

const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as HulutableTranslate

/** Controller-owned table with one text and one number column. */
function makeDoc(controller: HulutableController): { id: string; doc: ReturnType<typeof createBlankTable> } {
  const id = controller.createTable('算')
  const name: Column = { id: 'n', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false }
  const amount: Column = { id: 'a', name: '金额', type: 'number', width: 100, frozen: false, hidden: false, required: false }
  controller.update((d) => {
    const doc = d.tables[id]!
    doc.columns = [name, amount]
    doc.rows = [
      { id: newId(), cells: { n: { value: 'x' }, a: { value: 1 } } },
      { id: newId(), cells: { n: { value: 'y' }, a: { value: 2 } } },
      { id: newId(), cells: { n: { value: 'z' }, a: { value: 3 } } },
    ]
  })
  return { id, doc: controller.snapshot().tables[id]! }
}

function bench() {
  const doc = createBlankTable('算')
  const name: Column = { id: 'n', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false }
  const amount: Column = { id: 'a', name: '金额', type: 'number', width: 100, frozen: false, hidden: false, required: false }
  doc.columns = [name, amount]
  doc.rows = [
    { id: newId(), cells: { n: { value: 'x' }, a: { value: 1 } } },
    { id: newId(), cells: { n: { value: 'y' }, a: { value: 2 } } },
    { id: newId(), cells: { n: { value: 'z' }, a: { value: 3 } } },
  ]
  return doc
}

describe('buildTemplates', () => {
  it('infers the range from the selection', () => {
    const doc = bench()
    const templates = buildTemplates({ r0: 1, r1: 2, c0: 1, c1: 1 }, doc, { col: 1, row: 1 })
    expect(templates.find(t => t.label === 'SUM')!.text).toBe('=SUM(B2:B3)')
    expect(templates.find(t => t.label === 'AVERAGE')!.text).toBe('=AVERAGE(B2:B3)')
    expect(templates.find(t => t.label === 'COUNT')!.text).toBe('=COUNT(B2:B3)')
  })

  it('falls back to the focused column extent without a selection', () => {
    const doc = bench()
    const templates = buildTemplates(null, doc, { col: 0, row: 0 })
    expect(templates.find(t => t.label === 'SUM')!.text).toBe('=SUM(A1:A3)')
    expect(templates.find(t => t.label === 'ROUND')!.text).toBe('=ROUND(A1, 2)')
    expect(templates.find(t => t.label === 'TODAY')!.text).toBe('=TODAY()')
  })
})

describe('autoSum', () => {
  it('writes SUM formulas one row below the selection', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const { id, doc } = makeDoc(controller)
    const row = autoSum(controller, doc, { r0: 0, r1: 1, c0: 1, c1: 1 })
    expect(row).toBe(2)
    const after = controller.snapshot().tables[id]!
    const cell = after.rows[2]!.cells['a']!
    expect(cell.formula).toBe('=SUM(B1:B2)')
    expect(cell.value).toBe(3)
  })

  it('creates the summary row when the selection reaches the last row', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const { id, doc } = makeDoc(controller)
    const row = autoSum(controller, doc, { r0: 0, r1: 2, c0: 1, c1: 1 })
    expect(row).toBe(3)
    const after = controller.snapshot().tables[id]!
    expect(after.rows).toHaveLength(4)
    expect(after.rows[3]!.cells['a']!.formula).toBe('=SUM(B1:B3)')
  })

  it('returns -1 without numeric columns in the selection', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const id = controller.createTable('算')
    const doc = controller.snapshot().tables[id]!
    expect(autoSum(controller, doc, { r0: 0, r1: 0, c0: 0, c1: 0 })).toBe(-1)
  })
})

describe('FormulaBar UI', () => {
  it('inserts a complete template and commits via Enter', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const { id, doc } = makeDoc(controller)
    render(<FormulaBar table={doc} selection={{ r0: 0, r1: 1, c0: 1, c1: 1 }} t={t} controller={controller} />)
    fireEvent.click(screen.getByText('Formulas'))
    fireEvent.click(screen.getByText('SUM'))
    const input = screen.getByDisplayValue('=SUM(B1:B2)') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    const after = controller.snapshot().tables[id]!
    expect(after.rows[0]!.cells['a']!.formula).toBe('=SUM(B1:B2)')
    expect(after.rows[0]!.cells['a']!.value).toBe(3)
  })

  it('runs the auto-sum button and moves the selection', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const { id, doc } = makeDoc(controller)
    render(<FormulaBar table={doc} selection={{ r0: 0, r1: 1, c0: 1, c1: 1 }} t={t} controller={controller} />)
    fireEvent.click(screen.getByLabelText('Auto-sum (writes SUM formulas below the selection)'))
    const after = controller.snapshot().tables[id]!
    expect(after.rows[2]!.cells['a']!.formula).toBe('=SUM(B1:B2)')
    expect(controller.snapshot().editor.selection).toEqual({ r0: 2, r1: 2, c0: 1, c1: 1 })
    expect(screen.getByText('✓')).toBeTruthy()
  })

  it('renders the hint without a selection', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const { doc } = makeDoc(controller)
    render(<FormulaBar table={doc} selection={null} t={t} controller={controller} />)
    expect(screen.getByText('Select a cell to edit its value or formula')).toBeTruthy()
  })

  it('disables the auto-sum button without numeric columns', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const { doc } = makeDoc(controller)
    render(<FormulaBar table={doc} selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }} t={t} controller={controller} />)
    const button = screen.getByLabelText('Auto-sum (writes SUM formulas below the selection)') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
