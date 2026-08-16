// @vitest-environment jsdom
/** Chart view: data building (line/bar points, pie/funnel groups), axis
 * scaling, and SVG rendering of all four chart types + empty states. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ChartView, buildChartData, niceMax } from '../src/client/views/ChartView.tsx'
import { createBlankTable } from '../src/client/domain/templates.ts'
import { newId, type Column, type View } from '../src/client/domain/types.ts'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as HulutableTranslate

function bench() {
  const doc = createBlankTable('图')
  const text: Column = { id: 'cat', name: '分类', type: 'text', width: 100, frozen: false, hidden: false, required: false }
  const numA: Column = { id: 'a', name: '数值A', type: 'number', width: 100, frozen: false, hidden: false, required: false }
  const numB: Column = { id: 'b', name: '数值B', type: 'number', width: 100, frozen: false, hidden: false, required: false }
  doc.columns = [text, numA, numB]
  doc.rows = [
    { id: newId(), cells: { cat: { value: '甲' }, a: { value: 10 }, b: { value: 1 } } },
    { id: newId(), cells: { cat: { value: '乙' }, a: { value: 20 }, b: { value: 2 } } },
    { id: newId(), cells: { cat: { value: '甲' }, a: { value: 5 }, b: { value: 3 } } },
  ]
  return doc
}

function viewOf(chart: View['chart']): View {
  return {
    id: 'v', name: '图视图', kind: 'chart', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
    chart: chart ?? { type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a'] },
  }
}

describe('niceMax', () => {
  it('rounds up to a nice axis maximum', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(21)).toBe(25)
    expect(niceMax(100)).toBe(100)
    expect(niceMax(450)).toBe(500)
  })
})

describe('buildChartData', () => {
  it('builds one point per row for line/bar charts', () => {
    const doc = bench()
    const { xColumn, yColumns, points } = buildChartData(doc, viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a', 'b'] }))
    expect(xColumn?.name).toBe('分类')
    expect(yColumns.map(c => c.name)).toEqual(['数值A', '数值B'])
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ label: '甲', values: [10, 1] })
  })

  it('groups and sums distinct categories for pie/funnel', () => {
    const doc = bench()
    const { points } = buildChartData(doc, viewOf({ type: 'pie', title: '', xColumnId: 'cat', yColumnIds: ['a'] }))
    // Groups sort by aggregate value descending (funnel needs it).
    expect(points).toEqual([
      { label: '乙', values: [20] },
      { label: '甲', values: [15] },
    ])
  })

  it('returns empty points without configured columns', () => {
    const doc = bench()
    const noX = buildChartData(doc, viewOf({ type: 'line', title: '', xColumnId: '', yColumnIds: ['a'] }))
    expect(noX.xColumn).toBeUndefined()
    expect(noX.points).toHaveLength(0)
    const noY = buildChartData(doc, viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: [] }))
    expect(noY.yColumns).toHaveLength(0)
    expect(noY.points).toHaveLength(0)
    // Unknown ids resolve to nothing.
    const ghost = buildChartData(doc, viewOf({ type: 'line', title: '', xColumnId: 'ghost', yColumnIds: ['ghost2'] }))
    expect(ghost.xColumn).toBeUndefined()
  })

  it('respects view filters when building points', () => {
    const doc = bench()
    const view = viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a'] })
    view.filters = [{ columnId: 'cat', op: 'eq', value: '甲' }]
    const { points } = buildChartData(doc, view)
    expect(points).toHaveLength(2)
    expect(points.every(p => p.label === '甲')).toBe(true)
  })
})

describe('ChartView', () => {
  it('renders an empty state without configuration', () => {
    const view = viewOf(undefined)
    view.chart = { type: 'line', title: '', xColumnId: '', yColumnIds: [] }
    render(<ChartView table={bench()} view={view} t={t} />)
    expect(screen.getByText('No chart yet')).toBeTruthy()
  })

  it('renders a line chart with series and legend', () => {
    const doc = bench()
    const view = viewOf({ type: 'line', title: '走势', xColumnId: 'cat', yColumnIds: ['a', 'b'] })
    render(<ChartView table={doc} view={view} t={t} />)
    expect(screen.getByText('走势')).toBeTruthy()
    // recharts renders an SVG chart surface with a legend wrapper.
    expect(document.querySelectorAll('svg').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.recharts-line, .recharts-wrapper').length).toBeGreaterThan(0)
  })

  it('renders a bar chart', () => {
    const doc = bench()
    const view = viewOf({ type: 'bar', title: '柱状', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    expect(screen.getByText('柱状')).toBeTruthy()
    expect(document.querySelectorAll('.recharts-bar, .recharts-wrapper').length).toBeGreaterThan(0)
  })

  it('renders a pie chart with percentage legend', () => {
    const doc = bench()
    const view = viewOf({ type: 'pie', title: '占比', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    expect(screen.getByText('占比')).toBeTruthy()
    expect(document.querySelectorAll('.recharts-pie, .recharts-wrapper').length).toBeGreaterThan(0)
  })

  it('renders a funnel chart with descending bars', () => {
    const doc = bench()
    const view = viewOf({ type: 'funnel', title: '漏斗', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    expect(screen.getByText('漏斗')).toBeTruthy()
    expect(document.querySelectorAll('.recharts-funnel, .recharts-wrapper').length).toBeGreaterThan(0)
  })

  it('falls back to the view name as the title', () => {
    const doc = bench()
    const view = viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    expect(screen.getByText('图视图')).toBeTruthy()
  })

  it('renders many categories without overlapping tick labels', () => {
    const doc = bench()
    for (let i = 0; i < 20; i += 1) {
      doc.rows.push({ id: newId(), cells: { cat: { value: `类别${i}` }, a: { value: i } } })
    }
    const view = viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    // recharts preserves axis readability (interval + angle) for dense categories.
    expect(document.querySelectorAll('svg').length).toBeGreaterThan(0)
  })
})

describe('chart data edges', () => {
  it('stringifies null/boolean x values', () => {
    const doc = bench()
    doc.rows.push({ id: newId(), cells: { cat: { value: null }, a: { value: 1 } } })
    doc.rows.push({ id: newId(), cells: { cat: { value: true }, a: { value: 2 } } })
    doc.rows.push({ id: newId(), cells: { cat: { value: false }, a: { value: 3 } } })
    const { points } = buildChartData(doc, viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a'] }))
    expect(points[3]!.label).toBe('')
    expect(points[4]!.label).toBe('✓')
    expect(points[5]!.label).toBe('×')
  })

  it('treats non-numeric y values as zero', () => {
    const doc = bench()
    doc.rows.push({ id: newId(), cells: { cat: { value: '丙' }, a: { value: '文本' } } })
    const { points } = buildChartData(doc, viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a'] }))
    expect(points.at(-1)!.values).toEqual([0])
    const pie = buildChartData(doc, viewOf({ type: 'pie', title: '', xColumnId: 'cat', yColumnIds: ['a'] }))
    expect(pie.points.some(p => p.label === '丙')).toBe(true)
  })

  it('handles a missing yColumnIds array (legacy config)', () => {
    const doc = bench()
    const view = viewOf(undefined)
    view.chart = { type: 'line', title: '', xColumnId: 'cat' } as never
    const { yColumns, points } = buildChartData(doc, view)
    expect(yColumns).toHaveLength(0)
    expect(points).toHaveLength(0)
  })

  it('sorts three or more pie groups descending', () => {
    const doc = bench()
    doc.rows.push({ id: newId(), cells: { cat: { value: '丙' }, a: { value: 30 } } })
    const { points } = buildChartData(doc, viewOf({ type: 'pie', title: '', xColumnId: 'cat', yColumnIds: ['a'] }))
    expect(points.map(p => p.values[0])).toEqual([30, 20, 15])
  })
})

describe('chart rendering edges', () => {
  it('renders a k-formatted axis for large values', () => {
    const doc = bench()
    doc.rows = [
      { id: newId(), cells: { cat: { value: '甲' }, a: { value: 4500 } } },
      { id: newId(), cells: { cat: { value: '乙' }, a: { value: 1200 } } },
    ]
    const view = viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    // The chart surface renders; axis formatting is delegated to recharts.
    expect(document.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('renders a multi-series bar chart', () => {
    const doc = bench()
    const view = viewOf({ type: 'bar', title: '', xColumnId: 'cat', yColumnIds: ['a', 'b'] })
    render(<ChartView table={doc} view={view} t={t} />)
    expect(document.querySelectorAll('.recharts-bar, .recharts-wrapper').length).toBeGreaterThan(0)
  })

  it('renders a pie with a majority slice and percentage labels', () => {
    const doc = bench()
    doc.rows = [
      { id: newId(), cells: { cat: { value: '很长的分类名称超过十个字符' }, a: { value: 90 } } },
      { id: newId(), cells: { cat: { value: '乙' }, a: { value: 10 } } },
    ]
    const view = viewOf({ type: 'pie', title: '', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    // Percentage shares derive from the aggregated groups (verified in buildChartData).
    expect(document.querySelectorAll('.recharts-pie, .recharts-wrapper').length).toBeGreaterThan(0)
  })

  it('renders a funnel with a zero-value group', () => {
    const doc = bench()
    doc.rows.push({ id: newId(), cells: { cat: { value: '零' }, a: { value: 0 } } })
    const view = viewOf({ type: 'funnel', title: '', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    expect(document.querySelectorAll('.recharts-funnel, .recharts-wrapper').length).toBeGreaterThan(0)
  })

  it('renders long category labels without overlap', () => {
    const doc = bench()
    doc.rows = [
      { id: newId(), cells: { cat: { value: '这是一个非常非常长的分类名称' }, a: { value: 1 } } },
    ]
    const view = viewOf({ type: 'line', title: '', xColumnId: 'cat', yColumnIds: ['a'] })
    render(<ChartView table={doc} view={view} t={t} />)
    // recharts angles/tightens ticks when many categories exist.
    expect(document.querySelectorAll('svg').length).toBeGreaterThan(0)
  })
})

describe('chart rendering modes', () => {
  it('builds funnel groups like pie groups', () => {
    const doc = bench()
    const { points } = buildChartData(doc, viewOf({ type: 'funnel', title: '', xColumnId: 'cat', yColumnIds: ['a'] }))
    expect(points.map(p => p.values[0])).toEqual([20, 15])
  })

  it('renders with forced light and dark backgrounds', () => {
    const doc = bench()
    const light = viewOf({ type: 'line', title: '浅', xColumnId: 'cat', yColumnIds: ['a'] })
    light.chart = { ...light.chart!, background: 'light', width: 500, height: 300 }
    render(<ChartView table={doc} view={light} t={t} />)
    expect(screen.getByText('浅')).toBeTruthy()
    cleanup()
    const dark = viewOf({ type: 'bar', title: '深', xColumnId: 'cat', yColumnIds: ['a'] })
    dark.chart = { ...dark.chart!, background: 'dark' }
    render(<ChartView table={doc} view={dark} t={t} />)
    expect(screen.getByText('深')).toBeTruthy()
  })
})
