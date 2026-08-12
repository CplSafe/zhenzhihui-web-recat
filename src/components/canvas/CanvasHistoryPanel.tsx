/**
 * CanvasHistoryPanel — 历史记录浮动面板
 * 图片/视频 Tab 切换，3 列网格缩略图展示，参考素材库面板
 */
import { useState, useEffect, useMemo } from 'react'
import styles from './CanvasHistoryPanel.module.css'

interface HistoryItem {
  id: string
  nodeId?: string
  title: string
  type: 'image' | 'video'
  src?: string
  poster?: string
}

interface CanvasHistoryPanelProps {
  visible: boolean
  position?: { x: number; y: number } | null
  variant?: 'popover' | 'drawer'
  onClose: () => void
  onSelect?: (item: HistoryItem) => void
  items?: HistoryItem[]
}

export default function CanvasHistoryPanel({
  visible,
  position,
  variant = 'popover',
  onClose,
  onSelect,
  items: sourceItems = [],
}: CanvasHistoryPanelProps) {
  const [tab, setTab] = useState<'image' | 'video'>('image')

  const items = useMemo(() => sourceItems.filter((item) => item.type === tab), [sourceItems, tab])

  // 点击外部关闭
  useEffect(() => {
    if (!visible || variant !== 'popover') return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(`.${styles.panel}`)) return
      onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [visible, variant, onClose])

  if (!visible) return null
  if (variant === 'popover' && !position) return null

  const panelStyle: React.CSSProperties | undefined =
    variant === 'popover' && position
      ? {
          left: position.x,
          top: position.y - 160,
        }
      : undefined

  return (
    <div
      className={[styles.panel, variant === 'drawer' ? styles.panelDrawer : ''].filter(Boolean).join(' ')}
      style={panelStyle}
    >
      {/* 头部 */}
      <div className={`${styles.header} ${variant === 'drawer' ? styles.headerDrawer : ''}`}>
        {variant === 'drawer' ? (
          <>
            {/* 左侧：返回icon + 标题 */}
            <div className={styles.headerLeft}>
              <button className={styles.backBtn} onClick={onClose} aria-label="返回画布">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 3 5 8l5 5" />
                </svg>
              </button>
              <span className={styles.title}>历史记录</span>
            </div>
          </>
        ) : (
          <span className={styles.title}>历史记录</span>
        )}
        <button className={styles.closeBtn} onClick={onClose} aria-label="关闭历史记录">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Tab 切换 */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'image' ? styles.tabActive : ''}`} onClick={() => setTab('image')}>
          图片
        </button>
        <button className={`${styles.tab} ${tab === 'video' ? styles.tabActive : ''}`} onClick={() => setTab('video')}>
          视频
        </button>
      </div>

      {/* 缩略图网格 */}
      <div className={styles.grid}>
        {items.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12,6 12,12 16,14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className={styles.emptyText}>暂无历史记录</span>
          </div>
        ) : (
          <div className={styles.gridInner}>
            {items.map((item) => (
              <div key={item.id} className={styles.item} onClick={() => onSelect?.(item)}>
                {item.src ? (
                  <>
                    {item.type === 'video' ? (
                      <video src={item.src} poster={item.poster} muted preload="metadata" aria-label={item.title} />
                    ) : (
                      <img src={item.src} alt={item.title} loading="lazy" />
                    )}
                    <div className={styles.itemOverlay}>
                      <span>{item.title}</span>
                    </div>
                  </>
                ) : (
                  <>
                    {/* 占位背景 */}
                    <div style={{ width: '100%', height: '100%', background: '#e8e8ea' }} />
                    <div className={styles.itemOverlay}>
                      <span>{item.title}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export type { HistoryItem }
