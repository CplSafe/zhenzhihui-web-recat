import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  ViewportPortal,
  useReactFlow,
  useStore,
  type FitViewOptions,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '@/views/CanvasNodePresentation.css'
import '@/views/CanvasShareView.css'
import CanvasImageResults from './CanvasImageResults'
import CanvasAudioNode from './CanvasAudioNode'
import CanvasArrowEdge from './CanvasArrowEdge'
import CanvasStoryboard from './CanvasStoryboard'
import CanvasNodeVideoBar from './CanvasNodeVideoBar'
import CanvasBottomBar from './CanvasBottomBar'
import CanvasViewControls from './CanvasViewControls'
import { CanvasNodeBody, CanvasNodeFrame, CanvasNodeHeader, CanvasNodeImage, CanvasNodePrompt } from './CanvasNodeFrame'
import { canvasImageResultIds, canvasImageResultSize } from '@/utils/canvasImageResults'
import { elementsToGraph } from '@/utils/canvasElements'
import { getGroupBounds } from '@/utils/canvasGrouping'
import {
  alignSharedVideoLabels,
  alignSharedVideoSectionHeadings,
  tightenSharedVideoRows,
} from '@/utils/canvasShareLayout'
import { resolveCanvasNodeTitle } from '@/utils/canvasNodeTitle'
import { parseCanvasStructuredText } from '@/utils/canvasStructuredText'
import { formatVideoDurationLabel, formatVideoTimeLabel } from '@/utils/videoDuration'
import { primeVideoFirstFrame } from '@/utils/videoFrameCapture'
import type { CanvasElementMutation } from '@/api/canvasApi'

const CanvasVideoPreviewModal = lazy(() => import('./CanvasVideoPreviewModal'))
const CanvasImagePreviewModal = lazy(() => import('./CanvasImagePreviewModal'))
const CANVAS_ARROW_EDGE_TYPE = 'canvasArrow'
const edgeTypes = { [CANVAS_ARROW_EDGE_TYPE]: CanvasArrowEdge }
export const READ_ONLY_CANVAS_DOCK_PADDING = '76px'

export interface ReadOnlyCanvasMedia {
  nodeUrls: (data: Record<string, unknown>) => { url: string; posterUrl: string }
  assetUrl: (assetId: number) => string
  missingMessage: string
  signed?: {
    request: (assetIds: number[], force?: boolean) => void
    status: (assetId: number) => 'idle' | 'loading' | 'ready' | 'unavailable'
    isExpiring: (assetId: number) => boolean
  }
}

export interface ReadOnlyCanvasLayout {
  readPositions: () => Map<string, XYPosition>
  savePositions: (positions: Map<string, XYPosition>) => void
  resetPositions: () => void
}

const MediaContext = createContext<ReadOnlyCanvasMedia>({
  nodeUrls: () => ({ url: '', posterUrl: '' }),
  assetUrl: () => '',
  missingMessage: '素材暂时无法加载',
})

function ReadOnlyViewControls({
  fitViewOptions,
  canResetLayout,
  onResetLayout,
}: {
  fitViewOptions: FitViewOptions
  canResetLayout: boolean
  onResetLayout: () => void
}) {
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
          onFitView={() => void fitView(fitViewOptions)}
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

function ReadOnlyVideo({
  url,
  poster,
  title,
  onError,
  beforePlayback,
  onReloadSignedSource,
}: {
  url: string
  poster: string
  title: string
  onError: () => void
  beforePlayback?: () => boolean
  onReloadSignedSource?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [preview, setPreview] = useState(false)
  const time = `${formatVideoTimeLabel(current)} / ${formatVideoDurationLabel(duration) || '--:--'}`
  const progress = duration > 0 ? Math.min(current / duration, 1) * 100 : 0
  const expand = () => {
    if (beforePlayback && !beforePlayback()) return
    videoRef.current?.pause()
    setPreview(true)
  }
  return (
    <div className="canvas-node-video-wrap nopan">
      <video
        ref={videoRef}
        className="canvas-node-media"
        crossOrigin={onReloadSignedSource ? 'anonymous' : undefined}
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
          if (video.paused) {
            if (beforePlayback && !beforePlayback()) return
            void video.play().catch(() => {
              if (video.error) onError()
            })
          } else video.pause()
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
            onReloadSignedSource={
              onReloadSignedSource &&
              (() => {
                setPreview(false)
                onReloadSignedSource()
              })
            }
            onClose={() => setPreview(false)}
          />
        </Suspense>
      )}
    </div>
  )
}

/** 复用画布节点的媒体和文本展示，拖动、聚焦与预览仅影响当前查看。 */
function ReadOnlyNode({ id, data }: NodeProps<Node>) {
  const { fitView } = useReactFlow()
  const headerScale = useStore((state) => Math.min(6, Math.max(1, 1 / state.transform[2])))
  const kind = String(data.kind || '')
  const { nodeUrls, assetUrl, missingMessage, signed } = useContext(MediaContext)
  const { url: resultUrl, posterUrl } = nodeUrls(data)
  const text = String(data.text || data.prompt || '')
  const structuredText = useMemo(() => parseCanvasStructuredText(text), [text])
  const title = resolveCanvasNodeTitle({ ...data, kind, text }) || '节点'
  const [failedUrl, setFailedUrl] = useState('')
  const [previewId, setPreviewId] = useState('')
  const imageIds = canvasImageResultIds(data)
  const imageGroup = kind === 'image' && imageIds.length > 1
  const expanded = Boolean(data.imageResultsExpanded)
  const primaryId = Number(data.assetId)
  const posterId = Number(data.posterAssetId)
  const hasMedia = Boolean(data.assetId || resultUrl)
  const mediaAvailable = Boolean(resultUrl && failedUrl !== resultUrl)
  const status = signed?.status(primaryId)
  const loadLabel = kind === 'image' ? '查看图片' : kind === 'audio' ? '载入音频' : '载入视频'
  const captionVideoId = typeof data.shareCaptionVideoId === 'string' ? data.shareCaptionVideoId : ''
  const sectionHeading = kind === 'text' && data.shareSectionHeading === true && structuredText.kind === 'plain'
  const focusId = captionVideoId || id
  const focusNode = () => void fitView({ nodes: [{ id: focusId }], padding: 0.35, maxZoom: 1.5, duration: 300 })
  const imageUrl = (assetId: number) => (assetId === primaryId && resultUrl ? resultUrl : assetUrl(assetId))
  const imageItems = imageGroup
    ? imageIds.map((assetId) => ({ id: String(assetId), url: imageUrl(assetId), title }))
    : [{ id, url: resultUrl, title }]
  const loadResult = (force = false) => {
    const ids = imageGroup
      ? expanded
        ? imageIds
        : [primaryId, ...imageIds.filter((assetId) => assetId !== primaryId).slice(0, 2)]
      : [primaryId, posterId]
    signed?.request(ids, force)
  }
  const previewImage = (itemId: string, assetId: number) => {
    signed?.request([assetId])
    setPreviewId(itemId)
  }

  return (
    <CanvasNodeFrame
      kind={kind}
      headerScale={headerScale}
      imageGroup={imageGroup}
      highDefinition={Boolean(data.hd)}
      data-share-section-heading={sectionHeading ? '' : undefined}
    >
      {signed && kind !== 'text' && <CanvasNodeHeader kind={kind} title={title} />}
      <CanvasNodeBody
        onDoubleClick={() => {
          if (kind === 'image' && mediaAvailable && !imageGroup) previewImage(id, primaryId)
          else focusNode()
        }}
      >
        {imageGroup && (!signed || mediaAvailable) ? (
          <CanvasImageResults
            assetIds={imageIds}
            primaryAssetId={imageIds.includes(primaryId) ? primaryId : imageIds[0]}
            expanded={expanded}
            resolveUrl={imageUrl}
            crossOrigin={signed ? 'anonymous' : undefined}
            onToggle={() => {
              if (!expanded) signed?.request(imageIds)
              const toggleImages = data.onToggleImages as () => void
              toggleImages()
            }}
            onPreview={(assetId) => previewImage(String(assetId), assetId)}
          />
        ) : mediaAvailable && (kind === 'video' || kind === 'timeline') ? (
          <ReadOnlyVideo
            key={resultUrl}
            url={resultUrl}
            poster={posterUrl}
            title={title}
            onError={() => setFailedUrl(resultUrl)}
            beforePlayback={
              signed &&
              (() => {
                if (!signed.isExpiring(primaryId)) return true
                loadResult()
                return false
              })
            }
            onReloadSignedSource={signed && (() => loadResult(true))}
          />
        ) : kind === 'audio' && signed && mediaAvailable ? (
          <audio
            className="read-only-canvas-audio nodrag nopan"
            crossOrigin="anonymous"
            src={resultUrl}
            aria-label={`${title}预览`}
            controls
            controlsList="nodownload"
            preload="metadata"
            onError={() => setFailedUrl(resultUrl)}
          />
        ) : kind === 'audio' && !signed ? (
          <CanvasAudioNode nodeId={id} data={data} src={resultUrl} selected={false} workspaceId={0} readOnly />
        ) : mediaAvailable && kind === 'image' ? (
          <CanvasNodeImage
            crossOrigin={signed ? 'anonymous' : undefined}
            src={resultUrl}
            alt={`${title}预览`}
            referrerPolicy={signed ? 'no-referrer' : undefined}
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
        ) : signed && primaryId > 0 ? (
          <CanvasNodePrompt placeholder>
            <button
              className="read-only-canvas-load nodrag nopan"
              type="button"
              disabled={status === 'loading'}
              onClick={() => {
                loadResult(Boolean(failedUrl))
                setFailedUrl('')
              }}
            >
              {status === 'loading' ? '正在载入…' : status === 'unavailable' || failedUrl ? '重新载入素材' : loadLabel}
            </button>
          </CanvasNodePrompt>
        ) : (
          <CanvasNodePrompt placeholder>{hasMedia ? missingMessage : '暂无内容'}</CanvasNodePrompt>
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
      {previewId && (!signed || imageItems.some((item) => item.id === previewId && item.url)) && (
        <Suspense fallback={null}>
          <CanvasImagePreviewModal
            items={signed ? imageItems.filter((item) => item.url) : imageItems}
            activeId={previewId}
            crossOrigin={signed ? 'anonymous' : undefined}
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

const nodeTypes: NodeTypes = { share: ReadOnlyNode }

function moveWithAnchor(position: XYPosition, from: XYPosition, to: XYPosition): XYPosition {
  return { x: position.x + (to.x - from.x), y: position.y + (to.y - from.y) }
}

export default function ReadOnlyCanvas({
  elements,
  media,
  fitViewOptions,
  layout,
}: {
  elements: CanvasElementMutation[]
  media: ReadOnlyCanvasMedia
  fitViewOptions: FitViewOptions
  layout?: ReadOnlyCanvasLayout
}) {
  const [expandedImages, setExpandedImages] = useState<Record<string, boolean>>({})
  const [nodePositions, setNodePositions] = useState(() => layout?.readPositions() ?? new Map<string, XYPosition>())
  const graph = useMemo(() => {
    const { nodes, edges } = elementsToGraph(elements)
    // 自定义只读节点不套 React Flow 默认卡片的边框/内边距；保留原尺寸与连接点。
    const displayNodes = nodes.map<Node>((node) => {
      const expanded = expandedImages[node.id] ?? Boolean(node.data.imageResultsExpanded)
      const data = { ...node.data, imageResultsExpanded: expanded }
      return {
        ...node,
        style: canvasImageResultIds(data).length > 1 ? { ...node.style, ...canvasImageResultSize(data) } : node.style,
        data: {
          ...data,
          onToggleImages: () => setExpandedImages((current) => ({ ...current, [node.id]: !expanded })),
        },
        type: 'share',
        selectable: false,
      }
    })
    return {
      nodes: layout
        ? alignSharedVideoSectionHeadings(tightenSharedVideoRows(alignSharedVideoLabels(displayNodes)))
        : displayNodes,
      edges: edges.map(({ markerEnd: _markerEnd, ...rest }) => ({ ...rest, type: CANVAS_ARROW_EDGE_TYPE })),
    }
  }, [elements, layout, expandedImages])

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
      if (settled.size) layout?.savePositions(settled)
    },
    [nodesById, layout, videoByTitleId],
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
  const groupFrames = useMemo(() => (layout ? [] : getGroupBounds(displayNodes)), [displayNodes, layout])

  return (
    <MediaContext.Provider value={media}>
      <ReactFlow
        nodes={displayNodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        fitView
        minZoom={0.01}
        maxZoom={10}
        fitViewOptions={fitViewOptions}
        zoomOnDoubleClick={false}
        nodesDraggable
        onlyRenderVisibleElements={!layout}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(255, 255, 255, 0.18)" gap={24} size={2} />
        {groupFrames.length > 0 && (
          <ViewportPortal>
            {groupFrames.map((frame, index) => (
              <div
                key={frame.groupId}
                className="read-only-canvas-group"
                style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
              >
                <span>{frame.name || `分组 ${index + 1}`}</span>
              </div>
            ))}
          </ViewportPortal>
        )}
        <ReadOnlyViewControls
          fitViewOptions={fitViewOptions}
          canResetLayout={nodePositions.size > 0}
          onResetLayout={() => {
            layout?.resetPositions()
            setNodePositions(new Map())
          }}
        />
      </ReactFlow>
    </MediaContext.Provider>
  )
}
