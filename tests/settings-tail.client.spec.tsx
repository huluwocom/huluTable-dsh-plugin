// @vitest-environment jsdom
/** ColumnSettingsPanel tail: validation params, options editing, linked modes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { ColumnSettingsPanel } from '../src/client/grid/ColumnSettingsPanel.tsx'
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

describe('ColumnSettingsPanel tail', () => {
  it('dismisses on outside mousedown and Escape', () => {
    const { controller, doc } = crm()
    const col = doc.columns[1]!
    const onClose = vi.fn()
    render(<div data-testid="out" />)
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(document.querySelector('[data-testid="out"]')!)
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('edits description and default and clears them', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns[1]!
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '说明文字' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.description).toBe('说明文字')
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.description).toBeUndefined()
    fireEvent.change(screen.getByLabelText('Default'), { target: { value: '默认值' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.default).toBe('默认值')
    fireEvent.change(screen.getByLabelText('Default'), { target: { value: '' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.default).toBeUndefined()
  })

  it('configures validation ranges and regex', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns.find(c => c.name === '预算')!
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Format validation'), { target: { value: 'numberRange' } })
    const minMax = screen.getAllByPlaceholderText(/Min|Max/)
    fireEvent.change(minMax[0]!, { target: { value: '1' } })
    fireEvent.change(minMax[1]!, { target: { value: '100' } })
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.validation).toEqual({ kind: 'numberRange', min: 1, max: 100 })
    fireEvent.change(screen.getByLabelText('Format validation'), { target: { value: 'regex' } })
    fireEvent.change(screen.getByPlaceholderText('Regex pattern'), { target: { value: '^[0-9]+$' } })
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.validation!.pattern).toBe('^[0-9]+$')
    // Clearing min/max drops them.
    fireEvent.change(screen.getByLabelText('Format validation'), { target: { value: 'lengthRange' } })
    fireEvent.change(screen.getAllByPlaceholderText(/Min|Max/)[0]!, { target: { value: '' } })
    fireEvent.change(screen.getAllByPlaceholderText(/Min|Max/)[1]!, { target: { value: '' } })
    const v = controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.validation!
    expect(v.min).toBeUndefined()
    expect(v.max).toBeUndefined()
  })

  it('edits option labels and colors, and removes options', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns.find(c => c.name === '跟进状态')!
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    // Edit the first option label.
    fireEvent.change(screen.getAllByLabelText('Option label')[0]!, { target: { value: '接触中' } })
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.options![0]!.label).toBe('接触中')
    // Color swatch change.
    fireEvent.change(screen.getAllByLabelText('Option color')[0]!, { target: { value: '#ff0000' } })
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.options![0]!.color).toBe('#ff0000')
    // Remove the first option.
    fireEvent.click(screen.getAllByText('×')[0]!)
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.options![0]!.label).not.toBe('接触中')
  })

  it('configures linked source mode with a mapping and the no-source hint', () => {
    const { controller, id, doc } = crm()
    const status = doc.columns.find(c => c.name === '跟进状态')!
    const source = doc.columns.find(c => c.name === '客户来源')!
    render(<ColumnSettingsPanel table={doc} column={status} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Cascading dropdown'), { target: { value: 'map' } })
    fireEvent.change(screen.getByLabelText('Column type'), { target: { value: 'select' } })
    // Pick the source column.
    fireEvent.change(screen.getByLabelText('Source column'), { target: { value: source.id } })
    // Toggle a map checkbox for the first target option (labeled by its name).
    fireEvent.click(screen.getAllByLabelText('新线索')[0]!)
    const linked = controller.snapshot().tables[id]!.columns.find(c => c.id === status.id)!.linked
    expect(linked?.mode).toBe('map')
    expect(Object.keys(linked?.map ?? {})).toHaveLength(1)
  })
})
