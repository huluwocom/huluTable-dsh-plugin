// @vitest-environment jsdom
/** Controller tail branches: pagehide flush, purge/undo guards, formula and
 * comment edges, imports, library sorts and updatedAt maintenance. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { newId } from '../src/client/domain/types.ts'

function bench() {
  const persistence = new MemoryPersistence()
  const controller = new HulutableController(persistence)
  return { persistence, controller }
}

function parsed(headers: string[], rows: string[][]) {
  return { headers, rows }
}

afterEach(() => { vi.restoreAllMocks() })

describe('controller tail 2', () => {
  it('flushes dirty tables and history on pagehide', async () => {
    const { controller, persistence } = bench()
    const saveSpy = vi.spyOn(persistence, 'saveTable').mockImplementation(() => Promise.resolve())
    const historySpy = vi.spyOn(persistence, 'saveHistory').mockImplementation(() => Promise.resolve())
    const id = controller.createTable('t', 'crm')
    controller.setCellValue(id, controller.snapshot().tables[id]!.rows[0]!.id, controller.snapshot().tables[id]!.columns[0]!.id, 'v')
    window.dispatchEvent(new Event('pagehide'))
    expect(saveSpy).toHaveBeenCalled()
    expect(historySpy).toHaveBeenCalled()
  })

  it('purges the current table and keeps other tables’ history cache', () => {
    const { controller } = bench()
    const a = controller.createTable('a', 'crm')
    const b = controller.createTable('b', 'crm')
    void controller.openTable(a)
    controller.setCellValue(a, controller.snapshot().tables[a]!.rows[0]!.id, controller.snapshot().tables[a]!.columns[0]!.id, 'x')
    controller.setCellValue(b, controller.snapshot().tables[b]!.rows[0]!.id, controller.snapshot().tables[b]!.columns[0]!.id, 'y')
    controller.purgeTable(a)
    expect(controller.snapshot().currentTableId).toBeNull()
    expect(controller.snapshot().tables[b]).toBeDefined()
  })

  it('undo/redo skip when the table is gone, and removeRows guards missing tables', () => {
    const { controller } = bench()
    const id = controller.createTable('t', 'crm')
    controller.setCellValue(id, controller.snapshot().tables[id]!.rows[0]!.id, controller.snapshot().tables[id]!.columns[0]!.id, 'x')
    controller.undo(id)
    controller.redo(id)
    controller.removeRows(id, [0])
    controller.purgeTable(id)
    controller.undo(id)
    controller.redo(id)
    controller.removeRows('ghost', [0])
    controller.setCellValue('ghost', 'r', 'c', 1)
    controller.addRows('ghost', 0)
  })

  it('sets formulas on empty cells and skips identical formulas', () => {
    const { controller } = bench()
    const id = controller.createTable('t', 'crm')
    const doc = controller.snapshot().tables[id]!
    const col = doc.columns[0]!
    const row = doc.rows[0]!
    // The cell has no record yet → before reads as { value: null }.
    controller.update((d) => { Reflect.deleteProperty(d.tables[id]!.rows[0]!.cells, col.id) })
    controller.setFormula(id, row.id, col.id, '=1+1')
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[col.id]!.value).toBe(2)
    // Same formula again → no-op.
    controller.setFormula(id, row.id, col.id, '=1+1')
    controller.undo(id)
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[col.id]!.value).toBeNull()
  })

  it('duplicates views carrying filters, sorts and calendar bindings', () => {
    const { controller } = bench()
    const id = controller.createTable('t')
    controller.update((d) => {
      const doc = d.tables[id]!
      doc.columns.push({ id: 'd', name: '日期', type: 'date', width: 100, frozen: false, hidden: false, required: false })
      doc.views.push({
        id: newId(), name: '日历', kind: 'calendar', filters: [{ columnId: 'd', op: 'notEmpty' }],
        filterMode: 'and', sorts: [{ columnId: 'd', dir: 'asc' }], hiddenColumns: [], calendarColumnId: 'd',
      })
    })
    const calendar = controller.snapshot().tables[id]!.views.find(v => v.kind === 'calendar')!
    controller.duplicateView(id, calendar.id)
    const copy = controller.snapshot().tables[id]!.views.at(-1)!
    expect(copy.calendarColumnId).toBe('d')
    expect(copy.filters).toHaveLength(1)
    expect(copy.sorts).toHaveLength(1)
    expect(copy.filters[0]).not.toBe(calendar.filters[0])
  })

  it('imports with empty names and ragged rows; appends ragged rows', () => {
    const { controller } = bench()
    const id = controller.importTable('  ', parsed(['a', 'b'], [['x'], ['y', 'z']]))
    expect(controller.snapshot().tables[id]!.name).toBe('导入表格')
    const doc = controller.snapshot().tables[id]!
    const colA = doc.columns.find(c => c.name === 'a')!
    const colB = doc.columns.find(c => c.name === 'b')!
    expect(doc.rows[0]!.cells[colA.id]!.value).toBe('x')
    expect(doc.rows[0]!.cells[colB.id]).toBeUndefined()
    void controller.openTable(id)
    const added = controller.appendImport(id, parsed(['a', 'b'], [['1', '2'], ['3']]))
    expect(added).toBeGreaterThan(0)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(4)
  })

  it('touches only edited rows in updatedAt columns', () => {
    const { controller } = bench()
    const id = controller.createTable('t', 'crm')
    controller.update((d) => {
      const doc = d.tables[id]!
      doc.columns.push({ id: 'upd', name: '更新时间', type: 'updatedAt', width: 100, frozen: false, hidden: false, required: false })
      doc.rows.push({ id: newId(), cells: { [doc.columns[0]!.id]: { value: 'r2' } } })
    })
    const doc = controller.snapshot().tables[id]!
    const col0 = doc.columns[0]!
    controller.setCellValue(id, doc.rows[0]!.id, col0.id, '改')
    const after = controller.snapshot().tables[id]!
    const upd = after.columns.find(c => c.type === 'updatedAt')!
    expect(after.rows[0]!.cells[upd.id]).toBeDefined()
    expect(after.rows[1]!.cells[upd.id]).toBeUndefined()
  })

  it('updates comments with missing lists and unknown ids', () => {
    const { controller } = bench()
    const id = controller.createTable('t', 'crm')
    const doc = controller.snapshot().tables[id]!
    const row = doc.rows[0]!
    const col = doc.columns[0]!
    // Updating a missing table and a key with no list are both no-ops.
    controller.updateComment('ghost-table', 'r', 'c', 'x', 'y')
    controller.updateComment(id, row.id, col.id, 'ghost', '文字')
    expect(controller.snapshot().tables[id]!.comments[`${row.id}:${col.id}`]).toEqual([])
    // Two comments, delete one by empty text → the other stays.
    controller.setComment(id, row.id, col.id, '第一条')
    controller.setComment(id, row.id, col.id, '第二条')
    const key = `${row.id}:${col.id}`
    expect(controller.snapshot().tables[id]!.comments[key]).toHaveLength(2)
    const first = controller.snapshot().tables[id]!.comments[key][0]!
    controller.updateComment(id, row.id, col.id, first.id, '')
    expect(controller.snapshot().tables[id]!.comments[key]).toHaveLength(1)
    // Clearing text with no list is a no-op.
    controller.update((d) => { Reflect.deleteProperty(d.tables[id]!.comments, key) })
    controller.setComment(id, row.id, col.id, '')
    expect(controller.snapshot().tables[id]!.comments[key]).toBeUndefined()
  })

  it('sorts the library by star then update time and the bin by delete time', () => {
    const { controller } = bench()
    const a = controller.createTable('旧')
    controller.update((d) => { d.tables[a]!.updatedAt = 100 })
    controller.setTags(a, [])
    const b = controller.createTable('新')
    controller.update((d) => { d.tables[b]!.updatedAt = 200 })
    controller.setTags(b, [])
    // Equal star → updatedAt decides.
    expect(controller.snapshot().library.map(r => r.name)).toEqual(['新', '旧'])
    controller.toggleStar(a)
    expect(controller.snapshot().library.map(r => r.name)).toEqual(['旧', '新'])
    // Two bin rows sort by deletedAt; a raw row without the stamp sorts last.
    controller.moveToBin(a)
    controller.update((d) => { d.tables[a]!.deletedAt = 100 })
    controller.moveToBin(b)
    const bin = controller.snapshot().bin
    expect(bin.map(r => r.id)).toEqual([b, a])
  })
})
