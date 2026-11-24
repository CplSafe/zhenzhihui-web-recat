import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { fetchAllCanvasElements, type CanvasElementMutation } from '@/api/canvasApi'
import { ViewAsUserError, type readAsUser } from '@/api/viewAsUser'
import ReadOnlyCanvas, {
  READ_ONLY_CANVAS_DOCK_PADDING,
  type ReadOnlyCanvasMedia,
} from '@/components/canvas/ReadOnlyCanvas'
import styles from './ViewAsUserView.module.css'

const fitViewOptions = {
  padding: { top: '24px', bottom: READ_ONLY_CANVAS_DOCK_PADDING, left: '24px', right: '24px' },
  minZoom: 0.01,
  maxZoom: 1,
} as const
const MAX_IMAGE_RESULTS = 15

function positiveId(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function nodeDimension(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && /^\d+(?:\.\d+)?px$/.test(value) ? parseFloat(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** Only the scoped server projection supplies media IDs. Persisted URLs and custom CSS stay outside the viewer. */
function projectElement(element: CanvasElementMutation): CanvasElementMutation {
  if (element.kind !== 'node' || element.op === 'delete') return element
  const payload = element.payload || {}
  const data = (payload.data || {}) as Record<string, unknown>
  const style = (payload.style || {}) as Record<string, unknown>
  const media = element.preview_media
  const primaryId = positiveId(media?.asset_id)
  const projectedImageIds = [...new Set((media?.image_asset_ids || []).map(positiveId).filter(Boolean))]
  const imageIds = projectedImageIds.slice(0, MAX_IMAGE_RESULTS)
  if (projectedImageIds.includes(primaryId) && !imageIds.includes(primaryId))
    imageIds[MAX_IMAGE_RESULTS - 1] = primaryId
  const kind = data.kind || payload.type
  return {
    ...element,
    payload: {
      position: payload.position,
      style: {
        width: nodeDimension(style.width ?? payload.width),
        height: nodeDimension(style.height ?? payload.height),
      },
      data: {
        kind,
        title: data.title,
        text: data.text ?? (kind === 'text' ? data.body : undefined),
        prompt: data.prompt,
        ratio: data.ratio,
        hd: data.hd,
        groupId: data.groupId,
        groupName: data.groupName,
        assetId: primaryId || imageIds[0] || 0,
        posterAssetId: positiveId(media?.poster_asset_id),
        imageResultAssetIds: imageIds,
        imageResultsExpanded: data.imageResultsExpanded === true,
      },
    },
  }
}

async function loadCanvasSnapshot(
  workspaceId: number,
  canvasId: number,
  read: typeof readAsUser,
  signal: AbortSignal,
): Promise<CanvasElementMutation[]> {
  const source = { workspaceId, canvasId }
  const reader = { read, signal }
  for (let attempt = 0; ; attempt += 1) {
    const initial = await fetchAllCanvasElements(source, reader)
    if (initial.sync_revision <= 0) return initial.elements.map(projectElement)
    try {
      // Initial pages can straddle a concurrent edit. Reconcile from the first page's watermark.
      const delta = await fetchAllCanvasElements({ ...source, afterRevision: initial.sync_revision }, reader)
      if (delta.history_floor_revision > initial.sync_revision) {
        throw new ViewAsUserError('画布需要重新同步', 409, 'CANVAS_FULL_SYNC_REQUIRED')
      }
      const elements = new Map(initial.elements.map((element) => [element.element_id, element]))
      for (const element of delta.elements) {
        if (element.op === 'delete') elements.delete(element.element_id)
        else elements.set(element.element_id, element)
      }
      return [...elements.values()].map(projectElement)
    } catch (error) {
      if (attempt > 0 || !(error instanceof ViewAsUserError) || error.code !== 'CANVAS_FULL_SYNC_REQUIRED') throw error
    }
  }
}

type Preview = { status: 'loading' | 'unavailable' } | { status: 'ready'; url: string; expiresAt: number }

interface PreviewResponse {
  url: string
  mime_type: string
  expires_in: number
}

function needsNewPreview(preview: Extract<Preview, { status: 'ready' }>) {
  return preview.expiresAt - Date.now() <= 5_000
}

function signedPreview(response: PreviewResponse, startedAt: number): Preview {
  const url = new URL(response.url)
  if (
    url.protocol !== 'https:' ||
    url.origin === window.location.origin ||
    url.username ||
    url.password ||
    !/^(image|video|audio)\//.test(response.mime_type) ||
    !Number.isFinite(response.expires_in) ||
    response.expires_in <= 0
  ) {
    throw new Error('素材预览地址无效')
  }
  return { status: 'ready', url: url.href, expiresAt: startedAt + response.expires_in * 1000 }
}

function useCanvasPreviews(workspaceId: number, canvasId: number, read: typeof readAsUser): ReadOnlyCanvasMedia {
  const latest = useRef(new Map<number, Preview>())
  const requests = useRef(new Set<AbortController>())
  const [previews, setPreviews] = useState(new Map<number, Preview>())

  useEffect(() => {
    const active = requests.current
    return () => {
      for (const controller of active) controller.abort()
      active.clear()
    }
  }, [])

  const request = useCallback(
    (ids: number[], force = false) => {
      const update = (assetId: number, preview: Preview) => {
        latest.current.set(assetId, preview)
        setPreviews(new Map(latest.current))
      }
      for (const assetId of ids) {
        if (!positiveId(assetId)) continue
        const cached = latest.current.get(assetId)
        if (cached?.status === 'loading' || (!force && cached?.status === 'ready' && !needsNewPreview(cached))) continue
        const controller = new AbortController()
        requests.current.add(controller)
        update(assetId, { status: 'loading' })
        const startedAt = Date.now()
        const path = `/api/v1/canvases/${canvasId}/assets/${assetId}/preview?workspace_id=${workspaceId}`
        void read<PreviewResponse>(path, { signal: controller.signal })
          .then((response) => {
            if (!controller.signal.aborted) update(assetId, signedPreview(response, startedAt))
          })
          .catch(() => {
            if (!controller.signal.aborted) update(assetId, { status: 'unavailable' })
          })
          .finally(() => requests.current.delete(controller))
      }
    },
    [canvasId, read, workspaceId],
  )

  const assetUrl = (assetId: number) => {
    const preview = previews.get(assetId)
    return preview?.status === 'ready' ? preview.url : ''
  }
  return {
    nodeUrls: (data) => ({ url: assetUrl(Number(data.assetId)), posterUrl: assetUrl(Number(data.posterAssetId)) }),
    assetUrl,
    missingMessage: '素材暂时不可查看',
    signed: {
      request,
      status: (assetId) => previews.get(assetId)?.status || 'idle',
      isExpiring: (assetId) => {
        const preview = previews.get(assetId)
        return preview?.status === 'ready' && needsNewPreview(preview)
      },
    },
  }
}

export default function ViewAsUserCanvas({
  workspaceId,
  canvasId,
  title,
  read,
  onClose,
}: {
  workspaceId: number
  canvasId: number
  title: string
  read: typeof readAsUser
  onClose: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ elements: CanvasElementMutation[] } | { error: string } | null>(null)
  const media = useCanvasPreviews(workspaceId, canvasId, read)

  useEffect(() => {
    const controller = new AbortController()
    void loadCanvasSnapshot(workspaceId, canvasId, read, controller.signal).then(
      (elements) => {
        if (!controller.signal.aborted) setResult({ elements })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const inaccessible = error instanceof ViewAsUserError && [403, 404].includes(error.status)
        setResult({ error: inaccessible ? '此用户暂无权限查看此画布，或画布已删除。' : '暂时无法打开画布。' })
      },
    )
    return () => controller.abort()
  }, [attempt, canvasId, read, workspaceId])

  return (
    <section aria-label="画布内容">
      <header className={styles.canvasHeading}>
        <h3>{title}</h3>
        <button type="button" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回画布列表
        </button>
      </header>
      {!result ? (
        <p role="status">正在打开画布…</p>
      ) : 'error' in result ? (
        <div className={styles.loadError} role="alert">
          {result.error}
          <button
            type="button"
            onClick={() => {
              setResult(null)
              setAttempt((value) => value + 1)
            }}
          >
            重试
          </button>
        </div>
      ) : result.elements.some((element) => element.kind === 'node' && element.op !== 'delete') ? (
        <div className={`share-view ${styles.canvasViewport}`}>
          <ReadOnlyCanvas elements={result.elements} media={media} fitViewOptions={fitViewOptions} />
        </div>
      ) : (
        <p>这张画布暂无内容。</p>
      )}
    </section>
  )
}
