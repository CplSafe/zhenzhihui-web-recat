import { createRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasMentionInput, {
  readMentionInput,
  type CanvasMentionInputHandle,
} from '@/components/canvas/CanvasMentionInput'

function setup(initial = '@图片1 后面的文字') {
  const ref = createRef<CanvasMentionInputHandle>()
  const onPreview = vi.fn()
  const onChange = vi.fn()
  const mentions = [{ label: '图片1', kind: 'image', thumbnailUrl: '/test-image.png' }]
  function Controlled() {
    const [value, setValue] = useState(initial)
    return (
      <CanvasMentionInput
        ref={ref}
        value={value}
        mentions={mentions}
        placeholder="提示词"
        className=""
        onChange={(event) => {
          onChange(event.target.value)
          setValue(event.target.value)
        }}
        onSelect={() => {}}
        onFocus={() => {}}
        onBlur={() => {}}
        onKeyDown={() => {}}
        onPreview={onPreview}
      />
    )
  }
  render(<Controlled />)
  const input = screen.getByRole('textbox', { name: '提示词' })
  return { input, ref, onPreview, onChange }
}

describe('CanvasMentionInput 单层引用编辑', () => {
  it('占位提示只在空内容显示，文字、引用和撤销重做都更新空状态', async () => {
    const { input, ref } = setup('')
    expect(input).toHaveAttribute('data-empty', 'true')
    act(() => ref.current!.focus())
    fireEvent.paste(input, { clipboardData: { getData: () => '普通文字' } })
    expect(input).toHaveAttribute('data-empty', 'false')
    const user = userEvent.setup()
    await user.keyboard('{Control>}z{/Control}')
    expect(input).toHaveAttribute('data-empty', 'true')
    await user.keyboard('{Control>}y{/Control}')
    expect(input).toHaveAttribute('data-empty', 'false')
    act(() => ref.current!.setSelectionRange(0, 4))
    fireEvent.paste(input, { clipboardData: { getData: () => '@图片1' } })
    expect(screen.getByRole('button', { name: '查看引用图片：图片1' })).toBeInTheDocument()
    expect(input).toHaveAttribute('data-empty', 'false')
    act(() => ref.current!.setSelectionRange(0, 4))
    fireEvent.paste(input, { clipboardData: { getData: () => '' } })
    expect(input).toHaveAttribute('data-empty', 'true')
  })

  it('聚焦和失焦均保留缩略图及 @，存储文本不含图片内容', async () => {
    const { input } = setup()
    const user = userEvent.setup()
    await user.click(input)
    const chip = screen.getByRole('button', { name: '查看引用图片：图片1' })
    expect(chip).toHaveTextContent('@图片1')
    expect(chip.querySelector('img')).not.toBeNull()
    expect(chip).toHaveAttribute('contenteditable', 'false')
    expect(readMentionInput(input)).toBe('@图片1 后面的文字')
    await user.tab()
    expect(chip).toBeInTheDocument()
  })

  it('引用后定位和中间插字使用存储文本偏移', async () => {
    const { input, ref, onChange } = setup()
    act(() => {
      ref.current!.focus()
      ref.current!.setSelectionRange(5, 5)
    })
    await userEvent.setup().keyboard('新')
    expect(readMentionInput(input)).toBe('@图片1 新后面的文字')
    expect(ref.current!.selectionStart).toBe(6)
    expect(onChange).toHaveBeenLastCalledWith('@图片1 新后面的文字')
  })

  it('粘贴仅插入纯文本，保留换行并支持撤销重做', async () => {
    const { input, ref } = setup('@图片1 ')
    act(() => {
      ref.current!.focus()
      ref.current!.setSelectionRange(5, 5)
    })
    fireEvent.paste(input, { clipboardData: { getData: () => '第一行\r\n第二行' } })
    expect(readMentionInput(input)).toBe('@图片1 第一行\n第二行')
    const user = userEvent.setup()
    await user.keyboard('{Control>}z{/Control}')
    expect(readMentionInput(input)).toBe('@图片1 ')
    await user.keyboard('{Control>}y{/Control}')
    expect(readMentionInput(input)).toBe('@图片1 第一行\n第二行')
  })

  it('按 Enter 插入换行，标签后光标仍可定位', async () => {
    const { input, ref } = setup('@图片1 ')
    act(() => {
      ref.current!.focus()
      ref.current!.setSelectionRange(5, 5)
    })
    await userEvent.setup().keyboard('{Enter}下一行')
    expect(readMentionInput(input)).toBe('@图片1 \n下一行')
    expect(ref.current!.selectionStart).toBe(9)
  })

  it('中文输入过程中不重建 DOM，输入完成后保持光标', () => {
    const { input, ref } = setup('')
    act(() => ref.current!.focus())
    fireEvent.compositionStart(input)
    input.textContent = '中文'
    const text = input.firstChild!
    const range = document.createRange()
    range.setStart(text, 2)
    range.collapse(true)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    fireEvent.input(input)
    expect(input.firstChild).toBe(text)
    expect(input).toHaveAttribute('data-empty', 'false')
    fireEvent.compositionEnd(input)
    expect(readMentionInput(input)).toBe('中文')
    expect(ref.current!.selectionStart).toBe(2)
  })
})
