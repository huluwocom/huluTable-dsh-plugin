/**
 * HulutableController: the workspace's data-owner (mirroring the
 * SettingsDocumentStore pattern). Owns one snapshot store carrying the
 * library projection, loaded table documents, and editor viewing state; all
 * mutations funnel through its methods, which keep the undo stacks, cell
 * history, and formula caches and schedule debounced IndexedDB flushes.
 * Created once in apply; components reach it through the register inject
 * face (controller + bound selector hook), never through ctx.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createUndoStack, commitDeltas, pushUndo, revertDeltas, type DeltaBatch, type UndoStack,
} from './domain/editlog.ts'
import {
  HISTORY_LIMIT, toLibraryRow, type TablePersistence,
} from './persistence.ts'
import {
  createBlankTable, createTableFromTemplate, localizeTemplate, TEMPLATES,
} from './domain/templates.ts'
import {
  commentKey, historyKey, newId, RECYCLE_TTL_MS,
  type CellHistoryEntry, type CellHistoryKey, type CellValue, type Column, type ColumnType,
  type LibraryRow, type TableDoc,
} from './domain/types.ts'
import {
  buildAddColumn, buildAddRows, buildCellEdit, buildClear, buildFill, buildMoveColumn,
  buildPaste, buildRemoveColumn, buildRemoveRows, buildSetValue, buildUpdateColumn,
  leadingFrozenCount, type EditResult,
} from './domain/editor-ops.ts'
import { evaluateFormulaAt, recalcFormulas } from './domain/formula.ts'
import { buildImportColumns, coerceImportValue, type ParsedImport } from './io/io.ts'

/** Rectangular selection over visible row/col indexes. */
export interface CellSelection {
  r0: number
  r1: number
  c0: number
  c1: number
}

/** Editor viewing state (transient, survives panel remounts via the store). */
export interface EditorState {
  selection: CellSelection | null
  /**
   * Editing overlay anchor. `row`/`col` are view indexes; `rowId` snapshots
   * the data row at edit start so sorts/filters changing the view order mid-
   * edit never redirect the committed value to another row.
   */
  editing: { row: number; col: number; rowId?: string | undefined } | null
  /** Undo availability for the current table (toolbar state). */
  undo: { canUndo: boolean; canRedo: boolean }
  /** Active view per table (UI preference, not persisted in the doc). */
  viewIds: Record<string, string>
}

/** Full controller snapshot. */
export interface HulutableState {
  ready: boolean
  library: LibraryRow[]
  bin: LibraryRow[]
  tables: Record<string, TableDoc>
  currentTableId: string | null
  binOpen: boolean
  editor: EditorState
}

/** Debounced persist flush delay. */
export const FLUSH_DELAY_MS = 500

/** One recorded cell change (before applying). */
export interface CellChange {
  rowId: string
  columnId: string
  before: CellValue
  after: CellValue
}

const initial = (): HulutableState => ({
  ready: false,
  library: [],
  bin: [],
  tables: {},
  currentTableId: null,
  binOpen: false,
  editor: { selection: null, editing: null, undo: { canUndo: false, canRedo: false }, viewIds: {} },
})

/**
 * The workspace controller. Methods mutate the snapshot and schedule
 * persistence; the undo stacks, history caches, and formula caches live here
 * as non-serialized state.
 */
export class HulutableController {
  readonly store: SnapshotStore<HulutableState>

  private readonly undoStacks = new Map<string, UndoStack>()
  private readonly historyCache = new Map<CellHistoryKey, CellHistoryEntry[]>()
  private readonly pendingHistory = new Map<CellHistoryKey, CellHistoryEntry[]>()
  /** Per-table formula caches (value by `${rowId}/${columnId}`), cleared on edit. */
  readonly formulaCache = new Map<string, Map<string, CellValue>>()

  /** Row/column clipboard for cut/copy/paste (in-memory, session-scoped). */
  private rowClipboard: import('./domain/types.ts').Row[] | null = null
  private colClipboard: import('./domain/types.ts').Column[] | null = null

  private dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly onPageHide = (): void => { this.flushNow() }

  constructor(private readonly persistence: TablePersistence) {
    this.store = createSnapshotStore<HulutableState>(initial())
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide)
    }
  }

  /** Load the library (and lazily purge expired recycle-bin items). */
  async init(): Promise<void> {
    let rows: LibraryRow[] = []
    try {
      rows = await this.persistence.loadLibrary()
    } catch {
      // Storage unavailable (blocked IndexedDB, privacy mode, jsdom tests):
      // the workspace still opens with an empty library; mutations degrade to
      // memory-only until storage recovers.
    }
    const now = Date.now()
    const expired: string[] = []
    const live: LibraryRow[] = []
    const bin: LibraryRow[] = []
    for (const row of rows) {
      if (row.deletedAt !== undefined) {
        if (now - row.deletedAt > RECYCLE_TTL_MS) expired.push(row.id)
        else bin.push(row)
      } else {
        live.push(row)
      }
    }
    for (const id of expired) {
      void this.persistence.removeTable(id).catch(() => {})
    }
    this.update((d) => {
      d.ready = true
      d.library = live
      d.bin = bin
    })
  }

  /** Read the current snapshot. */
  snapshot(): HulutableState {
    return this.store.getSnapshot()
  }

  /** Mutate the snapshot through an immer draft. */
  update(mutator: (draft: HulutableState) => void): void {
    this.store.update(mutator)
  }

  /** Load a table document into memory WITHOUT selecting it (library ops). */
  async ensureLoaded(id: string): Promise<void> {
    const current = this.snapshot()
    if (current.tables[id] !== undefined) return
    const doc = await this.persistence.loadTable(id)
    if (doc !== undefined) {
      this.update((d) => { d.tables[id] = doc })
      const history = await this.persistence.loadHistory(id)
      for (const [key, entries] of history) this.historyCache.set(key, entries)
    }
  }

  /** Open a table: load its full document on demand and select it. */
  async openTable(id: string): Promise<void> {
    const current = this.snapshot()
    if (current.tables[id] === undefined) {
      const doc = await this.persistence.loadTable(id)
      if (doc === undefined) return
      this.update((d) => { d.tables[id] = doc })
      const history = await this.persistence.loadHistory(id)
      for (const [key, entries] of history) this.historyCache.set(key, entries)
    }
    this.update((d) => { d.currentTableId = id })
  }

  /** Create a table from a template (or blank) and open it. */
  createTable(name: string, templateId?: string, lang = 'zh'): string {
    const trimmed = name.trim() === '' ? '未命名表格' : name.trim()
    const template = TEMPLATES.find(t => t.id === templateId)
    const doc = template === undefined
      ? createBlankTable(trimmed, lang)
      : createTableFromTemplate(template, trimmed, localizeTemplate(template, lang), lang)
    this.update((d) => {
      d.tables[doc.id] = doc
      d.library.push(toLibraryRow(doc))
      d.currentTableId = doc.id
      d.binOpen = false
    })
    this.markDirty(doc.id)
    return doc.id
  }

  /** Duplicate a table (rows and structure; comments and history excluded). */
  duplicateTable(id: string): string {
    const doc = this.snapshot().tables[id]
    if (doc === undefined) return ''
    const copy = structuredClone(doc)
    copy.id = newId()
    copy.name = `${doc.name} 副本`
    copy.createdAt = Date.now()
    copy.updatedAt = copy.createdAt
    delete copy.deletedAt
    copy.comments = {}
    this.update((d) => {
      d.tables[copy.id] = copy
      d.library.push(toLibraryRow(copy))
    })
    this.markDirty(copy.id)
    return copy.id
  }

  /** Rename a table. */
  renameTable(id: string, name: string): void {
    const trimmed = name.trim()
    if (trimmed === '') return
    this.update((d) => {
      const doc = d.tables[id]
      if (doc === undefined) return
      doc.name = trimmed
      doc.updatedAt = Date.now()
      this.reproject(d)
    })
    this.markDirty(id)
  }

  /** Replace a table's tags. */
  setTags(id: string, tags: string[]): void {
    this.update((d) => {
      const doc = d.tables[id]
      if (doc === undefined) return
      doc.tags = tags
      this.reproject(d)
    })
    this.markDirty(id)
  }

  /** Toggle the starred flag. */
  toggleStar(id: string): void {
    this.update((d) => {
      const doc = d.tables[id]
      if (doc === undefined) return
      doc.starred = !doc.starred
      this.reproject(d)
    })
    this.markDirty(id)
  }

  /** Move a table to the recycle bin. */
  moveToBin(id: string): void {
    this.update((d) => {
      const doc = d.tables[id]
      if (doc === undefined) return
      doc.deletedAt = Date.now()
      doc.updatedAt = doc.deletedAt
      if (d.currentTableId === id) d.currentTableId = null
      this.reproject(d)
    })
    this.markDirty(id)
  }

  /** Restore a table from the recycle bin. */
  restoreTable(id: string): void {
    this.update((d) => {
      const doc = d.tables[id]
      if (doc === undefined) return
      delete doc.deletedAt
      doc.updatedAt = Date.now()
      this.reproject(d)
    })
    this.markDirty(id)
  }

  /** Permanently delete a table (and its history). */
  purgeTable(id: string): void {
    this.update((d) => {
      Reflect.deleteProperty(d.tables, id)
      d.bin = d.bin.filter(row => row.id !== id)
      if (d.currentTableId === id) d.currentTableId = null
    })
    void this.persistence.removeTable(id).catch(() => {})
    // Snapshot the keys before deleting: deleting the current key during
    // iteration is safe, but a snapshot keeps the loop trivially correct.
    const historyKeys = Array.from(this.historyCache.keys())
    for (const key of historyKeys) {
      if (key.startsWith(`${id}/`)) this.historyCache.delete(key)
    }
  }

  /**
   * Apply one undoable edit: deltas forward, undo push, cell history records,
   * formula cache invalidation, and a scheduled persist.
   */
  commitEdit(tableId: string, label: string, deltas: DeltaBatch['deltas'], changes: CellChange[] = []): void {
    if (deltas.length === 0) return
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      commitDeltas(doc, { tableId, label, deltas })
      doc.updatedAt = Date.now()
      this.reproject(d)
    })
    this.formulaCache.delete(tableId)
    const stack = this.undoStacks.get(tableId) ?? createUndoStack()
    this.undoStacks.set(tableId, stack)
    pushUndo(stack, { tableId, label, deltas })
    if (changes.length > 0) this.recordHistory(tableId, changes)
    this.markDirty(tableId)
    this.refreshUndoState(tableId)
  }

  /** Undo the last edit of a table. */
  undo(tableId: string): void {
    const stack = this.undoStacks.get(tableId)
    const batch = stack?.past.at(-1)
    if (stack === undefined || batch === undefined) return
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      revertDeltas(doc, batch)
      doc.updatedAt = Date.now()
      recalcFormulas(doc)
      this.reproject(d)
    })
    stack.past.pop()
    stack.future.push(batch)
    this.formulaCache.delete(tableId)
    this.markDirty(tableId)
    this.refreshUndoState(tableId)
  }

  /** Redo the last undone edit of a table. */
  redo(tableId: string): void {
    const stack = this.undoStacks.get(tableId)
    const batch = stack?.future.at(-1)
    if (stack === undefined || batch === undefined) return
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      commitDeltas(doc, batch)
      doc.updatedAt = Date.now()
      recalcFormulas(doc)
      this.reproject(d)
    })
    stack.future.pop()
    stack.past.push(batch)
    this.formulaCache.delete(tableId)
    this.markDirty(tableId)
    this.refreshUndoState(tableId)
  }

  /** Whether a table has an undoable/redoable step. */
  canUndo(tableId: string): boolean {
    return (this.undoStacks.get(tableId)?.past.length ?? 0) > 0
  }

  canRedo(tableId: string): boolean {
    return (this.undoStacks.get(tableId)?.future.length ?? 0) > 0
  }

  /** Selection/editing viewing state. */
  select(selection: CellSelection | null): void {
    this.update((d) => { d.editor.selection = selection })
  }

  setEditing(editing: { row: number; col: number; rowId?: string | undefined } | null): void {
    this.update((d) => { d.editor.editing = editing })
  }

  setBinOpen(open: boolean): void {
    this.update((d) => { d.binOpen = open })
  }

  /** Cell history for one cell (P7 hover), last 5 records. */
  getHistory(tableId: string, rowId: string, columnId: string): CellHistoryEntry[] {
    return this.historyCache.get(historyKey(tableId, rowId, columnId)) ?? []
  }

  /** Editor op: set one cell from raw text (formulas when prefixed '='); returns a validation error or null. */
  setCellRaw(tableId: string, rowId: string, columnId: string, raw: string): string | null {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return 'missing'
    if (raw.startsWith('=')) {
      this.setFormula(tableId, rowId, columnId, raw)
      return null
    }
    const result = buildCellEdit(doc, rowId, columnId, raw)
    this.applyResult(tableId, '编辑单元格', result)
    return result.error
  }

  /** Editor op: set a formula on a cell (evaluated immediately). */
  setFormula(tableId: string, rowId: string, columnId: string, formula: string): void {
    const doc = this.snapshot().tables[tableId]
    const row = doc?.rows.find(r => r.id === rowId)
    const colIndex = doc?.columns.findIndex(c => c.id === columnId) ?? -1
    if (doc === undefined || row === undefined || colIndex < 0) return
    const rowIndex = doc.rows.indexOf(row)
    const before = row.cells[columnId] ?? { value: null }
    const value = evaluateFormulaAt(doc, rowIndex, colIndex, formula)
    const after: import('./domain/types.ts').Cell = { value, formula }
    if (before.formula === formula) return
    this.applyResult(tableId, '编辑公式', {
      deltas: [{ kind: 'cell', rowId, columnId, before, after }],
      changes: [{ rowId, columnId, before: before.value, after: value }],
      error: null,
    })
  }

  /** Editor op: set one cell to an already-typed value (dropdown, kanban, fill). */
  setCellValue(tableId: string, rowId: string, columnId: string, value: CellValue): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '编辑单元格', buildSetValue(doc, rowId, columnId, value))
  }

  /** Editor op: insert rows at an index (append when index === rowCount). */
  addRows(tableId: string, index: number, count = 1): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '添加行', buildAddRows(doc, index, count))
  }

  /** Editor op: remove rows by row index. */
  removeRows(tableId: string, indexes: readonly number[]): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '删除行', buildRemoveRows(doc, indexes))
  }

  /** Editor op: add a column at an index. */
  addColumn(tableId: string, index: number, type: ColumnType = 'text', name?: string): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '添加列', buildAddColumn(doc, index, type, name))
  }

  /** Editor op: patch a column (rename/type/options/validation/width/...). */
  updateColumn(tableId: string, columnId: string, patch: { [K in keyof Column]?: Column[K] | undefined }): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '修改列', buildUpdateColumn(doc, columnId, patch))
  }

  /**
   * Live column-width resize (not undoable — matches Excel's drag-resize).
   * Widths clamp to [40, 600].
   */
  setColumnWidth(tableId: string, columnId: string, width: number): void {
    const clamped = Math.max(40, Math.min(600, Math.round(width)))
    this.update((d) => {
      const column = d.tables[tableId]?.columns.find(c => c.id === columnId)
      const doc = d.tables[tableId]
      if (column === undefined || doc === undefined) return
      column.width = clamped
      doc.updatedAt = Date.now()
    })
    this.markDirty(tableId)
  }

  /** Editor op: remove a column by index. */
  removeColumn(tableId: string, index: number): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '删除列', buildRemoveColumn(doc, index))
  }

  /** Editor op: move a column to another index. */
  moveColumn(tableId: string, columnId: string, to: number): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '移动列', buildMoveColumn(doc, columnId, to))
  }

  /** Editor op: move one row to another index (undoable; row ids stay put). */
  moveRow(tableId: string, from: number, to: number): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined || from === to || from < 0 || from >= doc.rows.length) return
    const clampedTo = Math.max(0, Math.min(doc.rows.length - 1, to))
    if (from === clampedTo) return
    this.applyResult(tableId, '移动行', {
      deltas: [{ kind: 'rowMove', from, to: clampedTo, count: 1 }],
      changes: [],
      error: null,
    })
  }

  /** Copy rows into the row clipboard (deep copies). */
  copyRows(tableId: string, indexes: readonly number[]): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.rowClipboard = indexes
      .map(i => doc.rows[i])
      .filter((r): r is import('./domain/types.ts').Row => r !== undefined)
      .map(r => structuredClone(r))
  }

  /** Cut rows: copy into the clipboard and remove them. */
  cutRows(tableId: string, indexes: readonly number[]): void {
    this.copyRows(tableId, indexes)
    this.removeRows(tableId, [...indexes].sort((a, b) => b - a))
  }

  /** Paste the row clipboard below `index` (new ids, undoable). */
  pasteRows(tableId: string, index: number): number {
    const doc = this.snapshot().tables[tableId]
    const clipboard = this.rowClipboard
    if (doc === undefined || clipboard === null || clipboard.length === 0) return 0
    const now = Date.now()
    const rows = clipboard.map(r => ({
      id: newId(),
      cells: structuredClone(r.cells),
      ...(r.createdAt !== undefined ? { createdAt: r.createdAt } : {}),
      ...(r.updatedAt !== undefined ? { updatedAt: now } : {}),
    }))
    this.applyResult(tableId, '粘贴行', {
      deltas: [{ kind: 'rowAdd', index: Math.max(0, Math.min(index, doc.rows.length)), rows }],
      changes: [],
      error: null,
    })
    return rows.length
  }

  /** Copy one column (structure + config + cells) into the column clipboard. */
  copyColumn(tableId: string, index: number): void {
    const doc = this.snapshot().tables[tableId]
    const column = doc?.columns[index]
    if (doc === undefined || column === undefined) return
    this.colClipboard = [structuredClone(column)]
  }

  /** Cut a column: copy into the clipboard and remove it. */
  cutColumn(tableId: string, index: number): void {
    this.copyColumn(tableId, index)
    this.removeColumn(tableId, index)
  }

  /** Paste the column clipboard right of `index` (new ids, cells copied). */
  pasteColumn(tableId: string, index: number): number {
    const doc = this.snapshot().tables[tableId]
    const clipboard = this.colClipboard
    if (doc === undefined || clipboard === null || clipboard.length === 0) return 0
    const source = clipboard[0]
    /* v8 ignore next -- the clipboard is either null or non-empty. */
    if (source === undefined) return 0
    const copy: import('./domain/types.ts').Column = {
      ...structuredClone(source),
      id: newId(),
      name: `${source.name} 副本`,
    }
    const cells = doc.rows.map(row => ({
      rowId: row.id,
      cell: row.cells[source.id] ?? { value: null },
    }))
    const at = Math.max(0, Math.min(index + 1, doc.columns.length))
    // Frozen columns form the leading block: a copy landing inside it joins
    // the pane; elsewhere the pasted column is a normal scrolling column.
    copy.frozen = at <= leadingFrozenCount(doc)
    this.applyResult(tableId, '粘贴列', {
      deltas: [{ kind: 'columnAdd', index: at, column: copy, cells }],
      changes: [],
      error: null,
    })
    return 1
  }

  /** Editor op: duplicate a row's values into a new row below it. */
  duplicateRow(tableId: string, index: number): void {
    const doc = this.snapshot().tables[tableId]
    const source = doc?.rows[index]
    if (doc === undefined || source === undefined) return
    const now = Date.now()
    const clone = {
      id: newId(), cells: structuredClone(source.cells), createdAt: now, updatedAt: now,
    }
    this.applyResult(tableId, '复制行', {
      deltas: [{ kind: 'rowAdd', index: index + 1, rows: [clone] }],
      changes: [],
      error: null,
    })
  }

  /** Editor op: duplicate a column (structure + config) right of it. */
  duplicateColumn(tableId: string, index: number): void {
    const doc = this.snapshot().tables[tableId]
    const source = doc?.columns[index]
    if (doc === undefined || source === undefined) return
    const copy: Column = {
      ...structuredClone(source),
      id: newId(),
      name: `${source.name} 副本`,
    }
    const at = Math.min(index + 1, doc.columns.length)
    // Inside the leading frozen block the duplicate joins the pane.
    copy.frozen = at <= leadingFrozenCount(doc)
    this.applyResult(tableId, '复制列', {
      deltas: [{ kind: 'columnAdd', index: at, column: copy }],
      changes: [],
      error: null,
    })
  }

  /** Editor op: fill the region below/right of the anchor rect (over display columns). */
  fill(
    tableId: string,
    anchor: CellSelection,
    target: CellSelection,
    mode: 'copy' | 'series',
    columns: readonly import('./domain/types.ts').Column[],
  ): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '填充', buildFill(doc, anchor, target, mode, columns))
  }

  /** Editor op: clear rows over display columns. */
  clear(tableId: string, r0: number, r1: number, columns: readonly import('./domain/types.ts').Column[]): void {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return
    this.applyResult(tableId, '清空', buildClear(doc, r0, r1, columns))
  }

  /** Editor op: paste a tab-delimited grid at an anchor row over display columns. */
  paste(tableId: string, anchorRow: number, columns: readonly import('./domain/types.ts').Column[], grid: string[][]): string | null {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return 'missing'
    const result = buildPaste(doc, anchorRow, columns, grid)
    this.applyResult(tableId, '粘贴', result)
    return result.error
  }

  /** The active view of a table (fallback: first view). */
  viewOf(tableId: string): import('./domain/types.ts').View | undefined {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return undefined
    const activeId = this.snapshot().editor.viewIds[tableId]
    return doc.views.find(v => v.id === activeId) ?? doc.views[0]
  }

  /** Remember the active view for a table (UI preference). */
  setActiveView(tableId: string, viewId: string): void {
    this.update((d) => { d.editor.viewIds[tableId] = viewId })
  }

  /** Patch the active view (filters/sorts/hidden columns). */
  updateView(tableId: string, viewId: string, patch: Partial<import('./domain/types.ts').View>): void {
    this.update((d) => {
      const view = d.tables[tableId]?.views.find(v => v.id === viewId)
      if (view === undefined) return
      Object.assign(view, patch)
      const doc = d.tables[tableId]
      /* v8 ignore next -- the view lookup above already proved the table exists. */
      if (doc !== undefined) doc.updatedAt = Date.now()
    })
    this.markDirty(tableId)
  }

  /** Add a view (grid by default). */
  addView(tableId: string, name: string, kind: import('./domain/types.ts').View['kind'] = 'grid'): void {
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      const view: import('./domain/types.ts').View = {
        id: newId(), name, kind, filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      }
      doc.views.push(view)
      d.editor.viewIds[tableId] = view.id
    })
    this.markDirty(tableId)
  }

  /** Remove a view (keeps the first view when none remain). */
  removeView(tableId: string, viewId: string): void {
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      doc.views = doc.views.filter(v => v.id !== viewId)
      if (doc.views.length === 0) {
        doc.views.push({
          id: newId(), name: '网格', kind: 'grid', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
        })
      }
      if (d.editor.viewIds[tableId] === viewId) {
        const first = doc.views[0]
        /* v8 ignore next -- the re-insert above guarantees a first view. */
        if (first !== undefined) d.editor.viewIds[tableId] = first.id
      }
    })
    this.markDirty(tableId)
  }

  /** Duplicate a view. */
  duplicateView(tableId: string, viewId: string): void {
    this.update((d) => {
      const doc = d.tables[tableId]
      const source = doc?.views.find(v => v.id === viewId)
      if (doc === undefined || source === undefined) return
      // Field-level clone: structuredClone cannot copy immer draft proxies.
      const copy: import('./domain/types.ts').View = {
        id: newId(),
        name: `${source.name} 副本`,
        kind: source.kind,
        filters: source.filters.map(f => ({ ...f })),
        filterMode: source.filterMode,
        sorts: source.sorts.map(s => ({ ...s })),
        hiddenColumns: [...source.hiddenColumns],
      }
      if (source.groupColumnId !== undefined) copy.groupColumnId = source.groupColumnId
      if (source.calendarColumnId !== undefined) copy.calendarColumnId = source.calendarColumnId
      if (source.chart !== undefined) {
        // Field-level clone: structuredClone cannot copy immer draft proxies.
        copy.chart = {
          type: source.chart.type,
          title: source.chart.title,
          xColumnId: source.chart.xColumnId,
          yColumnIds: [...source.chart.yColumnIds],
        }
      }
      doc.views.push(copy)
    })
    this.markDirty(tableId)
  }

  /** Toggle a column's visibility in a view. */
  toggleColumnHidden(tableId: string, viewId: string, columnId: string): void {
    this.update((d) => {
      const view = d.tables[tableId]?.views.find(v => v.id === viewId)
      if (view === undefined) return
      const hidden = view.hiddenColumns.includes(columnId)
      view.hiddenColumns = hidden
        ? view.hiddenColumns.filter(id => id !== columnId)
        : [...view.hiddenColumns, columnId]
    })
    this.markDirty(tableId)
  }

  /** Add a column goal (optionally filtered by an eq/contains condition). */
  addGoal(tableId: string, goal: {
    columnId: string
    aggregate: 'sum' | 'avg' | 'count'
    target: number
    label?: string
    condition?: import('./domain/types.ts').Goal['condition'] | undefined
  }): void {
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      doc.goals.push({ id: newId(), ...goal })
    })
    this.markDirty(tableId)
  }

  /** Export every table document as a portable JSON backup (config + data). */
  exportBackup(): string {
    const snapshot = this.snapshot()
    return JSON.stringify({
      app: 'hulutable',
      version: 1,
      exportedAt: Date.now(),
      tables: Object.values(snapshot.tables),
    })
  }

  /**
   * Restore tables from a backup JSON. Existing tables with the same id are
   * overwritten; new ids are inserted. Returns the number of restored tables
   * (0 when the payload is not a valid hulutable backup).
   */
  importBackup(json: string): number {
    let data: unknown
    try {
      data = JSON.parse(json)
    } catch {
      return 0
    }
    const list = (data as { tables?: unknown } | null)?.tables
    if (!Array.isArray(list)) return 0
    const docs: TableDoc[] = []
    for (const raw of list) {
      if (raw === null || typeof raw !== 'object') continue
      const doc = raw as TableDoc
      if (typeof doc.id !== 'string' || !Array.isArray(doc.columns) || !Array.isArray(doc.rows)) continue
      docs.push(doc)
    }
    if (docs.length === 0) return 0
    this.update((d) => {
      for (const doc of docs) d.tables[doc.id] = doc
      this.reproject(d)
    })
    for (const doc of docs) {
      this.markDirty(doc.id)
      this.formulaCache.delete(doc.id)
    }
    return docs.length
  }

  /** Remove a column goal. */
  removeGoal(tableId: string, goalId: string): void {
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      doc.goals = doc.goals.filter(g => g.id !== goalId)
    })
    this.markDirty(tableId)
  }

  /** Add a conditional-formatting rule. */
  addFormatRule(tableId: string, rule: Omit<import('./domain/types.ts').FormatRule, 'id'>): void {
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      doc.formatRules.push({ ...rule, id: newId() })
    })
    this.markDirty(tableId)
  }

  /** Remove a conditional-formatting rule. */
  removeFormatRule(tableId: string, ruleId: string): void {
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      doc.formatRules = doc.formatRules.filter(r => r.id !== ruleId)
    })
    this.markDirty(tableId)
  }

  /** Update a conditional-formatting rule. */
  updateFormatRule(tableId: string, ruleId: string, patch: Partial<import('./domain/types.ts').FormatRule>): void {
    this.update((d) => {
      const rule = d.tables[tableId]?.formatRules.find(r => r.id === ruleId)
      if (rule === undefined) return
      Object.assign(rule, patch)
    })
    this.markDirty(tableId)
  }

  /** Create a new table from an imported grid and open it. */
  importTable(name: string, parsed: ParsedImport): string {
    const columns = buildImportColumns(parsed.headers, parsed.rows)
    const doc = createBlankTable(name.trim() === '' ? '导入表格' : name.trim())
    doc.columns = columns
    doc.rows = parsed.rows.map((values) => {
      const cells: Record<string, import('./domain/types.ts').Cell> = {}
      columns.forEach((column, c) => {
        const raw = values[c]
        if (raw !== undefined && raw !== '') cells[column.id] = { value: coerceImportValue(column.type, raw) }
      })
      const now = Date.now()
      return { id: newId(), cells, createdAt: now, updatedAt: now }
    })
    this.update((d) => {
      d.tables[doc.id] = doc
      d.library.push(toLibraryRow(doc))
      d.currentTableId = doc.id
      d.binOpen = false
    })
    this.markDirty(doc.id)
    return doc.id
  }

  /** Append an imported grid to an existing table (positional column match). */
  appendImport(tableId: string, parsed: ParsedImport): number {
    const doc = this.snapshot().tables[tableId]
    if (doc === undefined) return 0
    const now = Date.now()
    const rows: import('./domain/types.ts').Row[] = parsed.rows.map((values) => {
      const cells: Record<string, import('./domain/types.ts').Cell> = {}
      doc.columns.forEach((column, c) => {
        const raw = values[c]
        if (raw !== undefined && raw !== '') cells[column.id] = { value: coerceImportValue(column.type, raw) }
      })
      return { id: newId(), cells, createdAt: now, updatedAt: now }
    })
    if (rows.length === 0) return 0
    this.applyResult(tableId, '导入数据', {
      deltas: [{ kind: 'rowAdd', index: doc.rows.length, rows }],
      changes: [],
      error: null,
    })
    return rows.length
  }

  /** Apply an edit result as one undoable batch. */
  private applyResult(tableId: string, label: string, result: EditResult): void {
    if (result.deltas.length === 0) return
    // Auto-maintain updatedAt columns for every touched row in the same batch.
    const doc = this.snapshot().tables[tableId]
    const touchedRowIds = new Set<string>()
    for (const delta of result.deltas) {
      if (delta.kind === 'cell') touchedRowIds.add(delta.rowId)
      if (delta.kind === 'rowAdd' || delta.kind === 'rowRemove') {
        for (const row of delta.rows) touchedRowIds.add(row.id)
      }
    }
    /* v8 ignore next -- every applyResult caller already resolved the table. */
    if (doc !== undefined) {
      for (const column of doc.columns) {
        if (column.type !== 'updatedAt') continue
        const now = Date.now()
        for (const row of doc.rows) {
          if (!touchedRowIds.has(row.id)) continue
          const before = row.cells[column.id] ?? { value: null }
          /* v8 ignore next -- a second edit within the same millisecond is not reproducible deterministically. */
          if (before.value === now) continue
          result.deltas.push({
            kind: 'cell', rowId: row.id, columnId: column.id, before, after: { value: now },
          })
        }
      }
    }
    this.commitEdit(tableId, label, result.deltas, result.changes)
  }

  /** P7: update an existing comment's text. */
  updateComment(tableId: string, rowId: string, columnId: string, commentId: string, text: string): void {
    const key = commentKey(rowId, columnId)
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      const list = doc.comments[key] ?? []
      const next = list.map(c => (c.id === commentId ? { ...c, text } : c))
      if (text.trim() === '') {
        doc.comments[key] = next.filter(c => c.id !== commentId)
        if (doc.comments[key].length === 0) Reflect.deleteProperty(doc.comments, key)
      } else {
        doc.comments[key] = next
      }
      doc.updatedAt = Date.now()
    })
    this.markDirty(tableId)
  }

  /** P7: attach a comment to a cell. */
  setComment(tableId: string, rowId: string, columnId: string, text: string): void {
    const key = commentKey(rowId, columnId)
    this.update((d) => {
      const doc = d.tables[tableId]
      if (doc === undefined) return
      const list = doc.comments[key] ?? []
      if (text.trim() === '') {
        if (doc.comments[key] !== undefined) Reflect.deleteProperty(doc.comments, key)
      } else {
        doc.comments[key] = [...list.filter(c => c.id !== 'draft'), { id: newId(), text, createdAt: Date.now() }]
      }
      doc.updatedAt = Date.now()
    })
    this.markDirty(tableId)
  }

  /** Force pending flushes (pagehide, tests). */
  flushNow(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    const snapshot = this.snapshot()
    for (const id of this.dirty) {
      const doc = snapshot.tables[id]
      /* v8 ignore next -- in-memory test persistence never rejects; real failures degrade silently by design. */
      if (doc !== undefined) void this.persistence.saveTable(doc).catch((err: unknown) => {
        // Never drop data silently: surface storage failures so the user can
        // export a backup before the tab closes.
        console.error('[hulutable] table save failed', doc.id, err)
      })
    }
    this.dirty.clear()
    for (const [key, entries] of this.pendingHistory) {
      const tableId = key.slice(0, key.indexOf('/'))
      /* v8 ignore next -- in-memory test persistence never rejects; real failures degrade silently by design. */
      void this.persistence.saveHistory(tableId, key, entries).catch(() => {})
    }
    this.pendingHistory.clear()
  }

  /** Dispose: flush and detach the pagehide listener. */
  dispose(): void {
    this.flushNow()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide)
    }
  }

  private reproject(d: HulutableState): void {
    // Loaded documents project fresh rows; library entries whose documents
    // are NOT loaded yet (lazy openTable) must be PRESERVED — dropping them
    // here made tables vanish from the library whenever any doc changed.
    const loaded = new Set(Object.keys(d.tables))
    const live: LibraryRow[] = []
    const bin: LibraryRow[] = []
    for (const row of d.library) {
      if (loaded.has(row.id)) continue
      if (row.deletedAt !== undefined) bin.push(row)
      else live.push(row)
    }
    for (const row of d.bin) {
      if (loaded.has(row.id)) continue
      // Bin rows stay in the bin even without a deletedAt stamp (raw rows,
      // older exports): dropping them here would silently purge them.
      bin.push(row)
    }
    for (const doc of Object.values(d.tables)) {
      const row = toLibraryRow(doc)
      if (doc.deletedAt !== undefined) bin.push(row)
      else live.push(row)
    }
    d.library = live.sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt - a.updatedAt)
    /* v8 ignore next -- bin rows always carry deletedAt (set by moveToBin); the fallback is defensive. */
    d.bin = bin.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  }

  private recordHistory(tableId: string, changes: CellChange[]): void {
    const ts = Date.now()
    for (const change of changes) {
      const key = historyKey(tableId, change.rowId, change.columnId)
      const list = this.historyCache.get(key) ?? []
      list.push({ ts, before: change.before, after: change.after })
      const kept = list.slice(-HISTORY_LIMIT)
      this.historyCache.set(key, kept)
      this.pendingHistory.set(key, kept)
    }
  }

  /** Mirror undo availability into the snapshot for the toolbar. */
  private refreshUndoState(tableId: string): void {
    this.update((d) => {
      d.editor.undo.canUndo = this.canUndo(tableId)
      d.editor.undo.canRedo = this.canRedo(tableId)
    })
  }

  private markDirty(tableId: string): void {
    this.dirty.add(tableId)
    if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined
        this.flushNow()
      }, FLUSH_DELAY_MS)
    }
  }
}
