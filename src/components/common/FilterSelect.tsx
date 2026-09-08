/**
 * FilterSelect — 轻量自绘下拉筛选器。
 *
 * 原生 <select> 的展开列表由操作系统绘制，样式完全不可定制（灰底高亮、直角、无圆角阴影），
 * 与首页的薄荷绿视觉格格不入。这里用按钮 + listbox 弹层自绘，保持体量极小：
 * 首页是游客首屏、受 bundle 预算约束，不为一个筛选器引入 antd Select。
 *
 * 交互对齐原生习惯：点击/Enter/Space/方向键展开，方向键移动高亮，Enter 选中，
 * Esc 或点击外部收起（复用 useDismissablePopover）。
 */
import { useEffect, useRef, useState } from 'react'
import { useDismissablePopover } from '@/composables/useDismissablePopover'
import './FilterSelect.css'

/** 一个可选项；value 为空串通常表示「全部」。 */
export interface FilterSelectOption {
  value: string
  label: string
}

interface FilterSelectProps {
  value: string
  options: FilterSelectOption[]
  onChange: (value: string) => void
  /** 无障碍名称，例如「按领域筛选」。 */
  ariaLabel: string
  className?: string
}

export default function FilterSelect({ value, options, onChange, ariaLabel, className }: FilterSelectProps) {
  const { open, setOpen, toggle, wrapRef } = useDismissablePopover<HTMLDivElement>()
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  // 展开期间的键盘高亮项；展开瞬间对齐当前选中项
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex)
  }, [open, selectedIndex])

  // 高亮项随键盘移出可视区时跟随滚动（选项多于弹层高度时）
  useEffect(() => {
    if (!open) return
    const active = listRef.current?.children[activeIndex] as HTMLElement | undefined
    active?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  const choose = (option: FilterSelectOption) => {
    onChange(option.value)
    setOpen(false)
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => Math.min(options.length - 1, Math.max(0, current + step)))
      return
    }
    // Enter/Space 落在按钮上默认触发 click（toggle）；展开时改为「选中高亮项」
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault()
      const option = options[activeIndex]
      if (option) choose(option)
    }
  }

  const selectedLabel = options[selectedIndex]?.label || ''

  return (
    <div className={`filter-select${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`filter-select__trigger${open ? ' is-open' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="filter-select__value">{selectedLabel}</span>
        <svg
          className="filter-select__arrow"
          viewBox="0 0 12 12"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m2.5 4.5 3.5 3.5 3.5-3.5" />
        </svg>
      </button>

      {open && (
        <div className="filter-select__menu" role="listbox" aria-label={ariaLabel} ref={listRef}>
          {options.map((option, index) => {
            const selected = index === selectedIndex
            return (
              <button
                key={option.value || '__all__'}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={`filter-select__option${selected ? ' is-selected' : ''}${
                  index === activeIndex ? ' is-active' : ''
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span className="filter-select__option-label">{option.label}</span>
                {selected && (
                  <svg
                    className="filter-select__check"
                    viewBox="0 0 12 12"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m2 6.4 2.7 2.6L10 3.4" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
