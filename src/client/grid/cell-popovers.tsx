/**
 * Cell-level popovers: edit history (hover, last 5 records per cell) and
 * comments (badge click: view + add/delete). Both are small fixed-position
 * panels reading from the controller.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController } from '../controller.ts'
import { commentKey, type CellHistoryEntry, type TableDoc } from '../domain/types.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './cell-popovers.module.css'

function useDismiss(onClose: () => void): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return ref
}

function formatStamp(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

function valueText(value: CellHistoryEntry['before']): string {
  if (value === null || value === '') return '（空）'
  return String(value)
}

export interface HistoryPopoverProps {
  entries: CellHistoryEntry[]
  x: number
  y: number
  t: HulutableTranslate
  onClose: () => void
}

/** Hover popover: the cell's recent edit history. */
export function HistoryPopover({ entries, x, y, t, onClose }: HistoryPopoverProps) {
  const ref = useDismiss(onClose)
  return (
    <div
      ref={ref}
      className={css.popover}
      style={{
        left: Math.min(x + 10, window.innerWidth - 240),
        top: Math.min(y + 10, window.innerHeight - 220),
      }}
    >
      <div className={css.title}>{t('history.title')}</div>
      {entries.length === 0 ? (
        <div className={css.empty}>{t('history.empty')}</div>
      ) : (
        entries.map((entry, i) => (
          <div key={i} className={css.entry}>
            <span className={css.stamp}>{formatStamp(entry.ts)}</span>
            <span className={css.diff}>
              <span className={css.before}>{valueText(entry.before)}</span>
              <span className={css.arrow}>→</span>
              <span className={css.after}>{valueText(entry.after)}</span>
            </span>
          </div>
        ))
      )}
    </div>
  )
}

export interface CommentPopoverProps {
  table: TableDoc
  rowId: string
  columnId: string
  x: number
  y: number
  t: HulutableTranslate
  controller: HulutableController
  onClose: () => void
}

/** Comment popover: view existing comments, add or delete. */
export function CommentPopover({ table, rowId, columnId, x, y, t, controller, onClose }: CommentPopoverProps) {
  const ref = useDismiss(onClose)
  const key = commentKey(rowId, columnId)
  const comments = table.comments[key] ?? []
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const save = (text: string, commentId?: string): void => {
    if (text.trim() === '') return
    if (commentId !== undefined) {
      controller.updateComment(table.id, rowId, columnId, commentId, text)
    } else {
      controller.setComment(table.id, rowId, columnId, text)
    }
  }

  return (
    <div
      ref={ref}
      className={css.popover}
      style={{
        left: Math.min(x, window.innerWidth - 260),
        top: Math.min(y, window.innerHeight - 280),
      }}
    >
      <div className={css.title}>{t('comment.title')}</div>
      {comments.length === 0 && <div className={css.empty}>{t('comment.empty')}</div>}
      {comments.map(comment => (
        <div key={comment.id} className={css.comment}>
          {editing === comment.id ? (
            <input
              className={css.input}
              value={editText}
              autoFocus
              onChange={(e) => { setEditText(e.target.value) }}
              onBlur={() => {
                save(editText, editing)
                setEditing(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { save(editText, editing); setEditing(null) }
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <span className={css.commentText}>{comment.text}</span>
          )}
          <span className={css.commentActions}>
            <button
              type="button"
              className={css.small}
              aria-label={t('comment.save')}
              onClick={() => {
                if (editing === comment.id) { save(editText, comment.id); setEditing(null) }
                else { setEditing(comment.id); setEditText(comment.text) }
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className={clsx(css.small, css.danger)}
              aria-label={t('comment.delete')}
              onClick={() => { controller.setComment(table.id, rowId, columnId, '') }}
            >
              ×
            </button>
          </span>
        </div>
      ))}
      <div className={css.addRow}>
        <input
          className={css.input}
          value={draft}
          placeholder="+"
          onChange={(e) => { setDraft(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() !== '') {
              save(draft)
              setDraft('')
            }
          }}
        />
      </div>
    </div>
  )
}
