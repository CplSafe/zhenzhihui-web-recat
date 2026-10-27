/**
 * CanvasImagePreviewModal — 画布图片节点的「放大查看」全屏预览。
 *
 * 与视频预览（CanvasVideoPreviewModal）同一套交互语言：portal 到 body、遮罩点击/Esc 关闭。
 * 额外提供画廊导航：左右箭头 / 方向键在画布上的**全部图片**之间切换，
 * 底部缩略图条可直接跳到任意一张——预览不局限于双击的那一张。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './CanvasImagePreviewModal.module.css'
import ImageViewport from '@/components/common/ImageViewport'
import { imagePixelRatio, imageFunctionLabel, type CanvasImageInfo } from '@/utils/canvasImageInfo'
import { useToast } from '@/composables/useToast'

/** 画廊中的一张图片：画布上每个有素材的图片节点对应一项。 */
export interface CanvasImagePreviewItem {
  /** 节点 id，同时作为画廊项的唯一键 */
  id: string
  /** 图片地址（节点当前展示用的同一地址） */
  url: string
  /** 节点标题，展示在预览左上角 */
  title?: string
  assetId?: number
  workspaceId?: number
  sourceLabel?: string
  generated?: boolean
  info?: CanvasImageInfo
  panorama?: boolean
}

interface CanvasImagePreviewModalProps {
  resolveInfo?: (item: CanvasImagePreviewItem) => Promise<CanvasImageInfo | undefined>
  /** 画布上全部可预览的图片（按节点顺序） */
  items: CanvasImagePreviewItem[]
  /** 当前展示的图片（节点 id）；找不到时回退到第一张 */
  activeId: string
  /** 切换到另一张图片 */
  onSelect: (id: string) => void
  onClose: () => void
  /** 当前图片节点的“高清处理”入口。 */
  onHd?: () => void
  hdDisabled?: boolean
  onPanorama?: (nodeId: string) => void
}

export default function CanvasImagePreviewModal({
  items,
  resolveInfo,
  activeId,
  onSelect,
  onClose,
  onHd,
  hdDisabled = false,
  onPanorama,
}: CanvasImagePreviewModalProps) {
  const [failedMediaId, setFailedMediaId] = useState('')
  const [mediaSize, setMediaSize] = useState<{ id: string; width: number; height: number } | null>(null)
  const { showToast } = useToast()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const activeThumbRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const onSelectRef = useRef(onSelect)
  onCloseRef.current = onClose
  onSelectRef.current = onSelect

  const foundIndex = items.findIndex((item) => item.id === activeId)
  const index = foundIndex >= 0 ? foundIndex : 0
  const current = items[index]
  const [lookup, setLookup] = useState<{
    key: string
    status: 'loading' | 'done' | 'failed'
    info?: CanvasImageInfo
  } | null>(null)
  const lookups = useRef(new Map<string, Promise<CanvasImageInfo | undefined>>())
  const metadataKey = `${current?.workspaceId}:${current?.assetId}`
  useEffect(() => {
    if (!current?.assetId || !resolveInfo || (current.info?.modelName && current.info?.operationCode)) return
    if (
      !current.generated &&
      current.sourceLabel &&
      !['来源未记录', '高清处理', '模型生成'].includes(current.sourceLabel)
    )
      return
    let active = true
    setLookup({ key: metadataKey, status: 'loading' })
    if (!lookups.current.has(metadataKey)) lookups.current.set(metadataKey, resolveInfo(current))
    lookups.current.get(metadataKey)!.then(
      (info) => {
        if (active) setLookup({ key: metadataKey, status: 'done', info })
      },
      () => {
        lookups.current.delete(metadataKey)
        if (active) setLookup({ key: metadataKey, status: 'failed' })
      },
    )
    return () => {
      active = false
    }
  }, [metadataKey, current, resolveInfo])
  const resolved = lookup?.key === metadataKey ? lookup : null
  const info = resolved?.info
    ? {
        ...current?.info,
        ...resolved.info,
        modelName: resolved.info.modelName || current?.info?.modelName,
        prompt: resolved.info.prompt || current?.info?.prompt,
        createdAt: resolved.info.createdAt || current?.info?.createdAt,
        rows: resolved.info.rows.length ? resolved.info.rows : current?.info?.rows || [],
      }
    : current?.info
  const generated = current?.generated || Boolean(info?.operationCode?.startsWith('image.'))
  const sourceLabel =
    generated && (!current?.sourceLabel || ['来源未记录', '高清处理'].includes(current.sourceLabel))
      ? '模型生成'
      : current?.sourceLabel || '来源未记录'
  const functionLabel = imageFunctionLabel(info)
  const itemsRef = useRef(items)
  const indexRef = useRef(index)
  itemsRef.current = items
  indexRef.current = index

  const goTo = useCallback((nextIndex: number) => {
    const list = itemsRef.current
    if (nextIndex < 0 || nextIndex >= list.length) return
    onSelectRef.current(list[nextIndex].id)
  }, [])

  // 打开期间锁定页面滚动、聚焦关闭按钮；Esc 关闭、方向键翻图；关闭后还原焦点。
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' &&
        event.target instanceof HTMLElement &&
        event.target.matches('input, select, textarea')
      )
        return
      if (event.key === 'Tab') {
        const buttons = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]') || [],
        )
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        goTo(event.key === 'Home' ? 0 : itemsRef.current.length - 1)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goTo(indexRef.current - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goTo(indexRef.current + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus()
      })
    }
  }, [goTo])

  // 仅滚动缩略图条，避免 scrollIntoView 连带滚动遮罩或页面。
  useEffect(() => {
    const thumb = activeThumbRef.current
    const strip = thumb?.parentElement
    if (!thumb || !strip) return
    const item = thumb.getBoundingClientRect()
    const viewport = strip.getBoundingClientRect()
    if (item.left < viewport.left) strip.scrollLeft -= viewport.left - item.left
    else if (item.right > viewport.right) strip.scrollLeft += item.right - viewport.right
  }, [index])

  if (!current) return null

  const title = String(current.title || '').trim()

  return createPortal(
    <div className={styles.mask} onClick={() => onCloseRef.current()} role="presentation">
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="图片预览"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.close}
          onClick={() => onCloseRef.current()}
          aria-label="关闭图片预览"
        >
          ✕
        </button>

        {onHd && (
          <button type="button" className={styles.hdAction} onClick={onHd} disabled={hdDisabled}>
            高清处理
          </button>
        )}

        {(title || items.length > 1) && (
          <div className={styles.caption} aria-live="polite" aria-atomic="true">
            {title ? <span className={styles.captionTitle}>{title}</span> : null}
            {items.length > 1 ? (
              <span className={styles.captionCount} aria-label={`第 ${index + 1} 张，共 ${items.length} 张`}>
                {index + 1} / {items.length}
              </span>
            ) : null}
          </div>
        )}
        {current.panorama && onPanorama && (
          <button type="button" className={styles.panoramaAction} onClick={() => onPanorama(current.id)}>
            360° 沉浸浏览／取景
          </button>
        )}

        <div className={styles.content}>
          <div className={styles.stage}>
            {items.length > 1 && (
              <button
                type="button"
                className={`${styles.nav} ${styles.navPrev}`}
                onClick={() => goTo(index - 1)}
                disabled={index <= 0}
                aria-label="上一张图片"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="m14.5 5.5-7 6.5 7 6.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {/* key 强制换图时重挂载：上一张的画面不会在新图加载期间残留 */}
            <ImageViewport
              key={current.id + current.url}
              src={current.url}
              alt={title || '画布图片'}
              onSize={(size) => {
                setFailedMediaId('')
                setMediaSize({ id: current.id + current.url, ...size })
              }}
              onError={() => setFailedMediaId(current.id + current.url)}
            />
            {items.length > 1 && (
              <button
                type="button"
                className={`${styles.nav} ${styles.navNext}`}
                onClick={() => goTo(index + 1)}
                disabled={index >= items.length - 1}
                aria-label="下一张图片"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="m9.5 5.5 7 6.5-7 6.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>

          <aside className={styles.info} aria-label="图片信息">
            <h3>图片信息</h3>
            <dl className={styles.infoList}>
              <div>
                <dt>获取方式</dt>
                <dd>
                  {sourceLabel === '来源未记录' && resolved?.status === 'loading'
                    ? '查询中…'
                    : sourceLabel === '来源未记录' && resolved?.status === 'failed'
                      ? '来源查询失败'
                      : sourceLabel}
                </dd>
              </div>
              {generated && (
                <div>
                  <dt>使用功能</dt>
                  <dd>{functionLabel || (resolved?.status === 'loading' ? '查询中…' : '功能未记录')}</dd>
                </div>
              )}
              {(generated || info?.modelName) && (
                <div>
                  <dt>使用模型</dt>
                  <dd>
                    {info?.modelName ||
                      (info?.modelVersionId
                        ? `模型 #${info.modelVersionId}`
                        : resolved?.status === 'loading'
                          ? '查询中…'
                          : resolved?.status === 'failed'
                            ? '模型查询失败'
                            : '模型信息未记录')}
                  </dd>
                </div>
              )}
              <div>
                <dt>图片尺寸</dt>
                <dd>
                  {mediaSize?.id === current.id + current.url
                    ? `${mediaSize.width} × ${mediaSize.height} px`
                    : failedMediaId === current.id + current.url
                      ? '读取失败'
                      : '读取中…'}
                </dd>
              </div>
              <div>
                <dt>图片比例</dt>
                <dd>
                  {mediaSize?.id === current.id + current.url
                    ? imagePixelRatio(mediaSize.width, mediaSize.height)
                    : failedMediaId === current.id + current.url
                      ? '读取失败'
                      : '读取中…'}
                </dd>
              </div>
              {(info?.rows || []).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
              {info?.createdAt && Number.isFinite(Date.parse(info.createdAt)) && (
                <div>
                  <dt>生成时间</dt>
                  <dd>{new Date(info.createdAt).toLocaleString('zh-CN')}</dd>
                </div>
              )}
            </dl>
            {info?.prompt ? (
              <details className={styles.prompt} key={current.id} open>
                <summary>提示词</summary>
                <p>{info.prompt}</p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(info?.prompt || '')
                      showToast('提示词已复制', 'success')
                    } catch {
                      showToast('复制失败，请手动选择提示词复制', 'error')
                    }
                  }}
                >
                  复制提示词
                </button>
              </details>
            ) : generated && !info && resolved?.status !== 'loading' ? (
              <p className={styles.emptyInfo}>历史生成参数未记录</p>
            ) : null}
          </aside>
        </div>

        {items.length > 1 && (
          <div className={styles.thumbs} role="listbox" aria-label="画布全部图片">
            {items.map((item, itemIndex) => (
              <button
                key={item.id}
                ref={itemIndex === index ? activeThumbRef : undefined}
                type="button"
                role="option"
                aria-selected={itemIndex === index}
                aria-label={String(item.title || '').trim() || `第 ${itemIndex + 1} 张`}
                className={`${styles.thumb}${itemIndex === index ? ` ${styles.thumbActive}` : ''}`}
                onClick={() => onSelectRef.current(item.id)}
                title={String(item.title || '').trim() || `第 ${itemIndex + 1} 张`}
              >
                <img src={item.url} alt="" aria-hidden="true" loading="lazy" />
                <span className={styles.thumbNumber}>{itemIndex + 1}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
