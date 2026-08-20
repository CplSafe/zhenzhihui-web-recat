/**
 * 视频时长档位条：可横向滚动的分段控件，两端带翻页箭头。
 *
 * 只列出模型枚举过的合法档位——模型没枚举的秒数提交上去会被后端判为参数非法。
 * 档位多时（如 4~30s 共 27 档）用滚动承载，避免挤压成一片无法点选的窄按钮。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './StudioDurationPicker.module.less'

/** 时长档位条的受控数据与回调。 */
export interface StudioDurationPickerProps {
  /** 可选时长档位（秒），已升序。 */
  options: number[]
  value: number
  onChange: (durationSec: number) => void
  disabled?: boolean
}

/** 一次翻页滚动的比例（相对可视宽度）。 */
const PAGE_RATIO = 0.8

/** 渲染可横向滚动的时长档位条。 */
export default function StudioDurationPicker({ options, value, onChange, disabled }: StudioDurationPickerProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  /** 依据当前滚动位置更新两端箭头的可用状态。 */
  const syncArrows = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const maxScroll = track.scrollWidth - track.clientWidth
    setCanScrollLeft(track.scrollLeft > 1)
    // 留 1px 容差，避免亚像素宽度导致右箭头永远可点。
    setCanScrollRight(track.scrollLeft < maxScroll - 1)
  }, [])

  // 档位变化（换模型）后可滚动范围随之改变，重新同步一次。
  useEffect(() => {
    syncArrows()
  }, [syncArrows, options])

  // 容器宽度变化（侧栏收起、窗口缩放）同样影响能否滚动。
  useEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncArrows)
    observer.observe(track)
    return () => observer.disconnect()
  }, [syncArrows])

  // 选中项滚动到可视区域：换模型后新选中的档位可能在视野之外。
  // 纯视觉增强，环境不支持（jsdom、老浏览器）时静默跳过，不能因此中断渲染。
  useEffect(() => {
    const track = trackRef.current
    const active = track?.querySelector<HTMLElement>('[data-active="true"]')
    if (typeof active?.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [value, options])

  if (!options.length) return null

  const scrollByPage = (direction: -1 | 1) => {
    const track = trackRef.current
    if (!track) return
    track.scrollBy({ left: direction * track.clientWidth * PAGE_RATIO })
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.arrow}
        aria-label="查看更短的时长"
        disabled={disabled || !canScrollLeft}
        onClick={() => scrollByPage(-1)}
      >
        ‹
      </button>

      <div className={styles.track} ref={trackRef} onScroll={syncArrows} role="radiogroup" aria-label="视频时长">
        {options.map((option) => {
          const active = option === value
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              data-active={active}
              className={`${styles.option}${active ? ` ${styles.isActive}` : ''}`}
              disabled={disabled}
              onClick={() => onChange(option)}
            >
              {option}s
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className={styles.arrow}
        aria-label="查看更长的时长"
        disabled={disabled || !canScrollRight}
        onClick={() => scrollByPage(1)}
      >
        ›
      </button>
    </div>
  )
}
