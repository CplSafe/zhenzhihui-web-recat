/**
 * InlineEdit — 双击编辑、回车确认、Esc 取消、失焦确认。
 * 平时只显示文本(简洁),双击才出现输入框。用于镜头标题 / 秒数 / 画面描述等轻量编辑。
 */
import { useState } from 'react'
import './InlineEdit.css'

interface InlineEditProps {
  value: string
  onCommit: (next: string) => void
  /** 多行(textarea):Enter 确认,Shift+Enter 换行 */
  multiline?: boolean
  /** 仅数字 */
  numeric?: boolean
  placeholder?: string
  /** 显示态/编辑态共用的类名前缀(配 -display / -input) */
  className?: string
  editable?: boolean
  maxLength?: number
}

export default function InlineEdit({
  value,
  onCommit,
  multiline,
  numeric,
  placeholder = '双击编辑',
  className = '',
  editable = true,
  maxLength,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const start = () => {
    if (!editable) return
    setDraft(value)
    setEditing(true)
  }
  const commit = () => {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  const cancel = () => setEditing(false)

  if (!editing) {
    return (
      <span
        className={`ie ie-display ${className}`}
        onDoubleClick={start}
        title={editable ? '双击修改' : undefined}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
      >
        {value ? value : <span className="ie-ph">{placeholder}</span>}
      </span>
    )
  }

  const onChange = (v: string) => setDraft(numeric ? v.replace(/[^0-9.]/g, '') : v)
  if (multiline) {
    return (
      <textarea
        className={`ie ie-input ${className}`}
        autoFocus
        value={draft}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            cancel()
          }
        }}
      />
    )
  }
  return (
    <input
      className={`ie ie-input ${className}`}
      autoFocus
      value={draft}
      maxLength={maxLength}
      inputMode={numeric ? 'numeric' : undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          cancel()
        }
      }}
    />
  )
}
