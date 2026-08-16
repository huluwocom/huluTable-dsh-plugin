// @vitest-environment jsdom
/** ColumnMenu tail: type picker, rename input, insert/move/freeze paths. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
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

describe('ColumnMenu tail', () => {
  it('renames via the inline input and cancels with Escape', () => {
    const { controller, id, doc } = crm()
    const view = render(<ColumnMenu table={doc} colIndex={0} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Rename'))
    const input = screen.getByDisplayValue('姓名')
    fireEvent.change(input, { target: { value: '新客户名' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(controller.snapshot().tables[id]!.columns[0]!.name).toBe('新客户名')
    view.rerender(
      <ColumnMenu table={controller.snapshot().tables[id]!} colIndex={0} x={0} y={0} t={t} controller={controller} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByText('Rename'))
    const input2 = screen.getByDisplayValue('新客户名')
    fireEvent.change(input2, { target: { value: '放弃' } })
    fireEvent.keyDown(input2, { key: 'Escape' })
    expect(controller.snapshot().tables[id]!.columns[0]!.name).toBe('新客户名')
  })

  it('switches column types from the picker', () => {
    const { controller, id, doc } = crm()
    const view = render(<ColumnMenu table={doc} colIndex={1} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Column type'))
    fireEvent.click(screen.getByText('Number'))
    expect(controller.snapshot().tables[id]!.columns[1]!.type).toBe('number')
    // Reopen on a fresh snapshot: clicking the current type is a no-op.
    view.rerender(
      <ColumnMenu table={controller.snapshot().tables[id]!} colIndex={1} x={0} y={0} t={t} controller={controller} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByText('Column type'))
    fireEvent.click(screen.getByText('Number'))
    expect(controller.snapshot().tables[id]!.columns[1]!.type).toBe('number')
  })

  it('inserts left, moves left, freezes and opens settings', () => {
    const { controller, id, doc } = crm()
    const view = render(<ColumnMenu table={doc} colIndex={1} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    const fresh = () => {
      view.rerender(
        <ColumnMenu table={controller.snapshot().tables[id]!} colIndex={1} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    }
    fireEvent.click(screen.getByText('Insert column left'))
    fresh()
    fireEvent.click(screen.getByText('Move left'))
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(doc.columns.length + 1)
    // Inserting into the frozen pane freezes the new column, so the menu now
    // offers unfreezing (positional freezing keeps the pane a prefix).
    fireEvent.click(screen.getByText('Unfreeze column'))
    fresh()
    expect(controller.snapshot().tables[id]!.columns[0]!.frozen).toBe(true)
    expect(controller.snapshot().tables[id]!.columns[1]!.frozen).toBe(false)
    fireEvent.click(screen.getByText('Freeze column'))
    fresh()
    expect(controller.snapshot().tables[id]!.columns[1]!.frozen).toBe(true)
    fireEvent.click(screen.getByText('Column settings'))
    expect(screen.getByText('Column settings')).toBeTruthy()
  })

  it('copies, cuts and pastes columns from the menu', () => {
    const { controller, id, doc } = crm()
    const view = render(<ColumnMenu table={doc} colIndex={1} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    const fresh = () => {
      view.rerender(
        <ColumnMenu table={controller.snapshot().tables[id]!} colIndex={1} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    }
    fireEvent.click(screen.getByText('Copy column'))
    fireEvent.click(screen.getByText('Paste column'))
    fresh()
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(doc.columns.length + 1)
    // Cut removes the column and the clipboard still pastes.
    fireEvent.click(screen.getByText('Cut column'))
    fresh()
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(doc.columns.length)
    fireEvent.click(screen.getByText('Paste column'))
    fresh()
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(doc.columns.length + 1)
  })

  it('copies, cuts and pastes rows from the menu', () => {
    const { controller, id, doc } = crm()
    const view = render(<RowMenu table={doc} rowIndex={0} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    const fresh = () => {
      view.rerender(
        <RowMenu table={controller.snapshot().tables[id]!} rowIndex={0} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    }
    const before = doc.rows.length
    fireEvent.click(screen.getByText('Copy row'))
    fireEvent.click(screen.getByText('Paste row'))
    fresh()
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(before + 1)
    fireEvent.click(screen.getByText('Cut row'))
    fresh()
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(before)
    fireEvent.click(screen.getByText('Paste row'))
    fresh()
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(before + 1)
  })

  it('keeps the menu open on mousedown inside it', () => {
    const { controller, doc } = crm()
    const onClose = vi.fn()
    render(<ColumnMenu table={doc} colIndex={0} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(screen.getByText('Rename'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('skips the rename when the name is unchanged or empty', () => {
    const { controller, id, doc } = crm()
    render(<ColumnMenu table={doc} colIndex={0} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Rename'))
    fireEvent.keyDown(screen.getByDisplayValue('姓名'), { key: 'Enter' })
    expect(controller.snapshot().tables[id]!.columns[0]!.name).toBe('姓名')
    // Whitespace-only names also skip the update.
    fireEvent.click(screen.getByText('Rename'))
    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(controller.snapshot().tables[id]!.columns[0]!.name).toBe('姓名')
  })

  it('renders nothing for out-of-range column and row indexes', () => {
    const { controller, doc } = crm()
    const onClose = vi.fn()
    render(<ColumnMenu table={doc} colIndex={999} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    expect(screen.queryByText('Rename')).toBeNull()
    render(<RowMenu table={doc} rowIndex={999} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    expect(screen.queryByText(/Insert row above/)).toBeNull()
  })
})
