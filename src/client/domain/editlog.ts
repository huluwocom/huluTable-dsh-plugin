/**
 * Delta-based undo/redo: every edit funnels through {@link commitDeltas} into
 * one {@link DeltaBatch} whose cost is proportional to the CHANGED cells or
 * structure — never the whole table — so undo stays instant on 10k-row
 * tables. Batches apply forward in order and revert in reverse order; a
 * revert re-inserts captured rows/columns, so undoing an edit that precedes a
 * structural delete still lands.
 */
import type { Cell, Column, Row, TableDoc } from './types.ts'

/** One reversible change. */
export type EditDelta =
  | { kind: 'cell'; rowId: string; columnId: string; before: Cell; after: Cell }
  | { kind: 'columnAdd'; index: number; column: Column; cells?: { rowId: string; cell: Cell }[] }
  | { kind: 'columnRemove'; index: number; column: Column; cells: { rowId: string; cell: Cell }[] }
  | { kind: 'columnUpdate'; columnId: string; before: Column; after: Column }
  | { kind: 'columnMove'; columnId: string; from: number; to: number }
  | { kind: 'rowAdd'; index: number; rows: Row[] }
  | { kind: 'rowRemove'; index: number; rows: Row[] }
  | { kind: 'rowMove'; from: number; to: number; count: number }
  | { kind: 'rowsReplace'; before: Row[]; after: Row[] }

/** One undoable gesture: a batch of deltas with a user-facing label. */
export interface DeltaBatch {
  tableId: string
  label: string
  deltas: EditDelta[]
}

/** Maximum retained undo steps per table. */
export const UNDO_LIMIT = 100

/** Apply one delta forward. */
function applyOne(table: TableDoc, delta: EditDelta): void {
  switch (delta.kind) {
    case 'cell': {
      const row = table.rows.find(r => r.id === delta.rowId)
      if (row !== undefined) row.cells[delta.columnId] = delta.after
      break
    }
    case 'columnAdd':
      table.columns.splice(delta.index, 0, delta.column)
      if (delta.cells !== undefined) {
        for (const entry of delta.cells) {
          const row = table.rows.find(r => r.id === entry.rowId)
          if (row !== undefined) row.cells[delta.column.id] = entry.cell
        }
      }
      break
    case 'columnRemove':
      table.columns.splice(delta.index, 1)
      for (const entry of delta.cells) {
        const row = table.rows.find(r => r.id === entry.rowId)
        if (row !== undefined) Reflect.deleteProperty(row.cells, delta.column.id)
      }
      break
    case 'columnUpdate': {
      const column = table.columns.find(c => c.id === delta.columnId)
      if (column !== undefined) {
        // Deleted keys must actually leave the target (assign only adds).
        for (const key of Object.keys(column) as (keyof Column)[]) {
          if (!(key in delta.after)) Reflect.deleteProperty(column, key)
        }
        Object.assign(column, delta.after)
      }
      break
    }
    case 'columnMove': {
      const column = table.columns[delta.from]
      if (column !== undefined) {
        table.columns.splice(delta.from, 1)
        table.columns.splice(delta.to, 0, column)
      }
      break
    }
    case 'rowAdd':
      table.rows.splice(delta.index, 0, ...delta.rows)
      break
    case 'rowRemove':
      table.rows.splice(delta.index, delta.rows.length)
      break
    case 'rowMove': {
      const moved = table.rows.splice(delta.from, delta.count)
      table.rows.splice(delta.to, 0, ...moved)
      break
    }
    case 'rowsReplace':
      table.rows = delta.after
      break
  }
}

/** Apply one delta backward (the exact inverse of {@link applyOne}). */
function revertOne(table: TableDoc, delta: EditDelta): void {
  switch (delta.kind) {
    case 'cell': {
      const row = table.rows.find(r => r.id === delta.rowId)
      if (row !== undefined) row.cells[delta.columnId] = delta.before
      break
    }
    case 'columnAdd':
      table.columns.splice(delta.index, 1)
      if (delta.cells !== undefined) {
        for (const entry of delta.cells) {
          const row = table.rows.find(r => r.id === entry.rowId)
          if (row !== undefined) Reflect.deleteProperty(row.cells, delta.column.id)
        }
      }
      break
    case 'columnRemove':
      table.columns.splice(delta.index, 0, delta.column)
      for (const entry of delta.cells) {
        const row = table.rows.find(r => r.id === entry.rowId)
        if (row !== undefined) row.cells[delta.column.id] = entry.cell
      }
      break
    case 'columnMove': {
      const column = table.columns[delta.to]
      if (column !== undefined) {
        table.columns.splice(delta.to, 1)
        table.columns.splice(delta.from, 0, column)
      }
      break
    }
    case 'columnUpdate': {
      const column = table.columns.find(c => c.id === delta.columnId)
      if (column !== undefined) {
        for (const key of Object.keys(column) as (keyof Column)[]) {
          if (!(key in delta.before)) Reflect.deleteProperty(column, key)
        }
        Object.assign(column, delta.before)
      }
      break
    }
    case 'rowAdd':
      table.rows.splice(delta.index, delta.rows.length)
      break
    case 'rowRemove':
      table.rows.splice(delta.index, 0, ...delta.rows)
      break
    case 'rowMove': {
      const moved = table.rows.splice(delta.to, delta.count)
      table.rows.splice(delta.from, 0, ...moved)
      break
    }
    case 'rowsReplace':
      table.rows = delta.before
      break
  }
}

/** Apply a batch forward. */
export function commitDeltas(table: TableDoc, batch: DeltaBatch): void {
  for (const delta of batch.deltas) applyOne(table, delta)
}

/** Revert a batch (reverse order). */
export function revertDeltas(table: TableDoc, batch: DeltaBatch): void {
  const reversed = [...batch.deltas].reverse()
  for (const delta of reversed) revertOne(table, delta)
}

/** Per-table undo stacks (controller-owned, never serialized). */
export interface UndoStack {
  past: DeltaBatch[]
  future: DeltaBatch[]
}

export function createUndoStack(): UndoStack {
  return { past: [], future: [] }
}

/** Push a batch; clears the redo side and caps history. */
export function pushUndo(stack: UndoStack, batch: DeltaBatch): void {
  stack.past.push(batch)
  if (stack.past.length > UNDO_LIMIT) stack.past.shift()
  stack.future = []
}
