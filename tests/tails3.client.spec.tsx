// @vitest-environment jsdom
/** Remaining tails: comment Enter paths, FormulaBar. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { CommentPopover } from '../src/client/grid/cell-popovers.tsx'
import { FormulaBar } from '../src/client/editor/FormulaBar.tsx'
import { NewTableModal } from '../src/client/NewTableModal.tsx'
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

function crm() {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('客户', 'crm')
  const doc = controller.snapshot().tables[id]!
  return { controller, id, doc }
}

describe('CommentPopover tails', () => {
  it('commits edits with Enter and deletes via empty text', () => {
    const { controller, id, doc } = crm()
    const row = doc.rows[0]!
    const col = doc.columns[0]!
    controller.setComment(id, row.id, col.id, '原')
    const view = render(
      <CommentPopover
        table={controller.snapshot().tables[id]!}
        rowId={row.id}
        columnId={col.id}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={() => {}}
      />,
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
    // Enter in the add box with empty text does nothing.
    fireEvent.keyDown(screen.getByPlaceholderText('+'), { key: 'Enter' })
    const key = `${row.id}:${col.id}`
    expect(controller.snapshot().tables[id]!.comments[key]).toHaveLength(1)
    // Edit via Enter key.
    fireEvent.click(screen.getByLabelText('Save'))
    fireEvent.change(screen.getByDisplayValue('原'), { target: { value: '新' } })
    fireEvent.keyDown(screen.getByDisplayValue('新'), { key: 'Enter' })
    fresh()
    expect(controller.snapshot().tables[id]!.comments[key][0]!.text).toBe('新')
    // Escape cancels the edit without saving.
    fireEvent.click(screen.getByLabelText('Save'))
    fireEvent.change(screen.getByDisplayValue('新'), { target: { value: '丢弃' } })
    fireEvent.keyDown(screen.getByDisplayValue('丢弃'), { key: 'Escape' })
    fresh()
    expect(controller.snapshot().tables[id]!.comments[key][0]!.text).toBe('新')
    // Empty-text update deletes the comment.
    controller.updateComment(id, row.id, col.id, controller.snapshot().tables[id]!.comments[key][0]!.id, '')
    expect(controller.snapshot().tables[id]!.comments[key]).toBeUndefined()
  })

  it('ignores mousedowns inside the popover and guards empty edit saves', () => {
    const { controller, id, doc } = crm()
    const row = doc.rows[0]!
    const col = doc.columns[0]!
    controller.setComment(id, row.id, col.id, '原')
    const onClose = vi.fn()
    render(
      <CommentPopover
        table={controller.snapshot().tables[id]!}
        rowId={row.id}
        columnId={col.id}
        x={0}
        y={0}
        t={t}
        controller={controller}
        onClose={onClose}
      />,
    )
    // Mousedown on the popover's own title does not dismiss.
    fireEvent.mouseDown(screen.getByText('Comment'))
    expect(onClose).not.toHaveBeenCalled()
    // Saving the edit with empty text is a no-op.
    fireEvent.click(screen.getByLabelText('Save'))
    const editInput = screen.getByDisplayValue('原')
    fireEvent.change(editInput, { target: { value: '' } })
    fireEvent.keyDown(editInput, { key: 'Enter' })
    const key = `${row.id}:${col.id}`
    expect(controller.snapshot().tables[id]!.comments[key]).toHaveLength(1)
    // The edit button toggles: pressing it again saves and exits editing.
    fireEvent.click(screen.getByLabelText('Save'))
    fireEvent.change(screen.getByDisplayValue('原'), { target: { value: '改' } })
    fireEvent.click(screen.getByLabelText('Save'))
    expect(controller.snapshot().tables[id]!.comments[key][0]!.text).toBe('改')
  })
})

describe('FormulaBar tails', () => {
  it('skips sync for dirty input and commits via Enter', () => {
    const { controller, id, doc } = crm()
    const view = render(<FormulaBar table={doc} selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }} t={t} controller={controller} />)
    fireEvent.change(screen.getByDisplayValue('陈小雨'), { target: { value: '草稿' } })
    controller.setCellValue(id, doc.rows[0]!.id, doc.columns[0]!.id, '外部')
    view.rerender(
      <FormulaBar table={controller.snapshot().tables[id]!} selection={{ r0: 0, r1: 0, c0: 0, c1: 0 }} t={t} controller={controller} />,
    )
    expect(screen.getByDisplayValue('草稿')).toBeTruthy()
    fireEvent.keyDown(screen.getByDisplayValue('草稿'), { key: 'Enter' })
    const nameCol = controller.snapshot().tables[id]!.columns[0]!
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[nameCol.id]!.value).toBe('草稿')
  })
})

describe('NewTableModal tail', () => {
  it('creates from a template card with a custom name', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const onClose = vi.fn()
    render(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('Blank Table'), { target: { value: '我的CRM' } })
    fireEvent.click(screen.getByText('客户管理'))
    expect(controller.snapshot().library[0]!.name).toBe('我的CRM')
    expect(controller.snapshot().library[0]!.templateId).toBe('crm')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
