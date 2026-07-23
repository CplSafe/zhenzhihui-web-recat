/**
 * AppConfirmDialog — 可访问的确认/输入对话框。
 * 挂载在顶层，任意页面可经 useConfirmDialog().requestConfirm() 触发。
 */
import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useUiStore } from '../stores/ui'
import './AppConfirmDialog.css'

/** 订阅全局确认状态，并将用户选择通过 store 中保存的 Promise 解析器返回给调用方。 */
export default function AppConfirmDialog() {
  const state = useUiStore((s) => s.confirm)
  const resolveConfirm = useUiStore((s) => s.resolveConfirm)
  const setConfirmInput = useUiStore((s) => s.setConfirmInput)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state.visible) return
    if (state.inputEnabled) inputRef.current?.focus()
    else dialogRef.current?.focus()
  }, [state.id, state.inputEnabled, state.visible])

  if (!state.visible) return null

  const hasInput = Boolean(state.inputEnabled)
  const title = state.title || '确认操作'
  const message = state.message || ''
  const confirmLabel = state.confirmLabel || '确认'
  const cancelLabel = state.cancelLabel || '取消'
  const confirmDanger = Boolean(state.danger)
  const idSuffix = state.id || 0

  const handleConfirm = () => {
    const userInput = inputRef.current?.value?.trim?.() ?? ''
    resolveConfirm(hasInput ? userInput : true)
  }

  const handleCancel = () => {
    resolveConfirm(hasInput ? null : false)
  }

  const handleKeydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') handleCancel()
    if (event.key === 'Enter' && !hasInput) handleConfirm()
  }

  return (
    <div
      ref={dialogRef}
      className="confirm-overlay"
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={`confirm-title-${idSuffix}`}
      aria-describedby={`confirm-desc-${idSuffix}`}
      onKeyDown={handleKeydown}
    >
      <div className="confirm-backdrop" aria-hidden="true" onClick={handleCancel} />
      <div className="confirm-dialog">
        <strong id={`confirm-title-${idSuffix}`} className="confirm-title">
          {title}
        </strong>
        {message && (
          <p id={`confirm-desc-${idSuffix}`} className="confirm-message">
            {message}
          </p>
        )}

        {hasInput && (
          <input
            ref={inputRef}
            className="confirm-input"
            type="text"
            value={state.inputValue}
            placeholder={state.inputPlaceholder || '请输入'}
            aria-label={state.inputLabel || '输入内容'}
            onChange={(e) => setConfirmInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm()
            }}
          />
        )}

        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={handleCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-btn confirm-btn-submit${confirmDanger ? ' is-danger' : ''}`}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
