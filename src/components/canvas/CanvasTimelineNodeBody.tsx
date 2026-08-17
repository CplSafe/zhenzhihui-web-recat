/**
 * 剪辑时间线节点的卡片内容。
 *
 * 卡片里就是一个播放器：画面 + 刻度尺 + 片段轨道，片段的跳转与移除都在轨道上完成。
 * 添加入口是轨道末尾的「+」（空时间线则是居中的「+」）——参考剪辑器的做法，
 * 添加动作紧挨着被添加的东西，比放在节点上方的操作组里更直觉。
 * 精修与合成是针对整条时间线的动作，仍在上方胶囊组（CanvasTimelineNodeActions）。
 *
 * 节点内的可点区域必须带 nodrag nopan，否则点击会被 React Flow 当成拖画布。
 */
import { useEffect, useRef, useState } from 'react'
import CanvasTimelinePlayer from './CanvasTimelinePlayer'
import SeekableVideo from '@/components/common/SeekableVideo'
import { MAX_TIMELINE_CLIPS, type TimelineClip } from '@/utils/timelineClips'
import type { CanvasTimelineSource } from './CanvasTimelineNodeActions'
import styles from './CanvasTimelineNodeBody.module.css'

interface CanvasTimelineNodeBodyProps {
  nodeId: string
  clips: readonly TimelineClip[]
  workspaceId: number
  /** 已合成的成片地址；有值时预览直接放成片。 */
  composedUrl?: string
  /** 已连线但来源视频还没生成完的数量，这类连线暂时产生不了片段。 */
  pendingSourceCount?: number
  onRemoveClip: (timelineNodeId: string, clipId: string) => void
  /** 点开「+」那一刻才取列表，避免上层随节点变动重渲染。 */
  getAddableSources?: (timelineNodeId: string) => CanvasTimelineSource[]
  onAddSource?: (timelineNodeId: string, sourceNodeId: string) => void
}

export default function CanvasTimelineNodeBody({
  nodeId,
  clips,
  workspaceId,
  composedUrl = '',
  pendingSourceCount = 0,
  onRemoveClip,
  getAddableSources,
  onAddSource,
}: CanvasTimelineNodeBodyProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [sources, setSources] = useState<CanvasTimelineSource[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点到别处收起：菜单会盖住轨道，留着碍事
  useEffect(() => {
    if (!addOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return
      setAddOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [addOpen])

  const canAdd = Boolean(getAddableSources && onAddSource) && clips.length < MAX_TIMELINE_CLIPS

  return (
    <div className={styles.body} ref={wrapRef}>
      <div className={styles.dragHandle} aria-label="拖动视频剪辑节点" title="拖动节点">
        <span />
        <span />
        <span />
      </div>
      <div className={styles.preview}>
        {composedUrl ? (
          // 已合成：成片才是下游节点消费的那份素材，直接放它。
          // 走 SeekableVideo——/download 不支持 Range，原生播放器拖进度条会被抹回 0
          <SeekableVideo
            className={`${styles.composed} nodrag nopan`}
            src={composedUrl}
            playsInline
            preload="metadata"
            controls
          />
        ) : (
          <CanvasTimelinePlayer
            clips={clips}
            workspaceId={workspaceId}
            compact
            onRemoveClip={(clipId) => onRemoveClip(nodeId, clipId)}
            {...(canAdd
              ? {
                  onAddClip: () => {
                    setSources(getAddableSources!(nodeId))
                    setAddOpen((open) => !open)
                  },
                }
              : {})}
          />
        )}
      </div>

      {pendingSourceCount > 0 && (
        <div className={styles.pending}>{pendingSourceCount} 个连入的视频还在生成，完成后自动加入</div>
      )}

      {addOpen && (
        <div className={`${styles.addMenu} nodrag nopan`} role="menu" aria-label="画布上的视频">
          {sources.length ? (
            sources.map((source) => (
              <button
                key={source.nodeId}
                type="button"
                role="menuitem"
                className={styles.addMenuItem}
                onClick={() => {
                  onAddSource?.(nodeId, source.nodeId)
                  setAddOpen(false)
                }}
              >
                {source.thumbnailUrl ? (
                  // 只取元数据拿一帧封面，不为选片下载整条视频
                  <video className={styles.addMenuThumb} src={source.thumbnailUrl} preload="metadata" muted />
                ) : (
                  <span className={styles.addMenuThumb} />
                )}
                <span className={styles.addMenuLabel}>{source.label}</span>
              </button>
            ))
          ) : (
            <span className={styles.addMenuEmpty}>画布上没有可加入的视频，先生成一条</span>
          )}
        </div>
      )}
    </div>
  )
}
