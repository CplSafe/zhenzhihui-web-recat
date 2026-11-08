import { useEffect, useState } from 'react'
import { getManualVideoDownloadUrl, getManualVideoTask, type ManualVideoTask } from '@/api/manualVideo'
import { getPromoMaterialDownload, type PromoOrder } from '@/api/promo'
import { sanitizeMediaUrl } from '@/utils/urlSafety'

/** 交付素材地址仅保存在内存；无法播放时回退到文字封面。 */
export default function DeliveryProjectCover({
  kind,
  task,
  workspaceId,
}: {
  kind: 'manual' | 'promo'
  task: ManualVideoTask | PromoOrder
  workspaceId: number
}) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setUrl('')
    setFailed(false)
    setReady(false)
    const load = async () => {
      if (kind === 'promo') {
        const id = (task as PromoOrder).delivered_material_id
        if (!id) return ''
        return (await getPromoMaterialDownload(id, controller.signal)).download_url
      }
      if (task.status !== 'succeeded') return ''
      let current = task as ManualVideoTask
      if (!current.outputs?.some((output) => output.type === 'video'))
        current = await getManualVideoTask(workspaceId, task.id, controller.signal)
      const video = current.outputs?.find((output) => output.type === 'video')
      if (video?.asset_id)
        return (await getManualVideoDownloadUrl(workspaceId, video.asset_id, controller.signal)).download_url
      return video?.url || ''
    }
    void load()
      .then((value) => {
        if (!controller.signal.aborted) setUrl(sanitizeMediaUrl(value || ''))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [kind, task, workspaceId])
  return (
    <div className="pm2-pcard-cover">
      {(!url || failed || !ready) && (
        <span className="pm2-pcard-cover-ph">{kind === 'manual' ? '精制成片 · T+1' : '定制宣传片 · T+5'}</span>
      )}
      {url && !failed && (
        <video
          className="pm2-pcard-cover-media"
          src={url}
          muted
          playsInline
          preload="metadata"
          style={ready ? undefined : { position: 'absolute', inset: 0, opacity: 0 }}
          onLoadedData={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
