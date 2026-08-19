/**
 * 入口页工具栏下拉(参考 2.0 element 风格)。
 * pill 按钮(图标 + 值 + chevron)+ 点击弹出选项浮层;点击外部关闭。
 * 替代原生 <select>,保证各浏览器样式一致。
 * 支持单选(默认)与多选(multiple):多选时 value 为 string[],点选切换不关闭浮层,
 * 按钮内以空格连接展示已选项(如「叫卖 幽默 商业」)。
 */
import { useEffect, useRef, useState } from 'react'
import WheelPicker from '@/components/common/WheelPicker'
import styles from './EntryDropdown.module.less'

/** 下拉选项、单/多选受控值、清空策略和禁用状态。 */
interface EntryDropdownProps {
  icon: React.ReactNode
  options: string[]
  value: string | string[]
  onChange: (v: any) => void
  /** 下拉触发器的可访问名称；同一工具栏存在多个下拉时用于消除歧义。 */
  ariaLabel?: string
  /** 靠近视口底部的工具栏可让菜单向上展开。 */
  placement?: 'top' | 'bottom'
  multiple?: boolean
  placeholder?: string
  /** 只读/禁用:按钮不可点击、不弹出浮层(用于只读复用场景) */
  disabled?: boolean
  /**
   * 有前置条件未满足:按钮【仍可点击】但不展开浮层，改为回调让调用方说明原因。
   * 与 disabled 的区别在于用户点得动——否则无从得知为什么不能选。
   */
  blocked?: boolean
  /** blocked 状态下被点击时触发，用于提示前置条件。 */
  onBlockedClick?: () => void
  disabledOptions?: readonly string[]
  /** 单选可清空:再次点击已选项则清空(onChange('')) */
  clearable?: boolean
  /** 值文字区最小宽度(px):固定后切换不同长度的值(如比例 16:9/1:1)时按钮整体宽度不抖动 */
  valueMinWidth?: number
  /**
   * 浮层形态:list=平铺选项(默认);wheel=滚轮吸附选择。
   * 滚轮只适合时长这类有序连续档位,且仅支持单选。
   */
  variant?: 'list' | 'wheel'
}

/** 渲染入口工具栏统一下拉，并支持外部点击关闭和连续多选。 */
export default function EntryDropdown({
  icon,
  value,
  options,
  onChange,
  ariaLabel,
  placement = 'bottom',
  multiple = false,
  placeholder = '请选择',
  disabled = false,
  blocked = false,
  onBlockedClick,
  disabledOptions = [],
  clearable = false,
  valueMinWidth,
  variant = 'list',
}: EntryDropdownProps) {
  // 滚轮是单选形态：多选语义（连续勾选、复选标记）在滚轮里没有对应交互，退回平铺列表。
  const useWheel = variant === 'wheel' && !multiple
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  // 前置条件在浮层展开后失效(如清空了模型选择)时收起，避免继续选到不该选的值。
  useEffect(() => {
    if (blocked) setOpen(false)
  }, [blocked])

  // 多选时把 value 规整成数组;单选时按字符串处理
  const selected = multiple ? (Array.isArray(value) ? value : value ? [String(value)] : []) : []
  const isSel = (o: string) => (multiple ? selected.includes(o) : o === value)
  // 单选未选中时,按钮文字回退到 placeholder(如「SKILLS」)
  const label = multiple ? (selected.length ? selected.join(' ') : placeholder) : String(value || placeholder)

  const handlePick = (o: string) => {
    if (disabledOptions.includes(o)) return
    if (multiple) {
      // 切换选中态,保持浮层打开以便连续多选
      const next = selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]
      onChange(next)
    } else {
      // 可清空:再次点击当前已选项则清空
      onChange(clearable && o === value ? '' : o)
      setOpen(false)
    }
  }

  return (
    <div className={`${styles.entrydd}${placement === 'top' ? ' ' + styles.top : ''}`} ref={ref}>
      <button
        type="button"
        className={`${styles.btn}${open ? ' ' + styles.open : ''}${blocked && !disabled ? ' ' + styles.blocked : ''}`}
        onClick={() => {
          if (disabled) return
          // 前置条件未满足：不展开，只解释原因；已展开时仍允许收起。
          if (blocked && !open) {
            onBlockedClick?.()
            return
          }
          setOpen((o) => !o)
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icon}
        <span
          className={styles.val}
          style={valueMinWidth ? { minWidth: valueMinWidth, display: 'inline-block', textAlign: 'left' } : undefined}
        >
          {label}
        </span>
        {/* 可清空且已选中:显示叉号,点击清空(阻止冒泡,避免触发展开) */}
        {clearable && !multiple && value && !disabled && (
          <span
            className={styles.clear}
            role="button"
            aria-label="清空"
            title="清空"
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
              setOpen(false)
            }}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
        )}
        <svg className={styles.caret} viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && useWheel && (
        <div className={`${styles.menu} ${styles.menuWheel}`}>
          <WheelPicker
            options={options.map((o) => ({ value: o, label: o, disabled: disabledOptions.includes(o) }))}
            value={String(value || '')}
            // 滚动停下即生效，但不收起浮层——中途每停顿一次就关掉会让人没法继续往下找档位。
            onChange={onChange}
            // 点击某档位/回车是明确的确认动作，这时才收起。点击浮层外同样收起。
            onCommit={() => setOpen(false)}
            ariaLabel={ariaLabel}
            // 5 档 × 64px = 320px：当前档位左右各看得见两档，足以判断该往哪边滑，又不至于宽过输入卡片
            visibleCount={5}
            itemWidth={64}
          />
        </div>
      )}
      {open && !useWheel && (
        <div className={styles.menu} role="listbox" aria-label={ariaLabel} aria-multiselectable={multiple}>
          {options.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={isSel(o)}
              aria-disabled={disabledOptions.includes(o)}
              disabled={disabledOptions.includes(o)}
              className={`${styles.opt}${isSel(o) ? ' ' + styles.active : ''}${multiple ? ' ' + styles.optMulti : ''}`}
              onClick={() => handlePick(o)}
            >
              {multiple && (
                <span className={styles.check} aria-hidden="true">
                  {isSel(o) && (
                    <svg viewBox="0 0 12 12" width="12" height="12">
                      <path
                        d="M2 6.5l2.5 2.5L10 3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              )}
              <span>{o}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
