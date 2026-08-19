/**
 * 档位选择器：选项横向滚动、居中吸附，中间高亮档位即当前值。
 *
 * 用于时长这类「档位有序且相邻值语义连续」的选择，替代平铺列表。
 * 语义仍是 listbox/option：滚动只是交互形式，读屏与键盘操作与普通下拉一致。
 * 滚动停止后才提交选择（滚动过程只更新高亮），避免途经的每一档都触发一次 onChange。
 *
 * 为什么是横向：竖向档位条要往下顶出一大截，在输入框上方的浮层里会盖住正文；
 * 横着摊开则贴着触发器排一行，且笔记本触控板的双指左右滑与它同向，滑动即选。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import './WheelPicker.css'

/** 单个可选档位；label 为展示文案，value 为回传值。 */
export interface WheelPickerOption {
  value: string
  label: string
  disabled?: boolean
}

interface WheelPickerProps {
  options: WheelPickerOption[]
  value: string
  onChange: (value: string) => void
  /**
   * 用户做出「确认」动作（点击某档位、回车）时额外触发，用于收起浮层。
   * 滚动/方向键只改值不触发它：滚动途中的每一次停顿都收起浮层会让人无从继续选。
   */
  onCommit?: (value: string) => void
  /** 可访问名称；同一面板存在多个选择器时用于消除歧义。 */
  ariaLabel?: string
  /** 可见档位数，取奇数以保证选中项居中。 */
  visibleCount?: number
  /** 单个档位宽度(px)；与 CSS 变量保持一致以便计算滚动位置。 */
  itemWidth?: number
  className?: string
}

/** 滚动停止判定：惯性结束后再提交，过短会在滑动途中误提交。 */
const SETTLE_DELAY_MS = 140

/**
 * 触发一次步进所需的累计 delta(px)。
 *
 * 取一个远小于档位宽度的值：鼠标滚轮一格（Chrome 下 delta≈100）会立刻满足阈值走一档，
 * 触控板的连续小 delta 则累计到这个值才走一档。每个 wheel 事件最多走一档，
 * 所以一格就是一档，不会因为 delta 大而一路冲过去。
 */
const WHEEL_STEP_THRESHOLD_PX = 16

export default function WheelPicker({
  options,
  value,
  onChange,
  onCommit,
  ariaLabel,
  visibleCount = 5,
  itemWidth = 72,
  className,
}: WheelPickerProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const settleTimerRef = useRef(0)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const [centerIndex, setCenterIndex] = useState(selectedIndex)
  // 停止滚动后的提交在定时器里执行，可能晚于本次渲染；用 ref 读最新值，避免回写一个已经过期的档位。
  const latestRef = useRef({ options, value, selectedIndex, onChange })
  latestRef.current = { options, value, selectedIndex, onChange }

  const scrollToIndex = useCallback(
    (index: number, smooth: boolean) => {
      const list = listRef.current
      if (!list) return
      const left = index * itemWidth
      if (Math.abs(list.scrollLeft - left) < 1) return
      // jsdom 没有 scrollTo，直接写 scrollLeft 保证测试与不支持平滑滚动的环境仍能定位。
      if (typeof list.scrollTo === 'function') {
        list.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' })
      } else {
        list.scrollLeft = left
      }
    },
    [itemWidth],
  )

  // 外部值变化（恢复草稿、换模型吸附档位）时把对应档位滚到中间。
  useEffect(() => {
    setCenterIndex(selectedIndex)
    scrollToIndex(selectedIndex, false)
  }, [selectedIndex, scrollToIndex, options.length])

  useEffect(() => () => window.clearTimeout(settleTimerRef.current), [])

  /**
   * 把某档位设为当前值。
   *
   * 不区分「用户滑动」与「程序化滚动」：提交同一个值是空操作，因此程序化滚动落位后
   * 再走一次提交没有副作用。反过来若靠时间窗口屏蔽程序化滚动，窗口内的真实滑动会被一并吞掉——
   * 那正是「滚动完还得点一下才生效」的原因。
   */
  const commitIndex = (index: number, opts?: { explicit?: boolean }) => {
    const latest = latestRef.current
    const option = latest.options[index]
    if (!option || option.disabled) {
      // 停在不可选档位：退回当前值，不提交一个用户其实选不了的档。
      setCenterIndex(latest.selectedIndex)
      scrollToIndex(latest.selectedIndex, true)
      return
    }
    setCenterIndex(index)
    scrollToIndex(index, true)
    if (option.value !== latest.value) latest.onChange(option.value)
    if (opts?.explicit) onCommit?.(option.value)
  }

  const handleScroll = () => {
    const list = listRef.current
    if (!list) return
    const index = Math.min(options.length - 1, Math.max(0, Math.round(list.scrollLeft / itemWidth)))
    setCenterIndex(index)
    // 滚动停止后自动生效：滚轮的语义就是「停在哪一档就是选哪一档」，不该再要求点一次。
    window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => commitIndex(index), SETTLE_DELAY_MS)
  }

  /**
   * 步进一档。放在 ref 里，供下面非被动的原生 wheel 监听调用，避免闭包读到过期的 centerIndex。
   */
  const stepRef = useRef<(direction: number) => void>(() => undefined)
  stepRef.current = (direction: number) => {
    const total = latestRef.current.options.length
    if (!total) return
    const next = Math.min(total - 1, Math.max(0, centerIndex + direction))
    if (next === centerIndex) return
    setCenterIndex(next)
    scrollToIndex(next, true)
    window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => commitIndex(next), SETTLE_DELAY_MS)
  }

  /**
   * 两种输入设备分开处理，这是横向档位条最容易做砸的地方。
   *
   * 触控板双指左右滑（deltaX 为主）：交给浏览器原生滚动 + scroll-snap。它带惯性和吸附，
   * 手感是系统级的，自己接管只会变成一顿一顿的步进，比原生差得多。
   *
   * 鼠标滚轮（deltaY 为主）：横向容器收不到有意义的滚动，必须自己折算成步进。
   * 而且不能按像素走——Chrome 一格滚轮 delta≈100，档位只有 72px，一格就跨过一档半，
   * 想停在某一档几乎不可能。所以按「格数」步进：一个 wheel 事件最多走一档。
   * 必须用 addEventListener 且 passive:false：React 的 onWheel 在根节点是被动监听，
   * 里面调 preventDefault 不生效，页面会跟着一起滚。
   */
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let accumulated = 0
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      // deltaMode 为行/页时 delta 不是像素，按档位宽度折算，保证阈值判断口径一致
      const delta = event.deltaMode === 0 ? event.deltaY : event.deltaY * itemWidth
      if (!delta) return
      event.preventDefault()
      accumulated += delta
      if (Math.abs(accumulated) < WHEEL_STEP_THRESHOLD_PX) return
      const direction = accumulated > 0 ? 1 : -1
      accumulated = 0
      stepRef.current(direction)
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => list.removeEventListener('wheel', onWheel)
  }, [itemWidth])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      commitIndex(centerIndex, { explicit: true })
      return
    }
    // 上下键一并接住：档位条虽然横排，但「上一个/下一个」的直觉两套方向键都有人用
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (!step && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : Math.min(options.length - 1, Math.max(0, centerIndex + step))
    commitIndex(target)
  }

  const padding = ((visibleCount - 1) / 2) * itemWidth

  return (
    <div
      className={`zzh-wheel${className ? ` ${className}` : ''}`}
      style={{ ['--zzh-wheel-item-w' as string]: `${itemWidth}px`, width: visibleCount * itemWidth }}
    >
      {/* 中间高亮带：标示「停在这里的档位就是当前值」，不参与滚动也不拦截点击 */}
      <div className="zzh-wheel__band" aria-hidden="true" />
      <div
        ref={listRef}
        className="zzh-wheel__list"
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
      >
        <div className="zzh-wheel__pad" style={{ width: padding }} aria-hidden="true" />
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled}
            disabled={option.disabled}
            className={`zzh-wheel__item${index === centerIndex ? ' is-center' : ''}`}
            // 距离中心越远越淡越小，形成滚轮的纵深感
            data-offset={Math.min(3, Math.abs(index - centerIndex))}
            onClick={() => commitIndex(index, { explicit: true })}
          >
            {option.label}
          </button>
        ))}
        <div className="zzh-wheel__pad" style={{ width: padding }} aria-hidden="true" />
      </div>
    </div>
  )
}
