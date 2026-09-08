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
        {/* 类型图标：危险操作（删除/解散等）与普通确认在视觉上分开，扫一眼就知道分量 */}
        <div className="confirm-head">
          <span className={`confirm-icon${confirmDanger ? ' is-danger' : ''}`} aria-hidden="true">
            {confirmDanger ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M12 8.6v4.6" />
                <path d="M12 16.6h.01" />
                <path
                  d="M10.4 4.1 3.2 16.7c-.7 1.2.2 2.8 1.6 2.8h14.4c1.4 0 2.3-1.6 1.6-2.8L13.6 4.1c-.7-1.2-2.5-1.2-3.2 0Z"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4" />
                <path d="M12 16.8h.01" />
              </svg>
            )}
          </span>
          <strong id={`confirm-title-${idSuffix}`} className="confirm-title">
            {title}
          </strong>
        </div>
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
