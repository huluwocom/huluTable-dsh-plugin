/**
 * Import modal: file pick → parse preview (headers, type inference, first
 * rows) → new table or append to the current one → confirm. Excel and CSV
 * both flow through SheetJS.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HulutableController } from '../controller.ts'
import { buildImportColumns, parseImport, type ParsedImport } from '../io/io.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './ImportModal.module.css'

export interface ImportModalProps {
  tableName: string
  hasCurrentTable: boolean
  t: HulutableTranslate
  controller: HulutableController
  onClose: () => void
}

/** Render the import modal. */
export function ImportModal({ tableName, hasCurrentTable, t, controller, onClose }: ImportModalProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<'new' | 'append'>('new')
  const [tableNameDraft, setTableNameDraft] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Escape always closes this popover and never reaches the workspace
        // shell underneath (nested inputs never consume it at this level).
        e.stopPropagation()
        onClose()
      }
    }
    // Capture-phase: swallow Escape so it never reaches the workspace shell's own document listener.
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  const pick = (file: File | undefined): void => {
    if (file === undefined) return
    void file.arrayBuffer().then((buffer) => {
      try {
        setParsed(parseImport(buffer, file.name))
        setFileName(file.name)
        setTableNameDraft(file.name.replace(/\.(xlsx|xls|csv)$/i, ''))
      } catch {
        /* v8 ignore next -- SheetJS tolerates nearly all byte patterns; a
         * genuine throw is environment-dependent and un-drivable here. */
        setParsed(null)
      }
    })
  }

  const confirm = (): void => {
    /* v8 ignore next -- the confirm footer renders only after a file parsed, so the miss arm is unreachable. */
    if (parsed === null) return
    if (mode === 'new') {
      controller.importTable(tableNameDraft, parsed)
    } else {
      const current = controller.snapshot().currentTableId
      if (current !== null) controller.appendImport(current, parsed)
    }
    onClose()
  }

  const columns = parsed === null ? [] : buildImportColumns(parsed.headers, parsed.rows)

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div ref={ref} className={css.modal} role="dialog" aria-modal="true" aria-label={t('import.title')}>
        <div className={css.header}>
          <span className={css.title}>{t('import.title')}</span>
          <button type="button" className={css.close} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className={css.body}>
          {parsed === null ? (
            <label className={css.dropzone}>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => { pick(e.target.files?.[0]) }}
              />
              <span className={css.dropTitle}>{t('import.pick')}</span>
              <span className={css.dropHint}>{t('import.pickHint')}</span>
            </label>
          ) : (
            <>
              <div className={css.fileRow}>
                <span className={css.fileName}>{fileName}</span>
                <button
                  type="button"
                  className={css.repick}
                  onClick={() => { setParsed(null) }}
                >
                  {t('import.repick')}
                </button>
              </div>
              <div className={css.preview}>
                <table className={css.grid}>
                  <thead>
                    <tr>
                      {columns.map((column, c) => (
                        <th key={c}>
                          {column.name}
                          <span className={css.typeTag}>{t(`type.${column.type}`)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => <td key={c}>{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 5 && (
                  <div className={css.more}>… {t('import.more', { n: parsed.rows.length - 5 })}</div>
                )}
              </div>
              <div className={css.modeRow}>
                <label className={css.modeLabel}>
                  <input
                    type="radio"
                    checked={mode === 'new'}
                    onChange={() => { setMode('new') }}
                  />
                  {t('import.asNew')}
                </label>
                <label className={clsx(css.modeLabel, !hasCurrentTable && css.disabled)}>
                  <input
                    type="radio"
                    checked={mode === 'append'}
                    disabled={!hasCurrentTable}
                    onChange={() => { setMode('append') }}
                  />
                  {t('import.append')}（{tableName}）
                </label>
              </div>
              {mode === 'new' && (
                <input
                  className={css.nameInput}
                  value={tableNameDraft}
                  placeholder={t('modal.name')}
                  onChange={(e) => { setTableNameDraft(e.target.value) }}
                />
              )}
              <div className={css.footer}>
                <button type="button" className={css.cancel} onClick={onClose}>
                  {t('import.cancel')}
                </button>
                <button type="button" className={css.confirm} onClick={confirm}>
                  {t('import.confirm')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
