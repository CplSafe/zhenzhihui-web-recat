import { useEffect, useState, type ReactNode } from 'react'
import { LoadingOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { getManualVideoDownloadUrl, getManualVideoTask } from '@/api/manualVideo'
import { sanitizeMediaUrl } from '@/utils/urlSafety'
import styles from './TaskCenterDrawer.module.less'

export default function DeliveryTaskCard({
  title,
  status,
  meta,
  onOpen,
  workspaceId = 0,
  video,
  manualTaskId = 0,
  countdown,
}: {
  title: string
  status: string
  meta: string
  onOpen: () => void
  workspaceId?: number
  video?: { asset_id?: number; url?: string }
  manualTaskId?: number
  countdown?: ReactNode
}) {
  const [detailVideo, setDetailVideo] = useState<{ asset_id?: number; url?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setDetailVideo(null)
    if (!workspaceId || !manualTaskId || status !== '已交付' || video?.asset_id || video?.url)
      return () => controller.abort()
    void getManualVideoTask(workspaceId, manualTaskId, controller.signal)
      .then((task) => {
        if (!controller.signal.aborted) setDetailVideo(task.outputs?.find((output) => output.type === 'video') || null)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [workspaceId, manualTaskId, status, video?.asset_id, video?.url])
  const directUrl = sanitizeMediaUrl(video?.url || detailVideo?.url || '')
  const assetId = Number(video?.asset_id || detailVideo?.asset_id || 0)
  const [assetUrl, setAssetUrl] = useState('')
  const [failedUrl, setFailedUrl] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setAssetUrl('')
    if (!workspaceId || !assetId || (directUrl && failedUrl !== directUrl)) return () => controller.abort()
    void getManualVideoDownloadUrl(workspaceId, assetId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAssetUrl(sanitizeMediaUrl(result.download_url || ''))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [workspaceId, assetId, directUrl, failedUrl])
  const url = directUrl && failedUrl !== directUrl ? directUrl : assetUrl !== failedUrl ? assetUrl : ''
  const active = ['待制作', '制作中', '返工中'].includes(status)
  const failed = /失败|取消|逾期/.test(status)
  return (
    <article className={`${styles.taskCard} ${failed ? styles.failed : active ? styles.queued : styles.completed}`}>
      <button type="button" className={styles.taskMain} onClick={onOpen}>
        <span className={styles.thumbnail} aria-hidden="true">
          <span className={styles.thumbnailPlaceholder}>
            {active ? (
              <LoadingOutlined className={styles.thumbnailSpinner} spin />
            ) : (
              <PlayCircleOutlined className={styles.thumbnailPlay} />
            )}
          </span>
          {url && (
            <video
              className={styles.thumbnailImage}
              src={url}
              muted
              playsInline
              preload="metadata"
              onError={() => setFailedUrl(url)}
            />
          )}
        </span>
        <span className={styles.taskContent}>
          <span className={styles.statusLine}>
            <span className={styles.statusText}>{status}</span>
          </span>
          <span className={styles.taskTitle} title={title}>
            {title}
          </span>
          <span className={styles.taskMeta}>{meta}</span>
          {countdown}
        </span>
      </button>
    </article>
  )
}
