/**
 * Table persistence: a narrow interface the controller talks to, with an
 * IndexedDB implementation for the browser and an in-memory implementation
 * for tests. Documents are stored whole; cell history is keyed per cell and
 * capped at 5 entries; meta holds workspace preferences.
 */
import type {
  CellHistoryEntry, CellHistoryKey, LibraryRow, TableDoc,
} from './domain/types.ts'

/** History kept per cell. */
export const HISTORY_LIMIT = 5

/** What the controller needs from storage. */
export interface TablePersistence {
  /** Load the lightweight library projection (all tables incl. deleted). */
  loadLibrary(): Promise<LibraryRow[]>
  /** Load one full table document. */
  loadTable(id: string): Promise<TableDoc | undefined>
  /** Persist one table document (insert or replace). */
  saveTable(doc: TableDoc): Promise<void>
  /** Permanently remove a table document. */
  removeTable(id: string): Promise<void>
  /** Load cell history for one table (key → entries). */
  loadHistory(tableId: string): Promise<Map<CellHistoryKey, CellHistoryEntry[]>>
  /** Save one cell history key (replace whole entry list). */
  saveHistory(tableId: string, key: CellHistoryKey, entries: CellHistoryEntry[]): Promise<void>
}

const DB_NAME = 'dsh-hulutable'
const DB_VERSION = 1
const TABLES = 'tables'
const HISTORY = 'history'
const META = 'meta'

/** In-memory persistence (tests and non-IndexedDB environments). */
export class MemoryPersistence implements TablePersistence {
  readonly tables = new Map<string, TableDoc>()
  readonly history = new Map<string, CellHistoryEntry[]>()
  readonly meta = new Map<string, unknown>()

  loadLibrary(): Promise<LibraryRow[]> {
    return Promise.resolve([...this.tables.values()].map(toLibraryRow))
  }

  loadTable(id: string): Promise<TableDoc | undefined> {
    return Promise.resolve(structuredClone(this.tables.get(id)))
  }

  saveTable(doc: TableDoc): Promise<void> {
    this.tables.set(doc.id, structuredClone(doc))
    return Promise.resolve()
  }

  removeTable(id: string): Promise<void> {
    this.tables.delete(id)
    return Promise.resolve()
  }

  loadHistory(tableId: string): Promise<Map<CellHistoryKey, CellHistoryEntry[]>> {
    const out = new Map<CellHistoryKey, CellHistoryEntry[]>()
    for (const [key, entries] of this.history) {
      if (key.startsWith(`${tableId}/`)) out.set(key, structuredClone(entries))
    }
    return Promise.resolve(out)
  }

  saveHistory(_tableId: string, key: CellHistoryKey, entries: CellHistoryEntry[]): Promise<void> {
    this.history.set(key, structuredClone(entries))
    return Promise.resolve()
  }
}

/** Project one table document to its library row. */
export function toLibraryRow(doc: TableDoc): LibraryRow {
  const row: LibraryRow = {
    id: doc.id,
    name: doc.name,
    tags: doc.tags,
    starred: doc.starred,
    rowCount: doc.rows.length,
    colCount: doc.columns.length,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
  if (doc.templateId !== undefined) row.templateId = doc.templateId
  if (doc.deletedAt !== undefined) row.deletedAt = doc.deletedAt
  return row
}

/** IndexedDB-backed persistence (browser). */
export class IndexedDbPersistence implements TablePersistence {
  private dbPromise: Promise<IDBDatabase> | undefined

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        /* v8 ignore start -- an upgrade runs once per fresh-DB version; every store is necessarily absent here. */
        if (!db.objectStoreNames.contains(TABLES)) db.createObjectStore(TABLES, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: 'key' })
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' })
        /* v8 ignore stop */
      }
      request.onsuccess = () => { resolve(request.result) }
      /* v8 ignore next 1 -- storage failures are environment-dependent (quota, private mode); the controller already degrades on them. */
      request.onerror = () => { reject(request.error ?? new Error('indexedDB open failed')) }
    })
    return this.dbPromise
  }

  private tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.open().then(db => new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode)
      const request = run(transaction.objectStore(store))
      request.onsuccess = () => { resolve(request.result) }
      /* v8 ignore next 1 -- storage failures are environment-dependent
       * (quota, locked DB); the controller already degrades on them. */
      request.onerror = () => { reject(request.error ?? new Error(`indexedDB ${store} failed`)) }
    }))
  }

  async loadLibrary(): Promise<LibraryRow[]> {
    const docs = await this.tx<TableDoc[]>(TABLES, 'readonly', s => s.getAll() as IDBRequest<TableDoc[]>)
    return docs.map(toLibraryRow)
  }

  async loadTable(id: string): Promise<TableDoc | undefined> {
    return this.tx<TableDoc | undefined>(TABLES, 'readonly', s => s.get(id) as IDBRequest<TableDoc | undefined>)
  }

  async saveTable(doc: TableDoc): Promise<void> {
    await this.tx(TABLES, 'readwrite', s => s.put(doc))
  }

  async removeTable(id: string): Promise<void> {
    await this.tx(TABLES, 'readwrite', s => s.delete(id))
  }

  async loadHistory(tableId: string): Promise<Map<CellHistoryKey, CellHistoryEntry[]>> {
    const rows = await this.tx<HistoryRow[]>(HISTORY, 'readonly', s => s.getAll() as IDBRequest<HistoryRow[]>)
    const out = new Map<CellHistoryKey, CellHistoryEntry[]>()
    const prefix = `${tableId}/`
    for (const row of rows) {
      if (row.key.startsWith(prefix)) out.set(row.key, row.entries)
    }
    return out
  }

  async saveHistory(_tableId: string, key: CellHistoryKey, entries: CellHistoryEntry[]): Promise<void> {
    await this.tx(HISTORY, 'readwrite', s => s.put({ key, entries }))
  }

  /** Close the underlying connection (tests; a page teardown may reuse it). */
  async close(): Promise<void> {
    const db = await this.dbPromise
    if (db !== undefined) {
      db.close()
      this.dbPromise = undefined
    }
  }
}

interface HistoryRow { key: string; entries: CellHistoryEntry[] }
