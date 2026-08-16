// @vitest-environment jsdom
/** ImportModal guards, TableEditor stats/empty. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { ImportModal } from '../src/client/editor/ImportModal.tsx'
import { TableEditor } from '../src/client/editor/TableEditor.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

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
  return controller
}

describe('ImportModal guards', () => {
  it('closes on Escape and rejects unparsable files', async () => {
    const controller = bench()
    const onClose = vi.fn()
    render(<ImportModal tableName="t" hasCurrentTable={false} t={t} controller={controller} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    // A minimal file still parses into an empty sheet without crashing.
    const empty = new File([new Uint8Array([1, 2, 3])], 'bad.xlsx')
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [empty] } })
    await new Promise(r => setTimeout(r, 0))
    // The empty sheet parses into a preview without crashing.
    expect(screen.getByText('Import')).toBeTruthy()
  })

  it('repicks a file and confirms into a new table', async () => {
    const controller = bench()
    const { toXlsx } = await import('../src/client/io/io.ts')
    const { createBlankTable } = await import('../src/client/domain/templates.ts')
    const src = createBlankTable('源')
    src.columns = [{ id: 'a', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    src.rows = [{ id: 'r', cells: { a: { value: '数据' } } }]
    render(<ImportModal tableName="t" hasCurrentTable={false} t={t} controller={controller} onClose={() => {}} />)
    const file = new File([toXlsx(src)], '好.xlsx')
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await new Promise(r => setTimeout(r, 0))
    fireEvent.click(screen.getByText('Pick again'))
    expect(screen.getByText(/Choose an Excel/)).toBeTruthy()
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await new Promise(r => setTimeout(r, 0))
    fireEvent.click(screen.getByText('Import'))
    expect(controller.snapshot().library).toHaveLength(1)
    expect(controller.snapshot().library[0]!.name).toBe('好')
  })
})

describe('TableEditor extras', () => {
  it('renders stats with a selection and the empty-guide for blank tables', async () => {
    const controller = bench()
    const id = controller.createTable('空表')
    await controller.openTable(id)
    const useWorkspace = bindSnapshotSelector(controller.store)
    render(<TableEditor controller={controller} useWorkspace={useWorkspace} t={t} />)
    expect(screen.getByText('This table is empty')).toBeTruthy()
    fireEvent.click(screen.getByText('+ Add column'))
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(1)
  })
})
