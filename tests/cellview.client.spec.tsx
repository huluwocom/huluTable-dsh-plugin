// @vitest-environment jsdom
/** CellView presentation: every column type render path. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CellView } from '../src/client/grid/CellView.tsx'
import { newId, type Column } from '../src/client/domain/types.ts'

afterEach(cleanup)

function col(type: Column['type'], overrides: Partial<Column> = {}): Column {
  return {
    id: newId(), name: '列', type, width: 100, frozen: false, hidden: false, required: false, ...overrides,
  }
}

function renderCell(column: Column, value: unknown) {
  render(
    <CellView
      column={column}
      cell={{ value: value as never }}
      selected={false}
      width={100}
      rowActive={false}
      onMouseDown={vi.fn()}
      onDoubleClick={vi.fn()}
    />,
  )
}

describe('CellView render paths', () => {
  it('renders text and textarea values', () => {
    renderCell(col('text'), '你好')
    expect(screen.getByText('你好')).toBeTruthy()
    renderCell(col('textarea'), '多行')
    expect(screen.getByText('多行')).toBeTruthy()
    renderCell(col('email'), 'a@b.com')
    expect(screen.getByText('a@b.com')).toBeTruthy()
    renderCell(col('phone'), '13800000000')
    expect(screen.getByText('13800000000')).toBeTruthy()
  })

  it('renders links for urls and timestamps for time columns', () => {
    renderCell(col('url'), 'https://example.com')
    expect(screen.getByText('https://example.com').closest('a')).toBeTruthy()
    renderCell(col('createdAt'), 1723632000000)
    expect(screen.getAllByText(/\d{4}-\d{2}-\d{2}/).length).toBeGreaterThan(0)
    renderCell(col('updatedAt'), 1723632000000)
    expect(screen.getAllByText(/\d{4}-\d{2}-\d{2}/).length).toBeGreaterThan(0)
  })

  it('renders checkbox, rating, progress and numeric values', () => {
    renderCell(col('checkbox'), false)
    renderCell(col('checkbox'), true)
    renderCell(col('rating'), 3)
    expect(screen.getByText('★★★')).toBeTruthy()
    renderCell(col('rating'), 0)
    renderCell(col('progress'), 45)
    expect(screen.getByText('45%')).toBeTruthy()
    renderCell(col('number'), 42)
    expect(screen.getByText('42')).toBeTruthy()
    renderCell(col('percent'), 0.5)
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('renders select chips with colors and multiSelect lists', () => {
    const select = col('select', { options: [{ id: 'a', label: '已成交', color: '#4ade80' }] })
    renderCell(select, '已成交')
    expect(screen.getByText('已成交')).toBeTruthy()
    const plain = col('select', { options: [{ id: 'b', label: '普通', color: '' }] })
    renderCell(plain, '普通')
    expect(screen.getByText('普通')).toBeTruthy()
    const multi = col('multiSelect', {
      options: [{ id: 'a', label: '甲', color: '#4ade80' }, { id: 'b', label: '乙', color: '' }],
    })
    renderCell(multi, ['甲', '乙'])
    expect(screen.getByText('甲')).toBeTruthy()
    renderCell(multi, null)
    renderCell(multi, '甲')
    expect(screen.getAllByText('甲').length).toBeGreaterThan(0)
  })

  it('renders empty cells', () => {
    renderCell(col('text'), null)
    renderCell(col('text'), undefined)
    renderCell(col('url'), '')
  })

  it('renders blank for non-numeric progress and empty rating cells', () => {
    renderCell(col('progress'), '文案')
    expect(screen.queryByText('0%')).toBeNull()
    renderCell(col('rating'), null)
    expect(screen.queryByText('★')).toBeNull()
    renderCell(col('createdAt'), 'nope')
    renderCell(col('updatedAt'), null)
  })

  it('applies a background and stops the comment badge mousedown', () => {
    const onMouseDown = vi.fn()
    const onComment = vi.fn()
    render(
      <CellView
        column={col('text')}
        cell={{ value: 'x' }}
        selected={false}
        width={100}
        rowActive={false}
        bg="#123456"
        hasComment={true}
        onMouseDown={onMouseDown}
        onDoubleClick={vi.fn()}
        onComment={onComment}
      />,
    )
    const badge = screen.getByLabelText('comment')
    fireEvent.mouseDown(badge)
    expect(onMouseDown).not.toHaveBeenCalled()
    fireEvent.click(badge)
    expect(onComment).toHaveBeenCalled()
  })
})
