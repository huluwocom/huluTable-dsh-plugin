/**
 * Dropdown option picker: click-to-set for select columns, checkbox toggle
 * for multiSelect columns, plus an optional custom-value input. Set values go
 * through the controller (undoable).
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController } from '../controller.ts'
import type { Column, Row } from '../domain/types.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './popovers.module.css'

export interface OptionPickerProps {
  table: { id: string }
  column: Column
  rowData: Row | undefined
  x: number
  y: number
  t: HulutableTranslate
  controller: HulutableController
  onClose: () => void
}

/** Render the dropdown option picker for one cell. */
export function OptionPicker({ table, column, rowData, x, y, t, controller, onClose }: OptionPickerProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const current = rowData?.cells[column.id]?.value
  const isMulti = column.type === 'multiSelect'
  const currentList: string[] = isMulti && Array.isArray(current)
    ? current
    : current !== null && current !== undefined && current !== '' ? [String(current)] : []
  const [custom, setCustom] = useState('')

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

  if (rowData === undefined) return null

  const setValue = (label: string): void => {
    if (isMulti) {
      const next = currentList.includes(label)
        ? currentList.filter(v => v !== label)
        : [...currentList, label]
      controller.setCellValue(table.id, rowData.id, column.id, next.length === 0 ? null : next)
    } else {
      controller.setCellValue(table.id, rowData.id, column.id, label)
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      className={css.popover}
      style={{
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 320),
      }}
    >
      <div className={css.title}>{column.name}</div>
      <div className={css.optionList}>
        {(column.options ?? []).map(option => (
          <button
            key={option.id}
            type="button"
            className={clsx(css.optionRow, css.optionButton, currentList.includes(option.label) && css.checked)}
            onClick={() => { setValue(option.label) }}
          >
            <span className={css.chip} style={option.color !== '' ? { background: `${option.color}44` } : undefined}>
              {option.label}
            </span>
            {currentList.includes(option.label) && <span className={css.checkMark}>✓</span>}
          </button>
        ))}
      </div>
      {(column.linked?.allowCustom ?? false) && (
        <div className={css.customRow}>
          <input
            className={css.valueInput}
            value={custom}
            placeholder={t('picker.custom')}
            onChange={(e) => { setCustom(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim() !== '') {
                setValue(custom.trim())
                setCustom('')
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
