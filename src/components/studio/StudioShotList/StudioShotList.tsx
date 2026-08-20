/**
 * 智能分镜列表（自定义分镜编辑器）。
 *
 * 页面效果：逐镜编辑「画面描述 + 镜头时长」，支持拖拽排序、增删镜头，
 * 并实时显示总时长；智能分镜自动生成的台词/字幕/音效以标签形式回显。
 * 受控组件：分镜数据与变更全部由父级持有，本组件不持有业务状态。
 */
import { useState } from 'react'
import {
  MAX_SHOT_COUNT,
  MAX_SHOT_SEC,
  MIN_SHOT_SEC,
  type StudioShot,
  appendStudioShot,
  moveStudioShot,
  removeStudioShot,
  totalStudioShotSec,
  updateStudioShot,
} from '@/utils/studioShots'
import styles from './StudioShotList.module.less'

/** 分镜列表的受控数据与交互回调。 */
export interface StudioShotListProps {
  shots: StudioShot[]
  onChange: (shots: StudioShot[]) => void
  /** 「取消自定义分镜」返回普通提示词模式。 */
  onExit?: () => void
  /** 目标总时长（秒）；超出时高亮提示，但不阻止编辑。 */
  targetSec?: number
  disabled?: boolean
}

/** 渲染可拖拽排序的分镜编辑列表。 */
export default function StudioShotList({ shots, onChange, onExit, targetSec, disabled }: StudioShotListProps) {
  // 拖拽仅在列表内重排，用原生 HTML5 DnD 即可，无需引入 dnd-kit。
  const [dragIndex, setDragIndex] = useState(-1)
  const [overIndex, setOverIndex] = useState(-1)

  const total = totalStudioShotSec(shots)
  const isOver = Boolean(targetSec) && total > (targetSec as number)

  const handleDrop = (to: number) => {
    if (dragIndex >= 0 && dragIndex !== to) onChange(moveStudioShot(shots, dragIndex, to))
    setDragIndex(-1)
    setOverIndex(-1)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        {onExit ? (
          <button type="button" className={styles.back} onClick={onExit} disabled={disabled}>
            <span aria-hidden="true">↩</span>
            取消自定义分镜
          </button>
        ) : (
          <span />
        )}
        <span className={`${styles.total}${isOver ? ` ${styles.isOver}` : ''}`}>
          共 {shots.length} 镜 · {total}s{targetSec ? ` / ${targetSec}s` : ''}
        </span>
      </div>

      <div className={styles.list}>
        {shots.map((shot, index) => (
          <div
            key={shot.id}
            className={[
              styles.shot,
              dragIndex === index ? styles.isDragging : '',
              overIndex === index && dragIndex !== index ? styles.isDropTarget : '',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable={!disabled}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => {
              event.preventDefault()
              setOverIndex(index)
            }}
            onDrop={() => handleDrop(index)}
            onDragEnd={() => {
              setDragIndex(-1)
              setOverIndex(-1)
            }}
          >
            <div className={styles.shotBar}>
              <span className={styles.handle} aria-hidden="true" title="拖动调整镜头顺序">
                ☰
              </span>
              <span className={styles.no}>镜头{index + 1}</span>

              <span className={styles.duration}>
                <span className={styles.durationValue}>{shot.dur} s</span>
                <span className={styles.stepper}>
                  <button
                    type="button"
                    className={styles.stepperBtn}
                    aria-label={`镜头${index + 1}增加时长`}
                    disabled={disabled || shot.dur >= MAX_SHOT_SEC}
                    onClick={() => onChange(updateStudioShot(shots, shot.id, { dur: shot.dur + 1 }))}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={styles.stepperBtn}
                    aria-label={`镜头${index + 1}减少时长`}
                    disabled={disabled || shot.dur <= MIN_SHOT_SEC}
                    onClick={() => onChange(updateStudioShot(shots, shot.id, { dur: shot.dur - 1 }))}
                  >
                    ▼
                  </button>
                </span>
              </span>

              <button
                type="button"
                className={styles.remove}
                aria-label={`删除镜头${index + 1}`}
                disabled={disabled || shots.length <= 1}
                onClick={() => onChange(removeStudioShot(shots, shot.id))}
              >
                ✕
              </button>
            </div>

            <textarea
              className={styles.desc}
              value={shot.desc}
              placeholder="请描述镜头信息，如：谁在哪、发生了什么"
              disabled={disabled}
              onChange={(event) => onChange(updateStudioShot(shots, shot.id, { desc: event.target.value }))}
            />

            {/* 智能分镜生成的脚本词只读回显，让用户知道这一镜还会带旁白/字幕/音效 */}
            {(shot.line || shot.subtitle || shot.sfx) && (
              <div className={styles.meta}>
                {shot.line && <span className={styles.metaTag}>旁白：{shot.line}</span>}
                {shot.subtitle && <span className={styles.metaTag}>字幕：{shot.subtitle}</span>}
                {shot.sfx && <span className={styles.metaTag}>音效：{shot.sfx}</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        className={styles.add}
        disabled={disabled || shots.length >= MAX_SHOT_COUNT}
        onClick={() => onChange(appendStudioShot(shots))}
        title={shots.length >= MAX_SHOT_COUNT ? `最多 ${MAX_SHOT_COUNT} 个镜头` : undefined}
      >
        <span aria-hidden="true">＋</span> 镜头
      </button>
    </div>
  )
}
