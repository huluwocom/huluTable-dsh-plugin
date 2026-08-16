/** Controller tail branches: guards, view fallbacks, updatedAt maintenance. */
import { describe, expect, it } from 'vitest'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId } from '../src/client/domain/types.ts'

function bench() {
  const persistence = new MemoryPersistence()
  const controller = new HulutableController(persistence)
  return { persistence, controller }
}

async function openCrm() {
  const b = bench()
  const id = b.controller.createTable('客户', 'crm')
  await b.controller.openTable(id)
  return { ...b, id }
}

describe('controller tail', () => {
  it('guards duplicateTable and empty renames', () => {
    const { controller } = bench()
    const id = controller.createTable('t')
    expect(controller.duplicateTable('missing')).toBe('')
    controller.renameTable(id, '   ')
    expect(controller.snapshot().tables[id]!.name).toBe('t')
  })

  it('purges the current table and clears selection', async () => {
    const { controller, id } = await openCrm()
    controller.select({ r0: 0, r1: 0, c0: 0, c1: 0 })
    controller.moveToBin(id)
    controller.purgeTable(id)
    expect(controller.snapshot().currentTableId).toBeNull()
  })

  it('guards commitEdit and appendImport edge cases', async () => {
    const { controller, id } = await openCrm()
    controller.commitEdit('missing', 'x', [{ kind: 'cell', rowId: 'r', columnId: 'c', before: { value: null }, after: { value: 1 } }])
    controller.commitEdit(id, 'x', [])
    const empty = { headers: [], rows: [] }
    expect(controller.appendImport(id, empty)).toBe(0)
    expect(controller.appendImport('missing', { headers: ['a'], rows: [['1']] })).toBe(0)
  })

  it('removes the active view down to zero and resets the preference', () => {
    const { controller } = bench()
    const id = controller.createTable('t')
    controller.addView(id, 'v2')
    const views = controller.snapshot().tables[id]!.views
    controller.removeView(id, views[0]!.id)
    controller.removeView(id, views[1]!.id)
    const doc = controller.snapshot().tables[id]!
    expect(doc.views).toHaveLength(1)
    expect(controller.viewOf(id)!.id).toBe(doc.views[0]!.id)
  })

  it('duplicates views carrying group and calendar bindings', async () => {
    const { controller, id } = await openCrm()
    const kanban = controller.snapshot().tables[id]!.views.find(v => v.kind === 'kanban')!
    controller.duplicateView(id, kanban.id)
    const copy = controller.snapshot().tables[id]!.views.at(-1)!
    expect(copy.groupColumnId).toBe(kanban.groupColumnId)
    controller.duplicateView(id, 'ghost')
    // Chart configs ride along on duplication.
    controller.addView(id, '图', 'chart')
    const withChart = controller.snapshot().tables[id]!.views.find(v => v.kind === 'chart')!.id
    controller.updateView(id, withChart, { chart: { type: 'pie', title: '占比', xColumnId: 'x', yColumnIds: ['y'] } })
    controller.duplicateView(id, withChart)
    const copies = controller.snapshot().tables[id]!.views.filter(v => v.kind === 'chart')
    expect(copies).toHaveLength(3)
    expect(copies.at(-1)!.chart).toEqual({ type: 'pie', title: '占比', xColumnId: 'x', yColumnIds: ['y'] })
    expect(controller.snapshot().tables[id]!.views).toHaveLength(7)
  })

  it('updates views with unknown ids and removes missing goals', async () => {
    const { controller, id } = await openCrm()
    controller.updateView(id, 'ghost', { name: 'x' })
    controller.removeGoal(id, 'ghost')
    controller.addGoal(id, { columnId: 'c', aggregate: 'sum', target: 1 })
    controller.removeGoal(id, controller.snapshot().tables[id]!.goals[0]!.id)
    expect(controller.snapshot().tables[id]!.goals).toHaveLength(0)
  })

  it('maintains updatedAt columns on edits', async () => {
    const { controller } = bench()
    const doc = createBlankTable('t')
    doc.columns = [
      { id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false },
      { id: 'u', name: 'U', type: 'updatedAt', width: 100, frozen: false, hidden: false, required: false },
    ]
    doc.rows = [{ id: newId(), cells: { a: { value: 'x' } } }]
    controller.update((d) => { d.tables[doc.id] = doc })
    controller.setCellRaw(doc.id, doc.rows[0]!.id, 'a', 'y')
    const updated = controller.snapshot().tables[doc.id]!
    expect(typeof updated.rows[0]!.cells.u!.value).toBe('number')
    // The same-tick guard skips a second stamp.
    const before = updated.rows[0]!.cells.u!.value
    controller.setCellRaw(doc.id, doc.rows[0]!.id, 'a', 'z')
    expect(controller.snapshot().tables[doc.id]!.rows[0]!.cells.u!.value).toBeGreaterThanOrEqual(before as number)
  })

  it('tracks expired bin cleanup on init', async () => {
    const { persistence } = bench()
    const dead = createBlankTable('dead')
    dead.deletedAt = Date.now() - 40 * 24 * 60 * 60 * 1000
    await persistence.saveTable(dead)
    const failing = new HulutableController({
      loadLibrary: async () => [{
        id: dead.id, name: 'dead', tags: [], starred: false, rowCount: 0, colCount: 0,
        createdAt: 1, updatedAt: 1, deletedAt: dead.deletedAt,
      }],
      loadTable: async () => dead,
      saveTable: async () => {},
      removeTable: () => Promise.reject(new Error('gone')),
      loadHistory: async () => new Map(),
      saveHistory: async () => {},
    })
    await failing.init()
    expect(failing.snapshot().bin).toHaveLength(0)
  })
})
