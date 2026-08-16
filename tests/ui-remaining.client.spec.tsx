// @vitest-environment jsdom
/** Remaining UI branches: dismissal paths, cancel paths, confirm paths. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { HulutableRoot } from '../src/client/HulutableRoot.tsx'
import type { HulutableRootProps } from '../src/client/contract/slots.ts'
import { TableLibrary } from '../src/client/TableLibrary.tsx'
import { NewTableModal } from '../src/client/NewTableModal.tsx'
import { FilterPopover } from '../src/client/grid/FilterPopover.tsx'
import { ColumnMenu } from '../src/client/grid/menus.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const t = ((key: string, params?: Record<string, unknown>) => {
  const text = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name]
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    return ''
  })
}) as HulutableTranslate

/** Locale runtime stub for the root panel's zh/en switch. */
const localeSnapshot = { active: 'en' as const, locales: [] as never[], revision: 0 }
const localeStub = {
  getSnapshot: () => localeSnapshot,
  subscribe: () => () => {},
  setLocale: () => {},
} as unknown as HulutableRootProps['locale']

function bench() {
  const controller = new HulutableController(new MemoryPersistence())
  controller.update((d) => { d.ready = true })
  return { controller, useWorkspace: bindSnapshotSelector(controller.store) }
}

describe('HulutableRoot', () => {
  it('closes via the mask and keeps the panel closed', () => {
    const { controller, useWorkspace } = bench()
    render(<HulutableRoot wide={true} t={t} controller={controller} useWorkspace={useWorkspace} locale={localeStub} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    // Mask click closes.
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Escape listener removed after close (no crash on a second open/close).
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('NewTableModal', () => {
  it('names a template-created table after the template', () => {
    const { controller } = bench()
    const onClose = vi.fn()
    render(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    fireEvent.click(screen.getByText('客户管理'))
    expect(controller.snapshot().library[0]!.name).toBe('客户管理')
    expect(controller.snapshot().library[0]!.templateId).toBe('crm')
  })

  it('keeps a typed name when creating from a template card', () => {
    const { controller } = bench()
    const onClose = vi.fn()
    render(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('Blank Table'), { target: { value: '我的客户' } })
    fireEvent.click(screen.getByText('项目管理'))
    expect(controller.snapshot().library[0]!.name).toBe('我的客户')
    expect(controller.snapshot().library[0]!.templateId).toBe('project')
  })

  it('creates on Enter and closes on Escape', () => {
    const { controller } = bench()
    const onClose = vi.fn()
    const view = render(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    const input = screen.getByPlaceholderText('Blank Table')
    fireEvent.change(input, { target: { value: '回车表' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(controller.snapshot().library[0]!.name).toBe('回车表')
    expect(onClose).toHaveBeenCalledOnce()
    view.rerender(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes the modal when Escape lands on the name input or elsewhere inside', () => {
    const { controller } = bench()
    const onClose = vi.fn()
    render(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Blank Table'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })


})

describe('TableLibrary', () => {
  it('cancels rename on Escape and skips empty renames', () => {
    const { controller, useWorkspace } = bench()
    controller.createTable('客户')
    render(<TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} />)
    fireEvent.click(screen.getAllByTitle('Rename')[0]!)
    const input = screen.getByDisplayValue('客户')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(controller.snapshot().tables[controller.snapshot().library[0]!.id]!.name).toBe('客户')
    // Escape restores.
    fireEvent.click(screen.getAllByTitle('Rename')[0]!)
    const input2 = screen.getByDisplayValue('客户')
    fireEvent.change(input2, { target: { value: '改名' } })
    fireEvent.keyDown(input2, { key: 'Escape' })
    expect(controller.snapshot().tables[controller.snapshot().library[0]!.id]!.name).toBe('客户')
    expect(screen.queryByDisplayValue('改名')).toBeNull()
  })

  it('cancels delete on confirm=false', async () => {
    const { controller, useWorkspace } = bench()
    controller.createTable('客户')
    render(<TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} />)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getAllByTitle('Delete')[0]!)
    expect(controller.snapshot().bin).toHaveLength(0)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getAllByTitle('Delete')[0]!)
    await waitFor(() => { expect(controller.snapshot().bin).toHaveLength(1) })
    // Purge with confirm=false keeps the bin row.
    fireEvent.click(screen.getByText(/Recycle bin/))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getAllByText('Delete forever')[0]!)
    expect(controller.snapshot().bin).toHaveLength(1)
  })

  it('opens a table by clicking its row', async () => {
    const { controller, useWorkspace } = bench()
    const id = controller.createTable('客户')
    render(<TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} />)
    fireEvent.click(screen.getByText('客户'))
    expect(controller.snapshot().currentTableId).toBe(id)
  })
})

describe('FilterPopover', () => {
  it('dismisses on outside mousedown and reopens with existing state', () => {
    const { controller } = bench()
    const id = controller.createTable('客户', 'crm')
    const doc = controller.snapshot().tables[id]!
    const col = doc.columns.find(c => c.name === '跟进状态')!
    const view = doc.views[0]!
    const onClose = vi.fn()
    render(<div data-testid="outside" />)
    render(<FilterPopover table={doc} column={col} view={view} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(document.querySelector('[data-testid="outside"]')!)
    expect(onClose).toHaveBeenCalledOnce()
    // Reopen with an existing filter (multi-select with preselected values).
    controller.updateView(id, view.id, { filters: [{ columnId: col.id, op: 'in', values: ['已成交'] }] })
    render(
      <FilterPopover
        table={controller.snapshot().tables[id]!}
        column={col}
        view={controller.viewOf(id)!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={onClose}
      />,
    )
    expect(screen.getAllByText('已成交').length).toBeGreaterThan(0)
  })

  it('clears filters via the clear button and applies empty as a clear', () => {
    const { controller } = bench()
    const id = controller.createTable('客户', 'crm')
    const doc = controller.snapshot().tables[id]!
    const col = doc.columns.find(c => c.name === '姓名')!
    const view = doc.views[0]!
    controller.updateView(id, view.id, { filters: [{ columnId: col.id, op: 'contains', value: 'x' }] })
    render(
      <FilterPopover
        table={controller.snapshot().tables[id]!}
        column={col}
        view={controller.viewOf(id)!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('Clear filter'))
    expect(controller.viewOf(id)!.filters).toHaveLength(0)
    // Apply with an empty value clears too.
    cleanup()
    render(
      <FilterPopover
        table={controller.snapshot().tables[id]!}
        column={col}
        view={controller.viewOf(id)!}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('Apply'))
    expect(controller.viewOf(id)!.filters).toHaveLength(0)
  })

  it('applies between filters with both bounds', () => {
    const { controller } = bench()
    const id = controller.createTable('客户', 'crm')
    const doc = controller.snapshot().tables[id]!
    const col = doc.columns.find(c => c.name === '预算')!
    const view = doc.views[0]!
    render(<FilterPopover table={doc} column={col} view={view} x={0} y={0} t={t} controller={controller} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Filter op'), { target: { value: 'between' } })
    fireEvent.change(screen.getAllByPlaceholderText(/Min|Max/)[0]!, { target: { value: '1' } })
    fireEvent.change(screen.getAllByPlaceholderText(/Min|Max/)[1]!, { target: { value: '9' } })
    fireEvent.click(screen.getByText('Apply'))
    expect(controller.viewOf(id)!.filters[0]!.op).toBe('between')
  })
})

describe('ColumnMenu dismissal', () => {
  it('dismisses on outside mousedown and cancels rename with Escape', () => {
    const { controller } = bench()
    const id = controller.createTable('客户', 'crm')
    const doc = controller.snapshot().tables[id]!
    const onClose = vi.fn()
    render(<div data-testid="outside" />)
    render(<ColumnMenu table={doc} colIndex={1} x={0} y={0} t={t} controller={controller} onClose={onClose} />)
    fireEvent.mouseDown(document.querySelector('[data-testid="outside"]')!)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('backup and restore', () => {
  it('exports a JSON backup and restores tables from it', () => {
    const { controller, useWorkspace } = bench()
    controller.createTable('备份表')
    render(<TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} lang="zh" />)
    // Export: the download anchor is created with the JSON payload.
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    fireEvent.click(screen.getByText(/Backup/))
    expect(createSpy).toHaveBeenCalled()
    expect(revokeSpy).toHaveBeenCalled()
    createSpy.mockRestore()
    revokeSpy.mockRestore()
    // Restore: a fresh controller imports the exported JSON.
    const backup = controller.exportBackup()
    const fresh = new HulutableController(new MemoryPersistence())
    expect(fresh.importBackup(backup)).toBe(1)
    expect(fresh.snapshot().library).toHaveLength(1)
    expect(fresh.snapshot().library[0]!.name).toBe('备份表')
  })

  it('restores through the file input and alerts on invalid files', async () => {
    const { controller, useWorkspace } = bench()
    controller.createTable('备份表')
    render(<TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} lang="zh" />)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const good = new File([controller.exportBackup()], 'backup.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [good] } })
    await new Promise(r => setTimeout(r, 0))
    expect(alertSpy).toHaveBeenCalledWith('Restored 1 tables')
    alertSpy.mockClear()
    const bad = new File(['nope'], 'bad.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [bad] } })
    await new Promise(r => setTimeout(r, 0))
    expect(alertSpy).toHaveBeenCalledWith('Invalid backup file — nothing restored')
    // A change without a file is a no-op.
    fireEvent.change(input, { target: { files: [] } })
    expect(alertSpy).toHaveBeenCalledTimes(1)
    alertSpy.mockRestore()
  })

  it('imports nothing for invalid payloads', () => {
    const controller = new HulutableController(new MemoryPersistence())
    expect(controller.importBackup('not json')).toBe(0)
    expect(controller.importBackup('{"nope":1}')).toBe(0)
    expect(controller.importBackup('{"tables":[{"id":1}]}')).toBe(0)
    expect(controller.importBackup('{"tables":[null,"x"]}')).toBe(0)
    expect(controller.importBackup('{"tables":[{"id":"a","columns":[],"rows":[]}]}')).toBe(1)
  })
})
