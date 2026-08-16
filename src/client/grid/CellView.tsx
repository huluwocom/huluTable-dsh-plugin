/**
 * Memoized cell view: renders one cell by column type (text, numeric,
 * dropdown chip with color, checkbox, rating, progress, timestamps). Props
 * are primitive/stable references (immer keeps cell/column identity stable
 * until edited), so React.memo skips untouched cells on every grid scroll.
 */
import { memo } from 'react'
import clsx from 'clsx'
import type { Cell, Column } from '../domain/types.ts'
import { cellText, optionColor } from './geometry.ts'
import css from './Grid.module.css'

export interface CellViewProps {
  column: Column
  cell: Cell | undefined
  selected: boolean
  width: number
  /** true while another cell in the same row is being edited (row highlight). */
  rowActive: boolean
  /** rendered inside the sticky frozen strip. */
  frozen?: boolean
  /** absolute x offset for virtualized (non-frozen) columns; frozen cells
   * flow inside their sticky strip instead. */
  left?: number
  /** conditional-formatting background tint. */
  bg?: string | undefined
  /** cell carries at least one comment (corner badge). */
  hasComment?: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  /** single click (no drag) — used to open the dropdown picker. */
  onSingleClick?: () => void
  /** comment badge click. */
  onComment?: (e: React.MouseEvent) => void
  /** hover entry (history popover anchor). */
  onHover?: (e: React.MouseEvent) => void
}

function formatTime(value: number): string {
  const d = new Date(value)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`
}

function renderBody(props: CellViewProps) {
  const { column, cell } = props
  const value = cell?.value ?? null
  switch (column.type) {
    case 'checkbox':
      return (
        <span className={clsx(css.check, value === true && css.checkOn)}>
          {value === true ? '✓' : ''}
        </span>
      )
    case 'rating': {
      // Empty rating cells stay blank (no dim placeholder stars).
      if (typeof value !== 'number') return null
      const n = value
      const stars = Math.max(0, Math.min(5, Math.round(n)))
      return (
        <span className={css.rating} aria-label={`${n}★`}>
          {'★'.repeat(stars)}
          <span className={css.ratingDim}>{'★'.repeat(5 - stars)}</span>
        </span>
      )
    }
    case 'progress': {
      // Empty progress cells stay blank (no 0% bar).
      if (typeof value !== 'number') return null
      const n = value
      return (
        <span className={css.progress}>
          <span className={css.progressFill} style={{ width: `${Math.max(0, Math.min(100, n))}%` }} />
          <span className={css.progressLabel}>{`${Math.round(n)}%`}</span>
        </span>
      )
    }
    case 'select': {
      // Empty dropdown cells stay blank (no tinted chip).
      if (value === null || value === '') return null
      const color = optionColor(column, value)
      return (
        <span className={css.chip} style={color !== '' ? { background: `${color}44` } : undefined}>
          {cellText(column, value)}
        </span>
      )
    }
    case 'multiSelect': {
      const labels: string[] = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string')
        : value !== null && value !== '' ? [String(value)] : []
      if (labels.length === 0) return null
      return (
        <span className={css.chips}>
          {labels.map((label) => {
            const color = optionColor(column, label)
            return (
              <span
                key={label}
                className={css.chip}
                style={color !== '' ? { background: `${color}44` } : undefined}
              >
                {label}
              </span>
            )
          })}
        </span>
      )
    }
    case 'createdAt':
    case 'updatedAt':
      return <span className={css.time}>{typeof value === 'number' ? formatTime(value) : ''}</span>
    case 'currency':
    case 'percent':
    case 'number':
      return <span className={css.num}>{cellText(column, value)}</span>
    case 'url':
      return value !== null && value !== '' && typeof value === 'string'
        ? <a className={css.link} href={value} target="_blank" rel="noreferrer">{value}</a>
        : null
    default:
      return <span className={css.text}>{cellText(column, value)}</span>
  }
}

/** One grid cell. */
export const CellView = memo(function CellView(props: CellViewProps) {
  const {
    column, selected, width, left, onMouseDown, onDoubleClick, rowActive,
    frozen, bg, onSingleClick, hasComment, onComment, onHover,
  } = props
  return (
    <div
      className={clsx(
        css.cell,
        column.type === 'textarea' && css.wrap,
        column.type === 'number' || column.type === 'percent' || column.type === 'currency' ? css.numCell : undefined,
        selected && css.selected,
        rowActive && css.rowActive,
        frozen === true && css.cellFrozen,
      )}
      style={{ width, left, ...(bg !== undefined ? { background: bg } : {}) }}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onClick={() => { onSingleClick?.() }}
      onMouseEnter={(e) => { onHover?.(e) }}
    >
      {renderBody(props)}
      {hasComment === true && (
        <button
          type="button"
          className={css.commentBadge}
          aria-label="comment"
          onMouseDown={(e) => { e.stopPropagation() }}
          onClick={(e) => {
            e.stopPropagation()
            onComment?.(e)
          }}
        >
          📌
        </button>
      )}
    </div>
  )
}, (a, b) => a.cell === b.cell && a.column === b.column && a.selected === b.selected
  && a.width === b.width && a.left === b.left && a.rowActive === b.rowActive && a.frozen === b.frozen
  && a.bg === b.bg && a.hasComment === b.hasComment)
