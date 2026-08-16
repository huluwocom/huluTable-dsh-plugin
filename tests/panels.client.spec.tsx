// @vitest-environment jsdom
/** Panel/popover component behaviors: modals, pickers, menus, settings. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { NewTableModal } from '../src/client/NewTableModal.tsx'
import { ImportModal } from '../src/client/editor/ImportModal.tsx'
import { ViewManager } from '../src/client/editor/ViewManager.tsx'
import { GoalsPanel } from '../src/client/editor/GoalsPanel.tsx'
import { OptionPicker } from '../src/client/grid/OptionPicker.tsx'
import { ColumnSettingsPanel } from '../src/client/grid/ColumnSettingsPanel.tsx'
import { ColumnMenu, RowMenu } from '../src/client/grid/menus.tsx'
import { HistoryPopover, CommentPopover } from '../src/client/grid/cell-popovers.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
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
  controller.update((d) => { d.ready = true })
  return { controller }
}

function openCrm() {
  const { controller } = bench()
  const id = controller.createTable('客户', 'crm')
  return { controller, id, doc: controller.snapshot().tables[id]! }
}

describe('NewTableModal', () => {
  it('creates blank and template tables and closes via Escape', () => {
    const { controller } = bench()
    const onClose = vi.fn()
    const view = render(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('Blank Table'), { target: { value: '我的表' } })
    fireEvent.click(screen.getByText('Blank Table'))
    expect(controller.snapshot().library[0]!.name).toBe('我的表')
    expect(onClose).toHaveBeenCalledOnce()
    view.rerender(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    // Template card creates a CRM table.
    view.rerender(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    fireEvent.click(screen.getByText('客户管理'))
    expect(controller.snapshot().library).toHaveLength(2)
  })
})

describe('ImportModal', () => {
  it('parses a file and imports as a new table', async () => {
    const { controller } = bench()
    const onClose = vi.fn()
    render(<ImportModal tableName="当前表" hasCurrentTable={false} t={t} controller={controller} onClose={onClose} />)
    // Stub file: minimal xlsx via SheetJS.
    const { toXlsx } = await import('../src/client/io/io.ts')
    const { createBlankTable } = await import('../src/client/domain/templates.ts')
    const src = createBlankTable('源')
    src.columns = [{ id: 'a', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    src.rows = [{ id: 'r1', cells: { a: { value: '甲' } } }]
    const buffer = toXlsx(src)
    const file = new File([buffer], '导入.xlsx')
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await new Promise(r => setTimeout(r, 0))
    fireEvent.change(screen.getByDisplayValue('导入'), { target: { value: '新表' } })
    fireEvent.click(screen.getByText('Import'))
    expect(controller.snapshot().library[0]!.name).toBe('新表')
    expect(controller.snapshot().tables[controller.snapshot().currentTableId!]!.rows).toHaveLength(1)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('appends to the current table', async () => {
    const { controller } = bench()
    const id = controller.createTable('当前')
    const { toXlsx } = await import('../src/client/io/io.ts')
    const { createBlankTable } = await import('../src/client/domain/templates.ts')
    const src = createBlankTable('源')
    src.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    src.rows = [{ id: 'r1', cells: { a: { value: '追加' } } }]
    const file = new File([toXlsx(src)], '追加.xlsx')
    render(<ImportModal tableName="当前" hasCurrentTable={true} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await new Promise(r => setTimeout(r, 0))
    fireEvent.click(screen.getByText(/Append to the current table/))
    fireEvent.click(screen.getByText('Import'))
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(1)
  })

  it('ignores unrelated keys while open', () => {
    const { controller } = bench()
    const onClose = vi.fn()
    render(<ImportModal tableName="当前表" hasCurrentTable={false} t={t} controller={controller} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows the more-rows hint and toggles the mode radios', async () => {
    const { controller } = bench()
    const { toXlsx } = await import('../src/client/io/io.ts')
    const { createBlankTable } = await import('../src/client/domain/templates.ts')
    const src = createBlankTable('源')
    src.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    for (let i = 0; i < 7; i += 1) src.rows.push({ id: `r${i}`, cells: { a: { value: `v${i}` } } })
    const file = new File([toXlsx(src)], '七行.xlsx')
    render(<ImportModal tableName="X" hasCurrentTable={true} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByText(/more/)).toBeTruthy()
    // Toggle to append and back to new (radio change handlers).
    fireEvent.click(screen.getByText(/Append to the current table/))
    fireEvent.click(screen.getByText(/as a new table/))
    fireEvent.click(screen.getByText('Import'))
    expect(controller.snapshot().library).toHaveLength(1)
  })

  it('append mode without a current table skips the append and closes', async () => {
    const { controller } = bench()
    const onClose = vi.fn()
    const { toXlsx } = await import('../src/client/io/io.ts')
    const { createBlankTable } = await import('../src/client/domain/templates.ts')
    const src = createBlankTable('源')
    src.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    src.rows = [{ id: 'r1', cells: { a: { value: 'v' } } }]
    const file = new File([toXlsx(src)], '追加.xlsx')
    render(<ImportModal tableName="X" hasCurrentTable={true} t={t} controller={controller} onClose={onClose} />)
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await new Promise(r => setTimeout(r, 0))
    fireEvent.click(screen.getByText(/Append to the current table/))
    fireEvent.click(screen.getByText('Import'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(controller.snapshot().tables).toEqual({})
  })
})

describe('ViewManager', () => {
  it('manages views and binds columns', () => {
    const { controller, id, doc } = openCrm()
    const active = controller.viewOf(id)!
    const view = render(<ViewManager table={doc} activeView={active} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByText('+ Grid view'))
    expect(controller.snapshot().tables[id]!.views).toHaveLength(5)
    // Duplicate + rename + delete the last view (re-render with fresh props).
    const fresh = () => {
      view.rerender(
        <ViewManager
          table={controller.snapshot().tables[id]!}
          activeView={controller.viewOf(id)!}
          t={t}
          controller={controller}
          onClose={() => {}}
        />)
    }
    const dupeButtons = screen.getAllByLabelText('Duplicate view')
    fireEvent.click(dupeButtons[dupeButtons.length - 1]!)
    fresh()
    expect(controller.snapshot().tables[id]!.views).toHaveLength(6)
    fireEvent.click(screen.getAllByLabelText('Rename view').at(-1)!)
    const renameInput = screen.getByDisplayValue(/副本/)
    fireEvent.change(renameInput, { target: { value: '新视图' } })
    fireEvent.keyDown(renameInput, { key: 'Enter' })
    fresh()
    expect(controller.snapshot().tables[id]!.views.some(v => v.name === '新视图')).toBe(true)
    fireEvent.click(screen.getAllByLabelText('Delete view').at(-1)!)
    expect(controller.snapshot().tables[id]!.views).toHaveLength(5)
  })

  it('binds the kanban group column', () => {
    const { controller, id, doc } = openCrm()
    const kanban = controller.snapshot().tables[id]!.views.find(v => v.kind === 'kanban')!
    controller.setActiveView(id, kanban.id)
    render(<ViewManager table={doc} activeView={kanban} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Group column'), { target: { value: doc.columns.find(c => c.name === '客户来源')!.id } })
    expect(controller.viewOf(id)!.groupColumnId).toBe(doc.columns.find(c => c.name === '客户来源')!.id)
  })
})

describe('GoalsPanel', () => {
  it('adds and removes goals with progress', () => {
    const { controller, id, doc } = openCrm()
    const view = render(<GoalsPanel table={doc} view={doc.views[0]!} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Target value'), { target: { value: '500' } })
    fireEvent.click(screen.getByText('Add goal'))
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(1)
    view.rerender(
      <GoalsPanel
        table={controller.snapshot().tables[id]!}
        view={doc.views[0]!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('×'))
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(0)
  })
})

describe('OptionPicker', () => {
  it('sets and toggles dropdown values', () => {
    const { controller, id, doc } = openCrm()
    const col = doc.columns.find(c => c.name === '跟进状态')!
    const row = doc.rows[0]!
    const onClose = vi.fn()
    const view = render(
      <OptionPicker table={{ id }} column={col} rowData={row} x={0} y={0} t={t} controller={controller} onClose={onClose} />,
    )
    fireEvent.click(screen.getByText('已成交'))
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[col.id]!.value).toBe('已成交')
    expect(onClose).toHaveBeenCalledOnce()
    // multiSelect toggles without closing
    const multi = { ...doc.columns.find(c => c.name === '性别')!, type: 'multiSelect' as const }
    const multiPicker = () => {
      view.rerender(
        <OptionPicker
          table={{ id }}
          column={multi}
          rowData={controller.snapshot().tables[id]!.rows[0]}
          x={0}
          y={0}
          t={t}
          controller={controller}
          onClose={onClose}
        />)
    }
    multiPicker()
    // Row 0 carries 女 → clicking 男 adds it, clicking again removes it.
    fireEvent.click(screen.getByText('男'))
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[multi.id]!.value).toEqual(['女', '男'])
    multiPicker()
    fireEvent.click(screen.getByText('男'))
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[multi.id]!.value).toEqual(['女'])
    // missing row renders nothing
    render(<OptionPicker table={{ id }} column={col} rowData={undefined} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
  })
})

describe('ColumnSettingsPanel', () => {
  it('applies live edits for name/type/width/required/validation/options', () => {
    const { controller, id, doc } = openCrm()
    // columns[1] (性别) is not required in the template — toggle it on.
    const col = doc.columns[1]!
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '新名称' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.name).toBe('新名称')
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '200' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.width).toBe(200)
    fireEvent.click(screen.getByLabelText('Required'))
    expect(controller.snapshot().tables[id]!.columns[1]!.required).toBe(true)
    // Validation kind
    fireEvent.change(screen.getByLabelText('Format validation'), { target: { value: 'phone' } })
    expect(controller.snapshot().tables[id]!.columns[1]!.validation?.kind).toBe('phone')
  })

  it('edits dropdown options with colors and linked config', () => {
    const { controller, id, doc } = openCrm()
    const col = doc.columns.find(c => c.name === '跟进状态')!
    render(<ColumnSettingsPanel table={doc} column={col} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByText('+ Add option'))
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.options!.length)
      .toBe(col.options!.length + 1)
    // Remove the last option.
    const removes = screen.getAllByText('×')
    fireEvent.click(removes[removes.length - 1]!)
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.options!.length)
      .toBe(col.options!.length)
    // Linked map mode with a source column.
    fireEvent.change(screen.getByLabelText('Cascading dropdown'), { target: { value: 'map' } })
    fireEvent.change(screen.getByLabelText('Column type'), { target: { value: 'select' } })
    expect(controller.snapshot().tables[id]!.columns.find(c => c.id === col.id)!.linked?.mode).toBe('map')
  })
})

describe('ColumnMenu and RowMenu', () => {
  it('runs column actions', () => {
    const { controller, id, doc } = openCrm()
    const colIndex = 1
    render(<ColumnMenu table={doc} colIndex={colIndex} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Insert column right'))
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(doc.columns.length + 1)
    fireEvent.click(screen.getByText('Freeze column'))
    expect(controller.snapshot().tables[id]!.columns[1]!.frozen).toBe(true)
    fireEvent.click(screen.getByText('Hide column'))
    expect(controller.snapshot().tables[id]!.columns[1]!.hidden).toBe(true)
    fireEvent.click(screen.getByText('Move right'))
    fireEvent.click(screen.getByText('Duplicate column'))
    fireEvent.click(screen.getByText('Delete column'))
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(doc.columns.length + 1)
  })

  it('runs row actions', () => {
    const { controller, id, doc } = openCrm()
    render(<RowMenu table={doc} rowIndex={0} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Insert row above'))
    fireEvent.click(screen.getByText('Insert row below'))
    fireEvent.click(screen.getByText('Duplicate row'))
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(doc.rows.length + 3)
    fireEvent.click(screen.getByText('Clear row'))
    const nameCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '姓名')!
    expect(controller.snapshot().tables[id]!.rows[1]!.cells[nameCol.id]).toBeUndefined()
    fireEvent.click(screen.getByText('Delete row'))
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(doc.rows.length + 2)
  })
})

describe('cell popovers', () => {
  it('shows history entries or the empty state', () => {
    const { render: r } = { render }
    const view = r(<HistoryPopover entries={[{ ts: 1, before: 'a', after: 'b' }]} x={0} y={0} t={t} onClose={() => {}} />)
    expect(screen.getByText('a')).toBeTruthy()
    view.rerender(<HistoryPopover entries={[]} x={0} y={0} t={t} onClose={() => {}} />)
    expect(screen.getByText('No edits yet')).toBeTruthy()
  })

  it('adds, edits and deletes comments', () => {
    const { controller, id, doc } = openCrm()
    const row = doc.rows[0]!
    const col = doc.columns[0]!
    const view = render(
      <CommentPopover table={doc} rowId={row.id} columnId={col.id} x={0} y={0} t={t} controller={controller} onClose={() => {}} />,
    )
    const fresh = () => {
      view.rerender(
        <CommentPopover
          table={controller.snapshot().tables[id]!}
          rowId={row.id}
          columnId={col.id}
          x={0}
          y={0}
          t={t}
          controller={controller}
          onClose={() => {}}
        />)
    }
    fireEvent.change(screen.getByPlaceholderText('+'), { target: { value: '第一条' } })
    fireEvent.keyDown(screen.getByPlaceholderText('+'), { key: 'Enter' })
    const key = `${row.id}:${col.id}`
    expect(controller.snapshot().tables[id]!.comments[key]).toHaveLength(1)
    // Edit
    fresh()
    fireEvent.click(screen.getByLabelText('Save'))
    fireEvent.change(screen.getByDisplayValue('第一条'), { target: { value: '改过' } })
    // React 18 delegates onBlur through focusout.
    fireEvent.focusOut(screen.getByDisplayValue('改过'))
    fresh()
    expect(controller.snapshot().tables[id]!.comments[key][0]!.text).toBe('改过')
    // Delete
    fireEvent.click(screen.getByLabelText('Delete comment'))
    expect(controller.snapshot().tables[id]!.comments[key]).toBeUndefined()
  })
})
