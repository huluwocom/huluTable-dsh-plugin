/**
 * Table library: the workspace home. Search, tag filter, and the table row
 * list with star/rename/duplicate/delete actions, plus the new-table modal
 * (blank or from template) and the recycle-bin view. Pure presentation —
 * every fact arrives through props; mutations go through the controller.
 */
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  IconCheckOutline16, IconCopyOutline16, IconEditOutline16, IconPlusOutline16,
  IconSearchOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HulutableRootProps } from './contract/slots.ts'
import type { LibraryRow } from './domain/types.ts'
import { formatRelative, templateIcon } from './format.ts'
import { NewTableModal } from './NewTableModal.tsx'
import css from './TableLibrary.module.css'

type Props = Pick<HulutableRootProps, 'controller' | 'useWorkspace' | 't'> & { lang: string }

/** One library row: star, inline rename, template badge, tags, counts, actions. */
function LibraryRowView(props: {
  row: LibraryRow
  t: Props['t']
  controller: Props['controller']
  onOpen: () => void
}) {
  const { row, t, controller, onOpen } = props
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(row.name)

  const commitRename = (): void => {
    setRenaming(false)
    if (draft.trim() !== '' && draft.trim() !== row.name) {
      void controller.ensureLoaded(row.id).then(() => { controller.renameTable(row.id, draft) })
    }
  }

  return (
    <div
      className={css.row}
      role="button"
      tabIndex={0}
      aria-label={row.name}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      <div className={css.rowMain}>
        <span className={css.rowIcon}>{templateIcon(row.templateId)}</span>
        <div className={css.rowText}>
          <div className={css.rowTitleLine}>
            {renaming ? (
              <input
                className={css.renameInput}
                value={draft}
                autoFocus
                onChange={(e) => { setDraft(e.target.value) }}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setDraft(row.name); setRenaming(false) }
                }}
                onClick={(e) => { e.stopPropagation() }}
              />
            ) : (
              <span className={css.rowTitle}>{row.name}</span>
            )}
            {row.templateId !== undefined && (
              <span className={css.templateBadge}>{t('library.template.badge')}</span>
            )}
            {row.tags.map(tag => (
              <span key={tag} className={css.tag}>{tag}</span>
            ))}
          </div>
          <div className={css.rowMeta}>
            {t('library.rows', { rows: row.rowCount, cols: row.colCount })}
            {' · '}
            {t('library.updated', { time: formatRelative(row.updatedAt, t) })}
          </div>
        </div>
      </div>
      <div className={css.rowActions}>
        <button
          type="button"
          className={clsx(css.iconButton, row.starred && css.starred)}
          aria-label={row.starred ? '★' : '☆'}
          title={row.starred ? '★' : '☆'}
          onClick={(e) => { e.stopPropagation(); void controller.ensureLoaded(row.id).then(() => { controller.toggleStar(row.id) }) }}
        >
          <span className={css.star}>{row.starred ? '★' : '☆'}</span>
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('library.rename')}
          title={t('library.rename')}
          onClick={(e) => {
            e.stopPropagation()
            setDraft(row.name)
            setRenaming(true)
          }}
        >
          <IconEditOutline16 size={14} />
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('library.duplicate')}
          title={t('library.duplicate')}
          onClick={(e) => {
            e.stopPropagation()
            void controller.ensureLoaded(row.id).then(() => { controller.duplicateTable(row.id) })
          }}
        >
          <IconCopyOutline16 size={14} />
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('library.delete')}
          title={t('library.delete')}
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(t('library.delete.confirm', { name: row.name }))) {
              void controller.ensureLoaded(row.id).then(() => { controller.moveToBin(row.id) })
            }
          }}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * Render the library surface.
 * @param props - controller + workspace hook + locale.
 * @returns the library tree (list, modal, or bin view).
 */
export function TableLibrary(props: Props) {
  const { controller, useWorkspace, t, lang } = props
  const library = useWorkspace(s => s.library)
  const bin = useWorkspace(s => s.bin)
  const binOpen = useWorkspace(s => s.binOpen)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return library
    return library.filter(row => row.name.toLowerCase().includes(q))
  }, [library, search])

  return (
    <div className={css.library}>
      <div className={css.toolbar}>
        <div className={css.toolbarLeft}>
          <span className={css.title}>{t('library.title')}</span>
          <span className={css.count}>{library.length}</span>
        </div>
        <div className={css.toolbarRight}>
          <div className={css.searchBox}>
            <IconSearchOutline16 size={14} />
            <input
              className={css.searchInput}
              value={search}
              placeholder={t('library.search')}
              onChange={(e) => { setSearch(e.target.value) }}
            />
          </div>
          <button
            type="button"
            className={css.binButton}
            title={t('library.backup')}
            onClick={() => {
              // Full JSON backup of every table (data + structure + config).
              const blob = new Blob([controller.exportBackup()], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `hulutable-backup-${new Date().toISOString().slice(0, 10)}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            ⬇
            {t('library.backup')}
          </button>
          <label className={css.binButton}>
            ⬆ {t('library.backupRestore')}
            <input
              type="file"
              accept="application/json,.json"
              className={css.hiddenFile}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file === undefined) return
                void file.text().then((text) => {
                  const count = controller.importBackup(text)
                  window.alert(count > 0
                    ? t('library.backupRestore.ok', { count })
                    : t('library.backupRestore.fail'))
                })
              }}
            />
          </label>
          <button
            type="button"
            className={clsx(css.binButton, binOpen && css.active)}
            onClick={() => { controller.setBinOpen(!binOpen) }}
          >
            <IconTrashOutline16 size={14} />
            {t('library.bin.count', { count: bin.length })}
          </button>
          <button type="button" className={css.newButton} onClick={() => { setModalOpen(true) }}>
            <IconPlusOutline16 size={14} />
            {t('library.new')}
          </button>
        </div>
      </div>

      <div className={css.list}>
        {binOpen ? (
          bin.length === 0 ? (
            <div className={css.empty}>
              <div className={css.emptyTitle}>{t('library.bin.empty')}</div>
              <div className={css.emptyBody}>{t('library.bin.empty.body')}</div>
            </div>
          ) : (
            bin.map(row => (
              <div key={row.id} className={css.row}>
                <div className={css.rowMain}>
                  <span className={css.rowIcon}>{templateIcon(row.templateId)}</span>
                  <div className={css.rowText}>
                    <div className={css.rowTitleLine}>
                      <span className={css.rowTitle}>{row.name}</span>
                    </div>
                    <div className={css.rowMeta}>
                      {t('library.updated', { time: formatRelative(row.deletedAt ?? row.updatedAt, t) })}
                    </div>
                  </div>
                </div>
                <div className={css.rowActions}>
                  <button
                    type="button"
                    className={css.actionButton}
                    onClick={() => {
                      void controller.ensureLoaded(row.id).then(() => { controller.restoreTable(row.id) })
                    }}
                  >
                    <IconCheckOutline16 size={14} />
                    {t('library.backupRestore')}
                  </button>
                  <button
                    type="button"
                    className={clsx(css.actionButton, css.danger)}
                    onClick={() => {
                      if (window.confirm(t('library.purge.confirm', { name: row.name }))) {
                        // Purging works without a loaded doc (idempotent store removal).
                        controller.purgeTable(row.id)
                      }
                    }}
                  >
                    <IconTrashOutline16 size={14} />
                    {t('library.purge')}
                  </button>
                </div>
              </div>
            ))
          )
        ) : rows.length === 0 ? (
          <div className={css.empty}>
            <div className={css.emptyTitle}>
              {search.trim() === '' ? t('library.empty.title') : t('library.empty.search')}
            </div>
            <div className={css.emptyBody}>{t('library.empty.body')}</div>
          </div>
        ) : (
          rows.map(row => (
            <LibraryRowView
              key={row.id}
              row={row}
              t={t}
              controller={controller}
              onOpen={() => { void controller.openTable(row.id) }}
            />
          ))
        )}
      </div>

      {modalOpen && (
        <NewTableModal
          t={t}
          controller={controller}
          lang={lang}
          onClose={() => { setModalOpen(false) }}
        />
      )}
    </div>
  )
}
