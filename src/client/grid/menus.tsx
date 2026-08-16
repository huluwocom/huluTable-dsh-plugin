/**
 * Column and row context menus: fixed-position popovers with plain button
 * lists (no portal machinery — the workspace panel is a fixed overlay
 * already). Column menu: rename, type picker, insert/move/freeze/hide/
 * duplicate/delete. Row menu: insert/duplicate/clear/delete.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController } from '../controller.ts'
import { USER_COLUMN_TYPES, type ColumnType, type TableDoc } from '../domain/types.ts'
import { nextColumnName } from '../domain/editor-ops.ts'
import { ColumnSettingsPanel } from './ColumnSettingsPanel.tsx'
import css from './menus.module.css'

import type { HulutableTranslate as Translate } from '../locales.ts'

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

function MenuItem(props: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={clsx(css.item, props.danger === true && css.danger)}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

export interface ColumnMenuProps {
  table: TableDoc
  colIndex: number
  x: number
  y: number
  t: Translate
  controller: HulutableController
  onClose: () => void
}

/** Column header menu. */
export function ColumnMenu({ table, colIndex, x, y, t, controller, onClose }: ColumnMenuProps) {
  const ref = useDismiss(onClose)
  const column = table.columns[colIndex]
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(column?.name ?? '')
  const [pickingType, setPickingType] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  if (column === undefined) return null
  if (settingsOpen) {
    return (
      <ColumnSettingsPanel
        table={table}
        column={column}
        x={x}
        y={y}
        t={t}
        controller={controller}
        onClose={onClose}
      />
    )
  }

  const commitRename = (): void => {
    if (name.trim() !== '' && name.trim() !== column.name) {
      controller.updateColumn(table.id, column.id, { name: name.trim() })
    }
    setRenaming(false)
  }

  return (
    <div ref={ref} className={css.menu} style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 420) }}>
      {renaming ? (
        <div className={css.renameBox}>
          <input
            className={css.renameInput}
            value={name}
            autoFocus
            onChange={(e) => { setName(e.target.value) }}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setName(column.name); setRenaming(false) }
            }}
          />
        </div>
      ) : (
        <>
          <MenuItem label={t('col.rename')} onClick={() => { setName(column.name); setRenaming(true) }} />
          <MenuItem label={t('col.settings')} onClick={() => { setSettingsOpen(true) }} />
          <div className={css.sep} />
          <MenuItem
            label={t('col.type')}
            onClick={() => { setPickingType(v => !v) }}
          />
          {pickingType && (
            <div className={css.typeGrid}>
              {USER_COLUMN_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  className={clsx(css.typeCell, type === column.type && css.typeActive)}
                  onClick={() => {
                    if (type !== column.type) controller.updateColumn(table.id, column.id, { type })
                    setPickingType(false)
                  }}
                >
                  {t(`type.${type}`)}
                </button>
              ))}
            </div>
          )}
          <div className={css.sep} />
          <div className={css.sep} />
          <MenuItem label={t('col.copy')} onClick={() => { controller.copyColumn(table.id, colIndex); onClose() }} />
          <MenuItem label={t('col.cut')} onClick={() => { controller.cutColumn(table.id, colIndex); onClose() }} />
          <MenuItem label={t('col.paste')} onClick={() => { controller.pasteColumn(table.id, colIndex); onClose() }} />
          <div className={css.sep} />
          <MenuItem label={t('col.insertLeft')} onClick={() => { controller.addColumn(table.id, colIndex); onClose() }} />
          <MenuItem label={t('col.insertRight')} onClick={() => { controller.addColumn(table.id, colIndex + 1); onClose() }} />
          <MenuItem label={t('col.moveLeft')} onClick={() => { controller.moveColumn(table.id, column.id, colIndex - 1); onClose() }} />
          <MenuItem label={t('col.moveRight')} onClick={() => { controller.moveColumn(table.id, column.id, colIndex + 1); onClose() }} />
          <div className={css.sep} />
          <MenuItem
            label={column.frozen ? t('col.unfreeze') : t('col.freeze')}
            onClick={() => { controller.updateColumn(table.id, column.id, { frozen: !column.frozen }); onClose() }}
          />
          <MenuItem label={t('col.hide')} onClick={() => { controller.updateColumn(table.id, column.id, { hidden: true }); onClose() }} />
          <MenuItem
            label={t('col.duplicate')}
            onClick={() => { controller.duplicateColumn(table.id, colIndex); onClose() }}
          />
          <div className={css.sep} />
          <MenuItem label={t('col.delete')} danger onClick={() => { controller.removeColumn(table.id, colIndex); onClose() }} />
        </>
      )}
    </div>
  )
}

export interface RowMenuProps {
  table: TableDoc
  rowIndex: number
  x: number
  y: number
  t: Translate
  controller: HulutableController
  onClose: () => void
}

/** Row-number context menu. */
export function RowMenu({ table, rowIndex, x, y, t, controller, onClose }: RowMenuProps) {
  const ref = useDismiss(onClose)
  const row = table.rows[rowIndex]
  if (row === undefined) return null

  return (
    <div ref={ref} className={css.menu} style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 220) }}>
      <div className={css.sep} />
      <MenuItem label={t('row.copy')} onClick={() => { controller.copyRows(table.id, [rowIndex]); onClose() }} />
      <MenuItem label={t('row.cut')} onClick={() => { controller.cutRows(table.id, [rowIndex]); onClose() }} />
      <MenuItem label={t('row.paste')} onClick={() => { controller.pasteRows(table.id, rowIndex + 1); onClose() }} />
      <div className={css.sep} />
      <MenuItem label={t('row.insertAbove')} onClick={() => { controller.addRows(table.id, rowIndex); onClose() }} />
      <MenuItem label={t('row.insertBelow')} onClick={() => { controller.addRows(table.id, rowIndex + 1); onClose() }} />
      <MenuItem
        label={t('row.duplicate')}
        onClick={() => { controller.duplicateRow(table.id, rowIndex); onClose() }}
      />
      <MenuItem
        label={t('row.clear')}
        onClick={() => {
          controller.clear(table.id, rowIndex, rowIndex, table.columns)
          onClose()
        }}
      />
      <div className={css.sep} />
      <MenuItem label={t('row.delete')} danger onClick={() => { controller.removeRows(table.id, [rowIndex]); onClose() }} />
    </div>
  )
}

export { nextColumnName }
export type { ColumnType }
