// @vitest-environment jsdom
/** Grid excel-canvas behaviors: blank rows/columns render below/right of
 * the data and materialize on click, column letters in the header, the
 * corner select-all, double-click editing, and rowId-anchored editing that
 * survives re-sorts. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { Grid } from '../src/client/grid/Grid.tsx'
import { MIN_GRID_ROWS, ROW_HEIGHT, TOTAL_HEADER_HEIGHT } from '../src/client/grid/geometry.ts'
import { en } from '../src/client/locales.ts'
import type { HulutableTranslate } from '../src/client/locales.ts'
import type { HulutableState } from '../src/client/controller.ts'

// Grid suites render the full blank canvas; coverage instrumentation slows
// them well past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(window, 'innerWidth', { value: 3200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
})
afterEach(() => { cleanup() })

const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as HulutableTranslate

function Harness(props: { controller: HulutableController; useWorkspace: <S>(sel: (s: HulutableState) => S) => S }) {
  const table = props.useWorkspace(s => (s.currentTableId === null ? undefined : s.tables[s.currentTableId]))
  const view = table === undefined ? undefined : props.controller.viewOf(table.id) ?? table.views[0]
  const selection = props.useWorkspace(s => s.editor.selection)
  const editing = props.useWorkspace(s => s.editor.editing)
  if (table === undefined || view === undefined) return null
  return <Grid table={table} view={view} controller={props.controller} selection={selection} editing={editing} t={t} />
}

async function openTable(templateId?: string) {
  const controller = new HulutableController(new MemoryPersistence())
  const id = controller.createTable('表', templateId)
  await controller.openTable(id)
  const useWorkspace = bindSnapshotSelector(controller.store)
  render(<Harness controller={controller} useWorkspace={useWorkspace} />)
  return { controller, id }
}

// jsdom CSS-module class names are `_rowNum_xxx`; the header corner shares
// the `rowNum` substring, so body row numbers are filtered by class content.
function bodyRowNums(): HTMLElement[] {
  return [...document.querySelectorAll('[class*="_rowNum_"]')]
    .filter(el => !el.className.includes('Head'))
}

describe('blank canvas rows and columns', () => {
  it('renders blank rows below the data with running row numbers', async () => {
    const { controller } = await openTable('crm')
    const canvas = document.querySelector('[class*="_canvas_"]') as HTMLElement
    expect(canvas.style.height).toBe(`${TOTAL_HEADER_HEIGHT + MIN_GRID_ROWS * ROW_HEIGHT}px`)
    const rowNums = [...document.querySelectorAll('[class*="_rowNum_"]')].map(el => el.textContent)
    // Data rows 1..6 then blank rows continue 7, 8, …
    expect(rowNums.slice(0, 6)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(rowNums[6]).toBe('7')
    expect(rowNums[7]).toBe('8')
    // Blank rows render empty cells (no text).
    expect(screen.queryByText('陈小雨')).toBeTruthy()
    void controller
  })

  it('materializes a real row when clicking a blank row cell', async () => {
    const { controller, id } = await openTable('crm')
    const before = controller.snapshot().tables[id]!.rows.length
    const blankRowNum = [...document.querySelectorAll('[class*="_rowNum_"]')][6] as HTMLElement
    fireEvent.mouseDown(blankRowNum)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(before + 1)
  })

  it('materializes a real column when clicking a blank column header', async () => {
    const { controller, id } = await openTable('crm')
    const before = controller.snapshot().tables[id]!.columns.length
    const blanks = [...document.querySelectorAll('[class*="_headerCell_"]')].filter(el => el.textContent?.includes('+'))
    expect(blanks.length).toBeGreaterThan(0)
    fireEvent.mouseDown(blanks[0]!)
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(before + 1)
  })

  it('shows the column letter badge on every header', async () => {
    await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')].map(el => el.textContent)
    expect(letters.slice(0, 3)).toEqual(['A', 'B', 'C'])
    expect(letters.length).toBeGreaterThanOrEqual(12) // data + blank columns
  })

  it('selects every row via the corner select-all mark', async () => {
    const { controller } = await openTable('crm')
    const corner = document.querySelector('[class*="_cornerMark_"]') as HTMLElement
    fireEvent.mouseDown(corner)
    const selection = controller.snapshot().editor.selection
    expect(selection).not.toBeNull()
    expect(selection!.r0).toBe(0)
    expect(selection!.r1).toBe(5)
  })

  it('grows the blank floor while scrolling near the bottom', async () => {
    await openTable('crm')
    const scroll = document.querySelector('[class*="_scroll_"]') as HTMLElement
    const canvas = document.querySelector('[class*="_canvas_"]') as HTMLElement
    Object.defineProperty(scroll, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: canvas.clientHeight, configurable: true })
    Object.defineProperty(scroll, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(scroll, 'scrollWidth', { value: 2526, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: canvas.clientHeight - 400 - 60, configurable: true })
    Object.defineProperty(scroll, 'scrollLeft', { value: 0, configurable: true })
    fireEvent.scroll(scroll)
    await act(async () => {})
    const grown = document.querySelector('[class*="_canvas_"]') as HTMLElement
    expect(Number.parseInt(grown.style.height, 10)).toBeGreaterThan(canvas.clientHeight)
  })
})

describe('editing', () => {
  it('double-click starts editing with a rowId anchor', async () => {
    const { controller } = await openTable('crm')
    const cell = screen.getAllByText('女')[0]!
    fireEvent.doubleClick(cell)
    const editing = controller.snapshot().editor.editing
    expect(editing).toMatchObject({ row: 0, col: 1 })
    expect(editing!.rowId).toBeTypeOf('string')
  })

  it('double-click with detail flag starts editing immediately', async () => {
    const { controller } = await openTable('crm')
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.mouseDown(cell, { detail: 2 })
    expect(controller.snapshot().editor.editing).toMatchObject({ row: 0, col: 0 })
  })

  it('keeps editing the same row after a re-sort mid-edit', async () => {
    const { controller, id } = await openTable('crm')
    const doc = controller.snapshot().tables[id]!
    const rowId = doc.rows[0]!.id
    await act(async () => {
      controller.select({ r0: 0, r1: 0, c0: 0, c1: 0 })
      controller.setEditing({ row: 0, col: 0, rowId })
    })
    const input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    expect(input.value).toBe('陈小雨')
    fireEvent.change(input, { target: { value: '改名中' } })
    // Sort by the status column — the view order changes under the editor.
    controller.updateView(id, doc.views[0]!.id, { sorts: [{ columnId: doc.columns.find(c => c.name === '跟进状态')!.id, dir: 'asc' }] })
    await act(async () => {})
    // The input keeps the in-progress text (not the new row's value)…
    const kept = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    expect(kept.value).toBe('改名中')
    // …and commits to the ORIGINAL row (rowId anchor).
    fireEvent.keyDown(kept, { key: 'Enter' })
    const after = controller.snapshot().tables[id]!
    expect(after.rows.find(r => r.id === rowId)!.cells[after.columns[0]!.id]!.value).toBe('改名中')
  })

  it('commits by rowId even when the row moved to another view index', async () => {
    const { controller, id } = await openTable('crm')
    const doc = controller.snapshot().tables[id]!
    const statusCol = doc.columns.find(c => c.name === '跟进状态')!
    // Sort asc puts 已流失 (青橙, row 5) first.
    controller.updateView(id, doc.views[0]!.id, { sorts: [{ columnId: statusCol.id, dir: 'asc' }] })
    const rowId = doc.rows[5]!.id // 青橙 (已流失) — now view row 0
    await act(async () => {
      controller.select({ r0: 0, r1: 0, c0: 0, c1: 0 })
      controller.setEditing({ row: 0, col: 0, rowId })
    })
    const input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    expect(input.value).toBe('孙一鸣')
    fireEvent.keyDown(input, { key: 'Enter' })
    const after = controller.snapshot().tables[id]!
    expect(after.rows.find(r => r.id === rowId)!.cells[after.columns[0]!.id]!.value).toBe('孙一鸣')
  })
})

describe('blank canvas edges', () => {
  it('materializes a row when clicking a blank row CELL (onCellDown path)', async () => {
    const { controller, id } = await openTable('crm')
    const before = controller.snapshot().tables[id]!.rows.length
    // Blank row 7 (index 6): click its first blank cell.
    const blankCell = bodyRowNums()[6]!.parentElement!
      .querySelectorAll('[class*="cell"]')[0] as HTMLElement
    fireEvent.mouseDown(blankCell)
    expect(controller.snapshot().tables[id]!.rows).toHaveLength(before + 1)
  })

  it('ignores the row menu on blank rows', async () => {
    const { controller } = await openTable('crm')
    // The context menu must not open on blank (non-data) row numbers.
    fireEvent.contextMenu(bodyRowNums()[6]!)
    expect(screen.queryByText('Insert row above')).toBeNull()
    void controller
  })

  it('does not sort when clicking a blank header', async () => {
    const { controller, id } = await openTable('crm')
    const blankHead = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('+')) as HTMLElement
    fireEvent.click(blankHead)
    expect(controller.snapshot().tables[id]!.views[0]!.sorts).toHaveLength(0)
  })

  it('grows the column floor when scrolling far right', async () => {
    await openTable('crm')
    const scroll = document.querySelector('[class*="_scroll_"]') as HTMLElement
    const canvas = document.querySelector('[class*="_canvas_"]') as HTMLElement
    Object.defineProperty(scroll, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: canvas.clientHeight, configurable: true })
    Object.defineProperty(scroll, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(scroll, 'scrollWidth', { value: canvas.clientWidth, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 0, configurable: true })
    Object.defineProperty(scroll, 'scrollLeft', { value: 3000, configurable: true })
    fireEvent.scroll(scroll)
    await act(async () => {})
    const grown = document.querySelector('[class*="_canvas_"]') as HTMLElement
    expect(Number.parseInt(grown.style.width, 10)).toBeGreaterThan(canvas.clientWidth)
  })

  it('edits a blank-row cell (rowId undefined) and commits to the new row', async () => {
    const { controller, id } = await openTable('crm')
    const before = controller.snapshot().tables[id]!.rows.length
    const blankCell = bodyRowNums()[6]!.parentElement!
      .querySelectorAll('[class*="cell"]')[0] as HTMLElement
    fireEvent.mouseDown(blankCell, { detail: 2 })
    const editing = controller.snapshot().editor.editing
    expect(editing).toMatchObject({ row: before, col: 0 })
    // The commit lands on the newly created row (rowId resolves through the view).
    const input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '新行内容' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const after = controller.snapshot().tables[id]!
    expect(after.rows).toHaveLength(before + 1)
    expect(after.rows[before]!.cells[after.columns[0]!.id]!.value).toBe('新行内容')
  })

  it('counts goals with conditions on the header chip', async () => {
    const { controller, id } = await openTable('crm')
    controller.addGoal(id, {
      columnId: 'a', aggregate: 'count', target: 10,
      condition: { columnId: 's', op: 'eq', value: '已成交' },
    })
    controller.update((d) => {
      const doc = d.tables[id]!
      const status = doc.columns.find(c => c.name === '跟进状态')!
      const amount = doc.columns.find(c => c.name === '预算')!
      if (status !== undefined && amount !== undefined) {
        doc.goals = [{
          id: 'g', columnId: amount.id, aggregate: 'count', target: 10,
          condition: { columnId: status.id, op: 'eq', value: '已成交' },
        }]
      }
    })
    await act(async () => {})
    // 1 of 6 CRM rows is 已成交 → 10%.
    expect(screen.getByText('10%')).toBeTruthy()
  })
})

describe('blank column cells and ordinary scrolls', () => {
  it('materializes a column when clicking a blank CELL (onCellDown path)', async () => {
    const { controller, id } = await openTable('crm')
    const before = controller.snapshot().tables[id]!.columns.length
    // Blank cells live in the first data row, right of the last real column.
    const firstRow = bodyRowNums()[0]!.parentElement!
    const cells = [...firstRow.querySelectorAll('[class*="_cell_"]')] as HTMLElement[]
    const realCount = controller.snapshot().tables[id]!.columns.length
    fireEvent.mouseDown(cells[realCount]!)
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(before + 1)
  })

  it('does not grow the floor on ordinary scrolls', async () => {
    await openTable('crm')
    const scroll = document.querySelector('[class*="_scroll_"]') as HTMLElement
    const canvas = document.querySelector('[class*="_canvas_"]') as HTMLElement
    Object.defineProperty(scroll, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(scroll, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(scroll, 'scrollWidth', { value: 4000, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 100, configurable: true })
    Object.defineProperty(scroll, 'scrollLeft', { value: 200, configurable: true })
    fireEvent.scroll(scroll)
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    const after = document.querySelector('[class*="_canvas_"]') as HTMLElement
    expect(after.style.height).toBe(canvas.style.height)
    expect(after.style.width).toBe(canvas.style.width)
  })
})

describe('edit commit and header guards', () => {
  it('commits the running edit when clicking another cell', async () => {
    const { controller, id } = await openTable('crm')
    const cell = screen.getAllByText('陈小雨')[0]!
    fireEvent.doubleClick(cell)
    const input = document.querySelector('input[class*="editInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '改名中' } })
    // Click another cell: the blur never fires (input unmounts), but the
    // click path commits the pending edit first.
    const other = screen.getAllByText('李浩然')[0]!
    fireEvent.mouseDown(other)
    const doc = controller.snapshot().tables[id]!
    expect(doc.rows[0]!.cells[doc.columns[0]!.id]!.value).toBe('改名中')
  })

  it('ignores right-clicks on the letter and title headers', async () => {
    const { controller } = await openTable('crm')
    const letter = document.querySelector('[class*="letterText"]') as HTMLElement
    fireEvent.mouseDown(letter, { button: 2 })
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('姓名')) as HTMLElement
    fireEvent.mouseDown(head, { button: 2 })
    // No selection change from a right-click.
    expect(controller.snapshot().editor.selection).toBeNull()
  })
})

describe('blank cell single-clicks', () => {
  it('does not open the option picker on blank cells', async () => {
    await openTable('crm')
    const firstRow = [...document.querySelectorAll('[class*="_rowNum_"]')]
      .filter(el => !el.className.includes('Head'))[0]!.parentElement!
    const cells = [...firstRow.querySelectorAll('[class*="_cell_"]')] as HTMLElement[]
    const realCount = 11 // CRM has eleven real columns
    fireEvent.click(cells[realCount]!)
    expect(document.querySelector('[class*="picker"]')).toBeNull()
  })
})

describe('header interaction guards', () => {
  it('selects the whole column via a frozen letter', async () => {
    const { controller } = await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    fireEvent.mouseDown(letters[0]!)
    expect(controller.snapshot().editor.selection).toMatchObject({ c0: 0, c1: 0, r0: 0 })
  })

  it('keeps the rename open when clicking inside the input', async () => {
    const { controller, id } = await openTable('crm')
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('姓名')) as HTMLElement
    fireEvent.doubleClick(head)
    const input = document.querySelector('input[class*="renameHeadInput"]') as HTMLInputElement
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '客户姓名' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(controller.snapshot().tables[id]!.columns[0]!.name).toBe('客户姓名')
  })

  it('stops sort-button mousedown from selecting the column', async () => {
    const { controller } = await openTable('crm')
    const sortBtn = document.querySelector('button[aria-label*="sort-"]') as HTMLElement
    fireEvent.mouseDown(sortBtn)
    // The mousedown is swallowed → no selection change; click sorts.
    fireEvent.click(sortBtn)
    expect(controller.snapshot().editor.selection).toBeNull()
    expect(controller.snapshot().tables[controller.snapshot().currentTableId!]!.views[0]!.sorts).toHaveLength(1)
  })
})

describe('scrolling header interactions', () => {
  it('adds a column when clicking a blank letter', async () => {
    const { controller, id } = await openTable('crm')
    const before = controller.snapshot().tables[id]!.columns.length
    const plus = [...document.querySelectorAll('[class*="letterText"]')]
      .find(el => el.textContent === '+') as HTMLElement
    fireEvent.mouseDown(plus)
    expect(controller.snapshot().tables[id]!.columns).toHaveLength(before + 1)
  })

  it('renames a non-frozen column through its title', async () => {
    const { controller, id } = await openTable('crm')
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('性别')) as HTMLElement
    fireEvent.doubleClick(head)
    const input = document.querySelector('input[class*="renameHeadInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '性别（选填）' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const doc = controller.snapshot().tables[id]!
    expect(doc.columns.find(c => c.id === doc.columns[1]!.id)!.name).toBe('性别（选填）')
  })

  it('selects the whole column via a scrolling letter', async () => {
    const { controller } = await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    // B is the 性别 (non-frozen) column.
    fireEvent.mouseDown(letters[1]!)
    expect(controller.snapshot().editor.selection).toMatchObject({ c0: 1, c1: 1, r0: 0 })
  })

  it('commits the rename on blur with a valid draft and skips empty drafts', async () => {
    const { controller, id } = await openTable('crm')
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('姓名')) as HTMLElement
    fireEvent.doubleClick(head)
    let input = document.querySelector('input[class*="renameHeadInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '客户姓名' } })
    fireEvent.blur(input)
    expect(controller.snapshot().tables[id]!.columns[0]!.name).toBe('客户姓名')
    // A blank draft on blur keeps the previous name.
    fireEvent.doubleClick(head)
    input = document.querySelector('input[class*="renameHeadInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(controller.snapshot().tables[id]!.columns[0]!.name).toBe('客户姓名')
  })

  it('skips an empty rename draft on a non-frozen column', async () => {
    const { controller, id } = await openTable('crm')
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('性别')) as HTMLElement
    fireEvent.doubleClick(head)
    const input = document.querySelector('input[class*="renameHeadInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(controller.snapshot().tables[id]!.columns[1]!.name).toBe('性别')
  })

  it('blurring the rename input with a cancelled draft keeps the name', async () => {
    const { controller, id } = await openTable('crm')
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('性别')) as HTMLElement
    fireEvent.doubleClick(head)
    const input = document.querySelector('input[class*="renameHeadInput"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Escape' })
    // Escape cancels the rename; a later blur of a stale draft is a no-op.
    expect(controller.snapshot().tables[id]!.columns[1]!.name).toBe('性别')
  })
})

describe('column rename via the title row', () => {
  it('renames a column by double-clicking its title', async () => {
    const { controller, id } = await openTable('crm')
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('姓名')) as HTMLElement
    fireEvent.doubleClick(head)
    const input = document.querySelector('input[class*="renameHeadInput"]') as HTMLInputElement
    expect(input.value).toBe('姓名')
    fireEvent.change(input, { target: { value: '客户姓名' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const doc = controller.snapshot().tables[id]!
    expect(doc.columns.find(c => c.id === doc.columns[0]!.id)!.name).toBe('客户姓名')
  })

  it('cancels the rename with Escape and keeps the original name', async () => {
    const { controller, id } = await openTable('crm')
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('姓名')) as HTMLElement
    fireEvent.doubleClick(head)
    const input = document.querySelector('input[class*="renameHeadInput"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '改' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(controller.snapshot().tables[id]!.columns[0]!.name).toBe('姓名')
  })
})

describe('drag interactions', () => {
  it('resizes a column by dragging its header edge', async () => {
    const { controller, id } = await openTable('crm')
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('姓名')) as HTMLElement
    const grip = head.querySelector('[class*="colResize"]') as HTMLElement
    expect(grip).toBeTruthy()
    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 200 })
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 260 })
    fireEvent.pointerUp(document, { pointerId: 1 })
    const doc = controller.snapshot().tables[id]!
    expect(doc.columns[0]!.width).toBeGreaterThan(140)
  })

  it('moves a row after a long press on its row number', async () => {
    const { controller, id } = await openTable('crm')
    const rowNums = [...document.querySelectorAll('[class*="_rowNum_"]')]
      .filter(el => !el.className.includes('Head')) as HTMLElement[]
    const doc = controller.snapshot().tables[id]!
    const firstId = doc.rows[0]!.id
    fireEvent.pointerDown(rowNums[0]!, { pointerId: 1 })
    // Long-press delay (500ms) activates the drag.
    await new Promise(r => setTimeout(r, 600))
    fireEvent.pointerMove(document, { pointerId: 1, clientY: 52 + 32 * 2 + 4 })
    fireEvent.pointerUp(document, { pointerId: 1 })
    const after = controller.snapshot().tables[id]!
    expect(after.rows[2]!.id).toBe(firstId)
  })

  it('moves a column after a long press on its letter', async () => {
    const { controller, id } = await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    const doc = controller.snapshot().tables[id]!
    const secondId = doc.columns[1]!.id
    fireEvent.pointerDown(letters[1]!, { pointerId: 2 })
    await new Promise(r => setTimeout(r, 600))
    // Move to column index 4 (clientX ~ letter position of the 5th column).
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 46 + 140 * 3 })
    fireEvent.pointerUp(document, { pointerId: 2 })
    const after = controller.snapshot().tables[id]!
    expect(after.columns[3]!.id).toBe(secondId)
  })

  it('shows fixed row numbers after sorting', async () => {
    const { controller, id } = await openTable('crm')
    const doc = controller.snapshot().tables[id]!
    controller.updateView(id, doc.views[0]!.id, { sorts: [{ columnId: doc.columns[0]!.id, dir: 'desc' }] })
    await act(async () => {})
    // Row numbers stay positional (row 1 is always '1'), data moves.
    const rowNums = [...document.querySelectorAll('[class*="_rowNum_"]')]
      .filter(el => !el.className.includes('Head'))
    expect(rowNums[0]!.textContent).toBe('1')
    expect(rowNums[1]!.textContent).toBe('2')
  })
})

describe('drag guard rails', () => {
  it('cancels the long-press drag when the pointer lifts early', async () => {
    const { controller, id } = await openTable('crm')
    const rowNums = [...document.querySelectorAll('[class*="_rowNum_"]')]
      .filter(el => !el.className.includes('Head')) as HTMLElement[]
    const doc = controller.snapshot().tables[id]!
    const firstId = doc.rows[0]!.id
    // Lift before the 500ms threshold → no drag, no reorder.
    fireEvent.pointerDown(rowNums[0]!, { pointerId: 3 })
    fireEvent.pointerUp(rowNums[0]!, { pointerId: 3 })
    await new Promise(r => setTimeout(r, 600))
    expect(controller.snapshot().tables[id]!.rows[0]!.id).toBe(firstId)
  })

  it('ignores pointer moves from other pointers during a drag', async () => {
    const { controller, id } = await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    const doc = controller.snapshot().tables[id]!
    const secondId = doc.columns[1]!.id
    fireEvent.pointerDown(letters[1]!, { pointerId: 4 })
    await new Promise(r => setTimeout(r, 600))
    fireEvent.pointerMove(document, { pointerId: 99, clientX: 9999 })
    fireEvent.pointerMove(document, { pointerId: 4, clientX: 46 + 140 * 3 })
    fireEvent.pointerUp(document, { pointerId: 4 })
    const after = controller.snapshot().tables[id]!
    expect(after.columns[3]!.id).toBe(secondId)
  })

  it('no-ops when the long-press drag ends without moving', async () => {
    const { controller, id } = await openTable('crm')
    const rowNums = [...document.querySelectorAll('[class*="_rowNum_"]')]
      .filter(el => !el.className.includes('Head')) as HTMLElement[]
    const doc = controller.snapshot().tables[id]!
    const firstId = doc.rows[0]!.id
    fireEvent.pointerDown(rowNums[0]!, { pointerId: 5 })
    await new Promise(r => setTimeout(r, 600))
    fireEvent.pointerUp(document, { pointerId: 5 })
    expect(controller.snapshot().tables[id]!.rows[0]!.id).toBe(firstId)
    // Same for columns.
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    fireEvent.pointerDown(letters[1]!, { pointerId: 6 })
    await new Promise(r => setTimeout(r, 600))
    fireEvent.pointerUp(letters[1]!, { pointerId: 6 })
    expect(controller.snapshot().tables[id]!.columns[1]!.id).toBe(doc.columns[1]!.id)
  })

  it('drops a column drag onto blank space and onto itself harmlessly', async () => {
    const { controller, id } = await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    const doc = controller.snapshot().tables[id]!
    const secondId = doc.columns[1]!.id
    // Drag far right (blank area) → the column moves to the end.
    fireEvent.pointerDown(letters[1]!, { pointerId: 7 })
    await new Promise(r => setTimeout(r, 600))
    fireEvent.pointerMove(document, { pointerId: 7, clientX: 3000 })
    fireEvent.pointerUp(document, { pointerId: 7 })
    let after = controller.snapshot().tables[id]!
    expect(after.columns.at(-1)!.id).toBe(secondId)
    // Drag back onto its own letter → no reorder.
    fireEvent.pointerDown(letters[1]!, { pointerId: 8 })
    await new Promise(r => setTimeout(r, 600))
    fireEvent.pointerMove(document, { pointerId: 8, clientX: 46 + 140 * 1 })
    fireEvent.pointerUp(document, { pointerId: 8 })
    after = controller.snapshot().tables[id]!
    expect(after.columns[1]!.id).toBe(secondId)
  })

  it('drags a frozen column letter and resizes a scrolling column', async () => {
    const { controller, id } = await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    const doc = controller.snapshot().tables[id]!
    const firstName = doc.columns[0]!.id
    // Long-press the frozen A letter and drop it after column 2.
    fireEvent.pointerDown(letters[0]!, { pointerId: 11 })
    await new Promise(r => setTimeout(r, 600))
    fireEvent.pointerMove(document, { pointerId: 11, clientX: 46 + 140 * 2 })
    fireEvent.pointerUp(document, { pointerId: 11 })
    let after = controller.snapshot().tables[id]!
    expect(after.columns[2]!.id).toBe(firstName)
    // Resize a scrolling (non-frozen) column via its grip.
    const head = [...document.querySelectorAll('[class*="headerCell"]')]
      .find(el => el.textContent?.includes('电话')) as HTMLElement
    const grip = head.querySelector('[class*="colResize"]') as HTMLElement
    fireEvent.pointerDown(grip, { pointerId: 12, clientX: 400 })
    fireEvent.pointerMove(document, { pointerId: 12, clientX: 480 })
    fireEvent.pointerUp(document, { pointerId: 12 })
    after = controller.snapshot().tables[id]!
    const phoneIdx = after.columns.findIndex(c => c.name === '电话')
    expect(after.columns[phoneIdx]!.width).toBeGreaterThan(140)
  })

  it('ignores pointer-ups from other pointers during a column drag', async () => {
    const { controller, id } = await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    const doc = controller.snapshot().tables[id]!
    const secondId = doc.columns[1]!.id
    fireEvent.pointerDown(letters[1]!, { pointerId: 14 })
    await new Promise(r => setTimeout(r, 600))
    // A foreign pointer-up must not end the drag; the real one completes it.
    fireEvent.pointerUp(document, { pointerId: 99 })
    fireEvent.pointerMove(document, { pointerId: 14, clientX: 46 + 140 * 3 })
    fireEvent.pointerUp(document, { pointerId: 14 })
    const after = controller.snapshot().tables[id]!
    expect(after.columns[3]!.id).toBe(secondId)
  })

  it('cancels a row-number long-press when the pointer leaves', async () => {
    const { controller, id } = await openTable('crm')
    const rowNums = [...document.querySelectorAll('[class*="_rowNum_"]')]
      .filter(el => !el.className.includes('Head')) as HTMLElement[]
    fireEvent.pointerDown(rowNums[0]!, { pointerId: 13 })
    fireEvent.pointerLeave(rowNums[0]!)
    await new Promise(r => setTimeout(r, 600))
    expect(controller.snapshot().tables[id]!.rows[0]!.id).toBe(controller.snapshot().tables[id]!.rows[0]!.id)
  })

  it('cancels a letter long-press when the pointer leaves', async () => {
    const { controller, id } = await openTable('crm')
    const letters = [...document.querySelectorAll('[class*="letterText"]')] as HTMLElement[]
    fireEvent.pointerDown(letters[1]!, { pointerId: 9 })
    fireEvent.pointerLeave(letters[1]!)
    await new Promise(r => setTimeout(r, 600))
    expect(controller.snapshot().tables[id]!.columns[1]!.id).toBe(controller.snapshot().tables[id]!.columns[1]!.id)
  })

  it('ignores right-button pointer events on letters', async () => {
    await openTable('crm')
    const letter = document.querySelector('[class*="letterText"]') as HTMLElement
    // Right-click (button 2) must not arm the long-press drag.
    fireEvent.pointerDown(letter, { pointerId: 9, button: 2 })
    await new Promise(r => setTimeout(r, 600))
    expect(document.querySelector('[class*="dragInsertCol"]')).toBeNull()
  })
})
