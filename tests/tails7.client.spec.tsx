// @vitest-environment jsdom
/** Tail coverage: ColumnSettingsPanel edges. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { ColumnSettingsPanel } from '../src/client/grid/ColumnSettingsPanel.tsx'
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

function crm() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('客户', 'crm')
  const doc = controller.snapshot().tables[id]!
  return { controller, id, doc }
}

describe('ColumnSettingsPanel tails', () => {
  it('stays open on inside events and ignores invalid widths', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns[1]!
    const onClose = vi.fn()
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(screen.getByLabelText('Name'))
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    // A too-small width is rejected.
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '10' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.width).toBe(140)
  })

  it('toggles freeze and hide and clears the regex pattern', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns[1]!
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Freeze column'))
    fireEvent.click(screen.getByLabelText('Hide column'))
    expect(controller.snapshot().tables[id]!.columns[1]!.frozen).toBe(true)
    expect(controller.snapshot().tables[id]!.columns[1]!.hidden).toBe(true)
    // Regex validation: type then clear → the pattern is removed.
    fireEvent.change(screen.getByLabelText('Format validation'), { target: { value: 'regex' } })
    const pattern = screen.getByPlaceholderText('Regex pattern')
    fireEvent.change(pattern, { target: { value: '^A' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.validation?.pattern).toBe('^A')
    fireEvent.change(pattern, { target: { value: '' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.validation?.pattern).toBeUndefined()
  })

  it('handles option colors, allowCustom and the source-mode hint', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns.find(c => c.name === '跟进状态')!
    controller.update((d) => {
      d.tables[id]!.columns.find(c => c.id === col.id)!.options!.push({ id: 'plain', label: '无色', color: '' })
    })
    render(
      <ColumnSettingsPanel
        table={controller.snapshot().tables[id]!}
        column={controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
    )
    // The empty-colored option shows the placeholder swatch value.
    expect(screen.getByDisplayValue('#94a3b8')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Allow custom values'))
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.linked?.allowCustom).toBe(true)
    // Source mode renders the hint.
    fireEvent.change(screen.getByLabelText('Cascading dropdown'), { target: { value: 'source' } })
    expect(screen.getByText(/current distinct values/)).toBeTruthy()
  })

  it('unlinks to none and toggles mapped options off', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns.find(c => c.name === '跟进状态')!
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Cascading dropdown'), { target: { value: 'map' } })
    // Pick a source column that has options so the map boxes render.
    const srcCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '客户来源')!
    fireEvent.change(screen.getByLabelText('Source column'), { target: { value: srcCol.id } })
    // The map boxes list each source option; toggle one on then off.
    const boxes = screen.getAllByRole('checkbox')
    // The first map checkbox belongs to a different source option than the last.
    fireEvent.click(boxes[4]!)
    expect((boxes[4] as HTMLInputElement).checked).toBe(true)
    fireEvent.click(boxes[boxes.length - 1]!)
    expect((boxes[boxes.length - 1] as HTMLInputElement).checked).toBe(true)
    const linked = controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.linked
    expect(Object.values(linked?.map ?? {}).some(list => list.length > 0)).toBe(true)
    fireEvent.click(boxes[4]!)
    expect((boxes[4] as HTMLInputElement).checked).toBe(false)
    const linkedAfter = controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.linked
    // Unchecking removes that source option's mapping; the other stays.
    expect(Object.values(linkedAfter?.map ?? {})).toHaveLength(1)
    // Switching back to none removes the linkage.
    fireEvent.change(screen.getByLabelText('Cascading dropdown'), { target: { value: 'none' } })
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.linked).toBeUndefined()
  })

  it('handles a single-column table without source options', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const id = controller.createTable('单列')
    controller.update((d) => {
      d.tables[id]!.columns = [
        {
          id: 's', name: '状态', type: 'select', width: 100, frozen: false, hidden: false, required: false,
          options: [{ id: 'a', label: '甲', color: '' }],
        },
      ]
    })
    const doc = controller.snapshot().tables[id]!
    render(<ColumnSettingsPanel table={doc} column={doc.columns[0]!} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    // Map mode with no other columns → no source column → empty select.
    fireEvent.change(screen.getByLabelText('Cascading dropdown'), { target: { value: 'map' } })
    const source = screen.getByLabelText('Source column') as HTMLSelectElement
    expect(source.value).toBe('')
    // A source column without options shows the no-source hint.
    const c2 = new HulutableController(new MemoryPersistence())
    const id2 = c2.createTable('双列')
    c2.update((d) => {
      d.tables[id2]!.columns = [
        {
          id: 's', name: '状态', type: 'select', width: 100, frozen: false, hidden: false, required: false,
          options: [{ id: 'a', label: '甲', color: '' }],
        },
        { id: 'src', name: '来源', type: 'select', width: 100, frozen: false, hidden: false, required: false },
      ]
    })
    const doc2 = c2.snapshot().tables[id2]!
    cleanup()
    render(<ColumnSettingsPanel table={doc2} column={doc2.columns[0]!} x={0} y={0} t={t} controller={c2} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Cascading dropdown'), { target: { value: 'map' } })
    expect(screen.getByText(/no options/)).toBeTruthy()
  })
})
