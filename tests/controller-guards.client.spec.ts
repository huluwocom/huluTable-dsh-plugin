// @vitest-environment jsdom
/** Controller defensive arms: missing-table guards and storage failures. */
import { describe, expect, it, vi } from 'vitest'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence, type TablePersistence } from '../src/client/persistence.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type TableDoc } from '../src/client/domain/types.ts'

describe('missing-table guards', () => {
  it('every editor op is a no-op for an unknown table', async () => {
    const { controller } = bench()
    const c = controller
    c.setCellRaw('missing', 'r', 'c', 'x')
    c.setCellValue('missing', 'r', 'c', 1)
    c.setFormula('missing', 'r', 'c', '=1')
    c.addRows('missing', 0)
    c.addColumn('missing', 0)
    c.updateColumn('missing', 'c', { width: 10 })
    c.removeColumn('missing', 0)
    c.moveColumn('missing', 'c', 1)
    c.duplicateRow('missing', 0)
    c.duplicateColumn('missing', 0)
    c.fill('missing', { r0: 0, r1: 0, c0: 0, c1: 0 }, { r0: 0, r1: 1, c0: 0, c1: 0 }, 'copy', [])
    c.clear('missing', 0, 1, [])
    c.paste('missing', 0, [], [['x']])
    c.renameTable('missing', 'x')
    c.setTags('missing', [])
    c.toggleStar('missing')
    c.moveToBin('missing')
    c.restoreTable('missing')
    c.purgeTable('missing')
    c.setComment('missing', 'r', 'c', 'x')
    c.updateView('missing', 'v', {})
    c.toggleColumnHidden('missing', 'v', 'c')
    c.addGoal('missing', { columnId: 'c', aggregate: 'sum', target: 1 })
    c.removeGoal('missing', 'g')
    c.addFormatRule('missing', { columnId: 'c', op: 'eq', value: 'x', scope: 'row', enabled: true })
    c.removeFormatRule('missing', 'r')
    c.updateFormatRule('missing', 'r', { enabled: false })
    c.addView('missing', 'v')
    c.removeView('missing', 'v')
    c.duplicateView('missing', 'v')
    c.select(null)
    c.setEditing(null)
    c.setBinOpen(false)
    c.undo('missing')
    c.redo('missing')
    expect(c.viewOf('missing')).toBeUndefined()
    await c.openTable('missing')
    expect(c.snapshot().currentTableId).toBeNull()
    c.flushNow()
    c.dispose()
  })

  it('edit ops on a table whose row/column vanished are no-ops', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    controller.setCellRaw(id, 'ghost-row', doc.columns[0]!.id, 'x')
    controller.setCellValue(id, 'ghost-row', doc.columns[0]!.id, 1)
    controller.updateColumn(id, 'ghost-col', { width: 9 })
    controller.removeColumn(id, 999)
    controller.moveColumn(id, 'ghost-col', 0)
    controller.removeRows(id, [999])
    controller.duplicateRow(id, 999)
    controller.duplicateColumn(id, 999)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(doc.rows.length)
  })

  it('purge cleans history entries for the table', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const row = doc.rows[0]!
    const col = doc.columns[0]!
    controller.commitEdit(id, '编辑', [
      { kind: 'cell', rowId: row.id, columnId: col.id, before: { value: null }, after: { value: 'v' } },
    ], [{ rowId: row.id, columnId: col.id, before: null, after: 'v' }])
    expect(controller.getHistory(id, row.id, col.id)).toHaveLength(1)
    controller.moveToBin(id)
    controller.purgeTable(id)
    expect(controller.getHistory(id, row.id, col.id)).toHaveLength(0)
  })
})

describe('storage failure paths', () => {
  it('init degrades to an empty library when storage throws', async () => {
    const failing: TablePersistence = {
      loadLibrary: () => Promise.reject(new Error('boom')),
      loadTable: async () => undefined,
      saveTable: async () => {},
      removeTable: async () => {},
      loadHistory: async () => new Map(),
      saveHistory: async () => {},
    }
    const controller = new HulutableController(failing)
    await controller.init()
    expect(controller.snapshot().ready).toBe(true)
    expect(controller.snapshot().library).toHaveLength(0)
  })

  it('fire-and-forget saves swallow rejections', async () => {
    const failing: TablePersistence = {
      loadLibrary: async () => [],
      loadTable: async () => undefined,
      saveTable: () => Promise.reject(new Error('quota')),
      removeTable: () => Promise.reject(new Error('gone')),
      loadHistory: async () => new Map(),
      saveHistory: () => Promise.reject(new Error('nope')),
    }
    const controller = new HulutableController(failing)
    await controller.init()
    const id = controller.createTable('t')
    controller.moveToBin(id)
    controller.purgeTable(id)
    // Let the rejected promises settle without surfacing.
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.flushNow()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.snapshot().bin).toHaveLength(0)
  })

  it('pagehide listener flushes and detaches on dispose', () => {
    const listenerSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { controller } = bench()
    controller.dispose()
    expect(listenerSpy).toHaveBeenCalledWith('pagehide', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function))
  })
})

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

export type { TableDoc }
export { createBlankTable, newId }
