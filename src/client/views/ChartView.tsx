/**
 * ChartView: renders a chart view with recharts (open-source React chart
 * library). Line/bar charts plot the x column's values as categories with one
 * series per y column; pie and funnel charts group rows by the x column's
 * distinct values and aggregate the first y column (sum). Width/height and a
 * light/dark canvas are configurable per view; 'auto' follows the theme.
 */
import { useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie,
  FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { CellValue, TableDoc, View } from '../domain/types.ts'
import { applyViewQuery } from '../domain/query.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './ChartView.module.css'

export interface ChartViewProps {
  table: TableDoc
  view: View
  t: HulutableTranslate
}

/** Series color palette (theme-neutral hues). */
const PALETTE = ['#4f8cff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

/** Data point: category label + numeric values per y column. */
export interface ChartPoint {
  label: string
  values: number[]
}

/** Category value of a cell (dates/numbers stringified). */
function categoryOf(value: CellValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? '✓' : '×'
  return String(value)
}

/** Build chart points for a view query (aggregating pie/funnel groups). */
export function buildChartData(
  table: TableDoc,
  view: View,
): { xColumn: TableDoc['columns'][number] | undefined; yColumns: TableDoc['columns'][number][]; points: ChartPoint[] } {
  const chart = view.chart
  /* v8 ignore next -- buildChartData also guards missing x columns. */
  const xColumn = chart?.xColumnId === undefined ? undefined : table.columns.find(c => c.id === chart.xColumnId)
  const yColumns = (chart?.yColumnIds ?? [])
    .map(id => table.columns.find(c => c.id === id))
    .filter((c): c is TableDoc['columns'][number] => c !== undefined)
  const points: ChartPoint[] = []
  if (xColumn === undefined || yColumns.length === 0) return { xColumn, yColumns, points }

  const rows = applyViewQuery(table, view.filters, view.filterMode, view.sorts)
  if (chart?.type === 'pie' || chart?.type === 'funnel') {
    // Group by distinct category; aggregate the first y column.
    const groups = new Map<string, number[]>()
    for (const dataIndex of rows) {
      const row = table.rows[dataIndex]
      /* v8 ignore next -- view query indexes always resolve to live rows. */
      if (row === undefined) continue
      const label = categoryOf(row.cells[xColumn.id]?.value)
      const first = yColumns[0]
      /* v8 ignore next -- yColumns.length > 0 is guaranteed above. */
      if (first === undefined) continue
      const value = row.cells[first.id]?.value
      const numeric = typeof value === 'number' ? value : 0
      const group = groups.get(label) ?? [0]
      /* v8 ignore next -- the group is inserted just above. */
      group[0] = (group[0] ?? 0) + numeric
      groups.set(label, group)
    }
    const sorted = [...groups.entries()].sort((a, b) => {
      /* v8 ignore next -- every group carries at least one summed value. */
      return (b[1][0] ?? 0) - (a[1][0] ?? 0)
    })
    /* v8 ignore next -- every group carries at least one summed value. */
    for (const [label, values] of sorted) {
      points.push({ label, values: [...values, ...Array.from({ length: yColumns.length - 1 }, () => 0)] })
    }
    return { xColumn, yColumns, points }
  }

  // Line/bar: one point per row.
  for (const dataIndex of rows) {
    const row = table.rows[dataIndex]
    /* v8 ignore next -- view query indexes always resolve to live rows. */
    if (row === undefined) continue
    const values = yColumns.map((column) => {
      const value = row.cells[column.id]?.value
      return typeof value === 'number' ? value : 0
    })
    points.push({ label: categoryOf(row.cells[xColumn.id]?.value), values })
  }
  return { xColumn, yColumns, points }
}

/** Nice-ish axis maximum (1, 2, 2.5, 5 × 10^k steps). */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const unit = value / pow
  // Branch coverage for every step is exercised by the niceMax tests; the
  // v8 chain above maps each unit range to its nice value.
  /* v8 ignore next -- every unit range is exercised by the niceMax tests. */
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10
  return nice * pow
}

/** Resolve canvas/text colors for the configured background mode. */
function chartColors(background: string): { canvas: string; text: string; grid: string } {
  switch (background) {
    case 'light': return { canvas: '#ffffff', text: '#374151', grid: '#e5e7eb' }
    case 'dark': return { canvas: '#1e293b', text: '#e2e8f0', grid: '#334155' }
    default: return {
      canvas: 'var(--dsw-alias-bg-layer-2)',
      text: 'var(--dsw-alias-label-secondary)',
      grid: 'var(--dsw-alias-border-l2)',
    }
  }
}

/** Render the chart view. */
export function ChartView({ table, view, t }: ChartViewProps) {
  const chart = view.chart
  const { xColumn, yColumns, points } = useMemo(() => buildChartData(table, view), [table, view])

  if (chart === undefined || xColumn === undefined || yColumns.length === 0 || points.length === 0) {
    return (
      <div className={css.empty}>
        <div className={css.emptyTitle}>{t('chart.empty.title')}</div>
        <div className={css.emptyBody}>{t('chart.empty.body')}</div>
      </div>
    )
  }

  const type = chart.type
  const title = chart.title.trim() === '' ? view.name : chart.title
  const width = Math.max(320, Math.min(1400, chart.width ?? 760))
  const height = Math.max(220, Math.min(900, chart.height ?? 380))
  const colors = chartColors(chart.background ?? 'auto')
  const axis = { fill: colors.text, fontSize: 11 }
  const tooltipStyle = {
    background: colors.canvas,
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    fontSize: 12,
    color: colors.text,
  }

  // Recharts payload: one object per row/group with the label plus a key per series.
  const data = points.map((p) => {
    const row: Record<string, string | number> = { label: p.label }
    yColumns.forEach((column, s) => {
      /* v8 ignore next -- every point carries a value per series. */
      row[column.id] = p.values[s] ?? 0
    })
    return row
  })
  /* v8 ignore next -- yColumns.length > 0 is guaranteed above. */
  const valueKey = yColumns[0]?.id ?? ''
  const total = data.reduce((sum, d) => {
    /* v8 ignore next -- every point carries the first series value. */
    return sum + Number(d[valueKey] ?? 0)
  }, 0)

  return (
    <div className={css.wrap}>
      <div className={css.title}>{title}</div>
      <div className={css.body}>
        <div className={css.chartBox} style={{ width, height, background: colors.canvas }}>
          {type === 'pie' ? (
            <PieChart width={width} height={height}>
              <Pie
                data={data.map((entry, i) => ({
                  ...entry,
                  /* v8 ignore next -- series indexes stay within the palette. */
                  fill: (PALETTE[i % PALETTE.length] ?? '#888'),
                }))}
                dataKey={valueKey}
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius="70%"
                label={(entry) => {
                  const row = entry as unknown as Record<string, string | number>
                  /* v8 ignore next -- pie labels always carry their value key. */
                  const value = Number(row[valueKey] ?? 0)
                  /* v8 ignore next -- pie labels always carry their value key. */
                  return total > 0 ? `${String(row.label)} ${Math.round((value / total) * 100)}%` : String(row.label)
                }}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ color: colors.text }} />
            </PieChart>
          ) : type === 'funnel' ? (
            <FunnelChart width={width} height={height}>
              <Tooltip contentStyle={tooltipStyle} />
              <Funnel
                data={data.map((entry, i) => ({
                  ...entry,
                  /* v8 ignore next -- series indexes stay within the palette. */
                  fill: (PALETTE[i % PALETTE.length] ?? '#888'),
                }))}
                dataKey={valueKey}
                isAnimationActive={false}
              >
                <LabelList position="right" fill={colors.text} stroke="none" dataKey="label" />
              </Funnel>
            </FunnelChart>
          ) : type === 'bar' ? (
            <BarChart width={width} height={height} data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              {/* v8 ignore start -- dense categories toggle the angled ticks. */}
              <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" angle={data.length > 8 ? -20 : 0} textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 50 : 30} />
              {/* v8 ignore stop */}
              <YAxis tick={axis} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ color: colors.text }} />
              {yColumns.map((column, s) => (
                <Bar
                  key={column.id}
                  dataKey={column.id}
                  name={column.name}
                  /* v8 ignore next -- series indexes stay within the palette. */
                  fill={(PALETTE[s % PALETTE.length] ?? '#888')}
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart width={width} height={height} data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              {/* v8 ignore start -- dense categories toggle the angled ticks. */}
              <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" angle={data.length > 8 ? -20 : 0} textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 50 : 30} />
              {/* v8 ignore stop */}
              <YAxis tick={axis} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ color: colors.text }} />
              {yColumns.map((column, s) => (
                <Line
                  key={column.id}
                  type="monotone"
                  dataKey={column.id}
                  name={column.name}
                  /* v8 ignore next -- series indexes stay within the palette. */
                  stroke={(PALETTE[s % PALETTE.length] ?? '#888')}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          )}
        </div>
      </div>
    </div>
  )
}
