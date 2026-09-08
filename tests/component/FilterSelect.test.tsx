import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FilterSelect from '@/components/common/FilterSelect'

const OPTIONS = [
  { value: '', label: '全部粉丝' },
  { value: 'lt1w', label: '1W以下' },
  { value: '1w-10w', label: '1W-10W' },
]

function renderSelect(overrides: Partial<React.ComponentProps<typeof FilterSelect>> = {}) {
  const props = {
    value: '',
    options: OPTIONS,
    onChange: vi.fn(),
    ariaLabel: '按粉丝数量筛选',
    ...overrides,
  }
  render(<FilterSelect {...props} />)
  return props
}

describe('FilterSelect', () => {
  it('触发器显示当前选中项，点击展开 listbox 并标记选中项', async () => {
    const user = userEvent.setup()
    renderSelect({ value: 'lt1w' })

    const trigger = screen.getByRole('button', { name: '按粉丝数量筛选' })
    expect(trigger).toHaveTextContent('1W以下')

    await user.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '1W以下' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: '全部粉丝' })).toHaveAttribute('aria-selected', 'false')
  })

  it('点选某项后回调其 value 并收起弹层', async () => {
    const user = userEvent.setup()
    const props = renderSelect()

    await user.click(screen.getByRole('button', { name: '按粉丝数量筛选' }))
    await user.click(screen.getByRole('option', { name: '1W-10W' }))

    expect(props.onChange).toHaveBeenCalledWith('1w-10w')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('键盘可用：方向键展开并移动高亮，Enter 选中', async () => {
    const user = userEvent.setup()
    const props = renderSelect()

    const trigger = screen.getByRole('button', { name: '按粉丝数量筛选' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{Enter}')
    expect(props.onChange).toHaveBeenCalledWith('lt1w')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Esc 与点击外部都能收起且不改变选中值', async () => {
    const user = userEvent.setup()
    const props = renderSelect()

    await user.click(screen.getByRole('button', { name: '按粉丝数量筛选' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '按粉丝数量筛选' }))
    await user.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(props.onChange).not.toHaveBeenCalled()
  })
})
