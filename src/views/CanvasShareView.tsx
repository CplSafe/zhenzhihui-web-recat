import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './CanvasNodePresentation.css'
import './CanvasShareView.css'
import CanvasImageResults from '@/components/canvas/CanvasImageResults'
import CanvasAudioNode from '@/components/canvas/CanvasAudioNode'
import CanvasArrowEdge from '@/components/canvas/CanvasArrowEdge'
import CanvasStoryboard from '@/components/canvas/CanvasStoryboard'
import CanvasNodeVideoBar from '@/components/canvas/CanvasNodeVideoBar'
import CanvasBottomBar from '@/components/canvas/CanvasBottomBar'
import CanvasViewControls from '@/components/canvas/CanvasViewControls'
import { CanvasNodeBody, CanvasNodeFrame, CanvasNodeImage, CanvasNodePrompt } from '@/components/canvas/CanvasNodeFrame'
import { canvasImageResultIds, canvasImageResultSize } from '@/utils/canvasImageResults'
import { elementsToGraph } from '@/utils/canvasElements'
import {
  alignSharedVideoLabels,
  alignSharedVideoSectionHeadings,
  clearShareNodePositions,
  readShareNodePositions,
  saveShareNodePositions,
  tightenSharedVideoRows,
} from '@/utils/canvasShareLayout'
import { resolveCanvasShareMediaUrl, resolvePublicCanvasNodeMedia, shareAssetUrl } from '@/utils/canvasShareMedia'
import { resolveCanvasNodeTitle } from '@/utils/canvasNodeTitle'
import { parseCanvasStructuredText } from '@/utils/canvasStructuredText'
import { formatVideoDurationLabel, formatVideoTimeLabel } from '@/utils/videoDuration'
import { primeVideoFirstFrame } from '@/utils/videoFrameCapture'
import type { CanvasElementMutation } from '@/api/canvasApi'
import { fetchAllPublicCanvasElements, fetchPublicCanvas, type PublicCanvasShare } from '@/api/canvasShare'

const CanvasVideoPreviewModal = lazy(() => import('@/components/canvas/CanvasVideoPreviewModal'))
const CanvasImagePreviewModal = lazy(() => import('@/components/canvas/CanvasImagePreviewModal'))
const CANVAS_ARROW_EDGE_TYPE = 'canvasArrow'
const edgeTypes = { [CANVAS_ARROW_EDGE_TYPE]: CanvasArrowEdge }
const SHARE_FIT_VIEW_OPTIONS = {
  padding: { top: '92px', bottom: '76px', left: '24px', right: '24px' },
  minZoom: 0.01,
  maxZoom: 1,
} as const

function ShareViewControls({ canResetLayout, onResetLayout }: { canResetLayout: boolean; onResetLayout: () => void }) {
  const zoom = useStore((state) => state.transform[2])
  const { fitView, zoomIn, zoomOut, zoomTo } = useReactFlow()
  return (
    <CanvasBottomBar
      controls={
        <CanvasViewControls
          readOnly
          zoom={zoom}
          onZoomIn={() => void zoomIn({ duration: 160 })}
          onZoomOut={() => void zoomOut({ duration: 160 })}
          onFitView={() => void fitView(SHARE_FIT_VIEW_OPTIONS)}
          onZoomReset={() => void zoomTo(1, { duration: 160 })}
          canResetLayout={canResetLayout}
          onResetLayout={onResetLayout}
        />
      }
    >
      {null}
    </CanvasBottomBar>
  )
}

function SharedVideo({
  url,
  poster,
  title,
  onError,
}: {
  url: string
  poster: string
  title: string
  onError: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [preview, setPreview] = useState(false)
  const time = `${formatVideoTimeLabel(current)} / ${formatVideoDurationLabel(duration) || '--:--'}`
  const progress = duration > 0 ? Math.min(current / duration, 1) * 100 : 0
  const expand = () => {
    videoRef.current?.pause()
    setPreview(true)
  }
  return (
    <div className="canvas-node-video-wrap nopan">
      <video
        ref={videoRef}
        className="canvas-node-media"
        src={url}
        poster={poster || undefined}
        aria-label={`${title}预览`}
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          if (!poster) primeVideoFirstFrame(event.currentTarget)
        }}
        onError={onError}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onDurationChange={(event) => {
          const next = event.currentTarget.duration
          setDuration(Number.isFinite(next) ? next : 0)
        }}
      />
      <CanvasNodeVideoBar
        playing={playing}
        time={time}
        onExpand={expand}
        onToggle={() => {
          const video = videoRef.current
          if (!video) return
          if (video.paused)
            void video.play().catch(() => {
              if (video.error) onError()
            })
          else video.pause()
        }}
      >
        <label className="canvas-node-video-track" data-share-track>
          <span className="canvas-node-video-track__fill" style={{ width: `${progress}%` }} aria-hidden="true">
            <span className="canvas-node-video-track__thumb" />
          </span>
          <input
            type="range"
            aria-label="视频进度"
            aria-valuetext={time}
            min={0}
            max={duration}
            step="0.01"
            disabled={!duration}
            value={Math.min(current, duration)}
            onChange={(event) => {
              const value = Number(event.currentTarget.value)
              if (videoRef.current) videoRef.current.currentTime = value
              setCurrent(value)
            }}
          />
        </label>
      </CanvasNodeVideoBar>
      {preview && (
        <Suspense fallback={null}>
          <CanvasVideoPreviewModal
            src={url}
            poster={poster || undefined}
            startTime={current}
            showInfo={false}
            readOnly
            onClose={() => setPreview(false)}
          />
        </Suspense>
      )}
    </div>
  )
}

/** 使用编辑画布节点的展示组件，操作仅由公开页提供。 */
function ShareNode({ id, data }: NodeProps<Node>) {
  const { fitView } = useReactFlow()
  const headerScale = useStore((state) => Math.min(6, Math.max(1, 1 / state.transform[2])))
  const kind = String(data.kind || '')
  const resultUrl = resolveCanvasShareMediaUrl(data)
  const posterUrl = resolveCanvasShareMediaUrl(data, 'poster')
  const text = String(data.text || data.prompt || '')
  const structuredText = useMemo(() => parseCanvasStructuredText(text), [text])
  const title = resolveCanvasNodeTitle({ ...data, kind, text }) || '节点'
  const [failedUrl, setFailedUrl] = useState('')
  const [previewId, setPreviewId] = useState('')
  const imageIds = canvasImageResultIds(data)
  const imageGroup = kind === 'image' && imageIds.length > 1
  const hasMedia = Boolean(data.assetId || resultUrl)
  const mediaAvailable = Boolean(resultUrl && failedUrl !== resultUrl)
  const captionVideoId = typeof data.shareCaptionVideoId === 'string' ? data.shareCaptionVideoId : ''
  const sectionHeading = kind === 'text' && data.shareSectionHeading === true && structuredText.kind === 'plain'
  const focusId = captionVideoId || id
  const focusNode = () => void fitView({ nodes: [{ id: focusId }], padding: 0.35, maxZoom: 1.5, duration: 300 })
  const imageUrl = (assetId: number) =>
    assetId === Number(data.assetId) && resultUrl ? resultUrl : shareAssetUrl(String(data.shareToken), assetId)
  const imageItems = imageGroup
    ? imageIds.map((assetId) => ({ id: String(assetId), url: imageUrl(assetId), title }))
    : [{ id, url: resultUrl, title }]

  return (
    <CanvasNodeFrame
      kind={kind}
      headerScale={headerScale}
      imageGroup={imageGroup}
      highDefinition={Boolean(data.hd)}
      data-share-section-heading={sectionHeading ? '' : undefined}
    >
      <CanvasNodeBody
        onDoubleClick={() => {
          if (kind === 'image' && mediaAvailable && !imageGroup) setPreviewId(id)
          else focusNode()
        }}
      >
        {imageGroup ? (
          <CanvasImageResults
            assetIds={imageIds}
            primaryAssetId={imageIds.includes(Number(data.assetId)) ? Number(data.assetId) : imageIds[0]}
            expanded={Boolean(data.imageResultsExpanded)}
            resolveUrl={imageUrl}
            onToggle={() => (data.onToggleImages as () => void)()}
            onPreview={(assetId) => setPreviewId(String(assetId))}
          />
        ) : mediaAvailable && (kind === 'video' || kind === 'timeline') ? (
          <SharedVideo
            key={resultUrl}
            url={resultUrl}
            poster={posterUrl}
            title={title}
            onError={() => setFailedUrl(resultUrl)}
          />
        ) : kind === 'audio' ? (
          <CanvasAudioNode nodeId={id} data={data} src={resultUrl} selected={false} workspaceId={0} readOnly />
        ) : mediaAvailable && kind === 'image' ? (
          <CanvasNodeImage
            src={resultUrl}
            alt={`${title}预览`}
            draggable={false}
            onError={() => setFailedUrl(resultUrl)}
          />
        ) : kind === 'text' ? (
          structuredText.kind === 'storyboard' ? (
            <CanvasStoryboard items={structuredText.items} readOnly />
          ) : sectionHeading ? (
            <h2 className="share-section-heading" title={structuredText.text}>
              {structuredText.text}
            </h2>
          ) : (
            <CanvasNodePrompt>{structuredText.text}</CanvasNodePrompt>
          )
        ) : (
          <CanvasNodePrompt placeholder>
            {hasMedia ? '素材暂时无法加载，请联系分享者检查访问权限' : '暂无内容'}
          </CanvasNodePrompt>
        )}
      </CanvasNodeBody>
      {!captionVideoId && (
        <button
          type="button"
          className="canvas-video-expand share-node-focus nodrag nopan"
          aria-label={`放大查看${title}`}
          data-storyboard={kind === 'text' && structuredText.kind === 'storyboard' ? '' : undefined}
          title="聚焦节点"
          onClick={focusNode}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="6" />
            <path d="m14.5 14.5 4.5 4.5M7.5 10h5M10 7.5v5" />
          </svg>
        </button>
      )}
      {previewId && (
        <Suspense fallback={null}>
          <CanvasImagePreviewModal
            items={imageItems}
            activeId={previewId}
            onSelect={setPreviewId}
            onClose={() => setPreviewId('')}
          />
        </Suspense>
      )}
      <Handle
        id={`${id}-left-target`}
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="share-node-handle"
        aria-hidden="true"
      />
      <Handle
        id={`${id}-right-source`}
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="share-node-handle"
        aria-hidden="true"
      />
    </CanvasNodeFrame>
  )
}

const nodeTypes: NodeTypes = { share: ShareNode }

type LoadState = 'loading' | 'ready' | 'missing' | 'error'

function moveWithAnchor(position: XYPosition, from: XYPosition, to: XYPosition): XYPosition {
  return { x: position.x + (to.x - from.x), y: position.y + (to.y - from.y) }
}

export default function CanvasShareView() {
  const { token = '' } = useParams()
  return <CanvasSharePage key={token} token={token} />
}

function CanvasSharePage({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>('loading')
  const [message, setMessage] = useState('')
  const [share, setShare] = useState<PublicCanvasShare | null>(null)
  const [elements, setElements] = useState<CanvasElementMutation[]>([])
  const [expandedImages, setExpandedImages] = useState<Record<string, boolean>>({})
  const [nodePositions, setNodePositions] = useState(() => readShareNodePositions(token))

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

  const graph = useMemo(() => {
    const { nodes, edges } = elementsToGraph(elements)
    // 自定义只读节点不套 React Flow 默认卡片的边框/内边距；保留原尺寸与连接点。
    const displayNodes = nodes.map((node) => {
      // 节点自带的 resultUrl 要登录才能取，这里换算成分享口令下的匿名地址交给 ShareNode
      const media = resolvePublicCanvasNodeMedia(token, node.data)
      const expanded = expandedImages[node.id] ?? Boolean(node.data.imageResultsExpanded)
      const data = { ...node.data, imageResultsExpanded: expanded }
      return {
        ...node,
        style: canvasImageResultIds(data).length > 1 ? { ...node.style, ...canvasImageResultSize(data) } : node.style,
        data: {
          ...data,
          shareMediaUrl: media.url,
          sharePosterUrl: media.posterUrl,
          shareToken: token,
          onToggleImages: () => setExpandedImages((current) => ({ ...current, [node.id]: !expanded })),
        },
        type: 'share',
        selectable: false,
      }
    })
    return {
      nodes: alignSharedVideoSectionHeadings(tightenSharedVideoRows(alignSharedVideoLabels(displayNodes))),
      edges: edges.map(({ markerEnd: _markerEnd, ...rest }) => ({ ...rest, type: CANVAS_ARROW_EDGE_TYPE })),
    }
  }, [elements, token, expandedImages])

  const { nodesById, videoByTitleId } = useMemo(() => {
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
    const videoByTitleId = new Map<string, Node>()
    for (const node of graph.nodes) {
      const videoId = node.data.shareTitleVideoId ?? node.data.shareCaptionVideoId
      if (node.data.kind !== 'text' || typeof videoId !== 'string') continue
      const video = nodesById.get(videoId)
      if (video?.data.kind === 'video' || video?.data.kind === 'timeline') videoByTitleId.set(node.id, video)
    }
    return { nodesById, videoByTitleId }
  }, [graph.nodes])

  // 标题和视频共用视频的位置，拖动任意一个时都保留它们的相对间距。
  const handleNodesChange = useCallback<OnNodesChange>(
    (changes) => {
      const moved = new Map<string, XYPosition>()
      const settled = new Map<string, XYPosition>()
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue
        const node = nodesById.get(change.id)
        if (!node) continue
        const video = videoByTitleId.get(node.id)
        const id = video?.id ?? node.id
        const position = video ? moveWithAnchor(video.position, node.position, change.position) : change.position
        moved.set(id, position)
        if (change.dragging !== true) settled.set(id, position)
      }
      if (moved.size) setNodePositions((current) => new Map([...current, ...moved]))
      saveShareNodePositions(token, settled)
    },
    [nodesById, token, videoByTitleId],
  )

  const displayNodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        const video = videoByTitleId.get(node.id)
        const position = nodePositions.get(video?.id ?? node.id)
        if (!position) return node
        return { ...node, position: video ? moveWithAnchor(node.position, video.position, position) : position }
      }),
    [graph.nodes, nodePositions, videoByTitleId],
  )

  return (
    <div className="share-view">
      <div className="canvas-navigation share-topbar nodrag nopan nowheel" aria-label="画布导航">
        <span className="share-title">{share?.title || '共享画布'}</span>
        <span className="canvas-save-status share-badge">只读查看</span>
      </div>

      {state === 'ready' ? (
        <ReactFlow
          nodes={displayNodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          fitView
          minZoom={0.01}
          maxZoom={10}
          fitViewOptions={SHARE_FIT_VIEW_OPTIONS}
          zoomOnDoubleClick={false}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(255, 255, 255, 0.18)" gap={24} size={2} />
          <ShareViewControls
            canResetLayout={nodePositions.size > 0}
            onResetLayout={() => {
              clearShareNodePositions(token)
              setNodePositions(new Map())
            }}
          />
        </ReactFlow>
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
