/**
 * 右侧创作结果流：按「一次生成 = 一个批次」展示图片/视频产物。
 *
 * 排列方式是聊天式的——旧在上、新在下，新生成的追加到底部并自动滚到可见处；
 * 往上滚到顶会触发加载更早的历史（onLoadMore）。
 *
 * 纯展示组件：批次数据、翻页、重试与预览动作全部由父级提供。
 * 单条产物有 pending / done / failed 三种状态，分别渲染进度、成品与失败原因。
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import AiBadge from '@/components/common/AiBadge'
import { toCssAspectRatio } from '@/utils/aspectRatio'
import type { StudioMode } from '@/utils/studioParams'
import styles from './StudioResultFeed.module.less'

/** 一次生成中的单条产物。 */
export interface StudioResultItem {
  id: string
  status: 'pending' | 'done' | 'failed'
  url?: string
  /** 后端返回的真实进度（0-100）；缺省时只显示转圈。 */
  progress?: number
  error?: string
  /**
   * 该产物对应的后端任务 ID。
   *
   * 记在产物而非批次上：一次生成 N 个视频会并发创建 N 个独立任务，
   * 若只在批次上留一个 ID，后创建的会覆盖先前的，刷新后其余产物再也无法续轮询。
   */
  taskId?: number
}

/** 一次生成动作产生的批次。 */
export interface StudioResultBatch {
  id: string
  mode: StudioMode
  prompt: string
  /** 展示用的参数摘要，如「1080p · 5s · 16:9 · 2」。 */
  summary: string
  createdAt: number
  items: StudioResultItem[]
  /** 该批次使用的分镜数，仅视频模式有意义。 */
  shotCount?: number
  /** 画面比例，如 16:9；用于让占位格子从「生成中」阶段就保持正确形状。 */
  ratio?: string
}

/** 结果流的展示数据与交互回调。 */
export interface StudioResultFeedProps {
  batches: StudioResultBatch[]
  filter: 'all' | 'image' | 'video'
  onFilterChange: (filter: 'all' | 'image' | 'video') => void
  onPreview?: (item: StudioResultItem) => void
  onRetry?: (batch: StudioResultBatch) => void
  /** 首屏历史加载中。 */
  loading?: boolean
  /** 更早的历史加载中。 */
  loadingMore?: boolean
  /** 是否还有更早的历史。 */
  hasMore?: boolean
  /** 滚动到顶部附近时触发，加载更早的历史。 */
  onLoadMore?: () => void
}

const FILTERS: { key: 'all' | 'image' | 'video'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
]

/** 时间戳 → HH:mm。 */
function formatTime(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 渲染创作结果流。 */
export default function StudioResultFeed({
  batches,
  filter,
  onFilterChange,
  onPreview,
  onRetry,
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
}: StudioResultFeedProps) {
  const visible = batches.filter((batch) => filter === 'all' || batch.mode === filter)

  const listRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  // 上次渲染时的滚动高度与首/末批次，用来判断该「保持锚点」还是「滚到底部」。
  const prevScrollHeightRef = useRef(0)
  const firstBatchIdRef = useRef<string>('')
  const lastBatchIdRef = useRef<string>('')

  // 只在「批次集合的两端发生变化」时才动滚动位置。
  // 依赖必须是首尾批次 id 而不是 visible 数组本身：数组每次渲染都是新引用，
  // 若以它为依赖，生成过程中视频元素加载撑高也会被误判成「顶部插入了内容」而错误纠正滚动。
  const firstBatchId = visible.length ? visible[0].id : ''
  const lastBatchId = visible.length ? visible[visible.length - 1].id : ''

  // 往上翻页会把内容插到前面，浏览器默认保持 scrollTop 不变，视口就会跳到更早的内容。
  // 这里按新增的高度把 scrollTop 补回去，让用户视线停在原来那条上。
  // 用 useLayoutEffect：必须在浏览器绘制前修正，否则会看到一帧跳动。
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const appendedAtBottom = lastBatchId !== lastBatchIdRef.current
    const prependedAtTop = firstBatchId !== firstBatchIdRef.current && !appendedAtBottom

    if (appendedAtBottom) {
      // 首屏进来、以及每次新生成追加到尾部时，都停在最新的内容上。
      list.scrollTop = list.scrollHeight
    } else if (prependedAtTop && prevScrollHeightRef.current > 0) {
      list.scrollTop += list.scrollHeight - prevScrollHeightRef.current
    }

    prevScrollHeightRef.current = list.scrollHeight
    firstBatchIdRef.current = firstBatchId
    lastBatchIdRef.current = lastBatchId
  }, [firstBatchId, lastBatchId])

  // 顶部哨兵进入视口（含 300px 预加载）就拉更早的一页，与站内其它无限滚动一致。
  useEffect(() => {
    if (!hasMore || !onLoadMore) return
    const sentinel = topSentinelRef.current
    if (!sentinel) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { root: listRef.current, rootMargin: '300px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore, loadingMore])

  return (
    <section className={styles.feed} aria-label="创作结果">
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="按类型筛选">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              className={`${styles.tab}${filter === item.key ? ` ${styles.isActive}` : ''}`}
              onClick={() => onFilterChange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && !loading ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>还没有创作记录</span>
          <span className={styles.emptyHint}>在左侧输入描述，开始你的第一次生成</span>
        </div>
      ) : (
        <div className={styles.list} ref={listRef}>
          {/* 顶部哨兵：滚到这里就加载更早的历史 */}
          <div ref={topSentinelRef} className={styles.sentinel} aria-hidden="true" />

          {(loading || loadingMore) && (
            <div className={styles.loadingMore} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              <span>{loading ? '加载创作记录…' : '加载更早的创作…'}</span>
            </div>
          )}
          {!loading && !loadingMore && !hasMore && visible.length > 0 && (
            <div className={styles.historyEnd}>没有更早的创作了</div>
          )}

          {visible.map((batch) => (
            <article key={batch.id} id={`studio-batch-${batch.id}`} className={styles.batch}>
              <header className={styles.batchHead}>
                <span className={styles.badge}>{batch.mode === 'video' ? '视频生成' : '图片生成'}</span>
                <span className={styles.batchMeta}>
                  {batch.summary}
                  {batch.shotCount ? ` · ${batch.shotCount} 镜` : ''} · {formatTime(batch.createdAt)}
                </span>
                {onRetry && (
                  <button type="button" className={styles.retry} onClick={() => onRetry(batch)}>
                    再次生成
                  </button>
                )}
              </header>

              {batch.prompt && <p className={styles.prompt}>{batch.prompt}</p>}

              {/* 比例由该批次的生成参数决定，从「生成中」阶段就占好位，出图后不再跳变 */}
              <div
                className={styles.items}
                style={{ '--frame-ratio': toCssAspectRatio(batch.ratio) } as React.CSSProperties}
              >
                {batch.items.map((item) => (
                  <div key={item.id} className={styles.item}>
                    {item.status === 'pending' && (
                      <div className={styles.state}>
                        <span className={styles.spinner} aria-hidden="true" />
                        <span>{batch.mode === 'video' ? '视频生成中…' : '图片生成中…'}</span>
                        {typeof item.progress === 'number' && (
                          <span className={styles.progressTrack}>
                            <span
                              className={styles.progressFill}
                              style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
                            />
                          </span>
                        )}
                      </div>
                    )}

                    {item.status === 'failed' && (
                      <div className={`${styles.state} ${styles.failed}`}>
                        <span aria-hidden="true">⚠</span>
                        <span>{item.error || '生成失败'}</span>
                      </div>
                    )}

                    {item.status === 'done' && item.url && (
                      <>
                        {batch.mode === 'video' ? (
                          <video
                            className={`${styles.media} ${styles.video}`}
                            src={item.url}
                            controls
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <img
                            className={styles.media}
                            src={item.url}
                            alt="生成结果"
                            loading="lazy"
                            onClick={() => onPreview?.(item)}
                          />
                        )}
                        {/* 全站统一的 AI 生成标记 */}
                        <AiBadge />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
