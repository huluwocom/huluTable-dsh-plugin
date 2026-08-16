/** Formula engine: tokenizer, parser, evaluation, recalc, refs. */
import { describe, expect, it } from 'vitest'
import {
  columnLetter, evaluateFormula, parseFormula, parseRef, recalcFormulas, tokenize,
} from '../src/client/domain/formula.ts'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type TableDoc } from '../src/client/domain/types.ts'

function table(): TableDoc {
  const doc = createBlankTable('t')
  doc.columns = [
    { id: 'name', name: '名称', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    { id: 'amount', name: '金额', type: 'number', width: 100, frozen: false, hidden: false, required: false },
    { id: 'qty', name: '数量', type: 'number', width: 100, frozen: false, hidden: false, required: false },
  ]
  const mk = (name: string, amount: number, qty: number) => ({
    id: newId(), cells: { name: { value: name }, amount: { value: amount }, qty: { value: qty } },
  })
  doc.rows = [mk('A', 100, 2), mk('B', 200, 3), mk('C', 300, 4)]
  return doc
}

describe('coordinates', () => {
  it('maps column indexes to letters and back', () => {
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(25)).toBe('Z')
    expect(columnLetter(26)).toBe('AA')
    expect(parseRef('B3')).toEqual({ col: 1, row: 2 })
    expect(parseRef('AA1')).toEqual({ col: 26, row: 0 })
    expect(parseRef('nope')).toBeNull()
  })
})

describe('tokenize', () => {
  it('tokenizes numbers, ids, ops, strings', () => {
    const tokens = tokenize('SUM(A1:B2)+3*"x"')
    expect(tokens.map(t => t.kind)).toEqual(['id', 'lp', 'id', 'op', 'id', 'rp', 'op', 'num', 'op', 'str'])
  })
})

describe('parseFormula', () => {
  it('parses valid formulas and rejects garbage', () => {
    expect(parseFormula('1+2*3')).not.toBeNull()
    expect(parseFormula('SUM(A1:A3)')).not.toBeNull()
    expect(parseFormula('IF(A1>1,"y","n")')).not.toBeNull()
    expect(parseFormula('1+')).toBeNull()
    expect(parseFormula('(')).toBeNull()
  })
})

describe('evaluateFormula', () => {
  it('evaluates arithmetic with precedence', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=1+2*3')).toBe(7)
    expect(evaluateFormula(doc, 0, 1, '=10/2-1')).toBe(4)
    expect(evaluateFormula(doc, 0, 1, '=2^3')).toBe(8)
  })

  it('resolves relative cell refs', () => {
    const doc = table()
    // Row 0 amount + qty = 102
    expect(evaluateFormula(doc, 0, 1, '=B1+C1')).toBe(102)
    expect(evaluateFormula(doc, 1, 1, '=B2+C2')).toBe(203)
  })

  it('aggregates ranges', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=SUM(B1:B3)')).toBe(600)
    expect(evaluateFormula(doc, 0, 1, '=AVERAGE(B1:B3)')).toBe(200)
    expect(evaluateFormula(doc, 0, 1, '=MAX(B1:B3)')).toBe(300)
    expect(evaluateFormula(doc, 0, 1, '=MIN(B1:B3)')).toBe(100)
    expect(evaluateFormula(doc, 0, 1, '=COUNT(B1:B3)')).toBe(3)
    expect(evaluateFormula(doc, 0, 1, '=SUM(B1:B2,C3)')).toBe(304)
  })

  it('evaluates IF and text functions', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=IF(B1>150,"高","低")')).toBe('低')
    expect(evaluateFormula(doc, 2, 1, '=IF(B3>150,"高","低")')).toBe('高')
    expect(evaluateFormula(doc, 0, 1, '=CONCAT(A1,"-",B1)')).toBe('A-100')
    expect(evaluateFormula(doc, 0, 1, '=UPPER(LEFT(A1,1))')).toBe('A')
    expect(evaluateFormula(doc, 0, 1, '=LEN(A1)')).toBe(1)
  })

  it('supports comparisons and booleans', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=B1>50')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=AND(B1>50,C1=2)')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=OR(B1>500,C1=2)')).toBe(true)
  })

  it('returns errors for division by zero and cycles', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=1/0')).toBe('#ERROR')
    doc.rows[0]!.cells.amount = { value: null, formula: '=B1+1' }
    expect(evaluateFormula(doc, 0, 1, '=B1')).toBe('#ERROR')
  })

  it('returns dates via TODAY/DATE', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=DATE(2025,8,1)')).toBe('2025-08-01')
    expect(typeof evaluateFormula(doc, 0, 1, '=TODAY()')).toBe('string')
    expect(typeof evaluateFormula(doc, 0, 1, '=NOW()')).toBe('number')
  })
})

describe('recalcFormulas', () => {
  it('fills formula cell values in place', () => {
    const doc = table()
    doc.columns.push({ id: 'total', name: '合计', type: 'number', width: 100, frozen: false, hidden: false, required: false })
    doc.rows[0]!.cells.total = { value: null, formula: '=B1+C1' }
    doc.rows[1]!.cells.total = { value: null, formula: '=B2+C2' }
    recalcFormulas(doc)
    expect(doc.rows[0]!.cells.total.value).toBe(102)
    expect(doc.rows[1]!.cells.total.value).toBe(203)
    // Changing a source and recalculating propagates.
    doc.rows[0]!.cells.amount = { value: 500 }
    recalcFormulas(doc)
    expect(doc.rows[0]!.cells.total.value).toBe(502)
  })
})

describe('formula edge cases', () => {
  it('rejects malformed formulas', () => {
    expect(parseFormula('1+')).toBeNull()
    expect(parseFormula('(')).toBeNull()
    expect(parseFormula('SUM(1,')).toBeNull()
    expect(parseFormula('A1:B')).toBeNull()
    // Unknown functions parse but fail at evaluation.
    expect(parseFormula('foo()')).not.toBeNull()
  })

  it('tokenizes comparison operators and skips unknown chars', () => {
    const tokens = tokenize('a==b!=c')
    expect(tokens.filter(t => t.kind === 'op').map(t => (t as { value: string }).value)).toEqual(['==', '!='])
    expect(tokenize('a@b').length).toBeGreaterThanOrEqual(2)
  })

  it('evaluates unary ops, comparisons and string functions', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=-B1')).toBe(-100)
    expect(evaluateFormula(doc, 0, 1, '=+B1')).toBe(100)
    expect(evaluateFormula(doc, 0, 1, '="a"="a"')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '="a"<>"b"')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '="abc"<"abd"')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=LEN("你好")')).toBe(2)
    expect(evaluateFormula(doc, 0, 1, '=TRIM("  x  ")')).toBe('x')
    expect(evaluateFormula(doc, 0, 1, '=UPPER("ab")')).toBe('AB')
    expect(evaluateFormula(doc, 0, 1, '=LOWER("AB")')).toBe('ab')
    expect(evaluateFormula(doc, 0, 1, '=LEFT("abcd",2)')).toBe('ab')
    expect(evaluateFormula(doc, 0, 1, '=RIGHT("abcd",2)')).toBe('cd')
    expect(evaluateFormula(doc, 0, 1, '=MID("abcd",2,2)')).toBe('bc')
    expect(evaluateFormula(doc, 0, 1, '=ABS(-3)')).toBe(3)
    expect(evaluateFormula(doc, 0, 1, '=ROUND(1.6)')).toBe(2)
    expect(evaluateFormula(doc, 0, 1, '=TEXTJOIN(",",A1,A2)')).toBe('A,B')
    expect(evaluateFormula(doc, 0, 1, '=DATE(2025,1,15)')).toBe('2025-01-15')
    expect(evaluateFormula(doc, 0, 1, '=YEAR(1)')).toBe(1970)
    expect(evaluateFormula(doc, 0, 1, '=MONTH(1)')).toBe(1)
    expect(evaluateFormula(doc, 0, 1, '=DAY(1)')).toBe(1)
    expect(evaluateFormula(doc, 0, 1, '=UNKNOWN(1)')).toBe('#ERROR')
  })

  it('poisons arithmetic with errors and respects depth', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=1/0+1')).toBe('#ERROR')
    expect(evaluateFormula(doc, 0, 1, '=1-1/0')).toBe('#ERROR')
  })

  it('handles booleans as numbers in arithmetic', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=TRUE+1')).toBe(2)
    expect(evaluateFormula(doc, 0, 1, '=AND(TRUE,FALSE)')).toBe(false)
  })

  it('evaluates a ref chain with a shared cache', () => {
    const doc = table()
    doc.columns.push({ id: 'total', name: '合计', type: 'number', width: 100, frozen: false, hidden: false, required: false })
    doc.rows.forEach((row, r) => { row.cells.total = { value: null, formula: r === 0 ? '=B1*2' : '=C1+1' } })
    recalcFormulas(doc)
    expect(doc.rows[0]!.cells.total.value).toBe(200)
    expect(doc.rows[1]!.cells.total.value).toBe(3)
  })

  it('skips formula cells in unknown columns during recalc', () => {
    const doc = table()
    doc.rows[0]!.cells.ghost = { value: null, formula: '=1+1' }
    recalcFormulas(doc)
    expect(doc.rows[0]!.cells.ghost.value).toBeNull()
  })

  it('evaluates logical operators, parentheses and legacy comparison ops', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=(1+2)*3')).toBe(9)
    expect(evaluateFormula(doc, 0, 1, '=1==1')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=1!=2')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=2<=2')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=2>=2')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=2>1')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=7%3')).toBe(1)
  })

  it('resolves empty refs, unknown ids and bad ranges to errors', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=Z9')).toBeNull()
    expect(evaluateFormula(doc, 0, 1, '=A5')).toBeNull()
    expect(evaluateFormula(doc, 0, 1, '=abc')).toBe('#ERROR')
    expect(evaluateFormula(doc, 0, 1, '=A1:5')).toBe('#ERROR')
    expect(evaluateFormula(doc, 0, 1, '=)')).toBe('#ERROR')
    expect(evaluateFormula(doc, 0, 1, '=SUM(1,2')).toBe('#ERROR')
    expect(evaluateFormula(doc, 0, 1, '1+1')).toBe(2)
    expect(evaluateFormula(doc, 0, 1, '=A1:B2')).toBe('A')
  })

  it('coerces strings in arithmetic and truthiness', () => {
    const doc = table()
    doc.rows[0]!.cells.qty = { value: '3' }
    expect(evaluateFormula(doc, 0, 1, '=B1+C1')).toBe(103)
    doc.rows[0]!.cells.qty = { value: '' }
    expect(evaluateFormula(doc, 0, 1, '=B1+C1')).toBeNaN()
    expect(evaluateFormula(doc, 0, 1, '=AND(0,1)')).toBe(false)
    expect(evaluateFormula(doc, 0, 1, '=OR(0,1)')).toBe(true)
  })

  it('covers function fallbacks and a direct self-cycle', () => {
    const doc = table()
    expect(evaluateFormula(doc, 0, 1, '=SUM(B1,"x")')).toBe(100)
    expect(evaluateFormula(doc, 0, 1, '=AVERAGE("x","y")')).toBe(0)
    expect(evaluateFormula(doc, 0, 1, '=MAX("x")')).toBe(0)
    expect(evaluateFormula(doc, 0, 1, '=MIN("x")')).toBe(0)
    expect(evaluateFormula(doc, 0, 1, '=COUNT("x")')).toBe(0)
    expect(evaluateFormula(doc, 0, 1, '=COUNTA(B1,"")')).toBe(1)
    expect(evaluateFormula(doc, 0, 1, '=IF()')).toBeNull()
    expect(evaluateFormula(doc, 0, 1, '=CONCAT(A5)')).toBe('')
    expect(evaluateFormula(doc, 0, 1, '=ROUND()')).toBe(0)
    expect(evaluateFormula(doc, 0, 1, '=ABS()')).toBe(0)
    expect(evaluateFormula(doc, 0, 1, '=DATE()')).toBe('1900-01-01')
    expect(evaluateFormula(doc, 0, 1, '=LEFT("abcd")')).toBe('a')
    expect(evaluateFormula(doc, 0, 1, '=RIGHT("abcd")')).toBe('d')
    expect(evaluateFormula(doc, 0, 1, '=MID("abcd",2)')).toBe('b')
    // A self-referencing formula poisons itself through the cycle guard.
    doc.rows[0]!.cells.name = { value: null, formula: '=A1' }
    expect(evaluateFormula(doc, 0, 0, '=A1')).toBe('#ERROR')
    expect(evaluateFormula(doc, 0, 1, '=1 + 2')).toBe(3)
    expect(evaluateFormula(doc, 0, 1, '=(1+2')).toBe('#ERROR')
    expect(evaluateFormula(doc, 0, 1, '=1 2')).toBe('#ERROR')
    doc.rows[0]!.cells.amount = { value: null, formula: '=1+1' }
    expect(evaluateFormula(doc, 0, 1, '=SUM(B1,B1)')).toBe(4)
    doc.rows[0]!.cells.amount = { value: 100 }
    expect(evaluateFormula(doc, 0, 1, '=OR("x",FALSE)')).toBe(true)
    expect(evaluateFormula(doc, 0, 1, '=A5<B5')).toBe(false)
    expect(evaluateFormula(doc, 0, 1, '=IF(FALSE,1)')).toBeNull()
    expect(evaluateFormula(doc, 0, 1, '=IF(TRUE)')).toBeNull()
    expect(evaluateFormula(doc, 0, 1, '=TEXTJOIN()')).toBe('')
    expect(evaluateFormula(doc, 0, 1, '=YEAR()')).toBe(1970)
    expect(evaluateFormula(doc, 0, 1, '=MONTH()')).toBe(1)
    expect(evaluateFormula(doc, 0, 1, '=DAY()')).toBe(1)
    expect(evaluateFormula(doc, 0, 1, '=LEFT()')).toBe('')
    expect(evaluateFormula(doc, 0, 1, '=RIGHT()')).toBe('')
    expect(evaluateFormula(doc, 0, 1, '=MID()')).toBe('')
    expect(evaluateFormula(doc, 0, 1, '=LEN()')).toBe(0)
    expect(evaluateFormula(doc, 0, 1, '=TRIM()')).toBe('')
    expect(evaluateFormula(doc, 0, 1, '=UPPER()')).toBe('')
    expect(evaluateFormula(doc, 0, 1, '=LOWER()')).toBe('')
    expect(evaluateFormula(doc, 0, 1, '=A5:B5')).toBeNull()
    // A 70-cell reference chain trips the depth guard.
    const deepDoc = createBlankTable('deep')
    deepDoc.columns = [{ id: 'n', name: 'N', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    for (let i = 0; i < 71; i += 1) {
      deepDoc.rows.push({ id: newId(), cells: { n: { value: null, formula: `=A${i + 2}` } } })
    }
    expect(evaluateFormula(deepDoc, 0, 0, '=A2')).toBe('#ERROR')
  })
})
