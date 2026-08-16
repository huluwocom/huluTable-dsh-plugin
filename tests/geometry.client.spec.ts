/** Grid geometry: offsets, virtualization windows, stats, clipboard parsing. */
import { vi, describe, expect, it } from 'vitest'
import {
  HEADER_HEIGHT, ROW_HEIGHT, MIN_GRID_COLS, MIN_GRID_ROWS, blankColumn, isBlankColumn,
  columnOffsets, frozenWidth, optionColor, selectionStats,
  visibleColumnRange, visibleRowRange,
} from '../src/client/grid/geometry.ts'
import { parseClipboardGrid } from '../src/client/grid/Grid.tsx'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type Column } from '../src/client/domain/types.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

function columns(widths: number[], frozen: boolean[] = []): Column[] {
  return widths.map((width, i) => ({
    id: `c${i}`, name: `列${i}`, type: 'text' as const, width,
    frozen: frozen[i] ?? false, hidden: false, required: false,
  }))
}

describe('columnOffsets', () => {
  it('computes prefix sums and total', () => {
    const { offsets, total } = columnOffsets(columns([100, 150, 200]))
    expect(offsets).toEqual([0, 100, 250])
    expect(total).toBe(450)
  })

  it('computes frozen strip width including the row-number gutter', () => {
    const cols = columns([100, 150, 200], [true, false, true])
    expect(frozenWidth(cols)).toBe(46 + 100 + 200)
  })
})

describe('visibleRowRange', () => {
  it('windows rows around the scroll offset with overscan', () => {
    // scrollTop 0 → rows 0..(viewport rows + overscan)
    const { start, end } = visibleRowRange(0, 320, 1000)
    expect(start).toBe(0)
    expect(end).toBe(14) // 320/32 = 10 + 4 overscan
    // scrolled to row 100
    const mid = visibleRowRange(HEADER_HEIGHT + 100 * ROW_HEIGHT, 320, 1000)
    expect(mid.start).toBe(96)
    expect(mid.end).toBe(114)
    // clamped at the end
    const tail = visibleRowRange(HEADER_HEIGHT + 999 * ROW_HEIGHT, 320, 1000)
    expect(tail.start).toBe(995)
    expect(tail.end).toBe(1000)
  })
})

describe('visibleColumnRange', () => {
  it('skips scrolled-off columns and keeps frozen ones', () => {
    const cols = columns([100, 100, 200, 100], [true, false, false, false])
    const { offsets } = columnOffsets(cols)
    const range = visibleColumnRange(150, 300, cols, offsets)
    expect(range.start).toBe(1) // frozen index 0 excluded from window
    expect(range.end).toBe(4)
  })
})

describe('selectionStats', () => {
  it('aggregates numeric cells only', () => {
    const doc = createBlankTable('t')
    doc.columns = [
      { id: 'n', name: 'N', type: 'number', width: 100, frozen: false, hidden: false, required: false },
      { id: 't', name: 'T', type: 'text', width: 100, frozen: false, hidden: false, required: false },
    ]
    doc.rows = [
      { id: newId(), cells: { n: { value: 2 }, t: { value: 'x' } } },
      { id: newId(), cells: { n: { value: 4 }, t: { value: 'y' } } },
      { id: newId(), cells: { n: { value: 6 } } },
    ]
    const stats = selectionStats(doc, 0, 2, 0, 1)!
    expect(stats.sum).toBe(12)
    expect(stats.avg).toBe(4)
    expect(stats.max).toBe(6)
    expect(stats.min).toBe(2)
    expect(stats.count).toBe(3)
  })

  it('returns null without numeric cells', () => {
    const doc = createBlankTable('t')
    doc.columns = [{ id: 't', name: 'T', type: 'text', width: 100, frozen: false, hidden: false, required: false }]
    doc.rows = [{ id: newId(), cells: { t: { value: 'x' } } }]
    expect(selectionStats(doc, 0, 0, 0, 0)).toBeNull()
  })

  it('skips non-numeric values inside numeric columns', () => {
    const doc = createBlankTable('t')
    doc.columns = [{ id: 'n', name: 'N', type: 'number', width: 100, frozen: false, hidden: false, required: false }]
    doc.rows = [
      { id: newId(), cells: { n: { value: 2 } } },
      { id: newId(), cells: { n: { value: 'abc' } } },
      { id: newId(), cells: {} },
    ]
    const stats = selectionStats(doc, 0, 2, 0, 0)!
    expect(stats.sum).toBe(2)
    expect(stats.count).toBe(1)
  })
})

describe('visibleColumnRange edges', () => {
  it('tolerates offsets shorter than the column list', () => {
    const cols = columns([100, 100, 200, 100], [true, false, false, false])
    // offsets only cover the first two columns; later entries read as 0,
    // so a far scroll advances past every unfrozen column.
    const range = visibleColumnRange(350, 300, cols, [0, 100])
    expect(range.start).toBe(1)
    expect(range.end).toBe(4)
    // A fully scrolled-out window clamps to the last column.
    const tail = visibleColumnRange(99999, 300, cols, [0, 100])
    expect(tail.start).toBe(1)
    expect(tail.end).toBe(4)
    // Scroll at the origin walks the end loop over the missing offsets too.
    const origin = visibleColumnRange(0, 300, cols, [0, 100])
    expect(origin.start).toBe(1)
    expect(origin.end).toBe(4)
  })
})

describe('optionColor', () => {
  it('returns the option color or empty for missing labels', () => {
    const col = columns([100])[0]!
    expect(optionColor(col, '甲')).toBe('')
    col.options = [{ id: 'a', label: '甲', color: '#fff' }]
    expect(optionColor(col, '甲')).toBe('#fff')
    expect(optionColor(col, '乙')).toBe('')
    expect(optionColor(col, null)).toBe('')
  })
})

describe('parseClipboardGrid', () => {
  it('parses tab/newline TSV', () => {
    expect(parseClipboardGrid('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles CRLF and quoted cells', () => {
    expect(parseClipboardGrid('"x\ty"\tq\r\n1\t2')).toEqual([['x\ty', 'q'], ['1', '2']])
  })

  it('drops the trailing empty line', () => {
    expect(parseClipboardGrid('a\n')).toEqual([['a']])
  })
})

describe('blank canvas columns', () => {
  it('creates stable blank columns and recognizes them', () => {
    const blank = blankColumn(3)
    expect(blank.id).toBe('__blank:3')
    expect(blank.name).toBe('')
    expect(blank.width).toBe(140)
    expect(blank.frozen).toBe(false)
    expect(isBlankColumn(blank)).toBe(true)
    expect(isBlankColumn(columns([100])[0]!)).toBe(false)
  })

  it('exposes the blank floor constants', () => {
    expect(MIN_GRID_ROWS).toBeGreaterThan(0)
    expect(MIN_GRID_COLS).toBeGreaterThan(0)
  })
})
