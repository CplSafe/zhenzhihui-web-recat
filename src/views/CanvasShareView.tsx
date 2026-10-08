/**
 * 公开画布只读查看页（/canvas/share/:token）。
 *
 * 免登录：数据走 /api/v1/canvas-shares/{token} 与 .../elements 两个匿名接口。
 * 这里刻意不复用 CanvasView——那一套挂着生成、云端同步、撤销栈、右键菜单等完整编辑链路，
 * 为只读再往里加分支，等于给全仓库最复杂的文件继续加负担。访客要的只有「看清这块画布画了什么」，
 * 因此节点在这里退化成一张卡片：图片/视频直接播放，文本原样展示。
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './CanvasShareView.css'
import CanvasArrowEdge from '@/components/canvas/CanvasArrowEdge'
import { elementsToGraph } from '@/utils/canvasElements'
import { resolveCanvasShareMediaUrl, resolvePublicCanvasNodeMedia } from '@/utils/canvasShareMedia'
import type { CanvasElementMutation } from '@/api/canvasApi'
import { fetchAllPublicCanvasElements, fetchPublicCanvas, type PublicCanvasShare } from '@/api/canvasShare'

const CANVAS_ARROW_EDGE_TYPE = 'canvasArrow'
const edgeTypes = { [CANVAS_ARROW_EDGE_TYPE]: CanvasArrowEdge }

/** 节点类型 → 展示用中文名；未知类型原样显示，不猜。 */
const KIND_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  timeline: '视频剪辑',
}

/** 只读节点保留原连接点位置，历史连线才能在分享页找到起止坐标。 */
function ShareNode({ id, data }: NodeProps<Node>) {
  const info = (data || {}) as Record<string, unknown>
  const kind = String(info.kind || '')
  const resultUrl = resolveCanvasShareMediaUrl(info)
  const posterUrl = resolveCanvasShareMediaUrl(info, 'poster')
  const text = String(info.text || info.prompt || '')
  const title = String(info.title || KIND_LABELS[kind] || kind || '节点')
  const [failedUrl, setFailedUrl] = useState('')
  const mediaFailed = Boolean(resultUrl && failedUrl === resultUrl)
  const isVideo = kind === 'video' || kind === 'timeline'
  const hasMedia = Boolean(info.assetId || resultUrl)

  return (
    <div className="share-node">
      <div className="share-node-kind" title={title}>
        {title}
      </div>
      {resultUrl && !mediaFailed && isVideo ? (
        // 访客可能只想确认成片效果，给原生控件即可，不再搬运画布那套自定义播放器
        <video
          className="share-node-media"
          src={resultUrl}
          poster={posterUrl || undefined}
          controls
          preload="metadata"
          aria-label={`${title}预览`}
          onError={() => setFailedUrl(resultUrl)}
        />
      ) : resultUrl && !mediaFailed ? (
        <img
          className="share-node-media"
          src={resultUrl}
          alt={`${title}预览`}
          loading="lazy"
          onError={() => setFailedUrl(resultUrl)}
        />
      ) : (
        <div className={hasMedia ? 'share-node-unavailable' : 'share-node-text'}>
          {hasMedia ? '素材暂时无法加载，请联系分享者检查访问权限' : text}
        </div>
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
    </div>
  )
}

const nodeTypes: NodeTypes = { share: ShareNode }

type LoadState = 'loading' | 'ready' | 'missing' | 'error'

export default function CanvasShareView() {
  const { token = '' } = useParams()
  const [state, setState] = useState<LoadState>('loading')
  const [message, setMessage] = useState('')
  const [share, setShare] = useState<PublicCanvasShare | null>(null)
  const [elements, setElements] = useState<CanvasElementMutation[]>([])

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
    return {
      // 自定义只读节点不套 React Flow 默认卡片的边框/内边距；保留原尺寸与连接点。
      nodes: nodes.map((node) => {
        // 节点自带的 resultUrl 要登录才能取，这里换算成分享口令下的匿名地址交给 ShareNode
        const media = resolvePublicCanvasNodeMedia(token, node.data)
        return {
          ...node,
          data: { ...node.data, shareMediaUrl: media.url, sharePosterUrl: media.posterUrl },
          type: 'share',
          draggable: false,
          selectable: false,
        }
      }),
      edges: edges.map(({ markerEnd: _markerEnd, ...rest }) => ({ ...rest, type: CANVAS_ARROW_EDGE_TYPE })),
    }
  }, [elements, token])

  return (
    <div className="share-view">
      <div className="share-topbar">
        <span className="share-title">{share?.title || '共享画布'}</span>
        <span className="share-badge">只读查看</span>
      </div>

      {state === 'ready' ? (
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
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
