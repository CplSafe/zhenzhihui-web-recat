/**
 * 入口页工具栏下拉(参考 2.0 element 风格)。
 * pill 按钮(图标 + 值 + chevron)+ 点击弹出选项浮层;点击外部关闭。
 * 替代原生 <select>,保证各浏览器样式一致。
 */
import { useEffect, useRef, useState } from 'react'

interface EntryDropdownProps {
  icon: React.ReactNode
  value: string
  options: string[]
  onChange: (v: string) => void
}

export default function EntryDropdown({ icon, value, options, onChange }: EntryDropdownProps) {
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

  return (
    <div className="entrydd" ref={ref}>
      <button
        type="button"
        className={`screate__pill entrydd__btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icon}
        <span className="entrydd__val">{value}</span>
        <svg className="entrydd__caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="entrydd__menu" role="listbox">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={o === value}
              className={`entrydd__opt${o === value ? ' is-active' : ''}`}
              onClick={() => {
                onChange(o)
                setOpen(false)
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
