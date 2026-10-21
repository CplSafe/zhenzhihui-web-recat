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

function KeyboardPicker({
  count = 2,
  onSelect = vi.fn(),
  onClose = vi.fn(),
  layout = 'strip',
}: {
  count?: number
  onSelect?: (index: number) => void
  onClose?: () => void
  layout?: 'strip' | 'grid'
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  return (
    <>
      <textarea ref={inputRef} aria-label="提示词" />
      <textarea aria-label="其他输入框" />
      <MaterialMentionPopover
        inputRef={inputRef}
        open
        title="素材"
        layout={layout}
        items={Array.from({ length: count }, (_, i) => ({ key: String(i), label: '素材' + i, url: '/image.png' }))}
        getAnchorRect={() => inputRef.current?.getBoundingClientRect() ?? null}
        onSelect={onSelect}
        onClose={onClose}
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

it('moves across grid rows and columns, including an incomplete last row', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<KeyboardPicker count={7} layout="grid" onSelect={onSelect} />)
  const editor = screen.getByRole('textbox', { name: '提示词' })
  editor.focus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('option', { name: '素材3' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{ArrowRight}{ArrowDown}')
  expect(screen.getByRole('option', { name: '素材6' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{ArrowDown}{ArrowUp}')
  expect(screen.getByRole('option', { name: '素材6' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{ArrowUp}{ArrowLeft}{Enter}')
  expect(onSelect).toHaveBeenCalledWith(2)
  expect(editor).toHaveFocus()
})

it('uses up/down in a single row and consumes navigation before parent shortcuts', async () => {
  const user = userEvent.setup()
  const onKeyDown = vi.fn()
  const onClose = vi.fn()
  render(
    <div onKeyDown={onKeyDown}>
      <KeyboardPicker onClose={onClose} />
    </div>,
  )
  const editor = screen.getByRole('textbox', { name: '提示词' })
  editor.focus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('option', { name: '素材1' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{ArrowUp}')
  expect(screen.getByRole('option', { name: '素材0' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
  expect(onKeyDown).not.toHaveBeenCalled()
})

it('does not navigate while composing Chinese or using modified arrow keys', () => {
  render(<KeyboardPicker layout="grid" count={7} />)
  const editor = screen.getByRole('textbox', { name: '提示词' })
  fireEvent.keyDown(editor, { key: 'ArrowDown', isComposing: true })
  fireEvent.keyDown(editor, { key: 'ArrowUp', keyCode: 229 })
  fireEvent.keyDown(editor, { key: 'ArrowRight', shiftKey: true })
  fireEvent.keyDown(editor, { key: 'ArrowDown', ctrlKey: true })
  expect(screen.getByRole('option', { name: '素材0' })).toHaveAttribute('aria-selected', 'true')
})
