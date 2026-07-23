/**
 * ShotTrashBin — 镜头编排页的可拖动回收站与已删除镜头列表。
 * 浮球位置按用户和工作空间记忆；恢复操作交由父页面持久化，避免组件自行篡改草稿状态。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import { useConfirmDialog } from '@/composables/useToast'
import trashFabIcon from '@/img/image copy 8.png'
import styles from './ShotTrashBin.module.less'

/** 回收站展示与恢复一个已删除镜头所需的数据快照。 */
export interface ShotTrashItem {
  id: string | number
  title: string
  duration: string
  thumb: string
  detail: string
  deletedAt: string
  originalIndex?: number
  shot?: Shot | null
  canRestore?: boolean
}

/** 回收站的受控数据、加载和恢复回调。 */
interface ShotTrashBinProps {
  items?: ShotTrashItem[]
  loading?: boolean
  onLoad?: () => Promise<void> | void
  onRestore?: (item: ShotTrashItem) => Promise<void> | void
  onDelete?: (item: ShotTrashItem) => Promise<void> | void
  onRestoreAll?: (items: ShotTrashItem[]) => Promise<void> | void
  onClearAll?: (items: ShotTrashItem[]) => Promise<void> | void
  buttonClassName?: string
  dataGuide?: string
  dragStorageKey?: string
  dragBoundarySelector?: string
  dragTopObstacleSelector?: string
}

/** 浮球坐标本地存储键前缀。 */
const DRAG_STORAGE_PREFIX = 'shot_trash_fab_pos'

/** 回收站浮球的默认像素尺寸。 */
const FAB_SIZE = 58

/** 浮球与视口边缘的基础安全距离。 */
const VIEWPORT_MARGIN = 20

/** 无业务边界时为页面上下操作区预留的距离。 */
const FAB_VERTICAL_SAFE_GAP = 88

/** 无业务边界时为页面左右操作区预留的距离。 */
const FAB_HORIZONTAL_SAFE_GAP = 72

/** 浮球与顶部障碍元素之间的最小间距。 */
const TOP_OBSTACLE_GAP = 3

/** 使用业务边界时允许浮球贴边的额外偏移。 */
const BOUNDARY_EDGE_GAP = 0

/** 过滤空值后拼接 CSS 类名。 */
const joinClassNames = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/** 删除动作图标。 */
function TrashOutlineIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M5 7h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7 7h10l-.7 11a2 2 0 0 1-2 1.9H9.7A2 2 0 0 1 7.7 18L7 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 恢复镜头动作图标。 */
function RestoreIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M7 7H3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4 10a8 8 0 1 0 2.3-5.7L3 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 删除时间提示图标。 */
function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 渲染可拖动回收站浮球、抽屉列表和单项恢复交互。 */
export default function ShotTrashBin({
  items = [],
  loading = false,
  onLoad,
  onRestore,
  onDelete,
  onRestoreAll,
  onClearAll,
  buttonClassName,
  dataGuide,
  dragStorageKey = 'default',
  dragBoundarySelector = '',
  dragTopObstacleSelector = '',
}: ShotTrashBinProps) {
  const { requestConfirm } = useConfirmDialog()
  const [open, setOpen] = useState(false)
  const [fabPos, setFabPos] = useState({ x: VIEWPORT_MARGIN + 12, y: 0 })
  const [initializedDragContext, setInitializedDragContext] = useState('')
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const onLoadRef = useRef(onLoad)
  const dragStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const dragStorageEntryKey = `${DRAG_STORAGE_PREFIX}:${dragStorageKey}`
  const dragPositionContext = `${dragStorageEntryKey}\n${dragBoundarySelector}\n${dragTopObstacleSelector}`

  // 约束浮球在业务内容边界内，并避开顶栏等障碍物，防止拖动后遮挡核心按钮或移出屏幕。
  const getDragBounds = useCallback(() => {
    if (typeof window === 'undefined') {
      return { minX: VIEWPORT_MARGIN, minY: VIEWPORT_MARGIN, maxX: VIEWPORT_MARGIN, maxY: VIEWPORT_MARGIN }
    }
    const boundary = dragBoundarySelector ? document.querySelector(dragBoundarySelector) : null
    const rect = boundary?.getBoundingClientRect?.()
    const topObstacle = dragTopObstacleSelector ? document.querySelector(dragTopObstacleSelector) : null
    const topObstacleRect = topObstacle?.getBoundingClientRect?.()
    const buttonRect = buttonRef.current?.getBoundingClientRect?.()
    const width = buttonRect?.width || FAB_SIZE
    const height = buttonRect?.height || FAB_SIZE
    if (!rect) {
      return {
        minX: VIEWPORT_MARGIN + FAB_HORIZONTAL_SAFE_GAP,
        minY: VIEWPORT_MARGIN + FAB_VERTICAL_SAFE_GAP,
        maxX: Math.max(VIEWPORT_MARGIN + FAB_HORIZONTAL_SAFE_GAP, window.innerWidth - width - VIEWPORT_MARGIN),
        maxY: Math.max(
          VIEWPORT_MARGIN + FAB_VERTICAL_SAFE_GAP,
          window.innerHeight - height - VIEWPORT_MARGIN - FAB_VERTICAL_SAFE_GAP,
        ),
      }
    }
    return {
      minX: rect.left + BOUNDARY_EDGE_GAP,
      minY: Math.max(rect.top + VIEWPORT_MARGIN, (topObstacleRect?.bottom ?? rect.top) + TOP_OBSTACLE_GAP),
      maxX: Math.max(rect.left + BOUNDARY_EDGE_GAP, rect.right - width - BOUNDARY_EDGE_GAP),
      maxY: Math.max(
        Math.max(rect.top + VIEWPORT_MARGIN, (topObstacleRect?.bottom ?? rect.top) + TOP_OBSTACLE_GAP),
        rect.bottom - height - BOUNDARY_EDGE_GAP,
      ),
    }
  }, [dragBoundarySelector, dragTopObstacleSelector])

  const clampFabPosition = useCallback(
    (x: number, y: number) => {
      const bounds = getDragBounds()
      return {
        x: Math.min(Math.max(bounds.minX, x), bounds.maxX),
        y: Math.min(Math.max(bounds.minY, y), bounds.maxY),
      }
    },
    [getDragBounds],
  )

  useEffect(() => {
    onLoadRef.current = onLoad
  }, [onLoad])

  useEffect(() => {
    if (!open) return
    void onLoadRef.current?.()
  }, [open])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let nextPosition: { x: number; y: number } | undefined
    try {
      const raw = window.localStorage.getItem(dragStorageEntryKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        nextPosition = clampFabPosition(Number(parsed?.x) || 0, Number(parsed?.y) || 0)
      }
    } catch {}
    if (!nextPosition) {
      const bounds = getDragBounds()
      nextPosition = clampFabPosition(bounds.minX + 8, bounds.minY + Math.max(0, (bounds.maxY - bounds.minY) * 0.32))
    }
    setFabPos(nextPosition)
    setInitializedDragContext(dragPositionContext)
  }, [clampFabPosition, dragPositionContext, dragStorageEntryKey, getDragBounds])

  useEffect(() => {
    if (typeof window === 'undefined' || initializedDragContext !== dragPositionContext) return
    try {
      window.localStorage.setItem(dragStorageEntryKey, JSON.stringify(fabPos))
    } catch {}
  }, [dragPositionContext, dragStorageEntryKey, fabPos, initializedDragContext])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setFabPos((prev) => clampFabPosition(prev.x, prev.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampFabPosition])

  const handleFabPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: fabPos.x,
      originY: fabPos.y,
      moved: false,
    }
    ;(e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId)
  }

  const handleFabPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== e.pointerId || typeof window === 'undefined') return
    const nextX = drag.originX + (e.clientX - drag.startX)
    const nextY = drag.originY + (e.clientY - drag.startY)
    const clamped = clampFabPosition(nextX, nextY)
    if (Math.abs(e.clientX - drag.startX) > 4 || Math.abs(e.clientY - drag.startY) > 4) {
      drag.moved = true
      suppressClickRef.current = true
    }
    setFabPos(clamped)
  }

  const handleFabPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current
    if (drag && drag.pointerId === e.pointerId) {
      ;(e.currentTarget as HTMLButtonElement).releasePointerCapture?.(e.pointerId)
    }
    dragStateRef.current = null
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  const handleFabClick = () => {
    if (suppressClickRef.current) return
    setOpen(true)
  }

  const handleRestoreAll = async () => {
    if (!items.length) return
    const ok = await requestConfirm(`确认恢复垃圾桶中的 ${items.length} 个分镜吗？`)
    if (!ok) return
    await onRestoreAll?.(items)
  }

  const handleClearAll = async () => {
    if (!items.length) return
    const ok = await requestConfirm(`确认永久删除垃圾桶中的 ${items.length} 个分镜吗？删除后不可恢复。`, {
      danger: true,
    })
    if (!ok) return
    await onClearAll?.(items)
  }

  const handleDelete = async (item: ShotTrashItem) => {
    const ok = await requestConfirm(`确认永久删除「${item.title || '该分镜'}」吗？删除后不可恢复。`, {
      danger: true,
    })
    if (!ok) return
    await onDelete?.(item)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-guide={dataGuide}
        className={joinClassNames(styles.trashFab, buttonClassName)}
        style={{ left: `${fabPos.x}px`, top: `${fabPos.y}px` }}
        onClick={handleFabClick}
        onPointerDown={handleFabPointerDown}
        onPointerMove={handleFabPointerMove}
        onPointerUp={handleFabPointerUp}
        onPointerCancel={handleFabPointerUp}
        aria-label="打开分镜回收站"
        title={items.length ? `分镜回收站（${items.length}）` : '分镜回收站'}
      >
        <img className={styles.trashFabIcon} src={trashFabIcon} alt="" draggable={false} />
        {items.length > 0 && <span className={styles.trashFabCount}>{items.length}</span>}
      </button>

      {open && (
        <div className={styles.trashMask} onClick={() => setOpen(false)}>
          <div
            className={styles.trashDialog}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="分镜回收站"
          >
            <div className={styles.trashHead}>
              <div className={styles.trashHeading}>
                <div className={styles.trashTitle}>
                  <TrashOutlineIcon className={styles.trashTitleIcon} />
                  <span>分镜回收站</span>
                </div>
                <div className={styles.trashSub}>已删除的分镜将在回收站中保留两个月，您可以随时恢复。</div>
              </div>
              <button type="button" className={styles.trashClose} onClick={() => setOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className={styles.trashToolbar}>
              <button
                type="button"
                className={styles.trashLink}
                disabled={!items.length || loading}
                onClick={() => void handleRestoreAll()}
              >
                <RestoreIcon className={styles.trashLinkIcon} />
                恢复全部
              </button>
              <button
                type="button"
                className={joinClassNames(styles.trashLink, styles.trashLinkDanger)}
                disabled={!items.length || loading}
                onClick={() => void handleClearAll()}
              >
                <TrashOutlineIcon className={styles.trashLinkIcon} />
                清空已回收站
              </button>
            </div>
            <div className={styles.trashBody}>
              {loading ? (
                <div className={styles.trashEmpty}>加载中…</div>
              ) : !items.length ? (
                <div className={styles.trashEmpty}>暂无已删除分镜</div>
              ) : (
                items.map((item) => {
                  const hasThumb = Boolean(String(item.thumb || '').trim())
                  return (
                    <div className={styles.trashCard} key={item.id}>
                      {hasThumb && (
                        <div className={styles.trashThumb}>
                          <img src={item.thumb} alt="" />
                        </div>
                      )}
                      <div className={styles.trashInfo}>
                        <div className={styles.trashMeta}>
                          <span className={styles.trashItemTitle}>{item.title || '未命名分镜'}</span>
                          <span className={styles.trashDur}>
                            <ClockIcon className={styles.trashDurIcon} />
                            <span>{item.duration || '5s'}</span>
                          </span>
                        </div>
                        <div className={styles.trashTime}>{item.deletedAt || '删除时间未知'}</div>
                        <div className={styles.trashDesc}>{item.detail || '暂无分镜描述'}</div>
                      </div>
                      <div className={styles.trashActions}>
                        <button
                          type="button"
                          className={styles.trashBtn}
                          disabled={loading || item.canRestore === false}
                          onClick={() => void onRestore?.(item)}
                        >
                          <RestoreIcon className={styles.trashBtnIcon} />
                          恢复
                        </button>
                        <button
                          type="button"
                          className={joinClassNames(styles.trashBtn, styles.trashBtnGhost)}
                          disabled={loading}
                          onClick={() => void handleDelete(item)}
                        >
                          <TrashOutlineIcon className={styles.trashBtnIcon} />
                          永久删除
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
