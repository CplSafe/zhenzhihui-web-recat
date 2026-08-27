/**
 * 创作参数（画面比例 / 视频时长 / 分辨率 / 出图数量）的弹窗选择器。
 *
 * 与「本次创作使用的模型」共用同一套面板视觉与定位逻辑：底栏只留一个 chip，
 * 点开后是标题 + 逐行「左标题 右下拉」的面板。此前这几项在底栏各占一个 chip，
 * 与模型 chip 等距排开，两层语义（用什么生成 / 生成成什么样）被拍平成一排。
 *
 * 档位本身仍由调用方按所选模型的 schema 算好后传入，这里只负责呈现与选择。
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CloseOutlined, DownOutlined, SlidersOutlined } from '@ant-design/icons'
import styles from '../GenerationModelPicker/GenerationModelDropdown.module.less'

export interface CreativeParamField {
  /** 稳定键，用于 React key 与 label 关联。 */
  key: string
  /** 行标题，如「画面比例」。 */
  label: string
  /** 行副标题，说明该参数影响什么。 */
  hint?: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  /** 未选择时的占位文案；省略则显示「请选择」。 */
  placeholder?: string
}

interface CreativeParamsDropdownProps {
  fields: readonly CreativeParamField[]
  /** chip 上的摘要文本；省略时按各项当前值拼接。 */
  summary?: string
  disabled?: boolean
  /** 禁用原因；作为 title 提示，让「点不动」有解释。 */
  disabledHint?: string
  /** 与所选模型不兼容时的提示，显示在面板顶部。 */
  conflicts?: readonly string[]
}

/** 未选择时长等参数时 chip 上的占位。 */
const EMPTY_SUMMARY = '创作参数'

export default function CreativeParamsDropdown({
  fields,
  summary,
  disabled = false,
  disabledHint,
  conflicts = [],
}: CreativeParamsDropdownProps) {
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const panelId = useId()

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  /**
   * 面板定位：与模型弹窗同一套算法——跟随触发器左对齐，下方空间不足则向上翻，
   * 并夹在视口内。窄屏交给样式表按全屏浮层处理。
   */
  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return
    if (window.innerWidth <= 720) {
      setPanelStyle(undefined)
      return
    }

    const viewportGap = 12
    const triggerGap = 12
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const triggerRect = trigger.getBoundingClientRect()
    const width = Math.min(460, Math.max(280, viewportWidth - viewportGap * 2))
    const left = Math.min(
      Math.max(viewportGap, triggerRect.left),
      Math.max(viewportGap, viewportWidth - width - viewportGap),
    )
    const belowSpace = viewportHeight - triggerRect.bottom - triggerGap - viewportGap
    const aboveSpace = triggerRect.top - triggerGap - viewportGap
    const openAbove = belowSpace < 240 && aboveSpace > belowSpace
    const availableHeight = Math.max(180, openAbove ? aboveSpace : belowSpace)
    const maxHeight = Math.min(520, Math.floor(viewportHeight * 0.64), availableHeight)
    const measuredHeight = Math.min(panelRef.current?.offsetHeight || maxHeight, maxHeight)
    const top = openAbove
      ? Math.max(viewportGap, triggerRect.top - triggerGap - measuredHeight)
      : Math.min(triggerRect.bottom + triggerGap, viewportHeight - measuredHeight - viewportGap)

    setPanelStyle({ position: 'fixed', top, left, right: 'auto', bottom: 'auto', width, maxHeight })
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRestoreFocus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    let settleFrame = 0
    const frame = requestAnimationFrame(() => {
      updatePanelPosition()
      settleFrame = requestAnimationFrame(updatePanelPosition)
    })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
      cancelAnimationFrame(frame)
      cancelAnimationFrame(settleFrame)
    }
  }, [closeAndRestoreFocus, open, updatePanelPosition])

  const chosen = fields.filter((field) => field.value)
  const triggerText = summary || (chosen.length ? chosen.map((field) => field.value).join(' · ') : EMPTY_SUMMARY)

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`创作参数，当前 ${triggerText}`}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        onClick={() => {
          if (!open) updatePanelPosition()
          setOpen((value) => !value)
        }}
      >
        <SlidersOutlined className={styles.triggerIcon} aria-hidden="true" />
        <span>{triggerText}</span>
        <DownOutlined className={`${styles.chevron}${open ? ` ${styles.chevronOpen}` : ''}`} aria-hidden="true" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <section
            ref={panelRef}
            id={panelId}
            className={styles.popover}
            style={panelStyle}
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${panelId}-title`}
          >
            <header className={styles.header}>
              <div>
                <h2 id={`${panelId}-title`}>本次创作的画面参数</h2>
                <p>档位由所选模型决定；换模型后不被支持的选项会自动收起</p>
              </div>
              <div className={styles.headerActions}>
                <button type="button" className={styles.close} aria-label="关闭参数选择" onClick={closeAndRestoreFocus}>
                  <CloseOutlined aria-hidden="true" />
                </button>
              </div>
            </header>

            {conflicts.length > 0 && (
              <div className={`${styles.globalState} ${styles.error}`} role="alert">
                <span>{conflicts[0]}</span>
              </div>
            )}

            <div className={styles.slotList}>
              {fields.map((field, index) => (
                <div className={styles.slot} key={field.key}>
                  <div className={styles.slotTop}>
                    <label htmlFor={`${panelId}-field-${index}`}>
                      <span>{field.label}</span>
                      {field.hint && <small>{field.hint}</small>}
                    </label>
                    <select
                      id={`${panelId}-field-${index}`}
                      aria-label={field.label}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                    >
                      {!field.value && <option value="">{field.placeholder || '请选择'}</option>}
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </section>,
          document.body,
        )}
    </div>
  )
}

export type { CreativeParamsDropdownProps }
