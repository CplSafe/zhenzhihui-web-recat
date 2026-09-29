import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import MaterialMentionPopover from '@/components/common/MaterialMentionPopover'

it('shows nine references in a grid centered below the @ trigger', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  const panelRect = vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 252,
    height: 280,
  } as DOMRect)

  try {
    render(
      <MaterialMentionPopover
        open
        title="选择参考素材"
        layout="grid"
        items={Array.from({ length: 9 }, (_, index) => ({
          key: String(index),
          label: `@图片${index + 1}`,
          url: `/reference-${index + 1}.png`,
        }))}
        getAnchorRect={() => ({ left: 300, top: 180, width: 40, bottom: 200 }) as DOMRect}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    )

    const panel = screen.getByRole('listbox', { name: '选择参考素材' })
    expect(within(panel).getAllByRole('option')).toHaveLength(9)
    expect(panel.className).toContain('panelGrid')
    expect(panel).toHaveStyle({ left: '194px', top: '208px' })
    await user.click(within(panel).getByRole('option', { name: '@图片9' }))
    expect(onSelect).toHaveBeenCalledWith(8)
  } finally {
    panelRect.mockRestore()
  }
})
