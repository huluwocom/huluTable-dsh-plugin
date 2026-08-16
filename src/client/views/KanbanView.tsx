/**
 * Kanban view: rows grouped by the view's group column (a dropdown column)
 * into lanes; cards drag between lanes to change the group value — the CRM
 * funnel. Rendered from the same table document; mutations go through the
 * controller (undoable).
 */
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController } from '../controller.ts'
import { applyViewQuery } from '../domain/query.ts'
import type { TableDoc, View } from '../domain/types.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './KanbanView.module.css'

export interface KanbanViewProps {
  table: TableDoc
  view: View
  controller: HulutableController
  t: HulutableTranslate
}

/** Render the kanban surface. */
export function KanbanView({ table, view, controller, t }: KanbanViewProps) {
  const groupColumn = table.columns.find(c => c.id === view.groupColumnId)
  const [dragging, setDragging] = useState<{ rowId: string; over: string } | null>(null)

  const rows = useMemo(
    () => applyViewQuery(table, view.filters, view.filterMode, view.sorts),
    [table, view.filters, view.filterMode, view.sorts],
  )

  // Card display columns: the first text-ish column (title) + first numeric (amount).
  const titleColumn = table.columns.find(c => c.type === 'text' || c.type === 'textarea')
  const amountColumn = table.columns.find(c => c.type === 'number' || c.type === 'currency' || c.type === 'percent')

  if (groupColumn === undefined) {
    return (
      <div className={css.missing}>
        {t('kanban.noGroup')}
      </div>
    )
  }

  // Lane model: options + a trailing '未设置' lane for empty values.
  const lanes: { key: string; label: string; color: string; rowIndexes: number[] }[] = []
  for (const option of groupColumn.options ?? []) {
    lanes.push({ key: option.label, label: option.label, color: option.color, rowIndexes: [] })
  }
  lanes.push({ key: '', label: t('kanban.unset'), color: '', rowIndexes: [] })
  const laneByKey = new Map(lanes.map(l => [l.key, l]))

  for (const dataIndex of rows) {
    const value = table.rows[dataIndex]?.cells[groupColumn.id]?.value
    const key = typeof value === 'string' ? value : ''
    // Known option values land in their lane; anything else in 未设置.
    const lane = laneByKey.get(key) ?? laneByKey.get('')
    lane?.rowIndexes.push(dataIndex)
  }

  const drop = (rowId: string, laneKey: string): void => {
    const row = table.rows.find(r => r.id === rowId)
    if (row !== undefined) {
      const value = laneKey === '' ? null : laneKey
      controller.setCellValue(table.id, rowId, groupColumn.id, value)
    }
    setDragging(null)
  }

  return (
    <div className={css.board}>
      {lanes.map(lane => (
        <div
          key={lane.key || '__empty__'}
          className={clsx(css.lane, dragging !== null && dragging.over === lane.key && css.laneOver)}
          onDragOver={(e) => {
            if (dragging !== null) { e.preventDefault(); setDragging({ ...dragging, over: lane.key }) }
          }}
          onDrop={(e) => {
            e.preventDefault()
            const rowId = e.dataTransfer.getData('text/plain')
            if (rowId !== '') drop(rowId, lane.key)
          }}
        >
          <div className={css.laneHeader}>
            <span className={css.laneDot} style={lane.color !== '' ? { background: lane.color } : undefined} />
            <span className={css.laneLabel}>{lane.label}</span>
            <span className={css.laneCount}>{lane.rowIndexes.length}</span>
          </div>
          <div className={css.laneBody}>
            {lane.rowIndexes.map((dataIndex) => {
              const row = table.rows[dataIndex]
              /* v8 ignore next -- row indexes come from the fresh query, which never yields stale indexes. */
              if (row === undefined) return null
              const title = titleColumn === undefined ? '' : String(row.cells[titleColumn.id]?.value ?? '')
              const amount = amountColumn === undefined ? undefined : row.cells[amountColumn.id]?.value
              return (
                <div
                  key={row.id}
                  className={css.card}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', row.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging({ rowId: row.id, over: lane.key })
                  }}
                  onDragEnd={() => { setDragging(null) }}
                >
                  <div className={css.cardTitle}>{title}</div>
                  <div className={css.cardMeta}>
                    {amount !== undefined && amount !== null && (
                      <span className={css.cardAmount}>{String(amount)}</span>
                    )}
                    <span className={css.cardSub}>
                      {table.columns
                        .filter(c => c.id !== groupColumn.id && c.id !== titleColumn?.id && c.id !== amountColumn?.id)
                        .slice(0, 2)
                        .map((c) => {
                          const v = row.cells[c.id]?.value
                          return v === null || v === undefined || v === '' ? null : `${c.name}: ${String(v)}`
                        })
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
