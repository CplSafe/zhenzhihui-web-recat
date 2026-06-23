/**
 * 入口页工具栏下拉(参考 2.0 element 风格)。
 * pill 按钮(图标 + 值 + chevron)+ 点击弹出选项浮层;点击外部关闭。
 * 替代原生 <select>,保证各浏览器样式一致。
 * 支持单选(默认)与多选(multiple):多选时 value 为 string[],点选切换不关闭浮层,
 * 按钮内以空格连接展示已选项(如「叫卖 幽默 商业」)。
 */
import { useEffect, useRef, useState } from 'react'
import styles from './EntryDropdown.module.less'

interface EntryDropdownProps {
  icon: React.ReactNode
  options: string[]
  value: string | string[]
  onChange: (v: any) => void
  multiple?: boolean
  placeholder?: string
}

export default function EntryDropdown({
  icon,
  value,
  options,
  onChange,
  multiple = false,
  placeholder = '请选择',
}: EntryDropdownProps) {
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

  // 多选时把 value 规整成数组;单选时按字符串处理
  const selected = multiple ? (Array.isArray(value) ? value : value ? [String(value)] : []) : []
  const isSel = (o: string) => (multiple ? selected.includes(o) : o === value)
  const label = multiple ? (selected.length ? selected.join(' ') : placeholder) : String(value ?? '')

  const handlePick = (o: string) => {
    if (multiple) {
      // 切换选中态,保持浮层打开以便连续多选
      const next = selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]
      onChange(next)
    } else {
      onChange(o)
      setOpen(false)
    }
  }

  return (
    <div className={styles.entrydd} ref={ref}>
      <button
        type="button"
        className={`${styles.btn}${open ? ' ' + styles.open : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icon}
        <span className={styles.val}>{label}</span>
        <svg className={styles.caret} viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className={styles.menu} role="listbox" aria-multiselectable={multiple}>
          {options.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={isSel(o)}
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
