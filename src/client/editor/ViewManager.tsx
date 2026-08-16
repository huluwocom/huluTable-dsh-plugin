/**
 * View manager panel: list/rename/duplicate/delete views, create new grid or
 * kanban views, and bind the active kanban/calendar view to its group/date
 * column. Lives over the editor toolbar.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController } from '../controller.ts'
import type { TableDoc, View } from '../domain/types.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './ViewManager.module.css'

export interface ViewManagerProps {
  table: TableDoc
  activeView: View
  t: HulutableTranslate
  controller: HulutableController
  onClose: () => void
}

/** Render the view manager panel. */
export function ViewManager({ table, activeView, t, controller, onClose }: ViewManagerProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Escape always closes this popover and never reaches the workspace
        // shell underneath (nested inputs never consume it at this level).
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    // Capture-phase: swallow Escape so it never reaches the workspace shell's own document listener.
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const optionColumns = table.columns.filter(c => c.type === 'select' || c.type === 'multiSelect')
  const dateColumns = table.columns.filter(c => c.type === 'date' || c.type === 'datetime')

  const commitRename = (): void => {
    if (renaming !== null && nameDraft.trim() !== '') {
      controller.updateView(table.id, renaming, { name: nameDraft.trim() })
    }
    setRenaming(null)
  }

  return (
    <div ref={ref} className={css.panel} style={{ right: 16, top: 56 }}>
      <div className={css.title}>{t('view.manage')}</div>
      <div className={css.list}>
        {table.views.map(view => (
          <div key={view.id} className={clsx(css.row, view.id === activeView.id && css.active)}>
            <button
              type="button"
              className={css.rowMain}
              onClick={() => { controller.setActiveView(table.id, view.id) }}
            >
              <span className={css.kindIcon}>{view.kind === 'kanban' ? '▦' : view.kind === 'calendar' ? '▤' : '▦'}</span>
              {renaming === view.id ? (
                <input
                  className={css.renameInput}
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => { setNameDraft(e.target.value) }}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                  }}
                  onClick={(e) => { e.stopPropagation() }}
                />
              ) : (
                <span className={css.name}>{view.name}</span>
              )}
            </button>
            <button
              type="button"
              className={css.small}
              aria-label={t('view.rename')}
              onClick={() => { setRenaming(view.id); setNameDraft(view.name) }}
            >
              ✎
            </button>
            <button
              type="button"
              className={css.small}
              aria-label={t('view.duplicate')}
              onClick={() => { controller.duplicateView(table.id, view.id) }}
            >
              ⧉
            </button>
            {table.views.length > 1 && (
              <button
                type="button"
                className={clsx(css.small, css.danger)}
                aria-label={t('view.delete')}
                onClick={() => { controller.removeView(table.id, view.id) }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className={css.actions}>
        <button
          type="button"
          className={css.addButton}
          onClick={() => { controller.addView(table.id, t('view.newGrid')) }}
        >
          + {t('view.newGrid')}
        </button>
        <button
          type="button"
          className={css.addButton}
          onClick={() => { controller.addView(table.id, t('view.newKanban'), 'kanban') }}
        >
          + {t('view.newKanban')}
        </button>
        <button
          type="button"
          className={css.addButton}
          onClick={() => { controller.addView(table.id, t('view.newCalendar'), 'calendar') }}
        >
          + {t('view.newCalendar')}
        </button>
        <button
          type="button"
          className={css.addButton}
          onClick={() => { controller.addView(table.id, t('view.newChart'), 'chart') }}
        >
          + {t('view.newChart')}
        </button>
      </div>
      {activeView.kind === 'kanban' && (
        <div className={css.bindRow}>
          <span className={css.bindLabel}>{t('view.groupColumn')}</span>
          <select
            className={css.bindSelect}
            aria-label={t('view.groupColumn')}
            value={activeView.groupColumnId ?? ''}
            onChange={(e) => {
              controller.updateView(table.id, activeView.id, { groupColumnId: e.target.value })
            }}
          >
            <option value="">—</option>
            {optionColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {activeView.kind === 'calendar' && (
        <div className={css.bindRow}>
          <span className={css.bindLabel}>{t('view.calendarColumn')}</span>
          <select
            className={css.bindSelect}
            aria-label={t('view.calendarColumn')}
            value={activeView.calendarColumnId ?? ''}
            onChange={(e) => {
              controller.updateView(table.id, activeView.id, { calendarColumnId: e.target.value })
            }}
          >
            <option value="">—</option>
            {dateColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {activeView.kind === 'chart' && (
        <ChartBind
          table={table}
          view={activeView}
          t={t}
          controller={controller}
        />
      )}
    </div>
  )
}

/** Chart view configuration: type, title, category column, value columns. */
function ChartBind(props: {
  table: TableDoc
  view: View
  t: HulutableTranslate
  controller: HulutableController
}) {
  const { table, view, t, controller } = props
  const chart = view.chart ?? { type: 'line' as const, title: '', xColumnId: '', yColumnIds: [] }
  const patch = (part: Partial<NonNullable<View['chart']>>): void => {
    controller.updateView(table.id, view.id, { chart: { ...chart, ...part } })
  }
  const toggleY = (columnId: string): void => {
    const list = chart.yColumnIds.includes(columnId)
      ? chart.yColumnIds.filter(id => id !== columnId)
      : [...chart.yColumnIds, columnId]
    patch({ yColumnIds: list })
  }
  return (
    <div className={css.bindCol}>
      <div className={css.bindRow}>
        <span className={css.bindLabel}>{t('chart.type')}</span>
        <select
          className={css.bindSelect}
          aria-label={t('chart.type')}
          value={chart.type}
          onChange={(e) => { patch({ type: e.target.value as 'line' | 'bar' | 'pie' | 'funnel' }) }}
        >
          <option value="line">{t('chart.type.line')}</option>
          <option value="bar">{t('chart.type.bar')}</option>
          <option value="pie">{t('chart.type.pie')}</option>
          <option value="funnel">{t('chart.type.funnel')}</option>
        </select>
      </div>
      <div className={css.bindRow}>
        <span className={css.bindLabel}>{t('chart.title')}</span>
        <input
          className={css.bindSelect}
          aria-label={t('chart.title')}
          value={chart.title}
          placeholder={view.name}
          onChange={(e) => { patch({ title: e.target.value }) }}
        />
      </div>
      <div className={css.bindRow}>
        <span className={css.bindLabel}>{t('chart.x')}</span>
        <select
          className={css.bindSelect}
          aria-label={t('chart.x')}
          value={chart.xColumnId}
          onChange={(e) => { patch({ xColumnId: e.target.value }) }}
        >
          <option value="">—</option>
          {table.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className={css.bindRow}>
        <span className={css.bindLabel}>{t('chart.width')}</span>
        <input
          type="number"
          className={css.bindSelect}
          aria-label={t('chart.width')}
          min={320}
          max={1400}
          /* v8 ignore next -- a fresh chart view has no width yet. */
          value={chart.width ?? 760}
          onChange={(e) => { patch({ width: Math.max(320, Math.min(1400, Number(e.target.value) || 760)) }) }}
        />
      </div>
      <div className={css.bindRow}>
        <span className={css.bindLabel}>{t('chart.height')}</span>
        <input
          type="number"
          className={css.bindSelect}
          aria-label={t('chart.height')}
          min={220}
          max={900}
          /* v8 ignore next -- a fresh chart view has no height yet. */
          value={chart.height ?? 380}
          onChange={(e) => { patch({ height: Math.max(220, Math.min(900, Number(e.target.value) || 380)) }) }}
        />
      </div>
      <div className={css.bindRow}>
        <span className={css.bindLabel}>{t('chart.background')}</span>
        <select
          className={css.bindSelect}
          aria-label={t('chart.background')}
          value={chart.background ?? 'auto'}
          onChange={(e) => { patch({ background: e.target.value as 'auto' | 'light' | 'dark' }) }}
        >
          <option value="auto">{t('chart.background.auto')}</option>
          <option value="light">{t('chart.background.light')}</option>
          <option value="dark">{t('chart.background.dark')}</option>
        </select>
      </div>
      <div className={css.bindLabel}>{t('chart.y')}</div>
      <div className={css.yList}>
        {table.columns.map(c => (
          <label key={c.id} className={css.yItem}>
            <input
              type="checkbox"
              checked={chart.yColumnIds.includes(c.id)}
              onChange={() => { toggleY(c.id) }}
            />
            <span>{c.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
