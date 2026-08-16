// @vitest-environment jsdom
/** Pure-module tail branches: editlog guards, geometry windows, io downloads. */
import { describe, expect, it, vi } from 'vitest'
import { commitDeltas, revertDeltas, type EditDelta } from '../src/client/domain/editlog.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type TableDoc } from '../src/client/domain/types.ts'
import { cellText, selectionStats, visibleColumnRange, columnOffsets } from '../src/client/grid/geometry.ts'
import { downloadBlob, downloadText, rowToStrings } from '../src/client/io/io.ts'
import { toLibraryRow } from '../src/client/persistence.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'

function table(): TableDoc {
  const doc = createBlankTable('t')
  doc.columns = [
    { id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    { id: 'n', name: 'N', type: 'number', width: 120, frozen: false, hidden: false, required: false },
  ]
  doc.rows = [{ id: newId(), cells: { a: { value: 'x' }, n: { value: 1 } } }]
  return doc
}

describe('editlog guards', () => {
  it('tolerates deltas referencing missing rows and columns', () => {
    const doc = table()
    const ghost = { kind: 'cell' as const, rowId: 'ghost', columnId: 'a', before: { value: null }, after: { value: 'y' } }
    commitDeltas(doc, { tableId: doc.id, label: 'x', deltas: [ghost] })
    expect(doc.rows[0]!.cells.a!.value).toBe('x')
    // Column remove with cells for a missing row.
    const batch: { tableId: string; label: string; deltas: EditDelta[] } = {
      tableId: doc.id, label: 'x',
      deltas: [{
        kind: 'columnRemove', index: 0, column: doc.columns[0]!,
        cells: [{ rowId: 'ghost', cell: { value: 'z' } }],
      }],
    }
    commitDeltas(doc, batch)
    expect(doc.columns).toHaveLength(1)
    revertDeltas(doc, batch)
    expect(doc.columns).toHaveLength(2)
    // Column update with a missing column id.
    commitDeltas(doc, {
      tableId: doc.id, label: 'x',
      deltas: [{ kind: 'columnUpdate', columnId: 'ghost', before: doc.columns[0]!, after: { ...doc.columns[0]!, name: 'B' } }],
    })
    expect(doc.columns[0]!.name).toBe('A')
    // Row move with an out-of-range source.
    commitDeltas(doc, {
      tableId: doc.id, label: 'x',
      deltas: [{ kind: 'rowMove', from: 9, to: 0, count: 1 }],
    })
    expect(doc.rows).toHaveLength(1)
    // Column add with cells for a missing row.
    const add: { tableId: string; label: string; deltas: EditDelta[] } = {
      tableId: doc.id, label: 'x',
      deltas: [{ kind: 'columnAdd', index: 1, column: { id: 'b', name: 'B', type: 'text', width: 100, frozen: false, hidden: false, required: false }, cells: [{ rowId: 'ghost', cell: { value: 'z' } }] }],
    }
    commitDeltas(doc, add)
    expect(doc.columns).toHaveLength(3)
    revertDeltas(doc, add)
    expect(doc.columns).toHaveLength(2)
  })
})

describe('geometry tails', () => {
  it('windows columns with mid-column scroll', () => {
    const doc = table()
    const { offsets } = columnOffsets(doc.columns)
    const range = visibleColumnRange(150, 50, doc.columns, offsets)
    expect(range.start).toBeLessThanOrEqual(range.end)
    // Scrolled past everything keeps the last columns in window.
    const far = visibleColumnRange(9999, 50, doc.columns, offsets)
    expect(far.end).toBe(2)
  })

  it('renders boolean cells and guards missing rows in stats', () => {
    const doc = table()
    const flag = { id: 'f', name: 'F', type: 'checkbox' as const, width: 100, frozen: false, hidden: false, required: false }
    expect(cellText(flag, true)).toBe('✓')
    expect(cellText(flag, false)).toBe('')
    expect(cellText(doc.columns[1]!, '12')).toBe('12')
    // Rows beyond the table are skipped.
    expect(selectionStats(doc, 0, 9, 0, 1)).not.toBeNull()
    // Columns beyond the table are skipped.
    const txt = { id: 't', name: 'T', type: 'text' as const, width: 100, frozen: false, hidden: false, required: false }
    const onlyText = createBlankTable('t2')
    onlyText.columns = [txt]
    onlyText.rows = [{ id: newId(), cells: { t: { value: 'x' } } }]
    expect(selectionStats(onlyText, 0, 0, 0, 0)).toBeNull()
  })

  it('serializes export rows with mixed value shapes', () => {
    const doc = table()
    doc.rows[0]!.cells.n = { value: null }
    const row = rowToStrings(doc, doc.rows[0]!)
    expect(row[0]).toBe('x')
    expect(row[1]).toBe('')
  })
})

describe('io downloads', () => {
  it('downloads text and blobs through anchor clicks', () => {
    vi.useFakeTimers()
    try {
      const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      downloadText('a.txt', 'hello', 'text/plain')
      expect(createSpy).toHaveBeenCalled()
      downloadBlob('b.bin', new Blob(['x']))
      expect(clickSpy).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(2500)
      expect(revokeSpy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('persistence tails', () => {
  it('projects library rows with template ids and deleted flags', () => {
    const p = new MemoryPersistence()
    const doc = table()
    doc.templateId = 'crm'
    doc.deletedAt = 123
    void p
    const row = toLibraryRow(doc)
    expect(row.templateId).toBe('crm')
    expect(row.deletedAt).toBe(123)
    const plain = toLibraryRow(table())
    expect(plain.templateId).toBeUndefined()
    expect(plain.deletedAt).toBeUndefined()
  })
})
