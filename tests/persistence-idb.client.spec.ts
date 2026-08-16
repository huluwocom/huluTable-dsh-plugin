// @vitest-environment jsdom
/** IndexedDbPersistence against fake-indexeddb: full CRUD + history round trips. */
import 'fake-indexeddb/auto'
import { vi, afterEach, describe, expect, it } from 'vitest'
import { IndexedDbPersistence } from '../src/client/persistence.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type TableDoc } from '../src/client/domain/types.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

const openInstances: IndexedDbPersistence[] = []

afterEach(async () => {
  // Fresh DB per test: close connections first so deletion is not blocked.
  for (const instance of openInstances.splice(0)) {
    await instance.close().catch(() => {})
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('dsh-hulutable')
    request.onsuccess = () => { resolve() }
    request.onerror = () => { resolve() }
    request.onblocked = () => { resolve() }
  })
})

function idb() {
  const p = new IndexedDbPersistence()
  openInstances.push(p)
  return p
}

function doc(): TableDoc {
  const d = createBlankTable('客户')
  d.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
  d.rows = [{ id: newId(), cells: { a: { value: 'v' } } }]
  return d
}

describe('IndexedDbPersistence', () => {
  it('saves, loads and lists tables', async () => {
    const p = idb()
    const table = doc()
    await p.saveTable(table)
    const loaded = await p.loadTable(table.id)
    expect(loaded?.name).toBe('客户')
    expect(loaded?.rows[0]!.cells.a!.value).toBe('v')
    const library = await p.loadLibrary()
    expect(library.map(r => r.id)).toEqual([table.id])
    expect(library[0]!.rowCount).toBe(1)
  })

  it('removes tables and tolerates missing ids', async () => {
    const p = idb()
    const table = doc()
    await p.saveTable(table)
    await p.removeTable(table.id)
    expect(await p.loadTable(table.id)).toBeUndefined()
    await p.removeTable('never-existed')
    expect(await p.loadLibrary()).toHaveLength(0)
  })

  it('round-trips cell history keyed per cell', async () => {
    const p = idb()
    const table = doc()
    await p.saveTable(table)
    const key = `${table.id}/row1/a`
    await p.saveHistory(table.id, key, [{ ts: 1, before: null, after: 'x' }])
    const history = await p.loadHistory(table.id)
    expect(history.get(key)).toHaveLength(1)
    // Another table's history stays separate.
    const other = doc()
    expect(await p.loadHistory(other.id)).toEqual(new Map())
  })

  it('close() without an open connection is a no-op', async () => {
    const p = new IndexedDbPersistence()
    await p.close()
    await p.close()
  })
})
