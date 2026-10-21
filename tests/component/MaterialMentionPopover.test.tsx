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
        inputRef={{ current: null }}
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
import { useRef } from 'react'
import { fireEvent } from '@testing-library/react'

function KeyboardPicker({ count = 2, onSelect = vi.fn() }: { count?: number; onSelect?: (index: number) => void }) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  return (
    <>
      <textarea ref={inputRef} aria-label="提示词" />
      <textarea aria-label="其他输入框" />
      <MaterialMentionPopover
        inputRef={inputRef}
        open
        title="素材"
        items={Array.from({ length: count }, (_, i) => ({ key: String(i), label: '素材' + i, url: '/image.png' }))}
        getAnchorRect={() => inputRef.current?.getBoundingClientRect() ?? null}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    </>
  )
}
it('confirms the only material from the editor', async () => {
  const onSelect = vi.fn()
  const user = userEvent.setup()
  render(<KeyboardPicker count={1} onSelect={onSelect} />)
  expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true')
  screen.getByRole('textbox', { name: '提示词' }).focus()
  await user.keyboard('{Enter}')
  expect(onSelect).toHaveBeenCalledWith(0)
})
it('cycles left/right and ignores IME, shortcuts and other editors', async () => {
  const onSelect = vi.fn()
  const user = userEvent.setup()
  render(<KeyboardPicker onSelect={onSelect} />)
  const editor = screen.getByRole('textbox', { name: '提示词' })
  editor.focus()
  await user.keyboard('{ArrowLeft}')
  expect(screen.getByRole('option', { name: '素材1' })).toHaveAttribute('aria-selected', 'true')
  expect(editor).toHaveFocus()
  fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 })
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
  expect(onSelect).not.toHaveBeenCalled()
  await user.keyboard('{ArrowRight}{Enter}')
  expect(onSelect).toHaveBeenLastCalledWith(0)
  onSelect.mockClear()
  screen.getByRole('textbox', { name: '其他输入框' }).focus()
  await user.keyboard('{Enter}')
  expect(onSelect).not.toHaveBeenCalled()
})
