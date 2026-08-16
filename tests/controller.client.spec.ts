/** Controller behaviors: library lifecycle, undo/redo, history, persistence. */
import { describe, expect, it, vi } from 'vitest'
import { HulutableController, FLUSH_DELAY_MS } from '../src/client/controller.ts'
import { MemoryPersistence, HISTORY_LIMIT } from '../src/client/persistence.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId } from '../src/client/domain/types.ts'

function bench() {
  const persistence = new MemoryPersistence()
  const controller = new HulutableController(persistence)
  return { persistence, controller }
}

async function seedTable(controller: HulutableController, persistence: MemoryPersistence) {
  const doc = createBlankTable('客户表')
  doc.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
  doc.rows = [{ id: newId(), cells: { a: { value: 'v0' } } }]
  controller.update((d) => { d.tables[doc.id] = doc; d.ready = true })
  await persistence.saveTable(doc)
  return doc.id
}

describe('HulutableController library', () => {
  it('initializes library and bin from persistence, purging expired bin rows', async () => {
    const { persistence, controller } = bench()
    const live = createBlankTable('live')
    const dead = createBlankTable('dead')
    dead.deletedAt = Date.now() - 40 * 24 * 60 * 60 * 1000 // expired (40 days)
    const fresh = createBlankTable('fresh')
    fresh.deletedAt = Date.now() - 1000
    await persistence.saveTable(live)
    await persistence.saveTable(dead)
    await persistence.saveTable(fresh)
    await controller.init()
    expect(controller.snapshot().library.map(r => r.name)).toEqual(['live'])
    expect(controller.snapshot().bin.map(r => r.name)).toEqual(['fresh'])
    // Expired rows are removed from persistence.
    expect(persistence.tables.has(dead.id)).toBe(false)
  })

  it('creates from template with resolved kanban group column', () => {
    const { controller } = bench()
    const id = controller.createTable('CRM', 'crm')
    const doc = controller.snapshot().tables[id]!
    expect(doc.rows.length).toBeGreaterThan(0)
    const kanban = doc.views.find(v => v.kind === 'kanban')
    expect(kanban?.groupColumnId).toBeDefined()
    const group = doc.columns.find(c => c.id === kanban?.groupColumnId)
    expect(group?.name).toBe('跟进状态')
  })

  it('moves to bin, restores, and purges', () => {
    const { controller } = bench()
    const id = controller.createTable('t1')
    controller.moveToBin(id)
    expect(controller.snapshot().bin.map(r => r.id)).toEqual([id])
    expect(controller.snapshot().library.map(r => r.id)).not.toContain(id)
    controller.restoreTable(id)
    expect(controller.snapshot().library.map(r => r.id)).toContain(id)
    controller.moveToBin(id)
    controller.purgeTable(id)
    expect(controller.snapshot().bin).toHaveLength(0)
    expect(controller.snapshot().tables[id]).toBeUndefined()
  })

  it('duplicates a table with a fresh id', () => {
    const { controller } = bench()
    const id = controller.createTable('t1')
    const copyId = controller.duplicateTable(id)
    expect(copyId).not.toBe(id)
    const copy = controller.snapshot().tables[copyId]!
    expect(copy.name).toContain('副本')
    expect(copy.id).not.toBe(id)
  })
})

describe('HulutableController undo/redo', () => {
  it('undoes and redoes cell edits with history records', async () => {
    const { persistence, controller } = bench()
    const id = await seedTable(controller, persistence)
    const rowId = controller.snapshot().tables[id]!.rows[0]!.id
    controller.commitEdit(id, '编辑', [
      { kind: 'cell', rowId, columnId: 'a', before: { value: 'v0' }, after: { value: 'v1' } },
    ], [{ rowId, columnId: 'a', before: 'v0', after: 'v1' }])
    expect(controller.snapshot().tables[id]!.rows[0]!.cells.a!.value).toBe('v1')
    expect(controller.canUndo(id)).toBe(true)
    expect(controller.getHistory(id, rowId, 'a')).toHaveLength(1)
    controller.undo(id)
    expect(controller.snapshot().tables[id]!.rows[0]!.cells.a!.value).toBe('v0')
    controller.redo(id)
    expect(controller.snapshot().tables[id]!.rows[0]!.cells.a!.value).toBe('v1')
  })

  it('keeps at most HISTORY_LIMIT records per cell', async () => {
    const { persistence, controller } = bench()
    const id = await seedTable(controller, persistence)
    const rowId = controller.snapshot().tables[id]!.rows[0]!.id
    for (let i = 0; i < 8; i += 1) {
      controller.commitEdit(id, '编辑', [
        { kind: 'cell', rowId, columnId: 'a', before: { value: String(i) }, after: { value: String(i + 1) } },
      ], [{ rowId, columnId: 'a', before: String(i), after: String(i + 1) }])
    }
    const history = controller.getHistory(id, rowId, 'a')
    expect(history).toHaveLength(HISTORY_LIMIT)
    expect(history.at(-1)?.after).toBe('8')
  })

  it('persists flushed edits and rehydrates on openTable', async () => {
    const { persistence, controller } = bench()
    const id = await seedTable(controller, persistence)
    const rowId = controller.snapshot().tables[id]!.rows[0]!.id
    controller.commitEdit(id, '编辑', [
      { kind: 'cell', rowId, columnId: 'a', before: { value: 'v0' }, after: { value: '持久化' } },
    ], [{ rowId, columnId: 'a', before: 'v0', after: '持久化' }])
    controller.flushNow()
    const stored = persistence.tables.get(id)!
    expect(stored.rows[0]!.cells.a!.value).toBe('持久化')
    // A fresh controller rehydrates from persistence.
    const fresh = new HulutableController(persistence)
    await fresh.init()
    await fresh.openTable(id)
    expect(fresh.snapshot().tables[id]!.rows[0]!.cells.a!.value).toBe('持久化')
  })

  it('bumps updatedAt on edits', async () => {
    const { persistence, controller } = bench()
    const id = await seedTable(controller, persistence)
    const before = controller.snapshot().tables[id]!.updatedAt
    const rowId = controller.snapshot().tables[id]!.rows[0]!.id
    controller.commitEdit(id, '编辑', [
      { kind: 'cell', rowId, columnId: 'a', before: { value: 'v0' }, after: { value: 'x' } },
    ])
    expect(controller.snapshot().tables[id]!.updatedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('HulutableController views and goals', () => {
  it('patches the active view filters and sorts', () => {
    const { controller } = bench()
    const id = controller.createTable('CRM', 'crm')
    const view = controller.viewOf(id)!
    expect(view.kind).toBe('grid')
    controller.updateView(id, view.id, { sorts: [{ columnId: 'x', dir: 'asc' }] })
    expect(controller.viewOf(id)!.sorts).toEqual([{ columnId: 'x', dir: 'asc' }])
  })

  it('toggles hidden columns per view', () => {
    const { controller } = bench()
    const id = controller.createTable('CRM', 'crm')
    const doc = controller.snapshot().tables[id]!
    const col = doc.columns[0]!
    const view = controller.viewOf(id)!
    controller.toggleColumnHidden(id, view.id, col.id)
    expect(controller.viewOf(id)!.hiddenColumns).toContain(col.id)
    controller.toggleColumnHidden(id, view.id, col.id)
    expect(controller.viewOf(id)!.hiddenColumns).not.toContain(col.id)
  })

  it('adds and removes goals with progress data', () => {
    const { controller } = bench()
    const id = controller.createTable('CRM', 'crm')
    const doc = controller.snapshot().tables[id]!
    const amount = doc.columns.find(c => c.name === '预算')!
    controller.addGoal(id, { columnId: amount.id, aggregate: 'sum', target: 500000 })
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(1)
    const goalId = controller.snapshot().tables[id]!.goals[0]!.id
    controller.removeGoal(id, goalId)
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(0)
  })

  it('manages conditional-formatting rules', () => {
    const { controller } = bench()
    const id = controller.createTable('CRM', 'crm')
    const doc = controller.snapshot().tables[id]!
    const status = doc.columns.find(c => c.name === '跟进状态')!
    controller.addFormatRule(id, {
      columnId: status.id, op: 'eq', value: '已成交', scope: 'row', bg: '#dcfce7', enabled: true,
    })
    expect(controller.snapshot().tables[id]!.formatRules).toHaveLength(1)
    const ruleId = controller.snapshot().tables[id]!.formatRules[0]!.id
    controller.updateFormatRule(id, ruleId, { enabled: false })
    expect(controller.snapshot().tables[id]!.formatRules[0]!.enabled).toBe(false)
    controller.removeFormatRule(id, ruleId)
    expect(controller.snapshot().tables[id]!.formatRules).toHaveLength(0)
  })
})

describe('HulutableController flush', () => {
  it('debounces saves and flushes on demand', async () => {
    vi.useFakeTimers()
    try {
      const { persistence, controller } = bench()
      const id = controller.createTable('t')
      expect(persistence.tables.has(id)).toBe(false)
      vi.advanceTimersByTime(FLUSH_DELAY_MS + 10)
      expect(persistence.tables.has(id)).toBe(true)
      controller.flushNow()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('library persistence across lazy loads', () => {
  it('keeps unloaded library rows when a new table is created', async () => {
    const persistence = new MemoryPersistence()
    const _controller = new HulutableController(persistence)
    // Seed several tables directly in persistence; the controller knows them
    // only as library rows after init (docs stay lazily unloaded).
    const seeded = new HulutableController(persistence)
    seeded.createTable('表A')
    seeded.createTable('表B')
    seeded.createTable('表C')
    seeded.flushNow()
    const fresh = new HulutableController(persistence)
    await fresh.init()
    expect(fresh.snapshot().library).toHaveLength(3)
    // None of the documents are loaded in memory yet.
    expect(Object.keys(fresh.snapshot().tables)).toHaveLength(0)
    // Creating a new table must NOT wipe the three seeded rows.
    fresh.createTable('新表')
    const names = fresh.snapshot().library.map(r => r.name).sort()
    expect(names).toEqual(['新表', '表A', '表B', '表C'])
  })

  it('reprojects unloaded bin rows across edits', async () => {
    const persistence = new MemoryPersistence()
    const seed = new HulutableController(persistence)
    const gone = seed.createTable('已删除')
    seed.moveToBin(gone)
    seed.flushNow()
    const controller = new HulutableController(persistence)
    await controller.init()
    expect(controller.snapshot().bin).toHaveLength(1)
    controller.createTable('又一张')
    expect(controller.snapshot().bin).toHaveLength(1)
  })

  it('ensures library operations load the doc first', async () => {
    const persistence = new MemoryPersistence()
    const seed = new HulutableController(persistence)
    const id = seed.createTable('待改名')
    seed.flushNow()
    const controller = new HulutableController(persistence)
    await controller.init()
    await controller.ensureLoaded(id)
    controller.toggleStar(id)
    expect(controller.snapshot().library.find(r => r.id === id)!.starred).toBe(true)
    controller.renameTable(id, '已改名')
    expect(controller.snapshot().library.find(r => r.id === id)!.name).toBe('已改名')
  })

  it('loads a document and its history through ensureLoaded, tolerating missing docs', async () => {
    const persistence = new MemoryPersistence()
    const seed = new HulutableController(persistence)
    const id = seed.createTable('历史表')
    seed.addColumn(id, 0, 'text', '字段')
    seed.addRows(id, 0)
    const doc = seed.snapshot().tables[id]!
    const columnId = doc.columns[0]!.id
    seed.setCellValue(id, doc.rows[0]!.id, columnId, '第一版')
    seed.setCellValue(id, doc.rows[0]!.id, columnId, '第二版')
    seed.flushNow()
    const controller = new HulutableController(persistence)
    await controller.init()
    await controller.ensureLoaded(id)
    expect(controller.snapshot().tables[id]).toBeDefined()
    expect(controller.getHistory(id, doc.rows[0]!.id, columnId).length).toBeGreaterThan(0)
    // A missing id resolves without touching the store.
    await controller.ensureLoaded('ghost')
    expect(controller.snapshot().tables['ghost']).toBeUndefined()
  })

  it('reprojects preserved unloaded live and bin rows (no table loss)', async () => {
    const persistence = new MemoryPersistence()
    const seed = new HulutableController(persistence)
    const a = seed.createTable('甲')
    const b = seed.createTable('乙')
    const c = seed.createTable('丙')
    seed.moveToBin(c)
    seed.flushNow()
    const controller = new HulutableController(persistence)
    await controller.init()
    expect(controller.snapshot().library.map(r => r.name).sort()).toEqual(['乙', '甲'])
    expect(controller.snapshot().bin).toHaveLength(1)
    // Load only 甲; 乙 stays lazily unloaded.
    await controller.openTable(a)
    // An edit on the loaded doc reprojects everything.
    controller.renameTable(a, '甲改')
    expect(controller.snapshot().library.map(r => r.name).sort()).toEqual(['乙', '甲改'])
    expect(controller.snapshot().bin).toHaveLength(1)
    // Defensive: a deleted stamp on an unloaded library row lands in the bin.
    controller.update((d) => {
      d.library.push({ id: 'ghost', name: '幽灵', tags: [], starred: false, rowCount: 0, colCount: 0, createdAt: 1, updatedAt: 2, deletedAt: 3 })
    })
    // A stamp-less raw bin row survives reprojection too.
    controller.update((d) => {
      d.bin.push({ id: 'raw', name: '无时间', tags: [], starred: false, rowCount: 0, colCount: 0, createdAt: 1, updatedAt: 2 })
    })
    controller.renameTable(a, '甲再改')
    expect(controller.snapshot().bin.some(r => r.id === 'ghost')).toBe(true)
    expect(controller.snapshot().bin.some(r => r.id === 'raw')).toBe(true)
    expect(controller.snapshot().library.some(r => r.id === 'ghost')).toBe(false)
    void b
  })
})
