/** View query engine: filters, multi-column sorts, dropdown option order. */
import { describe, expect, it } from 'vitest'
import { applyViewQuery, compareValues, matchFilter, opsForColumn } from '../src/client/domain/query.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type Column, type Row, type TableDoc } from '../src/client/domain/types.ts'

function table(): TableDoc {
  const doc = createBlankTable('t')
  doc.columns = [
    { id: 'name', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    {
      id: 'status', name: '状态', type: 'select', width: 100, frozen: false, hidden: false, required: false,
      options: [
        { id: 'a', label: '新线索', color: '#93c5fd' },
        { id: 'b', label: '已成交', color: '#4ade80' },
        { id: 'c', label: '已流失', color: '#cbd5e1' },
      ],
    },
    { id: 'amount', name: '金额', type: 'number', width: 100, frozen: false, hidden: false, required: false },
  ]
  const mk = (name: string, status: string, amount: number): Row => ({
    id: newId(),
    cells: { name: { value: name }, status: { value: status }, amount: { value: amount } },
  })
  doc.rows = [
    mk('张三', '已成交', 300),
    mk('李四', '新线索', 100),
    mk('王五', '已成交', 500),
    mk('赵六', '已流失', 50),
  ]
  return doc
}

describe('matchFilter', () => {
  it('matches text contains/empty ops', () => {
    const doc = table()
    expect(matchFilter(doc, 0, { columnId: 'name', op: 'contains', value: '张' })).toBe(true)
    expect(matchFilter(doc, 0, { columnId: 'name', op: 'contains', value: '李' })).toBe(false)
    expect(matchFilter(doc, 0, { columnId: 'name', op: 'startsWith', value: '张' })).toBe(true)
    expect(matchFilter(doc, 0, { columnId: 'name', op: 'endsWith', value: '三' })).toBe(true)
  })

  it('matches numeric range ops', () => {
    const doc = table()
    expect(matchFilter(doc, 0, { columnId: 'amount', op: 'gt', value: 200 })).toBe(true)
    expect(matchFilter(doc, 1, { columnId: 'amount', op: 'gt', value: 200 })).toBe(false)
    expect(matchFilter(doc, 0, { columnId: 'amount', op: 'between', value: 100, value2: 400 })).toBe(true)
    expect(matchFilter(doc, 2, { columnId: 'amount', op: 'between', value: 100, value2: 400 })).toBe(false)
  })

  it('matches dropdown multi-select', () => {
    const doc = table()
    expect(matchFilter(doc, 0, { columnId: 'status', op: 'in', values: ['已成交'] })).toBe(true)
    expect(matchFilter(doc, 1, { columnId: 'status', op: 'in', values: ['已成交'] })).toBe(false)
    expect(matchFilter(doc, 0, { columnId: 'status', op: 'empty' })).toBe(false)
  })

  it('handles empty cells', () => {
    const doc = table()
    doc.rows[0]!.cells.name = { value: null }
    expect(matchFilter(doc, 0, { columnId: 'name', op: 'empty' })).toBe(true)
    expect(matchFilter(doc, 1, { columnId: 'name', op: 'notEmpty' })).toBe(true)
  })
})

describe('applyViewQuery', () => {
  it('sorts empty values last regardless of direction (excel behavior)', () => {
    const doc = createBlankTable('t')
    doc.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    doc.rows = [
      { id: 'r1', cells: { a: { value: '甲' } } },
      { id: 'r2', cells: { a: { value: null } } },
      { id: 'r3', cells: { a: { value: '' } } },
      { id: 'r4', cells: { a: { value: '乙' } } },
    ]
    const asc = applyViewQuery(doc, [], 'and', [{ columnId: 'a', dir: 'asc' }])
    expect(asc).toEqual([0, 3, 1, 2]) // filled first, empties trailing
    const desc = applyViewQuery(doc, [], 'and', [{ columnId: 'a', dir: 'desc' }])
    expect(desc).toEqual([3, 0, 1, 2]) // empty cells still last
    // Two empty rows compare equal to each other and stay after filled ones.
    const mixed = applyViewQuery(doc, [], 'and', [{ columnId: 'a', dir: 'asc' }])
    expect(mixed[2] === 1 || mixed[2] === 2).toBe(true)
    expect(mixed[3] === 1 || mixed[3] === 2).toBe(true)
    // A blank-first row set still sorts empties last.
    const blankFirst = createBlankTable('t2')
    blankFirst.columns = [{ id: 'a', name: 'A', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    blankFirst.rows = [
      { id: 'x1', cells: { a: { value: null } } },
      { id: 'x2', cells: { a: { value: '甲' } } },
      { id: 'x3', cells: { a: { value: null } } },
    ]
    expect(applyViewQuery(blankFirst, [], 'and', [{ columnId: 'a', dir: 'asc' }])).toEqual([1, 0, 2])
  })

  it('filters with AND mode', () => {
    const doc = table()
    const rows = applyViewQuery(doc, [
      { columnId: 'status', op: 'in', values: ['已成交'] },
      { columnId: 'amount', op: 'gt', value: 200 },
    ], 'and', [])
    expect(rows).toEqual([0, 2])
  })

  it('filters with OR mode', () => {
    const doc = table()
    const rows = applyViewQuery(doc, [
      { columnId: 'status', op: 'eq', value: '已成交' },
      { columnId: 'status', op: 'eq', value: '已流失' },
    ], 'or', [])
    expect(rows).toEqual([0, 2, 3])
  })

  it('sorts by dropdown option order then numeric', () => {
    const doc = table()
    const rows = applyViewQuery(doc, [], 'and', [{ columnId: 'status', dir: 'asc' }])
    // Option order: 初步接触(0) < 已成交(1) < 已流失(2)
    expect(rows.map(i => doc.rows[i]!.cells.name!.value)).toEqual(['李四', '张三', '王五', '赵六'])
    const byAmount = applyViewQuery(doc, [], 'and', [{ columnId: 'amount', dir: 'desc' }])
    expect(byAmount).toEqual([2, 0, 1, 3])
  })

  it('sorts multi-level', () => {
    const doc = table()
    const rows = applyViewQuery(doc, [], 'and', [
      { columnId: 'status', dir: 'asc' },
      { columnId: 'amount', dir: 'desc' },
    ])
    // 初步接触 first (100), then 已成交 desc (500, 300), then 已流失.
    expect(rows.map(i => doc.rows[i]!.cells.amount!.value)).toEqual([100, 500, 300, 50])
  })
})

describe('opsForColumn', () => {
  it('offers range ops for numbers and pick ops for dropdowns', () => {
    expect(opsForColumn('number')).toContain('gt')
    expect(opsForColumn('number')).not.toContain('contains')
    expect(opsForColumn('select')).toEqual(['in', 'empty', 'notEmpty'])
    expect(opsForColumn('text')).toContain('contains')
  })
})

describe('compareValues', () => {
  it('compares numbers numerically and strings with locale', () => {
    expect(compareValues(2, 10)).toBeLessThan(0)
    expect(compareValues('a', 'b')).toBeLessThan(0)
    expect(compareValues(null, 'a')).toBeLessThan(0)
  })
})

export type { Column }
