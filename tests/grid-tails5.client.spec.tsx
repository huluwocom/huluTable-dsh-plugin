// @vitest-environment jsdom
/** Grid tails 5: non-frozen text single-clicks, popover dismissal, button mousedowns. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { Grid } from '../src/client/grid/Grid.tsx'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'
import type { HulutableState } from '../src/client/controller.ts'

// Grid suites render the full blank canvas; coverage instrumentation slows
// them well past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(window, 'innerWidth', { value: 3200, configurable: true })
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

function Harness(props: { controller: HulutableController; useWorkspace: <S>(sel: (s: HulutableState) => S) => S }) {
  const table = props.useWorkspace(s => (s.currentTableId === null ? undefined : s.tables[s.currentTableId]))
  const view = table === undefined ? undefined : props.controller.viewOf(table.id) ?? table.views[0]
  const selection = props.useWorkspace(s => s.editor.selection)
  const editing = props.useWorkspace(s => s.editor.editing)
  if (table === undefined || view === undefined) return null
  return <Grid table={table} view={view} controller={props.controller} selection={selection} editing={editing} t={t} />
}

async function openCrm() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('客户', 'crm')
  await controller.openTable(id)
  const useWorkspace = bindSnapshotSelector(controller.store)
  render(<Harness controller={controller} useWorkspace={useWorkspace} />)
  return { controller, id }
}

describe('Grid tails 5', () => {
  it('single-clicks a non-frozen text cell without opening a picker', async () => {
    const { controller } = await openCrm()
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.click(cell)
    expect(document.querySelector('[class*="popover"]')).toBeNull()
    void controller
  })

  it('dismisses the picker and history popover via Escape', async () => {
    const { controller, id } = await openCrm()
    // Open the dropdown picker and dismiss it.
    const statusCol = controller.snapshot().tables[id]!.columns.find(c => c.name === '跟进状态')!
    fireEvent.click(screen.getAllByText('已联系')[0]!)
    expect(document.querySelector('[class*="popover"]')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[class*="popover"]')).toBeNull()
    // Open the history popover and dismiss it.
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    await act(async () => {
      controller.setCellValue(id, controller.snapshot().tables[id]!.rows[0]!.id, nameCol.id, '改历史')
    })
    const cell = screen.getAllByText('改历史')[0]!
    fireEvent.mouseEnter(cell, { clientX: 10, clientY: 10 })
    expect(screen.getByText('Edit history (last 5)')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Edit history (last 5)')).toBeNull()
    void statusCol
  })

  it('explicit mousedowns on the header filter and menu buttons', async () => {
    const { controller } = await openCrm()
    fireEvent.mouseDown(screen.getByLabelText('filter-预算'))
    fireEvent.mouseDown(screen.getByLabelText('menu-预算'))
    expect(document.querySelector('[class*="popover"]')).toBeNull()
    void controller
  })
})
