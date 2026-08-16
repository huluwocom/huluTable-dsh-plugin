/**
 * Column settings panel: the rich configuration surface for one column —
 * name/type/width/required/freeze/hidden/description/default, the format
 * validators (phone/email/url/number/length/regex), the dropdown option
 * editor with per-option colors, and cascading (linked) dropdown config in
 * map or source modes. Every control applies live through the controller.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { HulutableController } from '../controller.ts'
import {
  USER_COLUMN_TYPES, newId, type Column, type ColumnValidation, type LinkedSelect, type TableDoc,
} from '../domain/types.ts'
import type { HulutableTranslate } from '../locales.ts'
import css from './ColumnSettingsPanel.module.css'

export interface ColumnSettingsPanelProps {
  table: TableDoc
  column: Column
  x: number
  y: number
  t: HulutableTranslate
  controller: HulutableController
  onClose: () => void
}

const VALIDATION_KINDS = ['none', 'phone', 'email', 'url', 'number', 'integer', 'numberRange', 'lengthRange', 'regex'] as const

/** Render the column settings panel. */
export function ColumnSettingsPanel({ table, column, x, y, t, controller, onClose }: ColumnSettingsPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState<Column>(() => structuredClone(column))

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

  // Live-apply: every edit goes straight to the table (undoable). The
  // explicit-undefined form lets cleared fields read as deletions upstream.
  const apply = (patch: { [K in keyof Column]?: Column[K] | undefined }): void => {
    setDraft((d) => {
      const next = { ...d, ...patch }
      for (const key of Object.keys(next) as (keyof Column)[]) {
        if (next[key] === undefined) Reflect.deleteProperty(next, key)
      }
      return next as Column
    })
    controller.updateColumn(table.id, column.id, patch)
  }

  const isOption = draft.type === 'select' || draft.type === 'multiSelect'
  const options = draft.options ?? []
  const validation = draft.validation ?? { kind: 'none' as const }

  const setValidation = (patch: { [K in keyof ColumnValidation]?: ColumnValidation[K] | undefined }): void => {
    const next = { ...validation, ...patch }
    for (const key of Object.keys(next) as (keyof ColumnValidation)[]) {
      if (next[key] === undefined) Reflect.deleteProperty(next, key)
    }
    apply({ validation: next as ColumnValidation })
  }

  const setLinked = (patch: { [K in keyof LinkedSelect]?: LinkedSelect[K] | undefined }): void => {
    const next = {
      mode: draft.linked?.mode ?? 'map',
      allowCustom: draft.linked?.allowCustom ?? false,
      ...draft.linked,
      ...patch,
    }
    for (const key of Object.keys(next) as (keyof LinkedSelect)[]) {
      if (next[key] === undefined) Reflect.deleteProperty(next, key)
    }
    apply({ linked: next as LinkedSelect })
  }

  const otherColumns = table.columns.filter(c => c.id !== column.id)
  const sourceOptions = draft.linked?.mode === 'map'
    ? otherColumns.find(c => c.id === draft.linked?.sourceColumnId)?.options ?? []
    : []

  return (
    <div ref={ref} className={css.panel} style={{ left: Math.min(x, window.innerWidth - 380), top: Math.min(y, window.innerHeight - 520) }}>
      <div className={css.title}>{t('col.settings')}</div>

      <div className={css.row}>
        <label className={css.label}>{t('col.name')}</label>
        <input
          className={css.input}
          aria-label={t('col.name')}
          value={draft.name}
          onChange={(e) => { apply({ name: e.target.value }) }}
        />
      </div>
      <div className={css.row}>
        <label className={css.label}>{t('col.type')}</label>
        <select
          className={css.input}
          aria-label={t('col.type')}
          value={draft.type}
          onChange={(e) => { apply({ type: e.target.value as Column['type'] }) }}
        >
          {USER_COLUMN_TYPES.map(type => <option key={type} value={type}>{t(`type.${type}`)}</option>)}
        </select>
      </div>
      <div className={css.row}>
        <label className={css.label}>{t('col.widthLabel')}</label>
        <input
          className={css.input}
          type="number"
          aria-label={t('col.widthLabel')}
          value={draft.width}
          min={60}
          max={600}
          onChange={(e) => { const w = Number(e.target.value); if (Number.isFinite(w) && w >= 40) apply({ width: w }) }}
        />
      </div>
      <div className={css.row}>
        <label className={css.checkLabel}>
          <input type="checkbox" checked={draft.required} onChange={() => { apply({ required: !draft.required }) }} />
          {t('col.required')}
        </label>
        <label className={css.checkLabel}>
          <input type="checkbox" checked={draft.frozen} onChange={() => { apply({ frozen: !draft.frozen }) }} />
          {t('col.freeze')}
        </label>
        <label className={css.checkLabel}>
          <input type="checkbox" checked={draft.hidden} onChange={() => { apply({ hidden: !draft.hidden }) }} />
          {t('col.hide')}
        </label>
      </div>
      <div className={css.row}>
        <label className={css.label}>{t('col.description')}</label>
        <input
          className={css.input}
          aria-label={t('col.description')}
          value={draft.description ?? ''}
          placeholder="—"
          onChange={(e) => {
            if (e.target.value === '') apply({ description: undefined })
            else apply({ description: e.target.value })
          }}
        />
      </div>
      <div className={css.row}>
        <label className={css.label}>{t('col.default')}</label>
        <input
          className={css.input}
          aria-label={t('col.default')}
          value={draft.default === null || draft.default === undefined ? '' : String(draft.default)}
          onChange={(e) => {
            if (e.target.value === '') apply({ default: undefined })
            else apply({ default: e.target.value })
          }}
        />
      </div>

      {/* Format validation */}
      <div className={css.section}>{t('col.validation')}</div>
      <div className={css.row}>
        <select
          className={css.input}
          aria-label={t('col.validation')}
          value={validation.kind}
          onChange={(e) => { setValidation({ kind: e.target.value as ColumnValidation['kind'] }) }}
        >
          {VALIDATION_KINDS.map(kind => <option key={kind} value={kind}>{t(`validation.${kind}`)}</option>)}
        </select>
      </div>
      {(validation.kind === 'numberRange' || validation.kind === 'lengthRange') && (
        <div className={css.row}>
          <input
            className={css.input}
            type="number"
            value={validation.min ?? ''}
            placeholder={t('validation.min')}
            onChange={(e) => { setValidation({ min: e.target.value === '' ? undefined : Number(e.target.value) }) }}
          />
          <input
            className={css.input}
            type="number"
            value={validation.max ?? ''}
            placeholder={t('validation.max')}
            onChange={(e) => { setValidation({ max: e.target.value === '' ? undefined : Number(e.target.value) }) }}
          />
        </div>
      )}
      {validation.kind === 'regex' && (
        <div className={css.row}>
          <input
            className={css.input}
            value={validation.pattern ?? ''}
            placeholder={t('validation.pattern')}
            onChange={(e) => { setValidation({ pattern: e.target.value === '' ? undefined : e.target.value }) }}
          />
        </div>
      )}

      {/* Dropdown options */}
      {isOption && (
        <>
          <div className={css.section}>{t('col.options')}</div>
          <div className={css.optionList}>
            {options.map(option => (
              <div key={option.id} className={css.optionRow}>
                <input
                  type="color"
                  className={css.colorSwatch}
                  aria-label={t('col.optionColor')}
                  value={option.color === '' ? '#94a3b8' : option.color}
                  onChange={(e) => {
                    apply({
                      options: options.map(o => (o.id === option.id ? { ...o, color: e.target.value } : o)),
                    })
                  }}
                />
                <input
                  className={css.input}
                  aria-label={t('col.optionLabel')}
                  value={option.label}
                  onChange={(e) => {
                    apply({
                      options: options.map(o => (o.id === option.id ? { ...o, label: e.target.value } : o)),
                    })
                  }}
                />
                <button
                  type="button"
                  className={css.remove}
                  aria-label="×"
                  onClick={() => { apply({ options: options.filter(o => o.id !== option.id) }) }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className={css.row}>
            <button
              type="button"
              className={css.addButton}
              onClick={() => {
                apply({ options: [...options, { id: newId(), label: t('col.newOption'), color: '#94a3b8' }] })
              }}
            >
              + {t('col.addOption')}
            </button>
            <label className={css.checkLabel}>
              <input
                type="checkbox"
                checked={draft.linked?.allowCustom ?? false}
                onChange={(e) => { setLinked({ allowCustom: e.target.checked }) }}
              />
              {t('col.allowCustom')}
            </label>
          </div>

          {/* Cascading dropdown */}
          <div className={css.section}>{t('col.linked')}</div>
          <div className={css.row}>
            <select
              className={css.input}
              aria-label={t('col.linked')}
              value={draft.linked?.mode ?? 'none'}
              onChange={(e) => {
                const mode = e.target.value as 'none' | 'map' | 'source'
                if (mode === 'none') apply({ linked: undefined })
                else setLinked({ mode, sourceColumnId: otherColumns[0]?.id })
              }}
            >
              <option value="none">{t('linked.none')}</option>
              <option value="map">{t('linked.map')}</option>
              <option value="source">{t('linked.source')}</option>
            </select>
          </div>
          {draft.linked !== undefined && (
            <div className={css.row}>
              <select
                className={css.input}
                aria-label={t('col.linkedSource')}
                value={draft.linked.sourceColumnId ?? ''}
                onChange={(e) => { setLinked({ sourceColumnId: e.target.value }) }}
              >
                {otherColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {draft.linked?.mode === 'map' && draft.linked.sourceColumnId !== undefined && (
            <div className={css.mapBox}>
              {sourceOptions.length === 0 && <div className={css.mapHint}>{t('linked.noSource')}</div>}
              {sourceOptions.map((sourceOption) => {
                const allowed = draft.linked?.map?.[sourceOption.label] ?? []
                return (
                  <div key={sourceOption.id} className={css.mapRow}>
                    <span className={css.mapKey}>{sourceOption.label}</span>
                    <span className={css.mapValues}>
                      {options.map(option => (
                        <label key={option.id} className={css.mapValue}>
                          <input
                            type="checkbox"
                            checked={allowed.includes(option.label)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...allowed, option.label]
                                : allowed.filter(v => v !== option.label)
                              const base = draft.linked?.map ?? {}
                              const map: Record<string, string[]> = {}
                              for (const [key, values] of Object.entries(base)) {
                                if (key !== sourceOption.label) map[key] = values
                              }
                              if (next.length > 0) map[sourceOption.label] = next
                              setLinked({ map })
                            }}
                          />
                          {option.label}
                        </label>
                      ))}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {draft.linked?.mode === 'source' && (
            <div className={css.mapHint}>{t('linked.sourceHint')}</div>
          )}
        </>
      )}

      <div className={css.footer}>
        <button type="button" className={css.done} onClick={onClose}>{t('col.done')}</button>
      </div>
    </div>
  )
}

export { clsx }
