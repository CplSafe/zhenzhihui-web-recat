import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FitViewOptions } from '@xyflow/react'
import ReadOnlyCanvas, {
  READ_ONLY_CANVAS_DOCK_PADDING,
  type ReadOnlyCanvasLayout,
  type ReadOnlyCanvasMedia,
} from '@/components/canvas/ReadOnlyCanvas'
import { clearShareNodePositions, readShareNodePositions, saveShareNodePositions } from '@/utils/canvasShareLayout'
import { resolveCanvasShareMediaUrl, resolvePublicCanvasNodeMedia, shareAssetUrl } from '@/utils/canvasShareMedia'
import type { CanvasElementMutation } from '@/api/canvasApi'
import {
  copySharedCanvas,
  fetchAllPublicCanvasElements,
  fetchPublicCanvas,
  type PublicCanvasShare,
} from '@/api/canvasShare'
import { useAllWorkspaces, useCurrentUser } from '@/stores/workspaceSession'

const SHARE_FIT_VIEW_OPTIONS = {
  padding: { top: '92px', bottom: READ_ONLY_CANVAS_DOCK_PADDING, left: '24px', right: '24px' },
  minZoom: 0.01,
  maxZoom: 1,
} as const

type LoadState = 'loading' | 'ready' | 'missing' | 'error'

export default function CanvasShareView() {
  const { token = '' } = useParams()
  const copyKeys = useRef(new Map<string, string>())
  return <CanvasSharePage key={token} token={token} copyKeys={copyKeys.current} />
}

function ShareCopyActions({
  token,
  userId,
  canCopy,
  copyKeys,
}: {
  token: string
  userId: number | undefined
  canCopy: boolean
  copyKeys: Map<string, string>
}) {
  const navigate = useNavigate()
  const workspaces = useAllWorkspaces()
  const [targetWorkspace, setTargetWorkspace] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const [copied, setCopied] = useState(false)

  const handleApply = async () => {
    if (copyBusy || copied || !targetWorkspace) return
    setCopyBusy(true)
    setCopyMessage('')
    try {
      const key = `${userId}:${token}:${targetWorkspace}`
      const requestKey = copyKeys.get(key) ?? crypto.randomUUID()
      copyKeys.set(key, requestKey)
      await copySharedCanvas(token, Number(targetWorkspace), requestKey)
      setCopied(true)
      setCopyMessage('已复制到所选空间，可返回首页进入该空间查看。')
    } catch (err) {
      setCopyMessage(String((err as Error)?.message || '复制失败，请重试'))
    } finally {
      setCopyBusy(false)
    }
  }

  if (!canCopy) return <span>分享者未允许复制</span>
  if (!userId) {
    return (
      <button type="button" onClick={() => navigate('/login', { state: { returnTo: `/canvas/share/${token}` } })}>
        登录后应用此画布
      </button>
    )
  }
  return (
    <>
      <select
        aria-label="复制到哪个空间"
        value={targetWorkspace}
        disabled={copyBusy}
        onChange={(event) => {
          setTargetWorkspace(event.target.value)
          setCopied(false)
          setCopyMessage('')
        }}
      >
        <option value="">请选择目标空间</option>
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      <button type="button" disabled={copyBusy || !targetWorkspace || copied} onClick={() => void handleApply()}>
        {copyBusy ? '复制中…' : copied ? '已应用' : '应用此画布'}
      </button>
      {copyMessage && <span role="status">{copyMessage}</span>}
    </>
  )
}

function CanvasSharePage({ token, copyKeys }: { token: string; copyKeys: Map<string, string> }) {
  const user = useCurrentUser()
  const topbarRef = useRef<HTMLDivElement>(null)
  const [fitTop, setFitTop] = useState(92)
  const [state, setState] = useState<LoadState>('loading')
  const [message, setMessage] = useState('')
  const [share, setShare] = useState<PublicCanvasShare | null>(null)
  const [elements, setElements] = useState<CanvasElementMutation[]>([])
  const layout = useMemo<ReadOnlyCanvasLayout>(
    () => ({
      readPositions: () => readShareNodePositions(token),
      savePositions: (positions) => saveShareNodePositions(token, positions),
      resetPositions: () => clearShareNodePositions(token),
    }),
    [token],
  )
  const media = useMemo<ReadOnlyCanvasMedia>(
    () => ({
      nodeUrls: (data) => {
        const assigned = resolvePublicCanvasNodeMedia(token, data)
        const resolved = { ...data, shareMediaUrl: assigned.url, sharePosterUrl: assigned.posterUrl }
        return { url: resolveCanvasShareMediaUrl(resolved), posterUrl: resolveCanvasShareMediaUrl(resolved, 'poster') }
      },
      assetUrl: (assetId) => shareAssetUrl(token, assetId),
      missingMessage: '素材暂时无法加载，请联系分享者检查访问权限',
    }),
    [token],
  )

  useLayoutEffect(() => {
    const topbar = topbarRef.current
    const viewport = topbar?.parentElement
    if (!topbar || !viewport) return
    // 复制控件在窄屏会换行，适应画布时要给完整的导航栏留出空间。
    const measure = () => {
      const bottom = topbar.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top
      setFitTop(Math.max(92, Math.ceil(bottom + 10)))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(topbar)
    return () => observer.disconnect()
  }, [])
  const fitViewOptions = useMemo<FitViewOptions>(
    () => ({ ...SHARE_FIT_VIEW_OPTIONS, padding: { ...SHARE_FIT_VIEW_OPTIONS.padding, top: `${fitTop}px` } }),
    [fitTop],
  )

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setState('loading')
      try {
        const [info, list] = await Promise.all([fetchPublicCanvas(token), fetchAllPublicCanvasElements(token)])
        if (cancelled) return
        setShare(info)
        setElements(list as CanvasElementMutation[])
        setState('ready')
      } catch (err) {
        if (cancelled) return
        const text = String((err as Error)?.message || '')
        // 链接失效与网络故障要分开说：前者让访客去找分享者要新链接，后者让他重试
        const missing = /404|不存在|已失效|过期|not found/i.test(text)
        setMessage(text || '画布加载失败')
        setState(missing ? 'missing' : 'error')
      }
    }
    if (!token) {
      setState('missing')
      setMessage('分享链接不完整')
      return
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="share-view">
      <div ref={topbarRef} className="canvas-navigation share-topbar nodrag nopan nowheel" aria-label="画布导航">
        <div className="share-heading">
          <span className="share-title">{share?.title || '共享画布'}</span>
          <span className="canvas-save-status share-badge">只读查看</span>
        </div>
        <div className="share-apply">
          <span>查看和复制会向分享者留记录，未登录时记为匿名访客。</span>
          {state === 'ready' && (
            <ShareCopyActions
              key={user?.id}
              token={token}
              userId={user?.id}
              canCopy={Boolean(share?.allowCopy)}
              copyKeys={copyKeys}
            />
          )}
        </div>
      </div>

      {state === 'ready' ? (
        <ReadOnlyCanvas elements={elements} media={media} layout={layout} fitViewOptions={fitViewOptions} />
      ) : (
        <div className="share-state" role="status">
          {state === 'loading' && <span>正在打开画布…</span>}
          {state === 'missing' && (
            <>
              <strong>链接已失效</strong>
              <span>{message || '这块画布的分享可能已被关闭，请向分享者索取新链接。'}</span>
            </>
          )}
          {state === 'error' && (
            <>
              <strong>画布加载失败</strong>
              <span>{message}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
