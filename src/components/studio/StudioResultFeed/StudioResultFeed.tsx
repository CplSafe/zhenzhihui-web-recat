/**
 * 右侧创作结果流：按「一次生成 = 一个批次」倒序展示图片/视频产物。
 *
 * 纯展示组件：批次数据、重试与预览动作全部由父级提供。
 * 单条产物有 pending / done / failed 三种状态，分别渲染进度、成品与失败原因。
 */
import AiBadge from '@/components/common/AiBadge'
import type { CSSProperties } from 'react'
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
  /** 画面比例（如 "16:9"），用于生成中按目标形状占位，避免出片后卡片跳动。 */
  ratio?: string
}

/** 结果流的展示数据与交互回调。 */
export interface StudioResultFeedProps {
  batches: StudioResultBatch[]
  filter: 'all' | 'image' | 'video'
  onFilterChange: (filter: 'all' | 'image' | 'video') => void
  onPreview?: (item: StudioResultItem) => void
  onRetry?: (batch: StudioResultBatch) => void
}

const FILTERS: { key: 'all' | 'image' | 'video'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
]

/** 把进度收敛到 0~100。 */
function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * 把 "16:9" 这类比例转成 CSS aspect-ratio。
 * 生成中就按目标形状占位，出片后卡片不会突然改变高度。
 */
function itemRatioStyle(ratio?: string): CSSProperties | undefined {
  const [w, h] = String(ratio || '')
    .split(':')
    .map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined
  return { '--studio-item-ratio': `${w} / ${h}` } as CSSProperties
}

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
}: StudioResultFeedProps) {
  const visible = batches.filter((batch) => filter === 'all' || batch.mode === filter)

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

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>还没有创作记录</span>
          <span className={styles.emptyHint}>在左侧输入描述，开始你的第一次生成</span>
        </div>
      ) : (
        <div className={styles.list}>
          {visible.map((batch) => (
            <article key={batch.id} className={styles.batch}>
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

              <div className={styles.items}>
                {batch.items.map((item) => (
                  <div key={item.id} className={styles.item} style={itemRatioStyle(batch.ratio)}>
                    {item.status === 'pending' && (
                      <>
                        <span className={styles.skeleton} aria-hidden="true" />
                        <div className={styles.pending} role="status" aria-live="polite">
                          <span className={styles.pendingIcon} aria-hidden="true">
                            {batch.mode === 'video' ? '🎬' : '🖼'}
                          </span>
                          <span>{batch.mode === 'video' ? '视频生成中…' : '图片生成中…'}</span>
                          {typeof item.progress === 'number' && (
                            <>
                              <span className={styles.percent}>{Math.round(clampPercent(item.progress))}%</span>
                              <span className={styles.progressTrack}>
                                <span
                                  className={styles.progressFill}
                                  style={{ width: `${clampPercent(item.progress)}%` }}
                                />
                              </span>
                            </>
                          )}
                        </div>
                      </>
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
