/**
 * Calendar view: rows with a date/datetime value in the view's calendar
 * column placed on a month grid. Month navigation; clicking a day lists its
 * events. Read-only for v1 — editing happens in the grid.
 */
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { applyViewQuery } from '../domain/query.ts'
import type { TableDoc, View } from '../domain/types.ts'
import type { HulutableTranslate } from '../locales.ts'
import { parseDate } from '../domain/editor-ops.ts'
import css from './CalendarView.module.css'

export interface CalendarViewProps {
  table: TableDoc
  view: View
  t: HulutableTranslate
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** Render the calendar surface. */
export function CalendarView({ table, view, t }: CalendarViewProps) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })

  const rows = useMemo(
    () => applyViewQuery(table, view.filters, view.filterMode, view.sorts),
    [table, view.filters, view.filterMode, view.sorts],
  )

  const calendarColumn = table.columns.find(c => c.id === view.calendarColumnId)
  const titleColumn = table.columns.find(c => c.type === 'text' || c.type === 'textarea')

  /** The month of the earliest date value in the calendar column. */
  const earliest = useMemo(() => {
    /* v8 ignore next -- the render guard below handles missing calendar columns. */
    if (calendarColumn === undefined) return undefined
    let min: Date | null = null
    for (const dataIndex of rows) {
      const value = table.rows[dataIndex]?.cells[calendarColumn.id]?.value
      if (typeof value !== 'string') continue
      const date = parseDate(value)
      if (date !== null && (min === null || date.getTime() < min.getTime())) min = date
    }
    return min
  }, [table, rows, calendarColumn])

  // day → event rows (title text) for the cursor month.
  const events = useMemo(() => {
    const map = new Map<number, { title: string; date: string }[]>()
    if (calendarColumn === undefined) return map
    for (const dataIndex of rows) {
      const value = table.rows[dataIndex]?.cells[calendarColumn.id]?.value
      if (typeof value !== 'string') continue
      const date = parseDate(value)
      if (date === null || date.getFullYear() !== cursor.year || date.getMonth() !== cursor.month) continue
      const title = titleColumn === undefined
        ? ''
        : String(table.rows[dataIndex]?.cells[titleColumn.id]?.value ?? '')
      const list = map.get(date.getDate()) ?? []
      list.push({ title, date: value })
      map.set(date.getDate(), list)
    }
    return map
  }, [table, rows, cursor, calendarColumn, titleColumn])

  if (calendarColumn === undefined) {
    return <div className={css.missing}>{t('calendar.noColumn')}</div>
  }

  const firstDay = new Date(cursor.year, cursor.month, 1)
  const lead = firstDay.getDay()
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const move = (delta: number): void => {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }
  const today = new Date()
  const isToday = (day: number): boolean =>
    today.getFullYear() === cursor.year && today.getMonth() === cursor.month && today.getDate() === day

  return (
    <div className={css.calendar}>
      <div className={css.header}>
        <button type="button" className={css.nav} onClick={() => { move(-1) }}>‹</button>
        <span className={css.title}>{cursor.year} 年 {cursor.month + 1} 月</span>
        <button type="button" className={css.nav} onClick={() => { move(1) }}>›</button>
        <button
          type="button"
          className={css.today}
          onClick={() => {
            setCursor({ year: today.getFullYear(), month: today.getMonth() })
          }}
        >
          {t('calendar.today')}
        </button>
        <button
          type="button"
          className={css.today}
          title={t('calendar.earliest')}
          disabled={earliest === undefined}
          onClick={() => {
            /* v8 ignore next -- the button is disabled without a min date. */
            if (earliest !== null && earliest !== undefined) setCursor({ year: earliest.getFullYear(), month: earliest.getMonth() })
          }}
        >
          {t('calendar.earliest')}
        </button>
        <span className={css.columnName}>{calendarColumn.name}</span>
      </div>
      <div className={css.weekRow}>
        {WEEKDAYS.map(day => <div key={day} className={css.weekday}>{day}</div>)}
      </div>
      <div className={css.grid}>
        {cells.map((day, i) => (
          <div key={i} className={clsx(css.day, day === null && css.empty, day !== null && isToday(day) && css.todayCell)}>
            {day !== null && (
              <>
                <span className={css.dayNum}>{day}</span>
                <div className={css.events}>
                  {(events.get(day) ?? []).slice(0, 3).map((event, j) => (
                    <div key={j} className={css.event} title={`${event.date} ${event.title}`}>
                      {event.title || event.date}
                    </div>
                  ))}
                  {(events.get(day)?.length ?? 0) > 3 && (
                    /* v8 ignore next -- the guard above proves the day has events. */
                    <div className={css.more}>+{(events.get(day)?.length ?? 0) - 3}</div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
