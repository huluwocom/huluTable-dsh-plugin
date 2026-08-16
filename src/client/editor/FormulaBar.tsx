/**
 * Formula bar (fx): shows the selected cell's address and content; typing
 * '=' starts a formula, Enter commits (formulas evaluate through the
 * controller). The ∑ button auto-sums the selection (a full =SUM(range) per
 * numeric column lands one row below the selection); the template menu
 * inserts COMPLETE formulas with the range inferred from the selection, so
 * users never hand-write references.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController, CellSelection } from '../controller.ts'
import { isNumericType, type TableDoc } from '../domain/types.ts'
import { columnLetter } from '../domain/formula.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './FormulaBar.module.css'

export interface FormulaBarProps {
  table: TableDoc
  selection: CellSelection | null
  t: HulutableTranslate
  controller: HulutableController
}

interface FormulaTemplate {
  label: string
  text: string
}

/**
 * Build the template list. Range templates anchor on the current selection
 * (or the focused column's data extent) so the inserted formula is complete
 * and immediately committable.
 */
export function buildTemplates(
  selection: CellSelection | null,
  table: TableDoc,
  focus: { col: number; row: number },
): FormulaTemplate[] {
  let range: string
  if (selection !== null) {
    range = `${columnLetter(selection.c0)}${selection.r0 + 1}:${columnLetter(selection.c1)}${selection.r1 + 1}`
  } else {
    const letter = columnLetter(focus.col)
    range = `${letter}1:${letter}${Math.max(1, table.rows.length)}`
  }
  const cell = `${columnLetter(focus.col)}${focus.row + 1}`
  return [
    { label: 'SUM', text: `=SUM(${range})` },
    { label: 'AVERAGE', text: `=AVERAGE(${range})` },
    { label: 'MAX', text: `=MAX(${range})` },
    { label: 'MIN', text: `=MIN(${range})` },
    { label: 'COUNT', text: `=COUNT(${range})` },
    { label: 'IF', text: '=IF(B2>0,"是","否")' },
    { label: 'CONCAT', text: `=CONCAT(${range})` },
    { label: 'ROUND', text: `=ROUND(${cell}, 2)` },
    { label: 'TODAY', text: '=TODAY()' },
    { label: 'DATE', text: '=DATE(2025, 8, 1)' },
  ]
}

/**
 * Auto-sum: append (or write) =SUM(column range) cells one row below the
 * selection for every numeric column inside it. Returns the target row index
 * or -1 when the selection has no numeric column.
 */
export function autoSum(
  controller: HulutableController,
  table: TableDoc,
  selection: CellSelection,
): number {
  const cols = table.columns
    .slice(selection.c0, selection.c1 + 1)
    .filter(c => isNumericType(c.type))
  if (cols.length === 0) return -1
  const targetRow = selection.r1 + 1
  if (targetRow >= table.rows.length) {
    controller.addRows(table.id, table.rows.length, targetRow - table.rows.length + 1)
  }
  // addRows updated the snapshot synchronously; re-read for the new row id.
  const after = controller.snapshot().tables[table.id]
  const targetRowId = after?.rows[targetRow]?.id
  /* v8 ignore next -- addRows just guaranteed the target row exists. */
  if (targetRowId === undefined) return -1
  for (const column of cols) {
    const c = table.columns.indexOf(column)
    const letter = columnLetter(c)
    controller.setFormula(table.id, targetRowId, column.id, `=SUM(${letter}${selection.r0 + 1}:${letter}${selection.r1 + 1})`)
  }
  return targetRow
}

/** Render the fx bar. */
export function FormulaBar({ table, selection, t, controller }: FormulaBarProps) {
  const [text, setText] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [summed, setSummed] = useState(false)
  const templatesRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const anchor = selection === null ? null : {
    row: selection.r0,
    col: selection.c0,
    rowId: table.rows[selection.r0]?.id,
    columnId: table.columns[selection.c0]?.id,
  }
  const cell = anchor === null ? undefined
    : anchor.rowId !== undefined && anchor.columnId !== undefined
      ? table.rows[anchor.row]?.cells[anchor.columnId]
      : undefined

  // Sync the fx input with the selection (but not while the user is typing).
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (dirty) return
    if (cell === undefined) { setText(''); return }
    setText(cell.formula ?? (cell.value === null ? '' : String(cell.value)))
  }, [cell, dirty])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (templatesRef.current !== null && !templatesRef.current.contains(e.target as Node)) {
        setTemplatesOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [])

  if (anchor === null || anchor.rowId === undefined || anchor.columnId === undefined) {
    return (
      <div className={css.bar}>
        <span className={css.address}>—</span>
        <span className={css.hint}>{t('fx.hint')}</span>
      </div>
    )
  }

  // The render guard above already proved both anchor parts defined.
  const { rowId, columnId } = anchor
  const commit = (): void => {
    setDirty(false)
    controller.setCellRaw(table.id, rowId, columnId, text)
    inputRef.current?.blur()
  }

  // The anchor guard above proves selection non-null here.
  /* v8 ignore next -- selection is non-null past the anchor guard. */
  const c0 = selection?.c0 ?? 0
  /* v8 ignore next -- selection is non-null past the anchor guard. */
  const c1 = selection?.c1 ?? 0
  const hasNumeric = table.columns
    .slice(c0, c1 + 1)
    .some(c => isNumericType(c.type))

  const runAutoSum = (): void => {
    /* v8 ignore next -- the ∑ button renders only with a selection. */
    if (selection === null) return
    /* v8 ignore next -- the button is disabled without numeric columns. */
    if (!hasNumeric) return
    const row = autoSum(controller, table, selection)
    setSummed(row >= 0)
    /* v8 ignore next -- autoSum only fails when the selection lacks numeric columns. */
    if (row >= 0) {
      setDirty(false)
      // Move the selection to the summary row so the fx bar reflects it.
      controller.select({
        r0: row, r1: row, c0: selection.c0, c1: Math.min(selection.c1, table.columns.length - 1),
      })
    }
  }

  const templates = buildTemplates(selection, table, { col: anchor.col, row: anchor.row })

  return (
    <div className={css.bar}>
      <span className={css.address}>{columnLetter(anchor.col)}{anchor.row + 1}</span>
      <span className={css.fxMark}>fx</span>
      <input
        ref={inputRef}
        className={css.input}
        value={text}
        onChange={(e) => { setDirty(true); setText(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDirty(false); setText(cell?.formula ?? String(cell?.value ?? '')) }
        }}
      />
      <button
        type="button"
        className={css.sumButton}
        title={t('fx.autosum')}
        aria-label={t('fx.autosum')}
        disabled={!hasNumeric}
        onClick={runAutoSum}
      >
        ∑
      </button>
      <div className={css.templates} ref={templatesRef}>
        <button
          type="button"
          className={css.templateButton}
          onClick={() => { setTemplatesOpen(v => !v) }}
        >
          {t('fx.templates')}
        </button>
        {templatesOpen && (
          <div className={css.templateMenu}>
            {templates.map(template => (
              <button
                key={template.label}
                type="button"
                className={css.templateItem}
                onClick={() => {
                  setDirty(true)
                  setText(template.text)
                  setTemplatesOpen(false)
                  inputRef.current?.focus()
                }}
              >
                <span className={css.templateLabel}>{template.label}</span>
                <code className={css.templateText}>{template.text}</code>
              </button>
            ))}
          </div>
        )}
      </div>
      {summed && <span className={css.summed}>✓</span>}
    </div>
  )
}

export { clsx }
