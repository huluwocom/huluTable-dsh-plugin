// @vitest-environment jsdom
/** Dismissal paths: outside mousedown / Escape on every floating surface. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { OptionPicker } from '../src/client/grid/OptionPicker.tsx'
import { HistoryPopover, CommentPopover } from '../src/client/grid/cell-popovers.tsx'
import { ColumnMenu, RowMenu } from '../src/client/grid/menus.tsx'
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

describe('dismissals', () => {
  it('closes the option picker on outside mousedown', () => {
    const { controller, id, doc } = crm()
    const col = doc.columns.find(c => c.name === '跟进状态')!
    const onClose = vi.fn()
    render(<div data-testid="out" />)
    render(<OptionPicker table={{ id }} column={col} rowData={doc.rows[0]} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(document.querySelector('[data-testid="out"]')!)
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes history and comment popovers on outside mousedown', () => {
    const { controller, id, doc } = crm()
    const onClose = vi.fn()
    render(<div data-testid="out" />)
    render(<HistoryPopover entries={[{ ts: 1, before: null, after: '' }]} x={0} y={0} t={t} onClose={onClose} />)
    // Empty values render as （空）.
    expect(screen.getAllByText('（空）').length).toBeGreaterThan(0)
    fireEvent.mouseDown(document.querySelector('[data-testid="out"]')!)
    expect(onClose).toHaveBeenCalledOnce()
    const row = doc.rows[0]!
    const col = doc.columns[0]!
    cleanup()
    render(<div data-testid="out2" />)
    render(<CommentPopover table={doc} rowId={row.id} columnId={col.id} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.mouseDown(document.querySelector('[data-testid="out2"]')!)
    expect(onClose).toHaveBeenCalledTimes(3)
    void id
  })

  it('closes row and column menus on outside mousedown', () => {
    const { controller, doc } = crm()
    const onClose = vi.fn()
    render(<div data-testid="out" />)
    render(<RowMenu table={doc} rowIndex={0} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(document.querySelector('[data-testid="out"]')!)
    expect(onClose).toHaveBeenCalledOnce()
    cleanup()
    render(<div data-testid="out2" />)
    render(<ColumnMenu table={doc} colIndex={0} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
