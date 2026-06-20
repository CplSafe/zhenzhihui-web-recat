/**
 * EditField — 智能成片各「修改框」复用组件(2.1)。
 * 结构:标题 + 文本域 + 字数 + 「AI 润色」按钮。
 * 按 2.1 规范:去掉每个框的「提交」按钮(改动随底部总按钮保存),新增「AI 润色」。
 * 受控:value + onChange。润色调用本地模型(src/api/aiPolish)。
 */
import { useRef, useState } from 'react'
import { polishText, type PolishKind } from '@/api/aiPolish'
import { useToast } from '@/composables/useToast'
import './EditField.css'

interface EditFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  kind?: PolishKind
  /** 润色上下文(如所属分镜主体/场景) */
  context?: string
  placeholder?: string
  maxLength?: number
  /** 标题栏右侧附加内容(如【片段1】角标),可选 */
  badge?: React.ReactNode
  rows?: number
}

export default function EditField({
  label,
  value,
  onChange,
  kind = 'generic',
  context,
  placeholder,
  maxLength = 500,
  badge,
  rows = 3,
}: EditFieldProps) {
  const { showToast } = useToast()
  const [polishing, setPolishing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const handlePolish = async () => {
    if (polishing) return
    if (!value.trim()) {
      showToast('请输入内容后再润色', 'info')
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPolishing(true)
    try {
      const out = await polishText(value, { kind, context, signal: ctrl.signal })
      onChange(maxLength ? out.slice(0, maxLength) : out)
      showToast('已润色', 'success')
    } catch (e: any) {
      if (e?.name !== 'AbortError') showToast(e?.message || '润色失败,请重试', 'error')
    } finally {
      setPolishing(false)
    }
  }

  return (
    <div className="edit-field">
      <div className="edit-field__head">
        <span className="edit-field__label">{label}</span>
        {badge}
      </div>
      <div className={`edit-field__box${polishing ? ' is-busy' : ''}`}>
        <textarea
          className="edit-field__input"
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={polishing}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="edit-field__foot">
          <span className="edit-field__count">
            {value.length}/{maxLength}
          </span>
          <button
            type="button"
            className="edit-field__polish"
            onClick={handlePolish}
            disabled={polishing}
            title="使用 AI 润色这段文本"
          >
            {polishing ? (
              <span className="edit-field__spinner" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
                <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z" />
              </svg>
            )}
            {polishing ? '润色中…' : 'AI 润色'}
          </button>
        </div>
      </div>
    </div>
  )
}
