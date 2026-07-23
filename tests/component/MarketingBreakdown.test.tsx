import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import MarketingBreakdown from '@/components/smart/MarketingBreakdown/MarketingBreakdown'

const data = {
  groups: [
    {
      label: '产品卖点',
      fields: [
        {
          key: 'g0-f0',
          label: '核心利益',
          hint: '一句话说明',
          desc: '省时省力',
          tags: ['高效率', '低成本'],
          picked: ['高效率'],
        },
      ],
    },
  ],
}

describe('MarketingBreakdown', () => {
  it('edits descriptions and routes add/remove tag actions', async () => {
    const user = userEvent.setup()
    const onChangeDesc = vi.fn()
    const onPickTag = vi.fn()
    const onRemoveTag = vi.fn()
    render(
      <MarketingBreakdown
        data={data}
        onChangeDesc={onChangeDesc}
        onPickTag={onPickTag}
        onRemoveTag={onRemoveTag}
        onRefreshTags={vi.fn()}
      />,
    )

    const description = screen.getByRole('textbox', { name: '核心利益描述' })
    fireEvent.change(description, { target: { value: '新的卖点' } })
    expect(onChangeDesc).toHaveBeenLastCalledWith('g0-f0', '新的卖点')

    const activeTag = screen.getByRole('button', { name: '高效率' })
    expect(activeTag).toHaveAttribute('aria-pressed', 'true')
    await user.click(activeTag)
    expect(onRemoveTag).toHaveBeenCalledWith('g0-f0', '高效率')

    const inactiveTag = screen.getByRole('button', { name: '低成本' })
    expect(inactiveTag).toHaveAttribute('aria-pressed', 'false')
    await user.click(inactiveTag)
    expect(onPickTag).toHaveBeenCalledWith('g0-f0', '低成本')

    await user.click(screen.getByRole('button', { name: '移除高效率' }))
    expect(onRemoveTag).toHaveBeenCalledTimes(2)
  })

  it('locks and announces a field while refreshing tags and handles empty groups', async () => {
    const user = userEvent.setup()
    const onRefreshTags = vi.fn()
    const view = render(
      <MarketingBreakdown
        data={data}
        onChangeDesc={vi.fn()}
        onPickTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onRefreshTags={onRefreshTags}
        refreshing={{ 'g0-f0': true }}
      />,
    )

    const refresh = screen.getByRole('button', { name: '核心利益换一批候选' })
    expect(refresh).toBeDisabled()
    expect(refresh).toHaveAttribute('aria-busy', 'true')
    await user.click(refresh)
    expect(onRefreshTags).not.toHaveBeenCalled()

    view.rerender(
      <MarketingBreakdown
        data={{ groups: [] }}
        onChangeDesc={vi.fn()}
        onPickTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onRefreshTags={onRefreshTags}
      />,
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
