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
import { ReactFlow, Background, Controls, type Node, type NodeProps, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './CanvasShareView.css'
import CanvasArrowEdge from '@/components/canvas/CanvasArrowEdge'
import { elementsToGraph } from '@/utils/canvasElements'
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

/** 只读节点：有结果就展示结果，没有就展示提示词，两者都没有则只留一个空卡片。 */
function ShareNode({ data }: NodeProps<Node>) {
  const info = (data || {}) as Record<string, unknown>
  const kind = String(info.kind || '')
  const resultUrl = String(info.resultUrl || '')
  const text = String(info.text || info.prompt || '')

  return (
    <div className="share-node">
      <div className="share-node-kind">{KIND_LABELS[kind] || kind || '节点'}</div>
      {resultUrl && kind === 'video' ? (
        // 访客可能只想确认成片效果，给原生控件即可，不再搬运画布那套自定义播放器
        <video className="share-node-media" src={resultUrl} controls preload="metadata" />
      ) : resultUrl ? (
        <img className="share-node-media" src={resultUrl} alt="" loading="lazy" />
      ) : (
        <div className="share-node-text">{text}</div>
      )}
    </div>
  )
}

const nodeTypes: NodeTypes = { default: ShareNode }

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
      // 只读：节点一律 default 类型走 ShareNode，并关掉拖拽与选中
      nodes: nodes.map((node) => ({ ...node, type: 'default', draggable: false, selectable: false })),
      edges: edges.map(({ markerEnd: _markerEnd, ...rest }) => ({ ...rest, type: CANVAS_ARROW_EDGE_TYPE })),
    }
  }, [elements])

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
