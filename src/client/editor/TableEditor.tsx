/**
 * TableEditor: the editor surface — toolbar (name, undo/redo, add row/column;
 * P3+ gains view/filter/goal/import/NL seats), the virtualized grid, and the
 * selection stats bar. Business data arrives through the controller face.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableRootProps } from '../contract/slots.ts'
import type { CellSelection } from '../controller.ts'
import type { TableDoc } from '../domain/types.ts'
import type { HulutableKey } from '../locales.ts'
import { selectionStats } from '../grid/geometry.ts'
import { Grid } from '../grid/Grid.tsx'
import { FormulaBar } from './FormulaBar.tsx'
import { GoalsPanel } from './GoalsPanel.tsx'
import { ViewManager } from './ViewManager.tsx'
import { ImportModal } from './ImportModal.tsx'
import { KanbanView } from '../views/KanbanView.tsx'
import { CalendarView } from '../views/CalendarView.tsx'
import { ChartView } from '../views/ChartView.tsx'
import { toCsv, toXlsx, downloadBlob, downloadText } from '../io/io.ts'
import css from './TableEditor.module.css'

type Props = Pick<HulutableRootProps, 'controller' | 'useWorkspace' | 't'>

/** Selection stats bar (bottom) with a mini bar chart of the first numeric column. */
function StatsBar(props: { table: TableDoc; selection: CellSelection; t: Props['t'] }) {
  const { table, selection, t } = props
  const stats = selectionStats(table, selection.r0, selection.r1, selection.c0, selection.c1)
  if (stats === null) return null
  const items: { key: HulutableKey; value: string }[] = [
    { key: 'stats.sum', value: stats.sum.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) },
    { key: 'stats.avg', value: stats.avg.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) },
    { key: 'stats.max', value: stats.max.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) },
    { key: 'stats.min', value: stats.min.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) },
    { key: 'stats.count', value: String(stats.count) },
  ]
  // Mini chart: values of the first numeric column inside the selection.
  let chartColumn: TableDoc['columns'][number] | undefined
  for (let c = selection.c0; c <= selection.c1; c += 1) {
    const column = table.columns[c]
    if (column !== undefined && (column.type === 'number' || column.type === 'currency' || column.type === 'percent')) {
      chartColumn = column
      break
    }
  }
  const chartValues: number[] = []
  /* v8 ignore next -- stats non-null implies a numeric column exists. */
  if (chartColumn !== undefined) {
    for (let r = selection.r0; r <= selection.r1; r += 1) {
      const value = table.rows[r]?.cells[chartColumn.id]?.value
      /* v8 ignore next -- numeric columns may hold non-numeric cells. */
      if (typeof value === 'number') chartValues.push(value)
    }
  }
  /* v8 ignore next -- stats non-null guarantees at least one numeric value. */
  const max = chartValues.length > 0 ? Math.max(...chartValues, 1) : 1
  return (
    <div className={css.statsBar}>
      {chartValues.length > 1 && (
        <svg className={css.miniChart} width="140" height="22" aria-hidden="true">
          {chartValues.slice(-20).map((value, i) => (
            <rect
              key={i}
              x={i * 6}
              y={22 - Math.max(2, (value / max) * 20)}
              width="4"
              height={Math.max(2, (value / max) * 20)}
              rx="1"
              fill="var(--dsw-alias-accent, #4f8cff)"
            />
          ))}
        </svg>
      )}
      {items.map(item => (
        <span key={item.key} className={css.statsItem}>
          <span className={css.statsLabel}>{t(item.key)}</span>
          <span className={css.statsValue}>{item.value}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * Render the editor for the current table.
 * @param props - controller face + locale.
 * @returns the editor tree.
 */
export function TableEditor({ controller, useWorkspace, t }: Props) {
  const tableId = useWorkspace(s => s.currentTableId)
  const table = useWorkspace(s => (s.currentTableId === null ? undefined : s.tables[s.currentTableId]))
  const selection = useWorkspace(s => s.editor.selection)
  const editing = useWorkspace(s => s.editor.editing)
  const canUndo = useWorkspace(s => s.editor.undo.canUndo)
  const canRedo = useWorkspace(s => s.editor.undo.canRedo)
  // Subscribe so active-view changes re-render the surface (viewOf reads the
  // store snapshot directly).
  useWorkspace(s => s.editor.viewIds)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [goalsAnchor, setGoalsAnchor] = useState({ x: 0, y: 0 })
  const [viewManagerOpen, setViewManagerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement | null>(null)
  const [exportAnchor, setExportAnchor] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!exportOpen) return
    const onDown = (e: MouseEvent): void => {
      if (exportRef.current !== null && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [exportOpen])

  useEffect(() => {
    setNameDraft(null)
  }, [tableId])

  /* v8 ignore next -- viewOf already falls back to the first view internally. */
  const view = table === undefined ? undefined : controller.viewOf(table.id) ?? table.views[0]

  if (table === undefined) {
    return <div className={css.missing}>{t('loading')}</div>
  }

  /* v8 ignore next -- viewOf always falls back to the first view. */
  const isChartView = view !== undefined && view.kind === 'chart'

  const commitName = (): void => {
    /* v8 ignore next -- Escape already cleared the draft; only blur-after-unmount reaches this with null. */
    if (nameDraft !== null) {
      controller.renameTable(table.id, nameDraft)
    }
    setNameDraft(null)
  }

  return (
    <div className={css.editor}>
      <div className={css.toolbar}>
        {nameDraft === null ? (
          <span className={css.tableName} onClick={() => { setNameDraft(table.name) }}>
            {table.name}
          </span>
        ) : (
          <input
            className={css.nameInput}
            value={nameDraft}
            autoFocus
            onChange={(e) => { setNameDraft(e.target.value) }}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setNameDraft(null) }
            }}
          />
        )}
        <span className={css.rows}>{t('editor.rows', { n: table.rows.length })}</span>
        <div className={css.viewChips}>
          {table.views.map(v => (
            <button
              key={v.id}
              type="button"
              className={clsx(css.viewChip, view?.id === v.id && css.viewChipActive)}
              onClick={() => { controller.setActiveView(table.id, v.id) }}
            >
              {v.kind === 'kanban' ? '▦' : v.kind === 'calendar' ? '▤' : v.kind === 'chart' ? '▥' : '▦'}{v.name}
            </button>
          ))}
          <button
            type="button"
            className={css.viewChip}
            title={t('view.manage')}
            onClick={() => { setViewManagerOpen(v => !v) }}
          >
            ⋯
          </button>
        </div>
        {view !== undefined && view.filters.length > 0 && (
          <button
            type="button"
            className={css.filterChip}
            title={t('filter.clear')}
            onClick={() => { controller.updateView(table.id, view.id, { filters: [] }) }}
          >
            {t('filter.clear')} ({view.filters.length})
          </button>
        )}
        <div className={css.spacer} />
        <button
          type="button"
          className={css.toolButton}
          disabled={!canUndo}
          title={t('tool.undo')}
          aria-label={t('tool.undo')}
          onClick={() => { controller.undo(table.id) }}
        >
          {t('tool.undo')}
        </button>
        <button
          type="button"
          className={css.toolButton}
          disabled={!canRedo}
          title={t('tool.redo')}
          aria-label={t('tool.redo')}
          onClick={() => { controller.redo(table.id) }}
        >
          {t('tool.redo')}
        </button>
        <div className={css.toolSep} />
        <button
          type="button"
          className={css.toolButton}
          title={t('tool.import')}
          aria-label={t('tool.import')}
          onClick={() => { setImportOpen(true) }}
        >
          {t('tool.import')}
        </button>
        <button
          type="button"
          className={css.toolButton}
          title={t('tool.export')}
          aria-label={t('tool.export')}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setExportAnchor({ x: rect.left, y: rect.bottom + 4 })
            setExportOpen(v => !v)
          }}
        >
          {t('tool.export')}
        </button>
        {exportOpen && (
          <div ref={exportRef} className={css.exportMenu} style={{ left: exportAnchor.x, top: exportAnchor.y }}>
            <button
              type="button"
              className={css.exportItem}
              onClick={() => {
                const buffer = toXlsx(table)
                downloadBlob(`${table.name}.xlsx`, new Blob([buffer]))
                setExportOpen(false)
              }}
            >
              {t('export.xlsx')}
            </button>
            <button
              type="button"
              className={css.exportItem}
              onClick={() => {
                downloadText(`${table.name}.csv`, toCsv(table), 'text/csv;charset=utf-8')
                setExportOpen(false)
              }}
            >
              {t('export.csv')}
            </button>
          </div>
        )}
        <button
          type="button"
          className={css.toolButton}
          title={t('tool.goals')}
          aria-label={t('tool.goals')}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setGoalsAnchor({ x: rect.left, y: rect.bottom + 4 })
            setGoalsOpen(true)
          }}
        >
          {t('tool.goals')}
        </button>
      </div>
      {view !== undefined && view.kind === 'kanban' && (
        <div className={css.altArea}>
          <KanbanView table={table} view={view} controller={controller} t={t} />
        </div>
      )}
      {view !== undefined && view.kind === 'calendar' && (
        <div className={css.altArea}>
          <CalendarView table={table} view={view} t={t} />
        </div>
      )}
      {isChartView && (
        <div className={css.altArea}>
          <ChartView table={table} view={view} t={t} />
        </div>
      )}
      {view !== undefined && view.kind === 'grid' && (
        <>
          {table.columns.length === 0 && (
            <div className={css.emptyGuide}>
              <div className={css.emptyTitle}>{t('editor.empty.title')}</div>
              <div className={css.emptyBody}>{t('editor.empty.body')}</div>
              <button
                type="button"
                className={css.emptyAction}
                onClick={() => { controller.addColumn(table.id, 0, 'text', '列 1') }}
              >
                + {t('tool.addColumn')}
              </button>
            </div>
          )}
          <FormulaBar table={table} selection={selection} t={t} controller={controller} />
          <div className={css.gridArea}>
            <Grid table={table} view={view} controller={controller} selection={selection} editing={editing} t={t} />
          </div>
        </>
      )}
      {importOpen && (
        <ImportModal
          tableName={table.name}
          hasCurrentTable={true}
          t={t}
          controller={controller}
          onClose={() => { setImportOpen(false) }}
        />
      )}
      {viewManagerOpen && view !== undefined && (
        <ViewManager
          table={table}
          activeView={view}
          t={t}
          controller={controller}
          onClose={() => { setViewManagerOpen(false) }}
        />
      )}
      {goalsOpen && view !== undefined && (
        <GoalsPanel
          table={table}
          view={view}
          x={goalsAnchor.x}
          y={goalsAnchor.y}
          t={t}
          controller={controller}
          onClose={() => { setGoalsOpen(false) }}
        />
      )}
      {selection !== null && (
        <StatsBar table={table} selection={selection} t={t} />
      )}
    </div>
  )
}
