/**
 * 参考视频上传区。
 *
 * 选片后先在本地读出时长元数据，再按当前模型的额度（条数 + 总时长）判断能否加入，
 * 超额的直接拒绝并提示原因，避免带着必然失败的输入去创建计费任务。
 * 落库上传延后到提交生成时进行（与参考图一致）。
 */
import { useEffect, useRef, useState } from 'react'
import { formatVideoDurationLabel, readVideoDurationSecExact } from '@/utils/videoDuration'
import { type StudioRefVideo, type StudioRefVideoLimits, getRefVideoRejectReason } from '@/utils/studioRefVideo'
import styles from './StudioRefVideos.module.less'

/** 参考视频区的受控数据与回调。 */
export interface StudioRefVideosProps {
  videos: StudioRefVideo[]
  onChange: (videos: StudioRefVideo[]) => void
  limits: StudioRefVideoLimits
  /** 超额等无法加入的情况通过它反馈给用户。 */
  onReject?: (reason: string) => void
  disabled?: boolean
}

let refVideoSequence = 0

/** 渲染参考视频缩略图网格与添加入口。 */
export default function StudioRefVideos({ videos, onChange, limits, onReject, disabled }: StudioRefVideosProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)

  // 卸载时回收本组件创建的 objectURL。
  const videosRef = useRef(videos)
  videosRef.current = videos
  useEffect(
    () => () => {
      videosRef.current.forEach((video) => {
        if (video.isObjectUrl) URL.revokeObjectURL(video.url)
      })
    },
    [],
  )

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setReading(true)
    try {
      // 逐个校验：前面的文件占用额度后，后面的判断要基于已接受的结果。
      let accepted = videos
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('video/')) continue
        const url = URL.createObjectURL(file)
        const durationSec = await readVideoDurationSecExact(url)
        const reason = getRefVideoRejectReason(accepted, durationSec, limits)
        if (reason) {
          URL.revokeObjectURL(url)
          onReject?.(reason)
          break
        }
        refVideoSequence += 1
        accepted = [
          ...accepted,
          {
            id: `refv-${Date.now().toString(36)}-${refVideoSequence.toString(36)}`,
            url,
            isObjectUrl: true,
            durationSec,
            file,
          },
        ]
      }
      if (accepted !== videos) onChange(accepted)
    } finally {
      setReading(false)
    }
  }

  const removeAt = (id: string) => {
    const target = videos.find((video) => video.id === id)
    if (target?.isObjectUrl) URL.revokeObjectURL(target.url)
    onChange(videos.filter((video) => video.id !== id))
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          参考视频
          <span className={styles.optional}>（可选）</span>
        </span>
        <span className={styles.quota}>
          {videos.length}/{limits.maxCount}
        </span>
      </div>

      <div className={styles.grid}>
        {videos.map((video) => (
          <div key={video.id} className={styles.item}>
            <video className={styles.thumb} src={video.url} preload="metadata" muted playsInline />
            <span className={styles.duration}>{formatVideoDurationLabel(video.durationSec)}</span>
            <button
              type="button"
              className={styles.itemRemove}
              aria-label="移除该参考视频"
              disabled={disabled}
              onClick={() => removeAt(video.id)}
            >
              ✕
            </button>
          </div>
        ))}

        {videos.length < limits.maxCount && (
          <button
            type="button"
            className={styles.add}
            disabled={disabled || reading}
            onClick={() => inputRef.current?.click()}
            aria-label="添加参考视频"
          >
            <span className={styles.addIcon} aria-hidden="true">
              ＋
            </span>
            {reading ? '读取中' : '添加'}
          </button>
        )}
      </div>

      <p className={styles.hint}>
        最多 {limits.maxCount} 个
        {limits.maxDurationSec === null ? '' : `，单条不超过 ${limits.maxDurationSec}s（随所选模型变化）`}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        multiple
        hidden
        onChange={(event) => {
          void pickFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}
