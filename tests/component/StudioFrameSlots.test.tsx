import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import StudioFrameSlots from '@/components/studio/StudioFrameSlots/StudioFrameSlots'
import type { StudioRefImage } from '@/utils/studioRefImage'

function image(id: string): StudioRefImage {
  return { id, url: `blob:${id}` }
}

describe('StudioFrameSlots', () => {
  it('空状态下渲染首帧与尾帧两个具名槽位', () => {
    render(<StudioFrameSlots images={[]} onChange={() => {}} />)

    expect(screen.getByLabelText('添加首帧')).toBeInTheDocument()
    expect(screen.getByLabelText('添加尾帧')).toBeInTheDocument()
  })

  it('已填充的槽位显示预览图并可更换', () => {
    render(<StudioFrameSlots images={[image('a')]} onChange={() => {}} />)

    expect(screen.getByLabelText('更换首帧')).toBeInTheDocument()
    expect(screen.getByAltText('首帧')).toHaveAttribute('src', 'blob:a')
    // 尾帧仍是空槽
    expect(screen.getByLabelText('添加尾帧')).toBeInTheDocument()
  })

  it('两张图齐备时可交换首尾顺序', async () => {
    const onChange = vi.fn()
    render(<StudioFrameSlots images={[image('a'), image('b')]} onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('交换首帧和尾帧'))

    // 顺序决定 first_frame / last_frame，交换后必须整体反转
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'b' }), expect.objectContaining({ id: 'a' })])
  })

  it('不足两张时交换按钮禁用', () => {
    render(<StudioFrameSlots images={[image('a')]} onChange={() => {}} />)
    expect(screen.getByLabelText('交换首帧和尾帧')).toBeDisabled()
  })

  it('移除首帧后尾帧前移，不会留下「首帧空、尾帧有图」的非法状态', async () => {
    const onChange = vi.fn()
    render(<StudioFrameSlots images={[image('a'), image('b')]} onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('移除首帧'))

    // 后端语义里第一张就是首帧，留空会让尾帧被误当成首帧
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'b' })])
  })

  it('移除尾帧只影响尾帧', async () => {
    const onChange = vi.fn()
    render(<StudioFrameSlots images={[image('a'), image('b')]} onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('移除尾帧'))

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })])
  })

  it('禁用态下交换不可用', () => {
    render(<StudioFrameSlots images={[image('a'), image('b')]} onChange={() => {}} disabled />)
    expect(screen.getByLabelText('交换首帧和尾帧')).toBeDisabled()
    expect(screen.getByLabelText('更换首帧')).toBeDisabled()
  })
})
