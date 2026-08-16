/**
 * New-table modal: name input plus the template gallery (blank + six
 * presets). Creating from a card closes the modal and opens the new table.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HulutableRootProps } from './contract/slots.ts'
import { TEMPLATES, localizeTemplate } from './domain/templates.ts'
import { templateIcon } from './format.ts'
import css from './NewTableModal.module.css'

type Props = Pick<HulutableRootProps, 'controller' | 't'> & { onClose: () => void; lang: string }

/** Render the new-table modal. */
export function NewTableModal({ controller, t, onClose, lang }: Props) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
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

  const create = (templateId?: string): void => {
    // A template card names the new table after the template when the name
    // field is still empty (user can rename right after creation).
    const template = TEMPLATES.find(t => t.id === templateId)
    const localized = template === undefined ? undefined : localizeTemplate(template, lang)
    const finalName = name.trim() !== '' || localized === undefined ? name : localized.name
    controller.createTable(finalName, templateId, lang)
    onClose()
  }

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div ref={modalRef} className={css.modal} role="dialog" aria-modal="true" aria-label={t('modal.title')}>
        <div className={css.header}>
          <span className={css.title}>{t('modal.title')}</span>
          <button type="button" className={css.close} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className={css.body}>
          <label className={css.nameLabel} htmlFor="hulutable-new-name">{t('modal.name')}</label>
          <input
            id="hulutable-new-name"
            ref={inputRef}
            className={css.nameInput}
            value={name}
            placeholder={t('modal.blank')}
            onChange={(e) => { setName(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create() }
            }}
          />
          <div className={css.gallery}>
            <button type="button" className={css.card} onClick={() => { create() }}>
              <span className={css.cardIcon}>📄</span>
              <span className={css.cardName}>{t('modal.blank')}</span>
              <span className={css.cardDesc}>{t('modal.blank.desc')}</span>
            </button>
            {TEMPLATES.map((template) => {
              const localized = localizeTemplate(template, lang)
              return (
                <button
                  key={template.id}
                  type="button"
                  className={clsx(css.card, name.trim() !== '' && css.ready)}
                  onClick={() => {
                    // Reflect the template name in the name field so the user
                    // sees (and can adjust) the resulting table name.
                    if (name.trim() === '') setName(localized.name)
                    create(template.id)
                  }}
                >
                  <span className={css.cardIcon}>{templateIcon(template.id)}</span>
                  <span className={css.cardName}>{localized.name}</span>
                  <span className={css.cardDesc}>{localized.description}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className={css.footer}>
          <button type="button" className={css.primary} onClick={() => { create() }}>
            {t('modal.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
