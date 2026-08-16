/** Controller editor-op wrappers, import, comments, view management. */
import { describe, expect, it } from 'vitest'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'

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

describe('controller editor ops', () => {
  it('sets raw values with coercion and validation errors', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const nameCol = doc.columns.find(c => c.name === '姓名')!
    const amountCol = doc.columns.find(c => c.name === '预算')!
    const row = doc.rows[0]!
    expect(controller.setCellRaw(id, row.id, amountCol.id, '123')).toBeNull()
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[amountCol.id]!.value).toBe(123)
    expect(controller.setCellRaw(id, row.id, amountCol.id, 'abc')).toBe('type')
    const contactCol = doc.columns.find(c => c.name === '电话')!
    expect(controller.setCellRaw(id, row.id, contactCol.id, '')).toBeNull()
    expect(controller.setCellRaw(id, 'nope', nameCol.id, 'x')).toBe('missing')
  })

  it('sets formulas and evaluates immediately', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const amountCol = doc.columns.find(c => c.name === '预算')!
    const row = doc.rows[0]!
    controller.setFormula(id, row.id, amountCol.id, '=100+1')
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[amountCol.id]!.value).toBe(101)
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[amountCol.id]!.formula).toBe('=100+1')
    // setCellRaw routes formulas too
    controller.setCellRaw(id, row.id, amountCol.id, '=200+1')
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[amountCol.id]!.value).toBe(201)
  })

  it('adds/updates/moves/removes columns and rows', async () => {
    const { controller, id } = await openCrm()
    const before = controller.snapshot().tables[id]!.columns.length
    controller.addColumn(id, 0, 'number', '新列')
    const doc = controller.snapshot().tables[id]!
    expect(doc.columns).toHaveLength(before + 1)
    const added = doc.columns[0]!
    controller.updateColumn(id, added.id, { width: 200, description: '备注' })
    controller.moveColumn(id, added.id, doc.columns.length - 1)
    controller.duplicateColumn(id, doc.columns.length - 1)
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(before + 2)
    controller.removeColumn(id, doc.columns.length - 1)
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(before + 1)
    const rowCount = controller.snapshot().tables[id]!.rows.length
    controller.addRows(id, 0)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(rowCount + 1)
    controller.duplicateRow(id, 0)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(rowCount + 2)
    controller.removeRows(id, [0])
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(rowCount + 1)
  })

  it('removing a populated column snapshots its cell values', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const nameCol = doc.columns.find(c => c.name === '姓名')!
    controller.removeColumn(id, doc.columns.indexOf(nameCol))
    // Undo restores the column with its values intact.
    controller.undo(id)
    const after = controller.snapshot().tables[id]!
    const restored = after.columns.find(c => c.name === '姓名')!
    expect(after.rows[0]!.cells[restored.id]!.value).toBe('陈小雨')
  })

  it('clears, fills and pastes over display columns', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const amountCol = doc.columns.find(c => c.name === '预算')!
    controller.setCellValue(id, doc.rows[0]!.id, amountCol.id, 100)
    controller.fill(id, { r0: 0, r1: 0, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'series', [amountCol])
    expect(controller.snapshot().tables[id]!.rows[1]!.cells[amountCol.id]!.value).toBe(101)
    expect(controller.snapshot().tables[id]!.rows[2]!.cells[amountCol.id]!.value).toBe(102)
    controller.clear(id, 0, 1, [amountCol])
    expect(controller.snapshot().tables[id]!.rows[0]!.cells[amountCol.id]!.value).toBeNull()
    controller.paste(id, 2, [amountCol], [['99']])
    expect(controller.snapshot().tables[id]!.rows[2]!.cells[amountCol.id]!.value).toBe(99)
  })

  it('imports into a new table and appends to the current one', async () => {
    const { controller } = bench()
    const parsed = { headers: ['名称', '金额'], rows: [['甲', '10'], ['乙', '20']] }
    const id = controller.importTable('导入', parsed)
    const doc = controller.snapshot().tables[id]!
    expect(doc.columns.map(c => c.name)).toEqual(['名称', '金额'])
    expect(doc.columns[1]!.type).toBe('number')
    expect(doc.rows).toHaveLength(2)
    controller.appendImport(id, { headers: ['名称', '金额'], rows: [['丙', '30']] })
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(3)
  })

  it('manages comments and tags', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const row = doc.rows[0]!
    const col = doc.columns[0]!
    controller.setComment(id, row.id, col.id, '重要客户')
    expect(Object.keys(controller.snapshot().tables[id]!.comments)).toHaveLength(1)
    controller.setComment(id, row.id, col.id, '')
    expect(Object.keys(controller.snapshot().tables[id]!.comments)).toHaveLength(0)
    controller.setTags(id, ['重点'])
    expect(controller.snapshot().tables[id]!.tags).toEqual(['重点'])
  })

  it('manages views', async () => {
    const { controller, id } = await openCrm()
    const first = controller.viewOf(id)!
    controller.addView(id, '看板', 'kanban')
    expect(controller.snapshot().tables[id]!.views).toHaveLength(5)
    const kanban = controller.snapshot().tables[id]!.views.at(-1)!
    expect(controller.viewOf(id)!.id).toBe(kanban.id)
    controller.duplicateView(id, kanban.id)
    expect(controller.snapshot().tables[id]!.views).toHaveLength(6)
    controller.removeView(id, kanban.id)
    controller.removeView(id, first.id)
    expect(controller.snapshot().tables[id]!.views.length).toBeGreaterThan(0)
  })

  it('guards editing state accessors', async () => {
    const { controller, id } = await openCrm()
    controller.select({ r0: 0, r1: 1, c0: 0, c1: 1 })
    expect(controller.snapshot().editor.selection?.r1).toBe(1)
    controller.setEditing({ row: 0, col: 0 })
    expect(controller.snapshot().editor.editing?.row).toBe(0)
    controller.setBinOpen(true)
    expect(controller.snapshot().binOpen).toBe(true)
    expect(controller.canUndo(id)).toBe(false)
    expect(controller.canRedo(id)).toBe(false)
    // openTable on a missing id is a no-op
    await controller.openTable('missing')
    expect(controller.snapshot().currentTableId).toBe(id)
    controller.dispose()
  })
})

describe('row/column clipboard and reorder', () => {
  it('moves rows and keeps row ids stable', async () => {
    const { controller, id } = await openCrm()
    const before = controller.snapshot().tables[id]!.rows.map(r => r.id)
    controller.moveRow(id, 0, 2)
    const after = controller.snapshot().tables[id]!.rows.map(r => r.id)
    expect(after[0]).toBe(before[1]!)
    expect(after[1]).toBe(before[2]!)
    expect(after[2]).toBe(before[0]!)
    // Undo restores the original order.
    controller.undo(id)
    expect(controller.snapshot().tables[id]!.rows.map(r => r.id)).toEqual(before)
  })

  it('clamps out-of-range row moves', async () => {
    const { controller, id } = await openCrm()
    const before = controller.snapshot().tables[id]!.rows.length
    controller.moveRow(id, 0, 0)
    controller.moveRow(id, 99, 1)
    controller.moveRow(id, 5, 999) // clamps to the last row → no-op
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(before)
  })

  it('pastes rows that lack timestamp fields', async () => {
    const controller = new HulutableController(new MemoryPersistence())
    const id = controller.createTable('无时间戳')
    controller.update((d) => {
      const doc = d.tables[id]!
      doc.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
      doc.rows = [{ id: 'r1', cells: { a: { value: 'x' } } }, { id: 'r2', cells: { a: { value: 'y' } } }]
    })
    controller.copyRows(id, [0])
    expect(controller.pasteRows(id, 1)).toBe(1)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(3)
  })

  it('copies, cuts and pastes rows', async () => {
    const { controller, id } = await openCrm()
    controller.copyRows(id, [0])
    expect(controller.pasteRows(id, 0)).toBe(1)
    let doc = controller.snapshot().tables[id]!
    expect(doc.rows).toHaveLength(7)
    expect(doc.rows[1]!.cells[doc.columns[0]!.id]!.value).toBe('陈小雨')
    // Cut removes and still pastes the copy.
    controller.cutRows(id, [5])
    doc = controller.snapshot().tables[id]!
    expect(doc.rows).toHaveLength(6)
    expect(controller.pasteRows(id, 6)).toBe(1)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(7)
  })

  it('pastes a column when some rows lack its cells', async () => {
    const controller = new HulutableController(new MemoryPersistence())
    const id = controller.createTable('缺单元格')
    controller.update((d) => {
      const doc = d.tables[id]!
      doc.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
      doc.rows = [
        { id: 'r1', cells: {} },
        { id: 'r2', cells: { a: { value: 'v' } } },
      ]
    })
    controller.copyColumn(id, 0)
    expect(controller.pasteColumn(id, 0)).toBe(1)
    const after = controller.snapshot().tables[id]!
    expect(after.rows[0]!.cells[after.columns[1]!.id]!.value).toBeNull()
    expect(after.rows[1]!.cells[after.columns[1]!.id]!.value).toBe('v')
  })

  it('copies, cuts and pastes columns', async () => {
    const { controller, id } = await openCrm()
    controller.copyColumn(id, 0)
    expect(controller.pasteColumn(id, 0)).toBe(1)
    const doc = controller.snapshot().tables[id]!
    expect(doc.columns).toHaveLength(12)
    expect(doc.columns[1]!.name).toBe('姓名 副本')
    // Cells copied along.
    expect(doc.rows[0]!.cells[doc.columns[1]!.id]!.value).toBe('陈小雨')
    // Cut the original column.
    controller.cutColumn(id, 0)
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(11)
  })

  it('guards clipboard and resize ops on missing tables', async () => {
    const controller = new HulutableController(new MemoryPersistence())
    controller.setColumnWidth('ghost', 'c', 100)
    controller.moveRow('ghost', 0, 1)
    controller.copyRows('ghost', [0])
    controller.cutRows('ghost', [0])
    expect(controller.pasteRows('ghost', 0)).toBe(0)
    controller.copyColumn('ghost', 0)
    controller.cutColumn('ghost', 0)
    expect(controller.pasteColumn('ghost', 0)).toBe(0)
    // Paste without a clipboard is a no-op on a real table too.
    const { controller: c2, id } = await openCrm()
    expect(c2.pasteRows(id, 0)).toBe(0)
    expect(c2.pasteColumn(id, 0)).toBe(0)
  })

  it('cuts multiple rows at once', async () => {
    const { controller, id } = await openCrm()
    const before = controller.snapshot().tables[id]!.rows.length
    controller.cutRows(id, [0, 2])
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(before - 2)
    expect(controller.pasteRows(id, 0)).toBe(2)
  })

  it('localizes template views and blank-table views for English tables', async () => {
    const controller = new HulutableController(new MemoryPersistence())
    // English CRM: view names + bound columns follow the English surface.
    const crm = controller.createTable('Customers', 'crm', 'en')
    const crmDoc = controller.snapshot().tables[crm]!
    expect(crmDoc.views.map(v => v.name)).toEqual(['All customers', 'Status board', 'Contact calendar', 'Source mix'])
    const status = crmDoc.columns.find(c => c.name === 'Status')!
    const kanban = crmDoc.views.find(v => v.kind === 'kanban')!
    expect(kanban.groupColumnId).toBe(status.id)
    const calendar = crmDoc.views.find(v => v.kind === 'calendar')!
    expect(calendar.calendarColumnId).toBe(crmDoc.columns.find(c => c.name === 'Next contact')!.id)
    const chart = crmDoc.views.find(v => v.kind === 'chart')!
    expect(chart.chart?.xColumnId).toBe(crmDoc.columns.find(c => c.name === 'Source')!.id)
    expect(chart.chart?.yColumnIds).toEqual([crmDoc.columns.find(c => c.name === 'Budget')!.id])
    // English project template: kanban groups by the English status column.
    const project = controller.createTable('Tasks', 'project', 'en')
    const projectDoc = controller.snapshot().tables[project]!
    expect(projectDoc.views.map(v => v.name)).toEqual(['Task list', 'Status board'])
    // English template without a view list keeps the default grid view.
    const finance = controller.createTable('Ledger', 'finance', 'en')
    const financeDoc = controller.snapshot().tables[finance]!
    expect(financeDoc.views.map(v => v.name)).toEqual(['Grid'])
    // English blank tables get an English default grid view.
    const blank = controller.createTable('Scratch', undefined, 'en')
    const blankDoc = controller.snapshot().tables[blank]!
    expect(blankDoc.views[0]!.name).toBe('Grid')
  })

  it('resizes a column width without touching undo', async () => {
    const { controller, id } = await openCrm()
    const before = controller.snapshot().tables[id]!.columns[0]!.width
    controller.setColumnWidth(id, controller.snapshot().tables[id]!.columns[0]!.id, 200)
    expect(controller.snapshot().tables[id]!.columns[0]!.width).toBe(200)
    // Clamps.
    controller.setColumnWidth(id, controller.snapshot().tables[id]!.columns[0]!.id, 99999)
    expect(controller.snapshot().tables[id]!.columns[0]!.width).toBe(600)
    expect(controller.canUndo(id)).toBe(false)
    void before
  })
})

describe('frozen block stays the column prefix', () => {
  it('dragging a plain column before the frozen one transfers the freeze', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const name = doc.columns[0]!.id // 姓名, frozen
    const gender = doc.columns[1]!.id // 性别
    controller.moveColumn(id, gender, 0)
    const after = controller.snapshot().tables[id]!
    expect(after.columns.map(c => c.id)).toEqual([gender, name, ...doc.columns.slice(2).map(c => c.id)])
    expect(after.columns[0]!.frozen).toBe(true)
    expect(after.columns[1]!.frozen).toBe(false)
    // One undo restores order and flags.
    controller.undo(id)
    const back = controller.snapshot().tables[id]!
    expect(back.columns[0]!.id).toBe(name)
    expect(back.columns[0]!.frozen).toBe(true)
    expect(back.columns[1]!.frozen).toBe(false)
  })

  it('dragging the frozen column out freezes its replacement', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const name = doc.columns[0]!.id
    controller.moveColumn(id, name, 2)
    const after = controller.snapshot().tables[id]!
    expect(after.columns[2]!.id).toBe(name)
    expect(after.columns[2]!.frozen).toBe(false)
    expect(after.columns[0]!.frozen).toBe(true)
    expect(after.columns[1]!.frozen).toBe(false)
  })

  it('freezing a later column pulls it into the block; unfreezing pushes it out', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const source = doc.columns[2]!.id // 年龄
    controller.updateColumn(id, source, { frozen: true })
    let after = controller.snapshot().tables[id]!
    expect(after.columns[1]!.id).toBe(source)
    expect(after.columns[1]!.frozen).toBe(true)
    expect(after.columns[0]!.frozen).toBe(true)
    controller.updateColumn(id, source, { frozen: false })
    after = controller.snapshot().tables[id]!
    expect(after.columns[1]!.id).toBe(source)
    expect(after.columns[1]!.frozen).toBe(false)
    expect(after.columns[0]!.frozen).toBe(true)
  })

  it('unfreezing the only frozen column keeps it first but unfrozen', async () => {
    const { controller, id } = await openCrm()
    const doc = controller.snapshot().tables[id]!
    const name = doc.columns[0]!.id
    controller.updateColumn(id, name, { frozen: false })
    const after = controller.snapshot().tables[id]!
    expect(after.columns[0]!.id).toBe(name)
    expect(after.columns[0]!.frozen).toBe(false)
    expect(after.columns[1]!.frozen).toBe(false)
  })

  it('a column inserted at index 0 joins the frozen pane', async () => {
    const { controller, id } = await openCrm()
    controller.addColumn(id, 0, 'text', '首位')
    const after = controller.snapshot().tables[id]!
    expect(after.columns[0]!.name).toBe('首位')
    expect(after.columns[0]!.frozen).toBe(true)
    expect(after.columns[1]!.frozen).toBe(true)
  })

  it('duplicating a frozen column yields a frozen copy next to it', async () => {
    const { controller, id } = await openCrm()
    controller.duplicateColumn(id, 0)
    const after = controller.snapshot().tables[id]!
    expect(after.columns[0]!.frozen).toBe(true)
    expect(after.columns[1]!.frozen).toBe(true)
    // Duplicating a plain column keeps the copy out of the pane.
    controller.duplicateColumn(id, 2)
    const after2 = controller.snapshot().tables[id]!
    expect(after2.columns[3]!.frozen).toBe(false)
  })
})
