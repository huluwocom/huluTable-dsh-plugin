/** Editor operations: fill series, paste, column/row builders, timestamps. */
import { describe, expect, it } from 'vitest'
import {
  buildAddColumn, buildAddRows, buildCellEdit, buildClear, buildFill, buildMoveColumn,
  buildPaste, buildRemoveColumn, buildRemoveRows, buildSetValue, buildUpdateColumn,
  parseDate, formatDate,
} from '../src/client/domain/editor-ops.ts'
import { commitDeltas, revertDeltas } from '../src/client/domain/editlog.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type Cell, type Row, type TableDoc } from '../src/client/domain/types.ts'
import { nextColumnName } from '../src/client/domain/editor-ops.ts'

function controllerUpdate(doc: TableDoc, row: number, value: Cell['value']): void {
  doc.rows[row]!.cells.num = { value }
}

function table(): TableDoc {
  const doc = createBlankTable('t')
  doc.columns = [
    { id: 'num', name: '数量', type: 'number', width: 100, frozen: false, hidden: false, required: false },
    { id: 'txt', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    { id: 'date', name: '日期', type: 'date', width: 100, frozen: false, hidden: false, required: false },
  ]
  const mk = (values: [Cell['value'], Cell['value'], Cell['value']]): Row => {
    const cells: Row['cells'] = {}
    doc.columns.forEach((column, i) => { cells[column.id] = { value: values[i]! } })
    return { id: newId(), cells }
  }
  doc.rows = [mk([1, 'A', '2025-01-01']), mk([2, 'B', '2025-01-02']), mk([3, 'C', '2025-01-03'])]
  return doc
}

function apply(table: TableDoc, result: ReturnType<typeof buildFill>) {
  commitDeltas(table, { tableId: table.id, label: 'x', deltas: result.deltas })
}

describe('buildCellEdit', () => {
  it('coerces and validates numeric input', () => {
    const doc = table()
    const row = doc.rows[0]!
    const ok = buildCellEdit(doc, row.id, 'num', '42')
    apply(doc, ok)
    expect(doc.rows[0]!.cells.num!.value).toBe(42)
    const bad = buildCellEdit(doc, row.id, 'num', 'abc')
    expect(bad.error).toBe('type')
    expect(bad.deltas).toHaveLength(0)
  })

  it('clears a cell on empty input', () => {
    const doc = table()
    const row = doc.rows[0]!
    apply(doc, buildCellEdit(doc, row.id, 'txt', ''))
    expect(doc.rows[0]!.cells.txt!.value).toBeNull()
  })

  it('no-ops when the value is unchanged', () => {
    const doc = table()
    const row = doc.rows[0]!
    expect(buildCellEdit(doc, row.id, 'num', '1').deltas).toHaveLength(0)
  })
})

describe('buildFill', () => {
  it('extends numeric series by inferred delta', () => {
    const doc = table()
    const result = buildFill(doc, { r0: 0, r1: 1, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'series')
    apply(doc, result)
    expect(doc.rows[2]!.cells.num!.value).toBe(3)
  })

  it('extends date series by one day', () => {
    const doc = table()
    const result = buildFill(doc, { r0: 0, r1: 0, c0: 2, c1: 2 }, { r0: 0, r1: 2, c0: 2, c1: 2 }, 'series')
    apply(doc, result)
    expect(doc.rows[1]!.cells.date!.value).toBe('2025-01-02')
    expect(doc.rows[2]!.cells.date!.value).toBe('2025-01-03')
  })

  it('copies text when no series is inferable', () => {
    const doc = table()
    const result = buildFill(doc, { r0: 0, r1: 0, c0: 1, c1: 1 }, { r0: 0, r1: 2, c0: 1, c1: 1 }, 'series')
    apply(doc, result)
    expect(doc.rows[1]!.cells.txt!.value).toBe('A')
    expect(doc.rows[2]!.cells.txt!.value).toBe('A')
  })

  it('copies with copy mode', () => {
    const doc = table()
    const result = buildFill(doc, { r0: 0, r1: 0, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'copy')
    apply(doc, result)
    expect(doc.rows[1]!.cells.num!.value).toBe(1)
    expect(doc.rows[2]!.cells.num!.value).toBe(1)
  })
})

describe('buildPaste', () => {
  it('pastes a grid from an anchor with type coercion', () => {
    const doc = table()
    const result = buildPaste(doc, 1, doc.columns, [['10', 'X'], ['20', 'Y']])
    apply(doc, result)
    expect(doc.rows[1]!.cells.num!.value).toBe(10)
    expect(doc.rows[1]!.cells.txt!.value).toBe('X')
    expect(doc.rows[2]!.cells.num!.value).toBe(20)
  })

  it('reports type errors without committing bad cells', () => {
    const doc = table()
    const result = buildPaste(doc, 0, doc.columns, [['bad']])
    expect(result.error).toBe('paste')
  })
})

describe('column builders', () => {
  it('adds, updates, moves, and removes columns reversibly', () => {
    const doc = table()
    const added = buildAddColumn(doc, 1, 'select', '状态')
    apply(doc, added)
    expect(doc.columns.map(c => c.name)).toEqual(['数量', '状态', '名称', '日期'])
    const addedId = doc.columns[1]!.id
    apply(doc, buildUpdateColumn(doc, addedId, { width: 200 }))
    expect(doc.columns[1]!.width).toBe(200)
    apply(doc, buildMoveColumn(doc, addedId, 3))
    expect(doc.columns.map(c => c.name)).toEqual(['数量', '名称', '日期', '状态'])
    apply(doc, buildRemoveColumn(doc, 3))
    expect(doc.columns.map(c => c.name)).toEqual(['数量', '名称', '日期'])
  })

  it('row remove/undo captures the exact rows', () => {
    const doc = table()
    const result = buildRemoveRows(doc, [0, 2])
    apply(doc, result)
    expect(doc.rows).toHaveLength(1)
    expect(doc.rows[0]!.cells.num!.value).toBe(2)
    revertDeltas(doc, { tableId: doc.id, label: 'x', deltas: result.deltas })
    expect(doc.rows).toHaveLength(3)
    expect(doc.rows[0]!.cells.num!.value).toBe(1)
    expect(doc.rows[2]!.cells.num!.value).toBe(3)
  })
})

describe('buildAddRows', () => {
  it('fills createdAt columns and defaults', () => {
    const doc = table()
    doc.columns.push({ id: 'at', name: '创建', type: 'createdAt', width: 100, frozen: false, hidden: false, required: false })
    doc.columns.push({ id: 'dv', name: '默认', type: 'text', width: 100, frozen: false, hidden: false, required: false, default: 'x' })
    const result = buildAddRows(doc, doc.rows.length, 1)
    apply(doc, result)
    const added = doc.rows.at(-1)!
    expect(typeof added.cells.at!.value).toBe('number')
    expect(added.cells.dv!.value).toBe('x')
  })
})

describe('buildClear', () => {
  it('clears only non-empty cells in the rect', () => {
    const doc = table()
    const result = buildClear(doc, 0, 1, doc.columns.slice(0, 2))
    apply(doc, result)
    expect(doc.rows[0]!.cells.num!.value).toBeNull()
    expect(doc.rows[1]!.cells.txt!.value).toBeNull()
    expect(doc.rows[2]!.cells.num!.value).toBe(3)
  })
})

describe('date helpers', () => {
  it('parses and formats dates', () => {
    const date = parseDate('2025-08-01')
    expect(date).not.toBeNull()
    expect(formatDate(date!)).toBe('2025-08-01')
    expect(parseDate('not-a-date')).toBeNull()
    expect(parseDate('2025/8/1')).not.toBeNull()
  })
})

describe('buildSetValue', () => {
  it('sets dropdown values directly', () => {
    const doc = table()
    const row = doc.rows[0]!
    const result = buildSetValue(doc, row.id, 'txt', '已成交')
    apply(doc, result)
    expect(doc.rows[0]!.cells.txt!.value).toBe('已成交')
  })
})

describe('editor-ops edge cases', () => {
  it('guards missing rows and columns', () => {
    const doc = table()
    expect(buildCellEdit(doc, 'ghost', 'num', '1').error).toBe('missing')
    expect(buildCellEdit(doc, doc.rows[0]!.id, 'ghost', '1').error).toBe('missing')
    expect(buildSetValue(doc, 'ghost', 'num', 1).error).toBe('missing')
    expect(buildSetValue(doc, doc.rows[0]!.id, 'ghost', 1).error).toBe('missing')
    expect(buildRemoveColumn(doc, 99).error).toBe('missing')
    expect(buildUpdateColumn(doc, 'ghost', { width: 1 }).error).toBe('missing')
    expect(buildMoveColumn(doc, 'ghost', 0).error).toBe('missing')
  })

  it('names new columns uniquely', () => {
    const doc = table()
    doc.columns.push({ id: 'x', name: '字段 1', type: 'text', width: 100, frozen: false, hidden: false, required: false })
    expect(nextColumnName(doc.columns)).toBe('字段 2')
  })

  it('skips invalid row indexes on remove', () => {
    const doc = table()
    const result = buildRemoveRows(doc, [-1, 99])
    expect(result.deltas).toHaveLength(0)
  })

  it('fills numeric-suffix text series', () => {
    const doc = table()
    doc.columns.push({ id: 'code', name: '编码', type: 'text', width: 100, frozen: false, hidden: false, required: false })
    doc.rows[0]!.cells.code = { value: '单号1' }
    const result = buildFill(
      doc, { r0: 0, r1: 0, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'series', [doc.columns[3]!])
    apply(doc, result)
    expect(doc.rows[1]!.cells.code!.value).toBe('单号2')
    expect(doc.rows[2]!.cells.code!.value).toBe('单号3')
  })

  it('handles empty bottom rows during fill', () => {
    const doc = table()
    const result = buildFill(doc, { r0: 2, r1: 2, c0: 0, c1: 0 }, { r0: 2, r1: 3, c0: 0, c1: 0 }, 'copy', [doc.columns[0]!])
    expect(result.deltas).toHaveLength(0)
  })

  it('rejects invalid paste values per column type', () => {
    const doc = table()
    const result = buildPaste(doc, 0, [doc.columns[0]!], [['bad']])
    expect(result.error).toBe('paste')
  })

  it('rejects values failing per-column validation', () => {
    const doc = table()
    doc.columns.push({
      id: 'ph', name: '电话', type: 'phone', width: 100, frozen: false, hidden: false, required: false,
      validation: { kind: 'phone' },
    })
    const result = buildCellEdit(doc, doc.rows[0]!.id, 'ph', '123')
    expect(result.error).toBe('phone')
  })

  it('no-ops set-value and move-column when nothing changes', () => {
    const doc = table()
    const same = buildSetValue(doc, doc.rows[0]!.id, 'txt', 'A')
    expect(same.error).toBeNull()
    expect(same.deltas).toHaveLength(0)
    const stay = buildMoveColumn(doc, 'num', 0)
    expect(stay.error).toBeNull()
    expect(stay.deltas).toHaveLength(0)
  })

  it('fills constant numeric seeds with a +1 step and boolean last values', () => {
    const doc = table()
    doc.rows[0]!.cells.num!.value = 5
    doc.rows[1]!.cells.num!.value = 5
    const constant = buildFill(doc, { r0: 0, r1: 1, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'series', [doc.columns[0]!])
    apply(doc, constant)
    expect(doc.rows[2]!.cells.num!.value).toBe(6)
    // A boolean last value copies as-is (neither number nor string series).
    const cb = { id: 'cb', name: '勾选', type: 'checkbox' as const, width: 100, frozen: false, hidden: false, required: false }
    doc.columns.push(cb)
    doc.rows[0]!.cells.cb = { value: true }
    const bool = buildFill(doc, { r0: 0, r1: 0, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'series', [cb])
    apply(doc, bool)
    expect(doc.rows[1]!.cells.cb!.value).toBe(true)
  })

  it('fills suffix text with mixed and constant seeds', () => {
    const doc = table()
    const code = { id: 'code', name: '编码', type: 'text' as const, width: 100, frozen: false, hidden: false, required: false }
    doc.columns.push(code)
    // A numeric seed maps to 0; the suffix-less string seed reads '' too.
    doc.rows[0]!.cells.code = { value: 'abc' }
    doc.rows[1]!.cells.code = { value: 7 }
    doc.rows[2]!.cells.code = { value: '单号2' }
    doc.rows.push({ id: newId(), cells: { code: { value: '' } } })
    const mixed = buildFill(doc, { r0: 0, r1: 2, c0: 0, c1: 0 }, { r0: 0, r1: 3, c0: 0, c1: 0 }, 'series', [code])
    apply(doc, mixed)
    expect(doc.rows[3]!.cells.code!.value).toBe('单号4')
    // Constant suffixes → step 0 → +1 per offset.
    doc.rows[0]!.cells.code = { value: '单号1' }
    doc.rows[1]!.cells.code = { value: '单号1' }
    const constant = buildFill(doc, { r0: 0, r1: 1, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'series', [code])
    apply(doc, constant)
    expect(doc.rows[2]!.cells.code.value).toBe('单号2')
  })

  it('infers a single-number step from mixed seeds', () => {
    const doc = table()
    // A string inside the number column coerces to NaN and drops out of the seeds.
    controllerUpdate(doc, 0, 'x')
    const mixed = buildFill(doc, { r0: 0, r1: 1, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'series', [doc.columns[0]!])
    apply(doc, mixed)
    expect(doc.rows[2]!.cells.num!.value).toBe(3)
  })

  it('fills from a single numeric seed', () => {
    const doc = table()
    const single = buildFill(doc, { r0: 0, r1: 0, c0: 0, c1: 0 }, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'series', [doc.columns[0]!])
    apply(doc, single)
    expect(doc.rows[1]!.cells.num!.value).toBe(2)
    expect(doc.rows[2]!.cells.num!.value).toBe(3)
  })

  it('collects seeds past the last row across a sideward target', () => {
    const doc = table()
    doc.columns.push(
      { id: 'e', name: 'E', type: 'text', width: 100, frozen: false, hidden: false, required: false },
      { id: 'f', name: 'F', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    )
    doc.rows[0]!.cells.e = { value: 'x' }
    // Anchor rows 0..5 (rows 3..5 missing); fill column E on row 0.
    const result = buildFill(
      doc, { r0: 0, r1: 5, c0: 0, c1: 0 }, { r0: 0, r1: 0, c0: 1, c1: 1 }, 'series', [doc.columns[3]!, doc.columns[4]!])
    // Missing source rows yield no seeds; the missing bottom row yields null.
    expect(result.deltas).toHaveLength(0)
  })

  it('fills with an anchor reaching past the last row', () => {
    const doc = table()
    const result = buildFill(doc, { r0: 2, r1: 5, c0: 0, c1: 0 }, { r0: 2, r1: 5, c0: 0, c1: 0 }, 'series', [doc.columns[0]!])
    // Missing source rows produce no seeds and a null bottom value; the
    // target window lies inside the anchor, so nothing is written.
    expect(result.deltas).toHaveLength(0)
    expect(doc.rows[2]!.cells.num!.value).toBe(3)
  })

  it('paste skips missing rows, missing columns and unchanged cells', () => {
    const doc = table()
    const result = buildPaste(doc, 1, doc.columns, [
      ['10', 'B', '2025-01-02', 'X', 'Y'],
      ['20', 'Y'],
      ['30'],
    ])
    expect(result.changes.map(c => c.columnId)).toEqual(['num', 'num', 'txt'])
  })

  it('clear skips rows beyond the table', () => {
    const doc = table()
    const result = buildClear(doc, 2, 9, doc.columns)
    expect(result.deltas.length).toBeGreaterThan(0)
  })
})
