/**
 * InlineEdit — 双击编辑、回车确认、Esc 取消、失焦确认。
 * 平时只显示文本(简洁),双击才出现输入框。用于镜头标题 / 秒数 / 画面描述等轻量编辑。
 */
import { useEffect, useRef, useState } from 'react'
import './InlineEdit.css'

/** 行内编辑器的受控值、提交方式和输入约束。 */
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
  /**
   * 进入编辑的方式:单击 / 双击(默认双击) / none。
   * none = 展示态就是一段普通文本,不响应点击与键盘,只能由 openSignal 打开——
   * 用在本身可点击的容器里(如整张可点开的项目卡片),避免"双击改名"的第一下就把卡片点开了。
   */
  trigger?: 'click' | 'dblclick' | 'none'
  /**
   * 由外部要求进入编辑态(例如另一处的「重命名」按钮)。
   * 从 false 变 true 时展开输入框;不传则完全保持原有的自行控制行为。
   */
  openSignal?: boolean
  /** 退出编辑态时通知外部,便于对方复位 openSignal。 */
  onEditingEnd?: () => void
  /**
   * 展示态的悬停提示。默认是「双击修改」这类操作提示;
   * 文本被省略号截断的场合(画布节点标题)传全文,否则用户悬停只能看到怎么改、看不到被截掉的内容。
   */
  title?: string
}

/** 在展示态与输入态之间切换，并把确认后的新值一次性交给父组件持久化。 */
export default function InlineEdit({
  value,
  onCommit,
  multiline,
  numeric,
  placeholder = '双击编辑',
  className = '',
  editable = true,
  maxLength,
  trigger = 'dblclick',
  openSignal,
  onEditingEnd,
  title,
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
    onEditingEnd?.()
    if (draft !== value) onCommit(draft)
  }
  const cancel = () => {
    setEditing(false)
    onEditingEnd?.()
  }

  // 外部信号从 false 变 true 时进入编辑态;只认这一次跳变,不接管后续的自行开合
  const prevOpenRef = useRef(false)
  useEffect(() => {
    const wanted = Boolean(openSignal)
    if (wanted && !prevOpenRef.current && !editing) start()
    prevOpenRef.current = wanted
  })

  if (!editing) {
    // trigger=none:展示态是普通文本,不挂交互;只由 openSignal 打开
    const interactive = editable && trigger !== 'none'
    return (
      <span
        className={`ie ie-display ${className}`}
        onClick={trigger === 'click' ? start : undefined}
        onDoubleClick={trigger === 'dblclick' ? start : undefined}
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                start()
              }
            : undefined
        }
        title={title ?? (interactive ? (trigger === 'click' ? '点击修改' : '双击修改') : undefined)}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
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
