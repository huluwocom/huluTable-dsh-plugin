/**
 * huluTable workspace trigger and panel shell: the sidebar-foot action row
 * plus the full-viewport workspace overlay. The trigger renders against the
 * column state (wide row vs rail icon); the panel hosts the table library
 * and (from P2 on) the table editor. Panel open state is component-local;
 * all workspace data arrives through the injected controller face.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutline14, IconCloseOutline16, IconDataOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HulutableRootProps } from './contract/slots.ts'
import { TableEditor } from './editor/TableEditor.tsx'
import { TableLibrary } from './TableLibrary.tsx'
import css from './HulutableRoot.module.css'

/**
 * Render the workspace trigger and panel.
 * @param props - composed slot props (owner share + locale + injected face).
 * @returns the trigger row plus the (conditional) workspace overlay.
 */
export function HulutableRoot({ wide, t, controller, useWorkspace, locale }: HulutableRootProps) {
  const [open, setOpen] = useState(false)
  const ready = useWorkspace(s => s.ready)
  const currentTableId = useWorkspace(s => s.currentTableId)
  // Live locale snapshot (zh/en switch rides the global locale runtime).
  const localeSnapshot = useSyncExternalStore(
    cb => locale.subscribe(cb),
    () => locale.getSnapshot(),
  )

  // Panel-scoped Escape dismissal; the listener lives only while open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  // Baseline focus management: entering the workspace lands on the close button.
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (open) closeButton.current?.focus()
  }, [open])

  const closeWorkspace = (): void => { setOpen(false) }
  const backToLibrary = (): void => {
    controller.setBinOpen(false)
    controller.update((d) => { d.currentTableId = null })
  }

  return (
    <>
      <Tooltip label={t('action.label.long')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={clsx(css.trigger, !wide && css.rail)}
          aria-label={wide ? t('action.label') : t('action.label.long')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(true) }}
        >
          <IconDataOutline16 size={wide ? 14 : 18} />
          {wide && <span className={css.triggerLabel}>{t('action.label')}</span>}
        </button>
      </Tooltip>
      {open && (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={closeWorkspace} />
          <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('panel.title')}>
            <div className={css.header}>
              <div className={css.titleRow}>
                {currentTableId !== null && (
                  <button
                    type="button"
                    className={css.backButton}
                    aria-label={t('library.back')}
                    title={t('library.back')}
                    onClick={backToLibrary}
                  >
                    <IconChevronLeftOutline14 size={14} />
                  </button>
                )}
                <IconDataOutline16 size={16} />
                <span>{t('panel.title')}</span>
                <div className={css.langSwitch} role="group" aria-label={t('panel.close')}>
                  <button
                    type="button"
                    className={clsx(css.langSegment, localeSnapshot.active === 'zh' && css.langSegmentActive)}
                    aria-label="中文"
                    onClick={() => { locale.setLocale('zh') }}
                  >
                    中
                  </button>
                  <button
                    type="button"
                    className={clsx(css.langSegment, localeSnapshot.active === 'en' && css.langSegmentActive)}
                    aria-label="English"
                    onClick={() => { locale.setLocale('en') }}
                  >
                    EN
                  </button>
                </div>
              </div>
              <button ref={closeButton} type="button" className={css.close} onClick={closeWorkspace}>
                <IconCloseOutline16 size={14} />
              </button>
            </div>
            <div className={css.body}>
              {!ready ? (
                <div className={css.placeholder}>
                  <div className={css.placeholderBody}>{t('loading')}</div>
                </div>
              ) : currentTableId !== null ? (
                <TableEditor controller={controller} useWorkspace={useWorkspace} t={t} />
              ) : (
                <TableLibrary controller={controller} useWorkspace={useWorkspace} t={t} lang={localeSnapshot.active} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
