import React, { useEffect, useRef, useState } from 'react'
import ViewportFloatingPanel from './ViewportFloatingPanel'
import type { GenerationModelOption } from '@/utils/generationModelCatalog'
import {
  readModelAccentHue,
  readModelInitial,
  readModelPresentation,
  readModelDescription,
} from '@/utils/modelPresentation'
import styles from './CanvasNodePanel.module.css'

/** 通用选择器弹出层 */
function SelectorPopover({
  children,
  open,
  onClose,
  expansionSpace,
  anchorElement,
  onEnter,
  onLeave,
}: {
  children: React.ReactNode
  open: boolean
  onClose: () => void
  expansionSpace: number
  anchorElement: HTMLElement | null
  onEnter: () => void
  onLeave: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const selected = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    selected?.scrollIntoView?.({ block: 'nearest' })
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      // 触发按钮交给自己的 click 切换，避免 mousedown 先关闭、click 又重新打开。
      if (ref.current?.contains(target) || anchorRef.current?.parentElement?.contains(target)) return
      onClose()
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      anchorRef.current?.parentElement?.querySelector<HTMLButtonElement>('button')?.focus()
      onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', keyboard, true)
    }
  }, [open, onClose])
  return open ? (
    <div ref={anchorRef}>
      <ViewportFloatingPanel
        panelRef={ref}
        anchorElement={anchorElement}
        expansionSpace={expansionSpace}
        layer={1500}
        className={`${styles.popover} ${styles.modelPopover} nodrag nopan nowheel`}
        role="listbox"
        aria-label="生成模型列表"
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Tab') {
            anchorRef.current?.parentElement?.querySelector<HTMLButtonElement>('button')?.focus()
            onClose()
            return
          }
          const options = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([aria-disabled="true"])') || [],
          )
          const index = options.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? options.length - 1
                : event.key === 'ArrowDown'
                  ? (index + 1) % options.length
                  : event.key === 'ArrowUp'
                    ? (index - 1 + options.length) % options.length
                    : -1
          if (next >= 0) {
            event.preventDefault()
            options[next]?.focus({ preventScroll: true })
            options[next]?.scrollIntoView?.({ block: 'nearest' })
          }
        }}
      >
        {children}
      </ViewportFloatingPanel>
    </div>
  ) : null
}

/* ── 模型选择器（受控，数据来自 /api/v1/ai/models） ── */
export default function CanvasModelSelector({
  models,
  durationLabel,
  value,
  loading,
  disabled,
  emptyLabel,
  onChange,
}: {
  models: GenerationModelOption[]
  durationLabel: (model: GenerationModelOption) => string
  operation?: string
  value?: number
  loading?: boolean
  disabled?: boolean
  /** 没有可用模型时的说明，用于区分「目录还没加载出来」和「这个操作没有可用模型」。 */
  emptyLabel?: string
  onChange?: (modelVersionId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [inspected, setInspected] = useState<number | null>(null)
  const hoverOpenTimerRef = useRef<number | null>(null)
  const hoverCloseTimerRef = useRef<number | null>(null)
  const clearHoverTimers = () => {
    if (hoverOpenTimerRef.current !== null) window.clearTimeout(hoverOpenTimerRef.current)
    if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
    hoverOpenTimerRef.current = null
    hoverCloseTimerRef.current = null
  }
  const close = () => {
    clearHoverTimers()
    setInspected(null)
    setOpen(false)
  }
  const inspect = (id: number) => {
    // 悬停时立即展开模型说明；延迟会让菜单显得迟钝。
    setInspected(id)
  }
  const availableModels = models.filter((m) => !m.unavailableReason)
  /**
   * 目录里有、但当前用不了的模型（未开通会员、余额不足、套餐不含等）。
   *
   * 这些模型原来被直接滤掉，控件只剩一句「暂无可用模型」且连点都点不开——
   * 后端明明给了 unavailableReason，用户却看不到，只能以为是素材或连线出了毛病。
   * 有原因就把原因显示出来，让人知道下一步该做什么。
   */
  const blockedModels = models.filter((m) => m.unavailableReason)
  const blockedReason = String(blockedModels[0]?.unavailableReason || '')
  const selected = availableModels.find((m) => m.modelVersionId === value)
  const display = loading
    ? '加载中...'
    : selected?.displayName || (blockedModels.length ? '模型暂不可用' : emptyLabel || '暂无可用模型')
  // 有被挡住的模型时仍然允许展开：列表里逐条写明为什么用不了
  const canOpen = !disabled && (availableModels.length > 0 || blockedModels.length > 0)
  useEffect(
    () => () => {
      if (hoverOpenTimerRef.current !== null) window.clearTimeout(hoverOpenTimerRef.current)
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
    },
    [],
  )
  const scheduleHoverOpen = () => {
    if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = null
    if (!canOpen || open) return
    if (hoverOpenTimerRef.current !== null) window.clearTimeout(hoverOpenTimerRef.current)
    hoverOpenTimerRef.current = window.setTimeout(() => {
      setOpen(true)
      hoverOpenTimerRef.current = null
    }, 160)
  }
  const scheduleHoverClose = () => {
    if (hoverOpenTimerRef.current !== null) window.clearTimeout(hoverOpenTimerRef.current)
    hoverOpenTimerRef.current = null
    if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setInspected(null)
      setOpen(false)
      hoverCloseTimerRef.current = null
    }, 180)
  }
  return (
    <div className={styles.selectorWrap}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-disabled={!canOpen}
        className={`${styles.selector} ${canOpen ? '' : styles.selectorDisabled}`}
        title={selected ? undefined : blockedReason || emptyLabel || undefined}
        onPointerEnter={scheduleHoverOpen}
        onPointerLeave={scheduleHoverClose}
        onClick={() => {
          if (!canOpen) return
          clearHoverTimers()
          if (open) close()
          else setOpen(true)
        }}
        aria-expanded={open && canOpen}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          if (canOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setOpen(true)
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLElement>(
                  '[aria-label="生成模型列表"] [aria-selected="true"], [aria-label="生成模型列表"] [role="option"]:not([aria-disabled="true"])',
                )
                ?.focus(),
            )
          }
        }}
      >
        {display}
      </button>
      {open && canOpen && (
        <SelectorPopover
          open={open}
          anchorElement={triggerRef.current}
          // 留出模型简介展开空间，并确保长目录仍可显示约十行后内部滚动。
          expansionSpace={models.length > 10 ? 360 : models.some((model) => readModelDescription(model)) ? 60 : 0}
          onClose={close}
          onEnter={() => {
            if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
            hoverCloseTimerRef.current = null
          }}
          onLeave={() => {
            setInspected(null)
            scheduleHoverClose()
          }}
        >
          {/* 可用的排在前面：被锁住的混在中间会让人以为列表到此为止 */}
          {availableModels.map((m) => (
            <ModelOptionRow
              key={m.modelVersionId}
              model={m}
              expanded={inspected === m.modelVersionId}
              onInspect={() => inspect(m.modelVersionId)}
              onBlur={() => {
                setInspected(null)
              }}
              durationSupport={durationLabel(m)}
              selected={m.modelVersionId === (selected?.modelVersionId ?? value)}
              onSelect={() => {
                onChange?.(m.modelVersionId)
                close()
              }}
            />
          ))}
          {blockedModels.map((m) => (
            <ModelOptionRow
              key={m.modelVersionId}
              model={m}
              expanded={inspected === m.modelVersionId}
              onInspect={() => inspect(m.modelVersionId)}
              onBlur={() => {
                setInspected(null)
              }}
              durationSupport={durationLabel(m)}
              blockedReason={String(m.unavailableReason)}
            />
          ))}
        </SelectorPopover>
      )}
    </div>
  )
}

/**
 * 模型列表里的一行。
 *
 * 紧凑行保留支持时长上限，悬停或键盘聚焦时展开后端简介。
 *
 * 不可用的模型同样走这一行：右侧换成锁标记，原因写在下方。
 * 锁给出「点不了」的瞬时信号，文字回答「为什么、下一步做什么」，两者缺一不可。
 */
function ModelOptionRow({
  model,
  durationSupport,
  selected,
  blockedReason,
  onSelect,
  expanded,
  onInspect,
  onBlur,
}: {
  model: GenerationModelOption
  durationSupport: string
  selected?: boolean
  blockedReason?: string
  onSelect?: () => void
  expanded: boolean
  onInspect: () => void
  onBlur: () => void
}) {
  const info = readModelPresentation(model)
  const initial = readModelInitial(model.displayName, info.provider)
  const hue = readModelAccentHue(model.displayName)
  const blocked = Boolean(blockedReason)
  const description = readModelDescription(model)
  /*
   * 图标优先用后端给的 logo；加载失败再退回首字母。
   * 不做失败回退的话，链接一坏这一列就全是碎图占位——比没有图标更糟。
   */
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = Boolean(info.logo) && !logoFailed
  /*
   * 模型的时长上限，直接展示在模型名下方。
   * 不展示的话，用户只能先选中模型、再去时长档位条里看还剩哪几档，选错了还得退回来重选——
   * 「我要的秒数它做不做得到」应当在选之前就看得见。
   * 只报上限：模型是 1 秒起、到上限为止，逐档列出反而会把可选范围说窄。
   */

  const content = (
    <>
      <span className={styles.modelRowHead}>
        {showLogo ? (
          <img
            className={styles.modelRowLogo}
            src={info.logo}
            alt=""
            title={info.provider || undefined}
            loading="lazy"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          initial && (
            <span
              className={styles.modelRowAvatar}
              // 厂商名放在 title 里：标记本身取的是模型名首字，厂商信息不该因此丢失
              title={info.provider || undefined}
              aria-hidden="true"
              style={
                blocked
                  ? undefined
                  : {
                      // 同一模型每次打开都是同一个颜色（按名称哈希，不用随机值）
                      background: `hsl(${hue} 62% 94%)`,
                      color: `hsl(${hue} 46% 38%)`,
                    }
              }
            >
              {initial}
            </span>
          )
        )}
        <span className={styles.modelRowName}>{model.displayName}</span>
        {info.isNew && !blocked && <span className={styles.modelRowNew}>NEW</span>}
        {blocked ? (
          <LockIcon />
        ) : selected ? (
          <span className={styles.modelRowCheck} aria-hidden="true">
            ✓
          </span>
        ) : null}
      </span>
      {durationSupport && (
        <span className={styles.modelRowMeta}>
          {/* 支持的秒数排在最前：选视频模型时这是最先要判断的一项 */}
          {durationSupport && (
            <span className={`${styles.modelRowTag} ${styles.modelRowTagDuration}`}>{durationSupport}</span>
          )}
        </span>
      )}
      {blocked && <em className={styles.modelRowReason}>{blockedReason}</em>}
      {description && (
        <span className={styles.modelRowReveal} aria-hidden={!expanded}>
          <span>
            <span className={styles.modelRowDescription}>{description}</span>
          </span>
        </span>
      )}
    </>
  )

  return (
    <button
      type="button"
      role="option"
      aria-disabled={blocked || undefined}
      aria-selected={Boolean(selected)}
      data-expanded={Boolean(description && expanded)}
      className={`${styles.modelRow} ${selected ? styles.modelRowActive : ''} ${blocked ? styles.modelRowBlocked : ''}`}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse' && (event.movementX || event.movementY)) onInspect()
      }}
      onFocus={onInspect}
      // 指针选择保持当前焦点，避免浏览器为浮层按钮滚动底层画布；键盘仍可正常聚焦。
      onMouseDown={(event) => event.preventDefault()}
      onBlur={onBlur}
      onClick={blocked ? undefined : onSelect}
    >
      {content}
    </button>
  )
}

/** 不可用模型的锁标记。 */
function LockIcon() {
  return (
    <svg className={styles.modelRowLock} viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
