/**
 * 画布线图草稿持久化（localStorage）
 * 防抖自动保存 nodes + edges + 文本内容，刷新页面后恢复
 */
import type { Node, Edge } from '@xyflow/react'

const DRAFT_KEY = 'zzh_canvas_draft'

interface CanvasDraft {
  nodes: Array<{
    id: string
    type: string
    position: { x: number; y: number }
    data: {
      kind: string
      ratio?: string
      videoMode?: string
      modelVersionId?: number
      /** 素材来源：素材库应用后需持久化，刷新才能恢复节点内容 */
      assetId?: number
      resultUrl?: string
    }
    style?: { width: number; height: number }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
    data?: Record<string, unknown>
  }>
  /** 文本节点内容映射 nodeId → 文本 */
  textContents: Record<string, string>
  updatedAt: number
}

/** 保存草稿（仅保留可序列化字段） */
export function saveCanvasDraft(nodes: Node[], edges: Edge[]) {
  const textMap = (window as any).__canvasTextContents as Map<string, string> | undefined
  const textContents: Record<string, string> = {}
  if (textMap) {
    textMap.forEach((v, k) => {
      if (v) textContents[k] = v
    })
  }

  const draft: CanvasDraft = {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type || 'text',
      position: n.position,
      data: {
        kind: (n.data?.kind as string) || 'text',
        ratio: (n.data as any)?.ratio as string | undefined,
        videoMode: (n.data as any)?.videoMode as string | undefined,
        modelVersionId: (n.data as any)?.modelVersionId as number | undefined,
        // 素材来源字段一并持久化，刷新后节点才能恢复素材内容
        assetId: (n.data as any)?.assetId as number | undefined,
        resultUrl: (n.data as any)?.resultUrl as string | undefined,
      },
      style: n.style as { width: number; height: number } | undefined,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      data: e.data,
    })),
    textContents,
    updatedAt: Date.now(),
  }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // localStorage 配额满或其他异常，静默跳过
  }
}

/** 读取草稿，无草稿或解析失败返回 null */
export function loadCanvasDraft(): CanvasDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as CanvasDraft
  } catch {
    return null
  }
}

/** 清除草稿 */
export function clearCanvasDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // 静默
  }
}
