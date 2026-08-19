import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import WheelPicker from '@/components/common/WheelPicker'

const durations = ['5s', '6s', '7s', '8s', '9s'].map((value) => ({ value, label: value }))

describe('WheelPicker', () => {
  it('保持 listbox/option 语义，并标记当前档位为选中', () => {
    render(<WheelPicker options={durations} value="7s" onChange={vi.fn()} ariaLabel="视频时长" />)

    const list = screen.getByRole('listbox', { name: '视频时长' })
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['5s', '6s', '7s', '8s', '9s'])
    expect(screen.getByRole('option', { name: '7s' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: '5s' })).toHaveAttribute('aria-selected', 'false')
  })

  it('点击档位即提交该值，点击当前值不重复触发', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<WheelPicker options={durations} value="7s" onChange={onChange} ariaLabel="视频时长" />)

    await user.click(screen.getByRole('option', { name: '9s' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('9s')

    onChange.mockClear()
    await user.click(screen.getByRole('option', { name: '7s' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('支持左右键逐档移动与 Home/End 直达首尾', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // 受控组件：父级要把新值写回去，逐档移动才会从最新档位继续。
    function ControlledWheel() {
      const [value, setValue] = useState('7s')
      return (
        <WheelPicker
          options={durations}
          value={value}
          onChange={(next) => {
            onChange(next)
            setValue(next)
          }}
          ariaLabel="视频时长"
        />
      )
    }
    render(<ControlledWheel />)

    const list = screen.getByRole('listbox', { name: '视频时长' })
    list.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('8s')
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('7s')
    // 档位横排后上下键仍然接住：「上一个/下一个」的直觉两套方向键都有人用
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith('8s')
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith('7s')
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('5s')
    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('9s')
  })

  it('滚动停下即生效，连续滚动每次都提交，且只有点击才算确认', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const onCommit = vi.fn()
      function ControlledWheel() {
        const [value, setValue] = useState('5s')
        return (
          <WheelPicker
            options={durations}
            value={value}
            onChange={(next) => {
              onChange(next)
              setValue(next)
            }}
            onCommit={onCommit}
            ariaLabel="视频时长"
            itemWidth={64}
          />
        )
      }
      render(<ControlledWheel />)
      const list = screen.getByRole('listbox', { name: '视频时长' })

      const scrollTo = (index: number) => {
        list.scrollLeft = index * 64
        fireEvent.scroll(list)
        act(() => {
          vi.advanceTimersByTime(200)
        })
      }

      scrollTo(3)
      expect(onChange).toHaveBeenLastCalledWith('8s')
      // 紧接着的第二次滚动同样要生效：上一次提交带来的程序化滚动不能把它吞掉。
      scrollTo(4)
      expect(onChange).toHaveBeenLastCalledWith('9s')
      expect(onChange).toHaveBeenCalledTimes(2)
      // 滚动只改值，不算「确认」——浮层由调用方在 onCommit 时才收起。
      expect(onCommit).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('option', { name: '6s' }))
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('6s')
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * 一格滚轮只走一档。
   *
   * 横向容器收不到有意义的纵向滚动，必须自己折算；而按像素折算又会跨档：
   * Chrome 一格 deltaY≈100，档位宽 64px，一格跨过一档半——想停在某一档几乎不可能。
   */
  it('一格鼠标滚轮只移动一档，而不是按像素跨过好几档', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      function ControlledWheel() {
        const [value, setValue] = useState('5s')
        return (
          <WheelPicker
            options={durations}
            value={value}
            onChange={(next) => {
              onChange(next)
              setValue(next)
            }}
            ariaLabel="视频时长"
            itemWidth={64}
          />
        )
      }
      render(<ControlledWheel />)
      const list = screen.getByRole('listbox', { name: '视频时长' })

      const notch = (deltaY: number) => {
        fireEvent.wheel(list, { deltaY, deltaMode: 0 })
        act(() => {
          vi.advanceTimersByTime(200)
        })
      }

      // Chrome 下一格滚轮就是 deltaY=100：只能前进一档
      notch(100)
      expect(onChange).toHaveBeenLastCalledWith('6s')
      notch(100)
      expect(onChange).toHaveBeenLastCalledWith('7s')
      // 反向同理
      notch(-100)
      expect(onChange).toHaveBeenLastCalledWith('6s')
      expect(onChange).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('触控板的连续小 delta 累计到阈值才走一档', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      function ControlledWheel() {
        const [value, setValue] = useState('5s')
        return (
          <WheelPicker
            options={durations}
            value={value}
            onChange={(next) => {
              onChange(next)
              setValue(next)
            }}
            ariaLabel="视频时长"
            itemWidth={64}
          />
        )
      }
      render(<ControlledWheel />)
      const list = screen.getByRole('listbox', { name: '视频时长' })

      // 单次 4px 远低于阈值，不该动
      fireEvent.wheel(list, { deltaY: 4, deltaMode: 0 })
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(onChange).not.toHaveBeenCalled()

      // 累计过阈值后走一档
      for (let i = 0; i < 3; i += 1) fireEvent.wheel(list, { deltaY: 4, deltaMode: 0 })
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(onChange).toHaveBeenCalledExactlyOnceWith('6s')
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * 触控板双指左右滑必须交回给浏览器。
   *
   * 它带惯性和 scroll-snap 吸附，手感是系统级的；自己接管会把连续滑动切成一顿一顿的步进，
   * 反而比原生差。所以横向为主的 wheel 事件既不 preventDefault、也不自行步进——
   * 值的变化由随后的 scroll 事件（滚动停止后）提交。
   */
  it('触控板横向滑动交给原生滚动，不被自行步进接管', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      render(<WheelPicker options={durations} value="5s" onChange={onChange} ariaLabel="视频时长" itemWidth={64} />)
      const list = screen.getByRole('listbox', { name: '视频时长' })

      // 横向分量占主导：连发多次也不该产生步进
      for (let i = 0; i < 6; i += 1) {
        fireEvent.wheel(list, { deltaX: 30, deltaY: 2, deltaMode: 0 })
      }
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(onChange).not.toHaveBeenCalled()

      const event = new WheelEvent('wheel', { deltaX: 30, deltaY: 2, cancelable: true, bubbles: true })
      list.dispatchEvent(event)
      // 没有 preventDefault，原生横向滚动才会照常发生
      expect(event.defaultPrevented).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('停在不可选档位时不提交，档位仍不可点击', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <WheelPicker
        options={[{ value: '5s', label: '5s' }, { value: '6s', label: '6s', disabled: true }, ...durations.slice(2)]}
        value="5s"
        onChange={onChange}
        ariaLabel="视频时长"
      />,
    )

    const disabledOption = screen.getByRole('option', { name: '6s' })
    expect(disabledOption).toBeDisabled()
    await user.click(disabledOption)
    expect(onChange).not.toHaveBeenCalled()
  })
})
