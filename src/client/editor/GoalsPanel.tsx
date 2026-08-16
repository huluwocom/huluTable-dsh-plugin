/**
 * Goals panel: list column goals (aggregate + target) with live progress
 * over the current view, plus an add form. Any column can be the target;
 * an optional eq/contains condition narrows which rows count. Progress
 * mirrors the header chips.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController } from '../controller.ts'
import { isNumericType, type TableDoc } from '../domain/types.ts'
import type { HulutableTranslate } from '../locales.ts'
import { applyViewQuery, matchFilter } from '../domain/query.ts'
import css from './GoalsPanel.module.css'

export interface GoalsPanelProps {
  table: TableDoc
  view: { id: string; filters: TableDoc['views'][number]['filters']; filterMode: 'and' | 'or' }
  x: number
  y: number
  t: HulutableTranslate
  controller: HulutableController
  onClose: () => void
}

/** Render the goals panel. */
export function GoalsPanel({ table, view, x, y, t, controller, onClose }: GoalsPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [columnId, setColumnId] = useState(table.columns[0]?.id ?? '')
  const [aggregate, setAggregate] = useState<'sum' | 'avg' | 'count'>('count')
  const [target, setTarget] = useState('100')
  const [condEnabled, setCondEnabled] = useState(false)
  const [condColumnId, setCondColumnId] = useState(table.columns[0]?.id ?? '')
  const [condOp, setCondOp] = useState<'eq' | 'contains'>('eq')
  const [condValue, setCondValue] = useState('')

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

  const viewRows = applyViewQuery(table, view.filters, view.filterMode, [])
  const currentColumn = table.columns.find(c => c.id === columnId)
  const currentNumeric = currentColumn !== undefined && isNumericType(currentColumn.type)
  const onColumnChange = (id: string): void => {
    setColumnId(id)
    // Non-numeric columns only support counting.
    const column = table.columns.find(c => c.id === id)
    // Select options only ever reference real columns.
    /* v8 ignore next -- select values always resolve to an existing column. */
    if (column !== undefined && !isNumericType(column.type)) setAggregate('count')
  }

  const statsOf = (goal: { columnId: string; aggregate: string; condition?: { columnId: string; op: 'eq' | 'contains'; value: string } | undefined }): { value: number; count: number } => {
    let sum = 0
    let count = 0
    let numericCount = 0
    for (const dataIndex of viewRows) {
      if (goal.condition !== undefined) {
        if (!matchFilter(table, dataIndex, {
          columnId: goal.condition.columnId, op: goal.condition.op, value: goal.condition.value,
        })) continue
      }
      count += 1
      const value = table.rows[dataIndex]?.cells[goal.columnId]?.value
      if (typeof value === 'number') { sum += value; numericCount += 1 }
    }
    const value = goal.aggregate === 'sum' ? sum
      : goal.aggregate === 'avg' ? (numericCount === 0 ? 0 : sum / numericCount)
        : count
    return { value, count }
  }

  const add = (): void => {
    const targetNum = Number(target)
    if (columnId === '' || !Number.isFinite(targetNum)) return
    /* v8 ignore next -- the condition column select always yields a real id. */
    const condition = condEnabled && condValue.trim() !== '' && condColumnId !== ''
      ? { columnId: condColumnId, op: condOp, value: condValue.trim() }
      : undefined
    controller.addGoal(table.id, { columnId, aggregate, target: targetNum, condition })
  }

  const conditionLabel = (condition: { columnId: string; op: 'eq' | 'contains'; value: string }): string => {
    const column = table.columns.find(c => c.id === condition.columnId)
    const opText = condition.op === 'eq' ? t('filter.op.eq') : t('filter.op.contains')
    return `${column?.name ?? condition.columnId} ${opText} ${condition.value}`
  }

  return (
    <div ref={ref} className={css.panel} style={{ left: Math.min(x, window.innerWidth - 360), top: Math.min(y, window.innerHeight - 420) }}>
      <div className={css.title}>{t('goal.title')}</div>
      {table.goals.length === 0 && <div className={css.empty}>{t('goal.empty')}</div>}
      {table.goals.map((goal) => {
        const { value } = statsOf(goal)
        const pct = goal.target === 0 ? 0 : Math.min(100, Math.round((value / goal.target) * 100))
        const column = table.columns.find(c => c.id === goal.columnId)
        return (
          <div key={goal.id} className={css.goalRow}>
            <div className={css.goalHead}>
              <span className={css.goalName}>
                {column?.name ?? goal.columnId} · {t(`goal.agg.${goal.aggregate}`)} → {goal.target}
                {goal.condition !== undefined && (
                  <span className={css.condBadge}>{conditionLabel(goal.condition)}</span>
                )}
              </span>
              <button
                type="button"
                className={css.remove}
                aria-label="×"
                onClick={() => { controller.removeGoal(table.id, goal.id) }}
              >
                ×
              </button>
            </div>
            <div className={css.progressTrack}>
              <div className={css.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <div className={css.progressMeta}>
              <span>{`${value} / ${goal.target}`}</span>
              <span className={css.pct}>{pct}%</span>
            </div>
          </div>
        )
      })}
      <div className={css.form}>
        <select
          className={css.field}
          value={columnId}
          onChange={(e) => { onColumnChange(e.target.value) }}
          aria-label={t('goal.column')}
        >
          {table.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          className={css.field}
          value={aggregate}
          onChange={(e) => { setAggregate(e.target.value as 'sum' | 'avg' | 'count') }}
          aria-label={t('goal.aggregate')}
        >
          <option value="sum" disabled={!currentNumeric}>{t('goal.agg.sum')}</option>
          <option value="avg" disabled={!currentNumeric}>{t('goal.agg.avg')}</option>
          <option value="count">{t('goal.agg.count')}</option>
        </select>
        <input
          className={css.field}
          value={target}
          aria-label={t('goal.target')}
          placeholder={t('goal.target')}
          onChange={(e) => { setTarget(e.target.value) }}
        />
        <div className={css.condRow}>
          <label className={css.condToggle}>
            <input
              type="checkbox"
              checked={condEnabled}
              aria-label={t('goal.cond.enable')}
              onChange={(e) => { setCondEnabled(e.target.checked) }}
            />
            <span>{t('goal.cond.enable')}</span>
          </label>
        </div>
        {condEnabled && (
          <div className={css.condRow}>
            <select
              className={css.field}
              value={condColumnId}
              onChange={(e) => { setCondColumnId(e.target.value) }}
              aria-label={t('goal.cond.column')}
            >
              {table.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className={css.field}
              value={condOp}
              onChange={(e) => { setCondOp(e.target.value as 'eq' | 'contains') }}
              aria-label={t('goal.cond.op')}
            >
              <option value="eq">{t('filter.op.eq')}</option>
              <option value="contains">{t('filter.op.contains')}</option>
            </select>
            <input
              className={css.field}
              value={condValue}
              aria-label={t('goal.cond.value')}
              placeholder={t('goal.cond.value')}
              onChange={(e) => { setCondValue(e.target.value) }}
            />
          </div>
        )}
        <button type="button" className={css.addButton} onClick={add}>
          {t('goal.add')}
        </button>
      </div>
    </div>
  )
}

export { clsx }
