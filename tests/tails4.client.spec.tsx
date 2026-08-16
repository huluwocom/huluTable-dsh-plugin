// @vitest-environment jsdom
/** Small-tail coverage: shortcuts, root dismissal, modal input paths, query
 * edges, the id fallback, and memory persistence history scoping. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableRoot } from '../src/client/HulutableRoot.tsx'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { NewTableModal } from '../src/client/NewTableModal.tsx'
import { applyViewQuery, compareValues, matchFilter } from '../src/client/domain/query.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type TableDoc } from '../src/client/domain/types.ts'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
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

/** Locale runtime stub for the root panel's zh/en switch. */
const localeSnapshot = { active: 'en' as const, locales: [] as never[], revision: 0 }
const localeStub = {
  getSnapshot: () => localeSnapshot,
  subscribe: () => () => {},
  setLocale: () => {},
} as unknown as Parameters<typeof HulutableRoot>[0]['locale']

function openRoot() {
  const controller = new HulutableController(new MemoryPersistence())
  const useWorkspace = bindSnapshotSelector(controller.store)
  render(<HulutableRoot wide={true} t={t} controller={controller} useWorkspace={useWorkspace} locale={localeStub} />)
  return controller
}

/** Query bench: row 1 lacks the name/status cells entirely. */
function qTable(): TableDoc {
  const d = createBlankTable('q')
  d.columns = [
    { id: 'name', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    { id: 'amount', name: '金额', type: 'number', width: 100, frozen: false, hidden: false, required: false },
    {
      id: 'status', name: '状态', type: 'select', width: 100, frozen: false, hidden: false, required: false,
      options: [{ id: 'a', label: '进行中', color: '' }],
    },
    { id: 'st2', name: '状态2', type: 'select', width: 100, frozen: false, hidden: false, required: false },
  ]
  d.rows = [
    { id: newId(), cells: { name: { value: '甲' }, amount: { value: 100 }, status: { value: '进行中' } } },
    { id: newId(), cells: { amount: { value: 200 } } },
  ]
  return d
}

describe('Small tails', () => {


  it('root panel stays open on unrelated keys', () => {
    openRoot()
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.getByRole('dialog', { name: 'HuluTable' })).toBeTruthy()
  })

  it('modal: plain keys do not create, Enter does, the footer button creates', () => {
    const controller = new HulutableController(new MemoryPersistence())
    const onClose = vi.fn()
    render(<NewTableModal controller={controller} t={t} onClose={onClose} />)
    const input = screen.getByPlaceholderText('Blank Table')
    fireEvent.keyDown(input, { key: 'a' })
    expect(controller.snapshot().library).toHaveLength(0)
    fireEvent.change(input, { target: { value: '回车表' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(controller.snapshot().library[0]!.name).toBe('回车表')
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('Create'))
    expect(controller.snapshot().library).toHaveLength(2)
  })

  it('matchFilter: missing cells read as empty and neq covers null arms', () => {
    const doc = qTable()
    expect(matchFilter(doc, 1, { columnId: 'name', op: 'empty' })).toBe(true)
    // neq: non-null value vs null rule.
    expect(matchFilter(doc, 0, { columnId: 'name', op: 'neq', value: null })).toBe(true)
    // neq: null value vs null rule (both arms of the null guard).
    expect(matchFilter(doc, 1, { columnId: 'name', op: 'neq', value: null })).toBe(false)
    // neq: null value vs non-null rule.
    expect(matchFilter(doc, 1, { columnId: 'name', op: 'neq', value: '甲' })).toBe(true)
  })

  it('compareValues stringifies nullish operands on both sides', () => {
    expect(compareValues('a', null)).toBeGreaterThan(0)
  })

  it('sorts a select column without options via the string fallback', () => {
    const doc = qTable()
    const rows = applyViewQuery(doc, [], 'and', [{ columnId: 'st2', dir: 'asc' }])
    expect(rows).toHaveLength(2)
  })

  it('newId falls back to a timestamp id without crypto', () => {
    const original = globalThis.crypto
    try {
      vi.stubGlobal('crypto', undefined)
      expect(newId().startsWith('id-')).toBe(true)
    } finally {
      vi.stubGlobal('crypto', original)
    }
  })

  it('MemoryPersistence scopes history by the table prefix', async () => {
    const p = new MemoryPersistence()
    await p.saveHistory('t1', 't1/r1/a', [{ ts: 1, before: null, after: 'x' }])
    await p.saveHistory('t2', 't2/r1/a', [{ ts: 1, before: null, after: 'y' }])
    const t1 = await p.loadHistory('t1')
    expect(t1.get('t1/r1/a')).toHaveLength(1)
    expect(t1.has('t2/r1/a')).toBe(false)
  })
})
