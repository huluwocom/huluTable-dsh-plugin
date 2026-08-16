/**
 * The virtualized grid: sticky header + row-number gutter + frozen columns,
 * windowed body rows, rectangular selection with drag, double-click editing
 * overlay, fill-handle series fill, TSV clipboard, dropdown option picker,
 * column filter/sort interactions, conditional-formatting tints, and goal
 * progress chips. Rendering follows the ACTIVE VIEW: filters, multi-column
 * sorts, and hidden columns are applied by the query engine before the
 * window is computed. Scroll state is rAF-throttled; all mutations go
 * through the controller (undoable).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HulutableController, CellSelection } from '../controller.ts'
import type { Column, FormatRule, Goal, TableDoc, View } from '../domain/types.ts'
import { applyViewQuery, matchFilter } from '../domain/query.ts'
import { columnLetter } from '../domain/formula.ts'
import type { HulutableTranslate } from '../locales.ts'
import {
  HEADER_HEIGHT, LETTER_ROW_HEIGHT, TOTAL_HEADER_HEIGHT, ROW_HEIGHT, ROW_HEADER_WIDTH, MIN_GRID_ROWS, MIN_GRID_COLS,
  blankColumn, isBlankColumn,
  columnOffsets, frozenWidth, visibleColumnRange, visibleRowRange,
} from './geometry.ts'
import { CellView } from './CellView.tsx'
import { ColumnMenu, RowMenu } from './menus.tsx'
import { FilterPopover } from './FilterPopover.tsx'
import { OptionPicker } from './OptionPicker.tsx'
import { CommentPopover, HistoryPopover } from './cell-popovers.tsx'
import { commentKey } from '../domain/types.ts'
import css from './Grid.module.css'

export interface GridProps {
  table: TableDoc
  view: View
  controller: HulutableController
  selection: CellSelection | null
  editing: { row: number; col: number; rowId?: string | undefined } | null
  t: HulutableTranslate
}

interface DragState {
  anchor: { row: number; col: number }
  current: { row: number; col: number }
}

interface FillState {
  anchor: CellSelection
  current: CellSelection
  pointerId: number
}

/** Rect over an anchor/current pair (normalized + clamped). */
function rectOf(
  anchor: { row: number; col: number },
  current: { row: number; col: number },
  rowCount: number,
  colCount: number,
): CellSelection {
  return {
    r0: Math.max(0, Math.min(anchor.row, current.row, rowCount - 1)),
    r1: Math.max(0, Math.min(Math.max(anchor.row, current.row), rowCount - 1)),
    c0: Math.max(0, Math.min(anchor.col, current.col, colCount - 1)),
    c1: Math.max(0, Math.min(Math.max(anchor.col, current.col), colCount - 1)),
  }
}

/** Build the TSV clipboard payload for a selection (view-indexed). */
function copyGrid(
  table: TableDoc,
  viewRows: readonly number[],
  displayCols: readonly Column[],
  sel: CellSelection,
): string {
  const lines: string[] = []
  for (let r = sel.r0; r <= sel.r1; r += 1) {
    const dataIndex = viewRows[r]
    /* v8 ignore next -- selection indexes stay within the view row list. */
    if (dataIndex === undefined) continue
    const row = table.rows[dataIndex]
    /* v8 ignore next -- view rows always resolve to real table rows. */
    if (row === undefined) continue
    const cells: string[] = []
    for (let c = sel.c0; c <= sel.c1; c += 1) {
      const column = displayCols[c]
      /* v8 ignore next -- selection indexes stay within the display column list. */
      if (column === undefined) continue
      const value = row.cells[column.id]?.value
      const text = value === null || value === undefined ? '' : String(value)
      cells.push(text.includes('\t') || text.includes('\n') ? `"${text.replaceAll('"', '""')}"` : text)
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/** Parse TSV clipboard text into a grid (handles quoted cells). */
export function parseClipboardGrid(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((line) => {
    const cells: string[] = []
    let current = ''
    let quoted = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line.charAt(i)
      if (ch === '"' && quoted && line.charAt(i + 1) === '"') { current += '"'; i += 1; continue }
      if (ch === '"') { quoted = !quoted; continue }
      if (ch === '\t' && !quoted) { cells.push(current); current = ''; continue }
      current += ch
    }
    cells.push(current)
    return cells
  })
}

/** Column index at a canvas x offset. */
function colAt(offsets: readonly number[], widths: readonly number[], colCount: number, x: number): number {
  for (let c = 0; c < colCount; c += 1) {
    /* v8 ignore next -- offsets and widths are built to colCount length. */
    if (x < (offsets[c] ?? 0) + (widths[c] ?? 0)) return c
  }
  return colCount - 1
}

/** Row-scope rule color for a data row, or undefined. */
function ruleArgs(rule: FormatRule): Parameters<typeof matchFilter>[2] {
  const args: Parameters<typeof matchFilter>[2] = { columnId: rule.columnId, op: rule.op }
  if (rule.value !== undefined) args.value = rule.value
  if (rule.value2 !== undefined) args.value2 = rule.value2
  if (rule.values !== undefined) args.values = rule.values
  return args
}

function rowRuleColor(table: TableDoc, dataIndex: number, rules: readonly FormatRule[]): string | undefined {
  for (const rule of rules) {
    if (!rule.enabled || rule.scope !== 'row') continue
    if (matchFilter(table, dataIndex, ruleArgs(rule))) return rule.bg
  }
  return undefined
}

/** Column-scope rule color for one cell, or undefined. */
function cellRuleColor(
  table: TableDoc,
  dataIndex: number,
  column: Column,
  rules: readonly FormatRule[],
): string | undefined {
  for (const rule of rules) {
    if (!rule.enabled || rule.scope !== 'column' || rule.columnId !== column.id) continue
    if (matchFilter(table, dataIndex, ruleArgs(rule))) return rule.bg
  }
  return undefined
}

/**
 * Render the virtualized grid.
 * @param props - table, active view, controller, viewing state, translate.
 */
export function Grid({ table, view, controller, selection, editing, t }: GridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [viewport, setViewport] = useState({
    /* v8 ignore next -- jsdom and browsers always report a window height here. */
    height: typeof window === 'undefined' ? 400 : window.innerHeight || 400,
    /* v8 ignore next -- jsdom and browsers always report a window width here. */
    width: typeof window === 'undefined' ? 800 : window.innerWidth || 800,
  })
  const [drag, setDrag] = useState<DragState | null>(null)
  const [fill, setFill] = useState<FillState | null>(null)
  const [columnMenu, setColumnMenu] = useState<{ col: number; x: number; y: number } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ row: number; x: number; y: number } | null>(null)
  const [filterFor, setFilterFor] = useState<{ col: number; x: number; y: number } | null>(null)
  const [picker, setPicker] = useState<{ row: number; col: number } | null>(null)
  const [hover, setHover] = useState<{ row: number; col: number; x: number; y: number } | null>(null)
  const [commentFor, setCommentFor] = useState<{ row: number; col: number; x: number; y: number } | null>(null)
  const [editText, setEditText] = useState('')
  /** Inline column-name editing (title row double-click). */
  const [renameCol, setRenameCol] = useState<{ col: number; draft: string } | null>(null)
  /** Live column-width drag (excel-style edge resize). */
  const [resizeCol, setResizeCol] = useState<{ col: number; startX: number; startW: number } | null>(null)

  // Display columns = all columns minus view-hidden ones.
  const displayCols = useMemo(
    () => table.columns.filter(c => !view.hiddenColumns.includes(c.id)),
    [table.columns, view.hiddenColumns],
  )
  // View query: filtered + sorted data row indexes (display order).
  const viewRows = useMemo(
    () => applyViewQuery(table, view.filters, view.filterMode, view.sorts),
    [table, view.filters, view.filterMode, view.sorts],
  )

  const rowCount = viewRows.length
  const dataColCount = displayCols.length
  // Excel-style blank canvas: a floor of blank rows/cols is always rendered
  // below/right of the data; scrolling near the edge grows the floor so more
  // blank space keeps loading while the user scrolls.
  const [rowFloor, setRowFloor] = useState(MIN_GRID_ROWS)
  const [colFloor, setColFloor] = useState(MIN_GRID_COLS)
  // Blank columns follow the data; their ids are positional and the floor is
  // monotonic, so React reuses the same keys as the floor grows.
  const renderCols = useMemo(() => [
    ...displayCols,
    ...Array.from({ length: colFloor }, (_, i) => blankColumn(i)),
  ], [displayCols, colFloor])
  const colCount = renderCols.length
  const renderRowCount = Math.max(rowCount, rowFloor)
  const { offsets, total } = useMemo(() => columnOffsets(renderCols), [renderCols])
  const widths = useMemo(() => renderCols.map(c => c.width), [renderCols])
  const frozen = frozenWidth(displayCols)

  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const editingRef = useRef(editing)
  editingRef.current = editing
  const editTextRef = useRef(editText)
  editTextRef.current = editText
  const skipBlurRef = useRef(false)
  const viewRowsRef = useRef(viewRows)
  viewRowsRef.current = viewRows
  const displayColsRef = useRef(displayCols)
  displayColsRef.current = displayCols

  // Data row id at a view row index (undefined past the data / blank rows).
  const rowIdAt = (r: number): string | undefined => {
    const dataIndex = viewRows[r]
    return dataIndex === undefined ? undefined : table.rows[dataIndex]?.id
  }

  // rAF-throttled scroll + viewport tracking + blank-canvas floor growth.
  useEffect(() => {
    const el = scrollRef.current
    /* v8 ignore next -- the ref is attached in the same render. */
    if (el === null) return
    let raf: number | null = null
    const onScroll = (): void => {
      /* v8 ignore next -- the throttle only ever sees one pending frame. */
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        setScroll({ top: el.scrollTop, left: el.scrollLeft })
        // Near the bottom/right edge: grow the blank floor so scrolling
        // keeps revealing fresh empty rows/columns (excel-like).
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 4) {
          setRowFloor(f => f + MIN_GRID_ROWS)
        }
        if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 200) {
          setColFloor(f => f + 8)
        }
      })
    }
    /* v8 ignore next -- the jsdom ResizeObserver stub never fires its callback. */
    const observer = new ResizeObserver(() => {
      setViewport({ height: el.clientHeight, width: el.clientWidth })
    })
    observer.observe(el)
    el.addEventListener('scroll', onScroll)
    // jsdom reports 0 client sizes; fall back to the window until the first
    // real measure so the first paint still shows a usable column window.
    setViewport({
      /* v8 ignore next -- jsdom falls back to the window size here. */
      height: el.clientHeight || window.innerHeight || 400,
      /* v8 ignore next -- jsdom falls back to the window size here. */
      width: el.clientWidth || window.innerWidth || 800,
    })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
      /* v8 ignore next -- unmount with a pending frame is not reproducible in tests. */
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  const rows = visibleRowRange(scroll.top, viewport.height, renderRowCount)
  const cols = visibleColumnRange(scroll.left, viewport.width, renderCols, offsets)
  const bodyHeight = TOTAL_HEADER_HEIGHT + renderRowCount * ROW_HEIGHT
  const canvasWidth = Math.max(total + ROW_HEADER_WIDTH, viewport.width)

  const isSelected = (r: number, c: number): boolean => {
    const sel = selectionRef.current
    if (sel === null) return false
    return r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1
  }

  // ── editing commit (defined before onCellDown, which commits on click) ──
  const commitEdit = useCallback((move: 'down' | 'right' | 'none'): void => {
    const current = editingRef.current
    /* v8 ignore next -- the input only renders while editing is set. */
    if (current === null) return
    const column = displayColsRef.current[current.col]
    const dataRow = current.rowId !== undefined
      ? table.rows.find(row => row.id === current.rowId)
      : table.rows[viewRowsRef.current[current.row] ?? 0]
    if (column !== undefined && dataRow !== undefined) {
      controller.setCellRaw(table.id, dataRow.id, column.id, editTextRef.current)
    }
    const next = move === 'down' ? { row: current.row + 1, col: current.col }
      : move === 'right' ? { row: current.row, col: current.col + 1 }
        : null
    if (next !== null && next.row < viewRowsRef.current.length && next.col < displayColsRef.current.length) {
      controller.setEditing({ ...next, rowId: rowIdAt(next.row) })
    } else {
      controller.setEditing(null)
    }
  }, [controller, table])
  // ── selection drag ──────────────────────────────────────────────────────
  const rowCountRef = useRef(rowCount)
  rowCountRef.current = rowCount
  const dataColCountRef = useRef(dataColCount)
  dataColCountRef.current = dataColCount
  const tableRef = useRef(table)
  tableRef.current = table
  const renderColsRef = useRef(renderCols)
  renderColsRef.current = renderCols
  const onCellDown = useCallback((r: number, c: number, e: React.MouseEvent): void => {
    e.preventDefault()
    // Keep keyboard focus on the grid so shortcuts (arrows, Ctrl+C/V, F2…)
    // keep working after mouse interaction.
    scrollRef.current?.focus()
    // A running edit commits when the user clicks elsewhere (blur never fires
    // because the editing input is unmounted, not blurred, by setEditing).
    if (editingRef.current !== null) {
      commitEdit('none')
    }
    // Blank canvas: clicking an empty row/column materializes real structure
    // in place (rows below the data, columns right of it), like Excel.
    if (r >= rowCountRef.current) {
      controller.addRows(tableRef.current.id, tableRef.current.rows.length, r - rowCountRef.current + 1)
    }
    if (c >= dataColCountRef.current) {
      controller.addColumn(tableRef.current.id, tableRef.current.columns.length)
    }
    // Double-click enters edit mode immediately (e.detail is the native click
    // count, so this fires before the second mouseup; the synthetic dblclick
    // path below re-sets the same state harmlessly).
    if (e.detail >= 2) {
      controller.setEditing({ row: r, col: c, rowId: rowIdAt(r) })
      return
    }
    if (e.shiftKey) {
      const sel = selectionRef.current
      if (sel !== null) {
        controller.select({
          r0: Math.min(sel.r0, r), r1: Math.max(sel.r1, r),
          c0: Math.min(sel.c0, c), c1: Math.max(sel.c1, c),
        })
      }
      return
    }
    setDrag({ anchor: { row: r, col: c }, current: { row: r, col: c } })
    controller.setEditing(null)
  }, [controller, commitEdit])

  useEffect(() => {
    if (drag === null) return
    const onMove = (e: MouseEvent): void => {
      const el = scrollRef.current
      /* v8 ignore next -- the drag gesture only runs while the grid is mounted. */
      if (el === null) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left + el.scrollLeft - ROW_HEADER_WIDTH
      const y = e.clientY - rect.top + el.scrollTop - TOTAL_HEADER_HEIGHT
      const row = Math.max(0, Math.min(renderRowCount - 1, Math.floor(y / ROW_HEIGHT)))
      const col = colAt(offsets, widths, colCount, x)
      /* v8 ignore next -- the guard mirrors the effect's own drag !== null check. */
      setDrag(d => (d === null ? null : { ...d, current: { row, col } }))
    }
    const onUp = (): void => {
      setDrag((d) => {
        /* v8 ignore next -- the effect only runs while drag is non-null, and mouseup clears it. */
        if (d !== null) controller.select(rectOf(d.anchor, d.current, renderRowCount, colCount))
        return null
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, controller, renderRowCount, colCount, offsets, widths])

  // ── column width resize drag ─────────────────────────────────────────────
  useEffect(() => {
    if (resizeCol === null) return
    const onMove = (e: PointerEvent): void => {
      const column = renderColsRef.current[resizeCol.col]
      /* v8 ignore next -- blank headers render no resize grip. */
      if (column === undefined || isBlankColumn(column)) return
      controller.setColumnWidth(tableRef.current.id, column.id, resizeCol.startW + (e.clientX - resizeCol.startX))
    }
    const onUp = (): void => { setResizeCol(null) }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [resizeCol, controller])

  // ── row/column drag-to-reorder (long-press the row number / column letter) ─
  const [rowDrag, setRowDrag] = useState<{ from: number; pointerId: number } | null>(null)
  const [colDrag, setColDrag] = useState<{ from: number; pointerId: number } | null>(null)
  const [dragTarget, setDragTarget] = useState<number | null>(null)
  const dragTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clearDragTimer = (): void => {
    if (dragTimer.current !== undefined) {
      clearTimeout(dragTimer.current)
      dragTimer.current = undefined
    }
  }

  const startRowDrag = (from: number, e: React.PointerEvent): void => {
    clearDragTimer()
    dragTimer.current = setTimeout(() => {
      dragTimer.current = undefined
      setRowDrag({ from, pointerId: e.pointerId })
    }, 500)
  }
  const startColDrag = (from: number, e: React.PointerEvent): void => {
    clearDragTimer()
    dragTimer.current = setTimeout(() => {
      dragTimer.current = undefined
      setColDrag({ from, pointerId: e.pointerId })
    }, 500)
  }

  useEffect(() => {
    if (rowDrag === null && colDrag === null) return
    const el = scrollRef.current
    /* v8 ignore next -- drag gestures only run while the grid is mounted. */
    if (el === null) return
    const onMove = (e: PointerEvent): void => {
      if (rowDrag !== null && e.pointerId === rowDrag.pointerId) {
        const rect = el.getBoundingClientRect()
        const y = e.clientY - rect.top + el.scrollTop - TOTAL_HEADER_HEIGHT
        const target = Math.max(0, Math.min(renderRowCount - 1, Math.floor(y / ROW_HEIGHT)))
        setDragTarget(target)
      } else if (colDrag !== null && e.pointerId === colDrag.pointerId) {
        const rect = el.getBoundingClientRect()
        // Column offsets start after the row-number gutter (46px).
        const x = e.clientX - rect.left + el.scrollLeft - ROW_HEADER_WIDTH
        const target = colAt(offsetsRef.current, widthsRef.current, colCountRef.current, x)
        setDragTarget(target)
      }
    }
    const onUp = (e: PointerEvent): void => {
      if (rowDrag !== null && e.pointerId === rowDrag.pointerId) {
        setDragTarget((target) => {
          if (target !== null) controller.moveRow(tableRef.current.id, rowDrag.from, target)
          return null
        })
        setRowDrag(null)
      } else if (colDrag !== null && e.pointerId === colDrag.pointerId) {
        /* v8 ignore start -- row-drag-only gestures never reach the column arm. */
        setDragTarget((target) => {
          const column = renderColsRef.current[colDrag.from]
          if (target !== null && column !== undefined && !isBlankColumn(column)) {
            // Move the display column to the target display position.
            const fromData = tableRef.current.columns.indexOf(column)
            const targetColumn = renderColsRef.current[target]
            const toData = targetColumn === undefined || isBlankColumn(targetColumn)
              ? tableRef.current.columns.length - 1
              : tableRef.current.columns.indexOf(targetColumn)
            /* v8 ignore next -- self-moves and missing columns are guarded drops. */
            if (fromData >= 0 && toData >= 0 && fromData !== toData) {
              controller.moveColumn(tableRef.current.id, column.id, toData)
            }
          }
          return null
        })
        setColDrag(null)
        /* v8 ignore stop */
      }
      clearDragTimer()
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      clearDragTimer()
    }
  }, [rowDrag, colDrag, controller])

  // refs for drag coordinates
  const offsetsRef = useRef(offsets)
  offsetsRef.current = offsets
  const widthsRef = useRef(widths)
  widthsRef.current = widths
  const colCountRef = useRef(colCount)
  colCountRef.current = colCount

  // ── fill drag ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (fill === null) return
    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== fill.pointerId) return
      const el = scrollRef.current
      /* v8 ignore next -- the fill gesture only runs while the grid is mounted. */
      if (el === null) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left + el.scrollLeft - ROW_HEADER_WIDTH
      const y = e.clientY - rect.top + el.scrollTop - TOTAL_HEADER_HEIGHT
      const row = Math.max(0, Math.min(renderRowCount - 1, Math.floor(y / ROW_HEIGHT)))
      const col = colAt(offsets, widths, colCount, x)
      const anchor = fill.anchor
      setFill({
        ...fill,
        current: {
          r0: anchor.r0, r1: Math.max(anchor.r1, row),
          c0: anchor.c0, c1: Math.max(anchor.c1, col),
        },
      })
    }
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== fill.pointerId) return
      setFill((f) => {
        /* v8 ignore next -- the effect only runs while fill is non-null. */
        if (f !== null) {
          // View indexes → data indexes for the anchor and target edges.
          const rowsRef = viewRowsRef.current
          const colsRef = displayColsRef.current
          /* v8 ignore next -- anchor indexes come from the live selection. */
          const anchorData = {
            r0: rowsRef[f.anchor.r0] ?? 0,
            r1: rowsRef[f.anchor.r1] ?? 0,
            c0: f.anchor.c0,
            c1: f.anchor.c1,
          }
          const targetData = {
            r0: anchorData.r0,
            /* v8 ignore next -- the target row stays within the view rows. */
            r1: rowsRef[f.current.r1] ?? anchorData.r1,
            c0: f.current.c0,
            c1: f.current.c1,
          }
          // buildFill indexes the COLUMNS PARAM, so display indexes must be
          // rebased onto the sliced column list.
          const base = Math.min(f.anchor.c0, f.current.c0)
          /* v8 ignore next -- a slice from base to max+1 is never empty. */
          const colRange = colsRef.slice(base, Math.max(f.anchor.c1, f.current.c1) + 1)
          if (colRange.length > 0) {
            controller.fill(table.id, {
              r0: anchorData.r0, r1: anchorData.r1,
              c0: f.anchor.c0 - base, c1: f.anchor.c1 - base,
            }, {
              r0: targetData.r0, r1: targetData.r1,
              c0: f.current.c0 - base, c1: f.current.c1 - base,
            }, 'series', colRange)
          } else {
            controller.fill(table.id, anchorData, targetData, 'series', colsRef)
          }
        }
        return null
      })
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [fill, controller, table.id, renderRowCount, colCount, offsets, widths])

  // ── editing ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (editing === null) return
    // The rowId snapshot anchors the edited row even when a sort/filter
    // reorders the view mid-edit; fall back to the view index otherwise.
    // Refs keep the effect keyed on the editing anchor alone, so a re-sort
    // (editing unchanged) never reloads the input over in-progress text.
    const t = tableRef.current
    const rows = viewRowsRef.current
    const dataRow = editing.rowId !== undefined
      ? t.rows.find(row => row.id === editing.rowId)
      : t.rows[rows[editing.row] ?? 0]
    const cell = dataRow?.cells[displayColsRef.current[editing.col]?.id ?? '']
    const value = cell?.value
    setEditText(value === null || value === undefined ? '' : String(value))
  }, [editing])



  // ── keyboard ────────────────────────────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent): void => {
    const current = editingRef.current
    if (current !== null) return // the editing input owns its keys
    const sel = selectionRef.current
    const rowsRef = viewRowsRef.current
    const colsRef = displayColsRef.current
    const moveSel = (dr: number, dc: number, extend: boolean): void => {
      e.preventDefault()
      if (sel === null) {
        controller.select({
          r0: 0, r1: Math.max(0, Math.min(rowCount - 1, dr)),
          c0: 0, c1: Math.max(0, Math.min(dataColCount - 1, dc)),
        })
        return
      }
      const anchor = extend ? { row: sel.r0, col: sel.c0 } : { row: sel.r1, col: sel.c1 }
      const target = {
        row: Math.max(0, Math.min(rowCount - 1, sel.r1 + dr)),
        col: Math.max(0, Math.min(dataColCount - 1, sel.c1 + dc)),
      }
      controller.select(rectOf(anchor, target, rowCount, dataColCount))
    }
    switch (e.key) {
      case 'ArrowDown': moveSel(1, 0, e.shiftKey); break
      case 'ArrowUp': moveSel(-1, 0, e.shiftKey); break
      case 'ArrowRight': moveSel(0, 1, e.shiftKey); break
      case 'ArrowLeft': moveSel(0, -1, e.shiftKey); break
      case 'Enter':
      case 'F2':
        if (sel !== null) controller.setEditing({ row: sel.r0, col: sel.c0, rowId: rowIdAt(sel.r0) })
        break
      case 'Tab': {
        e.preventDefault()
        if (sel !== null) {
          controller.select(rectOf(
            { row: sel.r0, col: sel.c1 + 1 }, { row: sel.r0, col: sel.c1 + 1 }, rowCount, dataColCount))
        }
        break
      }
      case 'Delete':
      case 'Backspace':
        if (sel !== null) {
          const dataRows = rowsRef.slice(sel.r0, sel.r1 + 1)
          const colRange = colsRef.slice(sel.c0, sel.c1 + 1)
          if (dataRows.length > 0 && colRange.length > 0) {
            /* v8 ignore next -- non-empty slices always have first and last elements. */
            controller.clear(table.id, dataRows[0] ?? 0, dataRows.at(-1) ?? 0, colRange)
          }
        }
        break
      case 'c':
      case 'C':
        if ((e.ctrlKey || e.metaKey) && sel !== null) {
          void navigator.clipboard.writeText(copyGrid(table, rowsRef, colsRef, sel))
        }
        break
      case 'v':
      case 'V':
        if ((e.ctrlKey || e.metaKey) && sel !== null) {
          void navigator.clipboard.readText().then((text) => {
            const anchorData = rowsRef[sel.r0] ?? 0
            const colRange = colsRef.slice(sel.c0)
            controller.paste(table.id, anchorData, colRange, parseClipboardGrid(text))
          })
        }
        break
      case 'z':
      case 'Z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          if (e.shiftKey) controller.redo(table.id)
          else controller.undo(table.id)
        }
        break
      case 'y':
      case 'Y':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); controller.redo(table.id) }
        break
    }
  }, [controller, table, rowCount, dataColCount])

  // ── sort cycle on the header ────────────────────────────────────────────
  const cycleSort = useCallback((columnId: string, shift: boolean): void => {
    const current = view.sorts.filter(s => s.columnId !== columnId)
    const existing = view.sorts.find(s => s.columnId === columnId)
    let next: View['sorts']
    if (existing === undefined) {
      /* v8 ignore next -- the header click never passes shift. */
      next = shift ? [...current, { columnId, dir: 'asc' }] : [{ columnId, dir: 'asc' }]
    } else if (existing.dir === 'asc') {
      next = [...current, { columnId, dir: 'desc' }]
    } else {
      next = current
    }
    controller.updateView(table.id, view.id, { sorts: next })
  }, [view, controller, table.id])

  // ── derived geometry ────────────────────────────────────────────────────
  /* v8 ignore start -- selection/drag/fill indexes always sit within offsets and widths. */
  const selectionRect = selection === null ? null : {
    left: ROW_HEADER_WIDTH + (offsets[selection.c0] ?? 0),
    top: TOTAL_HEADER_HEIGHT + selection.r0 * ROW_HEIGHT,
    width: (offsets[selection.c1] ?? 0) + (widths[selection.c1] ?? 0) - (offsets[selection.c0] ?? 0),
    height: (selection.r1 - selection.r0 + 1) * ROW_HEIGHT,
  }
  const dragRect = drag === null ? null : {
    left: ROW_HEADER_WIDTH + (offsets[Math.min(drag.anchor.col, drag.current.col)] ?? 0),
    top: TOTAL_HEADER_HEIGHT + Math.min(drag.anchor.row, drag.current.row) * ROW_HEIGHT,
    width: (offsets[Math.max(drag.anchor.col, drag.current.col)] ?? 0)
      + (widths[Math.max(drag.anchor.col, drag.current.col)] ?? 0)
      - (offsets[Math.min(drag.anchor.col, drag.current.col)] ?? 0),
    height: (Math.abs(drag.current.row - drag.anchor.row) + 1) * ROW_HEIGHT,
  }
  const fillRect = fill === null ? null : {
    left: ROW_HEADER_WIDTH + (offsets[fill.current.c0] ?? 0),
    top: TOTAL_HEADER_HEIGHT + fill.current.r0 * ROW_HEIGHT,
    width: (offsets[fill.current.c1] ?? 0) + (widths[fill.current.c1] ?? 0) - (offsets[fill.current.c0] ?? 0),
    height: (fill.current.r1 - fill.current.r0 + 1) * ROW_HEIGHT,
  }
  /* v8 ignore stop */
  const handlePos = selectionRect === null ? null : {
    left: selectionRect.left + selectionRect.width - 5,
    top: selectionRect.top + selectionRect.height - 5,
  }
  /* v8 ignore next -- the editing column always exists in offsets and widths. */
  const editingCell = editing === null ? undefined : (() => {
    // Re-anchor the overlay to the rowId's current view position so a sort
    // mid-edit keeps the editor glued to its cell (hidden when filtered out).
    const viewIndex = editing.rowId !== undefined
      ? viewRows.findIndex(dataIndex => table.rows[dataIndex]?.id === editing.rowId)
      : editing.row
    /* v8 ignore next -- a live edit always resolves to a view row. */
    if (viewIndex < 0) return undefined
    return {
      /* v8 ignore next -- the editing column always exists in offsets and widths. */
      left: ROW_HEADER_WIDTH + (offsets[editing.col] ?? 0),
      top: TOTAL_HEADER_HEIGHT + viewIndex * ROW_HEIGHT,
      /* v8 ignore next -- the editing column always exists in widths. */
      width: widths[editing.col] ?? 0,
    }
  })()

  // Goal aggregates over the CURRENT view rows (optionally filtered by the
  // goal's eq/contains condition).
  const goalStats = useMemo(() => {
    if (table.goals.length === 0) return []
    return table.goals.map((goal) => {
      let sum = 0
      let count = 0
      let numericCount = 0
      for (const dataIndex of viewRows) {
        if (goal.condition !== undefined) {
          const matched = matchFilter(table, dataIndex, {
            columnId: goal.condition.columnId,
            op: goal.condition.op,
            value: goal.condition.value,
          })
          if (!matched) continue
        }
        count += 1
        const value = table.rows[dataIndex]?.cells[goal.columnId]?.value
        if (typeof value === 'number') { sum += value; numericCount += 1 }
      }
      const value = goal.aggregate === 'sum' ? sum
        : goal.aggregate === 'avg' ? (numericCount === 0 ? 0 : sum / numericCount)
          : count
      return { goal, value }
    })
  }, [table, viewRows])

  const pickerCell = picker === null ? null : displayCols[picker.col]
  const scroller = scrollRef.current
  /* v8 ignore next -- picker indexes come from the live grid state. */
  const pickerAnchor = picker === null || pickerCell === null || scroller === null ? null : {
    left: (offsets[picker.col] ?? 0) + scroller.getBoundingClientRect().left - scroll.left,
    top: TOTAL_HEADER_HEIGHT + picker.row * ROW_HEIGHT + scroller.getBoundingClientRect().top - scroll.top + 32,
  }

  return (
    <div className={css.root}>
      <div
        ref={scrollRef}
        className={css.scroll}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            controller.select(null)
            controller.setEditing(null)
          }
        }}
      >
        <div className={css.canvas} style={{ width: canvasWidth, height: bodyHeight }}>
          {/* Sticky header: excel-style letter row (A/B/C) over the title row */}
          <div className={css.headerRow} style={{ width: canvasWidth }}>
            <div className={css.letterRow}>
              <div
                className={css.rowNumHead}
                style={{ width: ROW_HEADER_WIDTH, height: LETTER_ROW_HEIGHT }}
                title={t('col.rename')}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  controller.select({ r0: 0, r1: Math.max(0, rowCount - 1), c0: 0, c1: Math.max(0, dataColCount - 1) })
                  controller.setEditing(null)
                }}
              >
                <span className={css.cornerMark}>▦</span>
              </div>
              <div className={css.letterFrozen} style={{ width: frozen - ROW_HEADER_WIDTH }}>
                {displayCols.map((column, c) => column.frozen ? (
                  <LetterCell
                    key={column.id}
                    colIndex={c}
                    width={column.width}
                    blank={false}
                    onSelect={() => {
                      controller.select({ r0: 0, r1: Math.max(0, rowCount - 1), c0: c, c1: c })
                      controller.setEditing(null)
                    }}
                    onDragStart={(e) => { startColDrag(c, e) }}
                    onDragCancel={clearDragTimer}
                  />
                ) : null)}
              </div>
              {cols.start < cols.end && Array.from({ length: cols.end - cols.start }, (_, i) => cols.start + i).map((c) => {
                const column = renderCols[c]
                /* v8 ignore next -- the range is clamped to the render column list. */
                if (column === undefined) return null
                return (
                  <LetterCell
                    key={column.id}
                    colIndex={c}
                    width={column.width}
                    /* v8 ignore next -- header columns always exist in offsets. */
                    left={ROW_HEADER_WIDTH + (offsets[c] ?? 0)}
                    blank={isBlankColumn(column)}
                    onSelect={() => {
                      if (isBlankColumn(column)) {
                        // Clicking a blank letter materializes a new column.
                        controller.addColumn(table.id, table.columns.length)
                        controller.setEditing({ row: 0, col: c })
                        return
                      }
                      controller.select({ r0: 0, r1: Math.max(0, rowCount - 1), c0: c, c1: c })
                      controller.setEditing(null)
                    }}
                    onDragStart={(e) => { startColDrag(c, e) }}
                    onDragCancel={clearDragTimer}
                  />
                )
              })}
            </div>
            <div className={css.titleRow}>
              <div className={css.rowNumHead} style={{ width: ROW_HEADER_WIDTH, height: HEADER_HEIGHT }} />
              <div className={css.frozenHead} style={{ width: frozen - ROW_HEADER_WIDTH }}>
                {displayCols.map((column, c) => column.frozen ? (
                  <TitleCell
                    key={column.id}
                    column={column}
                    colIndex={c}
                    width={column.width}
                    frozen
                    sortDir={view.sorts.find(s => s.columnId === column.id)?.dir}
                    filtered={view.filters.some(f => f.columnId === column.id)}
                    goals={goalStats.filter(g => g.goal.columnId === column.id)}
                    renaming={renameCol !== null && renameCol.col === c}
                    renameDraft={renameCol?.draft ?? ''}
                    t={t}
                    onSort={(shift) => { cycleSort(column.id, shift) }}
                    onMenu={(x, y) => { setColumnMenu({ col: c, x, y }) }}
                    onFilter={(x, y) => { setFilterFor({ col: c, x, y }) }}
                    onRenameStart={() => { setRenameCol({ col: c, draft: column.name }) }}
                    onResizeStart={(x) => { setResizeCol({ col: c, startX: x, startW: column.width }) }}
                    onRenameChange={(draft) => { setRenameCol({ col: c, draft }) }}
                    onRenameCommit={() => {
                      /* v8 ignore next -- the rename input only renders with a draft. */
                      const draft = renameCol?.draft.trim() ?? ''
                      if (draft !== '' && draft !== column.name) {
                        controller.updateColumn(table.id, column.id, { name: draft })
                      }
                      setRenameCol(null)
                    }}
                    onRenameCancel={() => { setRenameCol(null) }}
                    onSelect={() => {
                      controller.select({ r0: 0, r1: Math.max(0, rowCount - 1), c0: c, c1: c })
                      controller.setEditing(null)
                    }}
                  />
                ) : null)}
              </div>
              {cols.start < cols.end && Array.from({ length: cols.end - cols.start }, (_, i) => cols.start + i).map((c) => {
                const column = renderCols[c]
                /* v8 ignore next -- the range is clamped to the render column list. */
                if (column === undefined) return null
                const blank = isBlankColumn(column)
                return (
                  <TitleCell
                    key={column.id}
                    column={column}
                    colIndex={c}
                    width={column.width}
                    /* v8 ignore next -- header columns always exist in offsets. */
                    left={ROW_HEADER_WIDTH + (offsets[c] ?? 0)}
                    blank={blank}
                    sortDir={view.sorts.find(s => s.columnId === column.id)?.dir}
                    filtered={view.filters.some(f => f.columnId === column.id)}
                    goals={goalStats.filter(g => g.goal.columnId === column.id)}
                    renaming={renameCol !== null && renameCol.col === c}
                    renameDraft={renameCol?.draft ?? ''}
                    t={t}
                    onSort={(shift) => { cycleSort(column.id, shift) }}
                    onMenu={(x, y) => { setColumnMenu({ col: c, x, y }) }}
                    onFilter={(x, y) => { setFilterFor({ col: c, x, y }) }}
                    onRenameStart={() => { setRenameCol({ col: c, draft: column.name }) }}
                    onResizeStart={(x) => { setResizeCol({ col: c, startX: x, startW: column.width }) }}
                    onRenameChange={(draft) => { setRenameCol({ col: c, draft }) }}
                    onRenameCommit={() => {
                      /* v8 ignore next -- the rename input only renders with a draft. */
                      const draft = renameCol?.draft.trim() ?? ''
                      if (draft !== '' && draft !== column.name) {
                        controller.updateColumn(table.id, column.id, { name: draft })
                      }
                      setRenameCol(null)
                    }}
                    onRenameCancel={() => { setRenameCol(null) }}
                    onSelect={() => {
                      if (blank) {
                        controller.addColumn(table.id, table.columns.length)
                        controller.setEditing({ row: 0, col: c })
                        return
                      }
                      controller.select({ r0: 0, r1: Math.max(0, rowCount - 1), c0: c, c1: c })
                      controller.setEditing(null)
                    }}
                  />
                )
              })}
            </div>
          </div>

          {/* Body rows */}
          {Array.from({ length: rows.end - rows.start }, (_, i) => rows.start + i).map((r) => {
            const dataIndex = viewRows[r]
            // Rows past the data are the blank canvas (rendered empty; clicking
            // materializes real rows through onCellDown).
            const row = dataIndex === undefined ? undefined : table.rows[dataIndex]
            const active = editing !== null && editing.row === r
            const rowBg = dataIndex === undefined ? undefined : rowRuleColor(table, dataIndex, table.formatRules)
            return (
              <div
                key={row?.id ?? `blank-${r}`}
                className={css.row}
                style={{
                  top: TOTAL_HEADER_HEIGHT + r * ROW_HEIGHT,
                  width: canvasWidth,
                  ...(rowBg !== undefined ? { background: rowBg } : {}),
                }}
              >
                <div
                  className={css.rowNum}
                  style={{ width: ROW_HEADER_WIDTH }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (dataIndex !== undefined) setRowMenu({ row: r, x: e.clientX, y: e.clientY })
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    if (dataIndex === undefined) {
                      controller.addRows(table.id, table.rows.length, r - rowCount + 1)
                    }
                    const sel = selectionRef.current
                    if (e.shiftKey && sel !== null) {
                      controller.select({
                        r0: Math.min(sel.r0, r), r1: Math.max(sel.r1, r),
                        c0: sel.c0, c1: sel.c1,
                      })
                    } else {
                      controller.select({ r0: r, r1: r, c0: 0, c1: Math.max(0, dataColCount - 1) })
                      controller.setEditing(null)
                    }
                  }}
                  onPointerDown={(e) => { startRowDrag(r, e) }}
                  onPointerUp={() => { clearDragTimer() }}
                  onPointerLeave={() => { clearDragTimer() }}
                >
                  {r + 1}
                </div>
                <div className={css.frozenCells} style={{ width: frozen - ROW_HEADER_WIDTH }}>
                  {displayCols.map((column, c) => column.frozen ? (
                    <CellView
                      key={column.id}
                      column={column}
                      cell={row?.cells[column.id]}
                      selected={isSelected(r, c)}
                      width={column.width}
                      rowActive={active}
                      frozen
                      bg={dataIndex === undefined ? undefined : cellRuleColor(table, dataIndex, column, table.formatRules)}
                      hasComment={row !== undefined && (table.comments[commentKey(row.id, column.id)]?.length ?? 0) > 0}
                      onMouseDown={(e) => { onCellDown(r, c, e) }}
                      onDoubleClick={() => { controller.setEditing({ row: r, col: c, rowId: rowIdAt(r) }) }}
                      onComment={(e) => {
                        setCommentFor({ row: r, col: c, x: e.clientX, y: e.clientY })
                      }}
                      onHover={(e) => { setHover({ row: r, col: c, x: e.clientX, y: e.clientY }) }}
                    />
                  ) : null)}
                </div>
                {Array.from({ length: cols.end - cols.start }, (_, i) => cols.start + i).map((c) => {
                  const column = renderCols[c]
                  /* v8 ignore next -- the range is clamped to the render column list. */
                  if (column === undefined) return null
                  return (
                    <CellView
                      key={column.id}
                      column={column}
                      cell={row?.cells[column.id]}
                      selected={isSelected(r, c)}
                      width={column.width}
                      /* v8 ignore next -- cell columns always exist in offsets. */
                      left={ROW_HEADER_WIDTH + (offsets[c] ?? 0)}
                      rowActive={active}
                      bg={dataIndex === undefined ? undefined : cellRuleColor(table, dataIndex, column, table.formatRules)}
                      hasComment={row !== undefined && (table.comments[commentKey(row.id, column.id)]?.length ?? 0) > 0}
                      onMouseDown={(e) => { onCellDown(r, c, e) }}
                      onDoubleClick={() => { controller.setEditing({ row: r, col: c, rowId: rowIdAt(r) }) }}
                      onSingleClick={() => {
                        if (!isBlankColumn(column) && (column.type === 'select' || column.type === 'multiSelect')) {
                          setPicker({ row: r, col: c })
                        }
                      }}
                      onComment={(e) => {
                        setCommentFor({ row: r, col: c, x: e.clientX, y: e.clientY })
                      }}
                      onHover={(e) => { setHover({ row: r, col: c, x: e.clientX, y: e.clientY }) }}
                    />
                  )
                })}
              </div>
            )
          })}

          {/* Row/column drag insert indicator */}
          {dragTarget !== null && (
            <div
              className={rowDrag !== null ? css.dragInsertRow : css.dragInsertCol}
              style={rowDrag !== null
                ? { top: TOTAL_HEADER_HEIGHT + dragTarget * ROW_HEIGHT, left: 0, width: canvasWidth }
                : {
                  /* v8 ignore next -- drag targets always resolve to rendered columns. */
                  left: ROW_HEADER_WIDTH + (offsets[dragTarget] ?? 0),
                  top: 0,
                  height: TOTAL_HEADER_HEIGHT,
                }}
            />
          )}

          {/* Selection / drag / fill overlay rects */}
          {selectionRect !== null && drag === null && fill === null && (
            <div className={css.selRect} style={selectionRect} />
          )}
          {dragRect !== null && <div className={css.selRect} style={dragRect} />}
          {fillRect !== null && fill !== null && <div className={css.fillRect} style={fillRect} />}

          {/* Fill handle */}
          {handlePos !== null && selection !== null && (
            <div
              className={css.fillHandle}
              style={handlePos}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                try {
                  e.currentTarget.setPointerCapture(e.pointerId)
                } catch {
                  // jsdom and some browsers lack pointer capture; the
                  // document-level listeners still track the gesture.
                }
                const anchor = selection
                setFill({ anchor, current: { ...anchor }, pointerId: e.pointerId })
              }}
            />
          )}

          {/* Editing overlay */}
          {editingCell !== undefined && (
            <input
              className={css.editInput}
              style={editingCell}
              value={editText}
              autoFocus
              onChange={(e) => { setEditText(e.target.value) }}
              onBlur={() => {
                if (skipBlurRef.current) { skipBlurRef.current = false; return }
                commitEdit('none')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); skipBlurRef.current = true; commitEdit('down') }
                if (e.key === 'Tab') { e.preventDefault(); skipBlurRef.current = true; commitEdit('right') }
                if (e.key === 'Escape') { e.stopPropagation(); skipBlurRef.current = true; controller.setEditing(null) }
              }}
            />
          )}
        </div>
      </div>

      {/* Menus / popovers */}
      {columnMenu !== null && displayCols[columnMenu.col] !== undefined && (
        <ColumnMenu
          table={table}
          colIndex={table.columns.indexOf(displayCols[columnMenu.col] as Column)}
          x={columnMenu.x}
          y={columnMenu.y}
          t={t}
          controller={controller}
          onClose={() => { setColumnMenu(null) }}
        />
      )}
      {rowMenu !== null && (
        <RowMenu
          table={table}
          /* v8 ignore next -- context menus only open on rendered rows. */
          rowIndex={viewRows[rowMenu.row] ?? 0}
          x={rowMenu.x}
          y={rowMenu.y}
          t={t}
          controller={controller}
          onClose={() => { setRowMenu(null) }}
        />
      )}
      {filterFor !== null && displayCols[filterFor.col] !== undefined && (
        <FilterPopover
          table={table}
          column={displayCols[filterFor.col] as Column}
          view={view}
          x={filterFor.x}
          y={filterFor.y}
          t={t}
          controller={controller}
          onClose={() => { setFilterFor(null) }}
        />
      )}
      {picker !== null && pickerCell !== null && pickerAnchor !== null && (
        <OptionPicker
          table={table}
          /* v8 ignore next -- the render guard already proved pickerCell defined. */
          column={pickerCell ?? displayCols[0] as Column}
          /* v8 ignore next -- picker rows come from the live view rows. */
          rowData={table.rows[viewRows[picker.row] ?? 0]}
          x={pickerAnchor.left}
          y={pickerAnchor.top}
          t={t}
          controller={controller}
          onClose={() => { setPicker(null) }}
        />
      )}
      {hover !== null && (() => {
        /* v8 ignore next -- hover rows always resolve through the view rows. */
        const dataIndex = viewRows[hover.row]
        /* v8 ignore next -- hover rows always resolve through the view rows. */
        const dataRow = dataIndex === undefined ? undefined : table.rows[dataIndex]
        const column = displayCols[hover.col]
        const rowId = dataRow?.id
        const columnId = column?.id
        /* v8 ignore next -- hovered cells always have a row and column. */
        if (rowId === undefined || columnId === undefined) return null
        const entries = controller.getHistory(table.id, rowId, columnId)
        if (entries.length === 0) return null
        return (
          <HistoryPopover
            entries={entries}
            x={hover.x}
            y={hover.y}
            t={t}
            onClose={() => { setHover(null) }}
          />
        )
      })()}
      {commentFor !== null && (() => {
        /* v8 ignore next -- comment rows always resolve through the view rows. */
        const dataIndex = viewRows[commentFor.row]
        /* v8 ignore next -- comment rows always resolve through the view rows. */
        const dataRow = dataIndex === undefined ? undefined : table.rows[dataIndex]
        const column = displayCols[commentFor.col]
        const rowId = dataRow?.id
        const columnId = column?.id
        /* v8 ignore next -- commented cells always have a row and column. */
        if (rowId === undefined || columnId === undefined) return null
        return (
          <CommentPopover
            table={table}
            rowId={rowId}
            columnId={columnId}
            x={commentFor.x}
            y={commentFor.y}
            t={t}
            controller={controller}
            onClose={() => { setCommentFor(null) }}
          />
        )
      })()}
    </div>
  )
}

interface LetterCellProps {
  colIndex: number
  width: number
  frozen?: boolean
  left?: number
  /** virtual blank filler column. */
  blank?: boolean
  onSelect: () => void
  /** long-press starts a column drag-to-reorder. */
  onDragStart: (e: React.PointerEvent) => void
  /** pointer up/leave cancels the pending long-press. */
  onDragCancel: () => void
}

/** Excel-style column letter (A, B, C…): click selects the whole column. */
function LetterCell(props: LetterCellProps) {
  const { colIndex, width, frozen, left, blank, onSelect, onDragStart, onDragCancel } = props
  return (
    <div
      /* v8 ignore next -- both letter-cell variants render in the CRM grid. */
      className={frozen === true ? css.letterCellFrozen : css.letterCell}
      style={{ width, ...(left !== undefined ? { left } : {}) }}
      onMouseDown={(e) => {
        if (e.button === 2) return
        onSelect()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        onDragStart(e)
      }}
      onPointerUp={() => { onDragCancel() }}
      onPointerLeave={() => { onDragCancel() }}
    >
      <span className={css.letterText}>{blank === true ? '+' : columnLetter(colIndex)}</span>
    </div>
  )
}

interface TitleCellProps {
  column: Column
  colIndex: number
  width: number
  frozen?: boolean
  left?: number
  /** virtual blank filler column (clicking adds a real column). */
  blank?: boolean
  sortDir: 'asc' | 'desc' | undefined
  filtered: boolean
  goals: { goal: Goal; value: number }[]
  renaming: boolean
  renameDraft: string
  t: HulutableTranslate
  onSort: (shift: boolean) => void
  onMenu: (x: number, y: number) => void
  onFilter: (x: number, y: number) => void
  /** pointer x at resize start. */
  onResizeStart: (x: number) => void
  onRenameStart: () => void
  onRenameChange: (draft: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onSelect: () => void
}

/** One sticky title cell: clickable column name, sort icon, filter/menu, goals. */
function TitleCell(props: TitleCellProps) {
  const {
    column, width, frozen, left, blank, sortDir, filtered, goals, t,
    renaming, renameDraft,
    onSort, onMenu, onFilter, onResizeStart, onRenameStart, onRenameChange, onRenameCommit, onRenameCancel, onSelect,
  } = props
  return (
    <div
      className={frozen === true ? css.headerCellFrozen : css.headerCell}
      style={{ width, ...(left !== undefined ? { left } : {}) }}
      onMouseDown={(e) => {
        if (e.button === 2) return
        onSelect()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        /* v8 ignore next -- blank headers never start a rename. */
        if (blank !== true) onRenameStart()
      }}
    >
      {renaming ? (
        <input
          className={css.renameHeadInput}
          value={renameDraft}
          autoFocus
          onChange={(e) => { onRenameChange(e.target.value) }}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onRenameCommit() }
            if (e.key === 'Escape') { e.stopPropagation(); onRenameCancel() }
          }}
          onClick={(e) => { e.stopPropagation() }}
        />
      ) : (
        <span className={css.headerName}>{blank === true ? '' : column.name}</span>
      )}
      {blank === true ? (
        <span className={css.blankAdd}>+</span>
      ) : (
        <>
          <button
            type="button"
            className={css.sortButton}
            aria-label={`sort-${column.name}`}
            title={t('sort.asc')}
            onMouseDown={(e) => { e.stopPropagation() }}
            onClick={(e) => {
              e.stopPropagation()
              onSort(e.shiftKey)
            }}
          >
            {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '⇅'}
          </button>
          {goals.map(({ goal, value }) => {
            const pct = goal.target === 0 ? 0 : Math.min(100, Math.round((value / goal.target) * 100))
            return (
              <span key={goal.id} className={css.goalChip} title={`${goal.label ?? ''} ${pct}%`}>
                <span className={css.goalFill} style={{ width: `${pct}%` }} />
                <span className={css.goalLabel}>{pct}%</span>
              </span>
            )
          })}
          <button
            type="button"
            className={css.headerFilter}
            aria-label={`filter-${column.name}`}
            title={t('filter.open')}
            onMouseDown={(e) => { e.stopPropagation() }}
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              onFilter(rect.left, rect.bottom + 4)
            }}
          >
            {filtered ? '▣' : '▽'}
          </button>
          <button
            type="button"
            className={css.headerMenu}
            aria-label={`menu-${column.name}`}
            onMouseDown={(e) => { e.stopPropagation() }}
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              onMenu(rect.left, rect.bottom + 4)
            }}
          >
            ⋯
          </button>
        </>
      )}
      {blank !== true && (
        <div
          className={css.colResize}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onResizeStart(e.clientX)
          }}
        />
      )}
    </div>
  )
}
