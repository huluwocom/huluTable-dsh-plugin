/** Delta undo/redo semantics: forward apply, reverse revert, structure capture. */
import { describe, expect, it } from 'vitest'
import {
  commitDeltas, createUndoStack, pushUndo, revertDeltas, type EditDelta,
} from '../src/client/domain/editlog.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type TableDoc } from '../src/client/domain/types.ts'

function tableWithRows(count: number): TableDoc {
  const doc = createBlankTable('t')
  doc.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
  for (let i = 0; i < count; i += 1) {
    doc.rows.push({ id: newId(), cells: { a: { value: `v${i}` } } })
  }
  return doc
}

describe('editlog deltas', () => {
  it('applies and reverts a cell edit', () => {
    const doc = tableWithRows(2)
    const rowId = doc.rows[0]!.id
    const batch = {
      tableId: doc.id, label: 'edit',
      deltas: [{ kind: 'cell', rowId, columnId: 'a', before: { value: 'v0' }, after: { value: 'x' } }] as EditDelta[],
    }
    commitDeltas(doc, batch)
    expect(doc.rows[0]!.cells.a!.value).toBe('x')
    revertDeltas(doc, batch)
    expect(doc.rows[0]!.cells.a!.value).toBe('v0')
  })

  it('reverts a row removal by re-inserting the captured rows', () => {
    const doc = tableWithRows(3)
    const removed = [doc.rows[1]!]
    const batch = {
      tableId: doc.id, label: 'delete row',
      deltas: [{ kind: 'rowRemove', index: 1, rows: removed }] as EditDelta[],
    }
    commitDeltas(doc, batch)
    expect(doc.rows).toHaveLength(2)
    revertDeltas(doc, batch)
    expect(doc.rows).toHaveLength(3)
    expect(doc.rows[1]!.id).toBe(removed[0]!.id)
  })

  it('reverts a column removal by re-inserting the column', () => {
    const doc = tableWithRows(1)
    const column = doc.columns[0]!
    const batch = {
      tableId: doc.id, label: 'delete column',
      deltas: [{ kind: 'columnRemove', index: 0, column, cells: [] }] as EditDelta[],
    }
    commitDeltas(doc, batch)
    expect(doc.columns).toHaveLength(0)
    revertDeltas(doc, batch)
    expect(doc.columns[0]!.id).toBe(column.id)
  })

  it('undoes a cell edit that preceded a row delete (reverse-order revert)', () => {
    const doc = tableWithRows(2)
    const rowId = doc.rows[0]!.id
    const editBatch = {
      tableId: doc.id, label: 'edit',
      deltas: [{ kind: 'cell', rowId, columnId: 'a', before: { value: 'v0' }, after: { value: 'y' } }] as EditDelta[],
    }
    const deleteBatch = {
      tableId: doc.id, label: 'delete row',
      deltas: [{ kind: 'rowRemove', index: 0, rows: [doc.rows[0]!] }] as EditDelta[],
    }
    commitDeltas(doc, editBatch)
    commitDeltas(doc, deleteBatch)
    expect(doc.rows).toHaveLength(1)
    // Undo delete first (reverse order), then the edit.
    revertDeltas(doc, deleteBatch)
    revertDeltas(doc, editBatch)
    expect(doc.rows).toHaveLength(2)
    expect(doc.rows[0]!.cells.a!.value).toBe('v0')
  })

  it('moves rows forward and back', () => {
    const doc = tableWithRows(4)
    const batch = {
      tableId: doc.id, label: 'move',
      deltas: [{ kind: 'rowMove', from: 0, to: 3, count: 1 }] as EditDelta[],
    }
    const firstId = doc.rows[0]!.id
    commitDeltas(doc, batch)
    expect(doc.rows[3]!.id).toBe(firstId)
    revertDeltas(doc, batch)
    expect(doc.rows[0]!.id).toBe(firstId)
  })

  it('applies and reverts column add/update/move and row add/replace', () => {
    const doc = tableWithRows(2)
    const column = { id: 'b', name: 'B', type: 'text', width: 100, frozen: false, hidden: false, required: false }
    const addBatch = {
      tableId: doc.id, label: 'add column',
      deltas: [{ kind: 'columnAdd', index: 1, column }] as EditDelta[],
    }
    commitDeltas(doc, addBatch)
    expect(doc.columns.map(c => c.id)).toEqual(['a', 'b'])
    revertDeltas(doc, addBatch)
    expect(doc.columns.map(c => c.id)).toEqual(['a'])
    // column update
    const updateBatch = {
      tableId: doc.id, label: 'update column',
      deltas: [{ kind: 'columnUpdate', columnId: 'a', before: { ...doc.columns[0]! }, after: { ...doc.columns[0]!, name: 'X' } }] as EditDelta[],
    }
    commitDeltas(doc, updateBatch)
    expect(doc.columns[0]!.name).toBe('X')
    revertDeltas(doc, updateBatch)
    expect(doc.columns[0]!.name).toBe('A')
    // column move
    doc.columns.push({ id: 'c', name: 'C', type: 'text', width: 100, frozen: false, hidden: false, required: false })
    const moveBatch = {
      tableId: doc.id, label: 'move column',
      deltas: [{ kind: 'columnMove', columnId: 'a', from: 0, to: 1 }] as EditDelta[],
    }
    commitDeltas(doc, moveBatch)
    expect(doc.columns[0]!.id).toBe('c')
    revertDeltas(doc, moveBatch)
    expect(doc.columns[0]!.id).toBe('a')
    // row add with cells
    const newRow = { id: newId(), cells: { a: { value: 'n' } } }
    const rowAddBatch = {
      tableId: doc.id, label: 'add row',
      deltas: [{ kind: 'rowAdd', index: 0, rows: [newRow] }] as EditDelta[],
    }
    commitDeltas(doc, rowAddBatch)
    expect(doc.rows).toHaveLength(3)
    revertDeltas(doc, rowAddBatch)
    expect(doc.rows).toHaveLength(2)
    // rows replace
    const replaceBatch = {
      tableId: doc.id, label: 'replace rows',
      deltas: [{ kind: 'rowsReplace', before: [...doc.rows], after: [doc.rows[0]!] }] as EditDelta[],
    }
    commitDeltas(doc, replaceBatch)
    expect(doc.rows).toHaveLength(1)
    revertDeltas(doc, replaceBatch)
    expect(doc.rows).toHaveLength(2)
  })

  it('column add with cells fills and removes them', () => {
    const doc = tableWithRows(2)
    const column = { id: 'b', name: 'B', type: 'text', width: 100, frozen: false, hidden: false, required: false }
    const cells = doc.rows.map(row => ({ rowId: row.id, cell: { value: 'x' } }))
    const batch = {
      tableId: doc.id, label: 'add column with cells',
      deltas: [{ kind: 'columnAdd', index: 1, column, cells }] as EditDelta[],
    }
    commitDeltas(doc, batch)
    expect(doc.rows[0]!.cells.b!.value).toBe('x')
    revertDeltas(doc, batch)
    expect(doc.rows[0]!.cells.b).toBeUndefined()
  })

  it('column remove with cells restores them on revert', () => {
    const doc = tableWithRows(2)
    const cells = doc.rows.map(row => ({ rowId: row.id, cell: { value: 'v' } }))
    const batch = {
      tableId: doc.id, label: 'remove column with cells',
      deltas: [{ kind: 'columnRemove', index: 0, column: doc.columns[0]!, cells }] as EditDelta[],
    }
    commitDeltas(doc, batch)
    expect(doc.rows[0]!.cells.a).toBeUndefined()
    revertDeltas(doc, batch)
    expect(doc.rows[0]!.cells.a!.value).toBe('v')
  })

  it('undo stack clears redo on push and caps history', () => {
    const stack = createUndoStack()
    const batch = { tableId: 't', label: 'x', deltas: [] as EditDelta[] }
    pushUndo(stack, batch)
    pushUndo(stack, batch)
    expect(stack.future).toHaveLength(0)
    for (let i = 0; i < 150; i += 1) pushUndo(stack, batch)
    expect(stack.past).toHaveLength(100)
  })

  it('tolerates deltas referencing missing rows and columns', () => {
    const doc = tableWithRows(1)
    const column = { id: 'b', name: 'B', type: 'text', width: 100, frozen: false, hidden: false, required: false }
    const ghostCells = [{ rowId: 'never-existed', cell: { value: 'g' } }]
    // columnRemove with cells for a missing row: forward skip + revert re-insert.
    const removeBatch = {
      tableId: doc.id, label: 'remove ghost',
      deltas: [{ kind: 'columnRemove', index: 0, column: doc.columns[0]!, cells: ghostCells }] as EditDelta[],
    }
    commitDeltas(doc, removeBatch)
    expect(doc.columns).toHaveLength(0)
    revertDeltas(doc, removeBatch)
    expect(doc.columns[0]!.id).toBe('a')
    // columnAdd with cells for a missing row: revert skip.
    const addBatch = {
      tableId: doc.id, label: 'add ghost',
      deltas: [{ kind: 'columnAdd', index: 0, column, cells: ghostCells }] as EditDelta[],
    }
    commitDeltas(doc, addBatch)
    revertDeltas(doc, addBatch)
    expect(doc.columns).toHaveLength(1)
    expect(doc.columns[0]!.id).toBe('a')
    // columnUpdate on a missing column: forward and revert both skip.
    const ghostUpdate = {
      tableId: doc.id, label: 'update ghost',
      deltas: [{ kind: 'columnUpdate', columnId: 'missing', before: column, after: { ...column, name: 'X' } }] as EditDelta[],
    }
    commitDeltas(doc, ghostUpdate)
    revertDeltas(doc, ghostUpdate)
    // Revert deletes keys that only the edit introduced.
    const reverted = {
      tableId: doc.id, label: 'clear description',
      deltas: [{ kind: 'columnUpdate', columnId: 'a', before: { ...doc.columns[0]! }, after: { ...doc.columns[0]!, description: 'desc' } }] as EditDelta[],
    }
    commitDeltas(doc, reverted)
    expect(doc.columns[0]!.description).toBe('desc')
    revertDeltas(doc, reverted)
    expect(doc.columns[0]!.description).toBeUndefined()
    // cell edit for a missing row: forward and revert both skip.
    const cellGhost = {
      tableId: doc.id, label: 'cell ghost',
      deltas: [{ kind: 'cell', rowId: 'never-existed', columnId: 'a', before: { value: 'b' }, after: { value: 'x' } }] as EditDelta[],
    }
    commitDeltas(doc, cellGhost)
    revertDeltas(doc, cellGhost)
    // columnMove from an out-of-range source: forward skips.
    const moveGhost = {
      tableId: doc.id, label: 'move ghost',
      deltas: [{ kind: 'columnMove', columnId: 'a', from: 99, to: 0 }] as EditDelta[],
    }
    commitDeltas(doc, moveGhost)
    // columnMove whose revert target is out of range: revert skips.
    const moveGhost2 = {
      tableId: doc.id, label: 'move ghost 2',
      deltas: [{ kind: 'columnMove', columnId: 'a', from: 0, to: 99 }] as EditDelta[],
    }
    commitDeltas(doc, moveGhost2)
    revertDeltas(doc, moveGhost2)
    expect(doc.columns).toHaveLength(1)
  })
})
