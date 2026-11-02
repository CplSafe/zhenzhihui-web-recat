import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import StudioDurationPicker from '@/components/studio/StudioDurationPicker/StudioDurationPicker'

/** 4~30 秒逐秒档位：图1 里滑块被挤爆的那种密集场景。 */
const DENSE_OPTIONS = Array.from({ length: 27 }, (_, i) => i + 4)

describe('StudioDurationPicker', () => {
  it('拖动时只回传合法档位，不自造中间秒数', () => {
    const onChange = vi.fn()
    render(<StudioDurationPicker options={[5, 10]} value={5} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: '视频时长' })
    fireEvent.change(slider, { target: { value: '600' } })
    expect(onChange).toHaveBeenLastCalledWith(10)
    fireEvent.change(slider, { target: { value: '900' } })
    expect(onChange.mock.calls.every(([value]) => [5, 10].includes(value))).toBe(true)
  })

  it('密集档位全部可选择，不丢弃任何合法秒数', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StudioDurationPicker options={DENSE_OPTIONS} value={4} onChange={onChange} />)
    for (const seconds of DENSE_OPTIONS) {
      rerender(<StudioDurationPicker options={DENSE_OPTIONS} value={seconds} onChange={onChange} />)
      const slider = screen.getByRole('slider', { name: '视频时长' })
      expect(slider).toHaveAttribute('aria-valuetext', `${seconds}s`)
      if (seconds < 30) {
        fireEvent.keyDown(slider, { key: 'ArrowRight' })
        expect(onChange).toHaveBeenLastCalledWith(seconds + 1)
      }
    }
  })

  it('当前档位标记为选中，供读屏与样式识别', () => {
    render(<StudioDurationPicker options={DENSE_OPTIONS} value={17} onChange={() => {}} />)

    const slider = screen.getByRole('slider', { name: '视频时长' })
    expect(slider).toHaveAttribute('aria-valuetext', '17s')
    expect(slider).toHaveValue('500')
  })

  it('调整滑块回传对应档位的秒数', () => {
    const onChange = vi.fn()
    render(<StudioDurationPicker options={DENSE_OPTIONS} value={5} onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: '视频时长' }), { target: { value: '308' } })

    expect(onChange).toHaveBeenCalledWith(12)
  })

  it('首尾档位不能通过键盘越界', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StudioDurationPicker options={[5, 10]} value={5} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' })
    expect(onChange).not.toHaveBeenCalled()
    rerender(<StudioDurationPicker options={[5, 10]} value={10} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('禁用态下档位不可点击', async () => {
    const onChange = vi.fn()
    render(<StudioDurationPicker options={[5, 10]} value={5} onChange={onChange} disabled />)

    const slider = screen.getByRole('slider', { name: '视频时长' })
    expect(slider).toBeDisabled()
    await userEvent.click(slider)
    await userEvent.keyboard('{ArrowRight}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('没有可选档位时不渲染（模型未声明时长）', () => {
    const { container } = render(<StudioDurationPicker options={[]} value={0} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
