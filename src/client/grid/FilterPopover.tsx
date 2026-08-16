/**
 * Column filter popover: operator picker, value inputs, apply/clear. The
 * rule lands in the ACTIVE VIEW's filters (controller.updateView).
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController } from '../controller.ts'
import { opsForColumn } from '../domain/query.ts'
import type { Column, TableDoc, View } from '../domain/types.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './popovers.module.css'

export interface FilterPopoverProps {
  table: TableDoc
  column: Column
  view: View
  x: number
  y: number
  t: HulutableTranslate
  controller: HulutableController
  onClose: () => void
}

/** Render the filter popover for one column. */
export function FilterPopover({ table, column, view, x, y, t, controller, onClose }: FilterPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const existing = view.filters.find(f => f.columnId === column.id)
  const [op, setOp] = useState(existing?.op ?? (column.type === 'select' || column.type === 'multiSelect' ? 'in' : 'contains'))
  const [value, setValue] = useState(existing !== undefined && existing.value !== undefined && existing.value !== null ? String(existing.value) : '')
  const [value2, setValue2] = useState(existing !== undefined && existing.value2 !== undefined && existing.value2 !== null ? String(existing.value2) : '')
  const [values, setValues] = useState<string[]>(existing?.values ?? [])

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

  const ops = opsForColumn(column.type)
  const isSelect = column.type === 'select' || column.type === 'multiSelect'

  const apply = (): void => {
    const rule: View['filters'][number] = { columnId: column.id, op }
    if (op === 'in') {
      rule.values = values
    } else if (op === 'between') {
      rule.value = value
      rule.value2 = value2
    } else if (op !== 'empty' && op !== 'notEmpty') {
      rule.value = value
    }
    const rest = view.filters.filter(f => f.columnId !== column.id)
    const noValue = op !== 'empty' && op !== 'notEmpty' && op !== 'in' && value === ''
    const noSelection = op === 'in' && values.length === 0
    if (!noValue && !noSelection) {
      controller.updateView(table.id, view.id, { filters: [...rest, rule] })
    } else {
      controller.updateView(table.id, view.id, { filters: rest })
    }
    onClose()
  }

  const clear = (): void => {
    controller.updateView(table.id, view.id, { filters: view.filters.filter(f => f.columnId !== column.id) })
    onClose()
  }

  return (
    <div ref={ref} className={css.popover} data-testid="filter-popover" style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 300) }}>
      <div className={css.title}>{column.name}</div>
      <select className={css.select} aria-label={t('filter.op')} value={op} onChange={(e) => { setOp(e.target.value as typeof op) }}>
        {ops.map(o => <option key={o} value={o}>{t(`filter.op.${o}`)}</option>)}
      </select>
      {isSelect ? (
        <div className={css.optionList}>
          {(column.options ?? []).map((option) => {
            const checked = values.includes(option.label)
            return (
              <label key={option.id} className={css.optionRow}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setValues(checked ? values.filter(v => v !== option.label) : [...values, option.label])
                  }}
                />
                <span className={css.chip} style={option.color !== '' ? { background: `${option.color}44` } : undefined}>
                  {option.label}
                </span>
              </label>
            )
          })}
        </div>
      ) : (
        <div className={css.valueRow}>
          <input
            className={css.valueInput}
            value={value}
            placeholder={op === 'between' ? t('filter.min') : t('filter.value')}
            onChange={(e) => { setValue(e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter') apply() }}
          />
          {op === 'between' && (
            <input
              className={css.valueInput}
              value={value2}
              placeholder={t('filter.max')}
              onChange={(e) => { setValue2(e.target.value) }}
              onKeyDown={(e) => { if (e.key === 'Enter') apply() }}
            />
          )}
        </div>
      )}
      <div className={css.actions}>
        <button type="button" className={css.clearButton} onClick={clear}>
          {t('filter.clear')}
        </button>
        <button type="button" className={css.applyButton} onClick={apply}>
          {t('filter.apply')}
        </button>
      </div>
    </div>
  )
}

export { clsx }
