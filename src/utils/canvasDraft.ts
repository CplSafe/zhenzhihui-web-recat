/**
 * 画布线图草稿持久化（localStorage）
 * 防抖自动保存 nodes + edges + 文本内容，刷新页面后恢复
 * 草稿键按项目 id 隔离，避免不同画布项目互相覆盖
 */
import type { Node, Edge } from '@xyflow/react'
import { pickPersistedNodeData } from '@/utils/canvasElements'

const DRAFT_KEY_PREFIX = 'zzh_canvas_draft'
const SCRIPT_CREATION_PENDING_PREFIX = 'zzh_canvas_script_creation_pending'

function scriptCreationPendingKey(canvasId: string | number): string {
  return `${SCRIPT_CREATION_PENDING_PREFIX}_${encodeURIComponent(String(canvasId))}`
}

/** 新建画布成功后登记一次性脚本创作入口，刷新后仍能恢复首次体验。 */
export function markCanvasScriptCreationPending(canvasId: string | number) {
  try {
    localStorage.setItem(scriptCreationPendingKey(canvasId), '1')
  } catch {
    // 入口仍可在当前页面按云端画布状态正常展示。
  }
}

export function hasCanvasScriptCreationPending(canvasId: string | number): boolean {
  try {
    return localStorage.getItem(scriptCreationPendingKey(canvasId)) === '1'
  } catch {
    return false
  }
}

export function clearCanvasScriptCreationPending(canvasId: string | number) {
  try {
    localStorage.removeItem(scriptCreationPendingKey(canvasId))
  } catch {
    // 云端 state 仍记录已完成状态。
  }
}

/** 按项目 id 生成隔离的草稿存储键：不同画布项目互不覆盖 */
function draftKey(projectId?: string | number): string {
  const id = String(projectId ?? '').trim()
  return id ? `${DRAFT_KEY_PREFIX}_p${encodeURIComponent(id)}` : DRAFT_KEY_PREFIX
}

interface CanvasDraft {
  nodes: Array<{
    id: string
    type: string
    position: { x: number; y: number }
    /**
     * 节点业务数据。字段集合与云端 mutation 共用 PERSISTED_NODE_DATA_FIELDS——
     * 两处各写一份白名单时，草稿曾经漏掉 prompt / realPerson / timeline。
     */
    data: Record<string, unknown>
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
  /** 草稿绑定的画布 id：用于判断本地草稿是否属于当前画布，避免误上传到新画布 */
  boundCanvasId?: number
  /** 创建画布时的一次性脚本创作入口是否已处理 */
  scriptCreationHandled?: boolean
}

/** 读取草稿绑定的画布 id（无草稿或未绑定时返回 0）。 */
export function readDraftBoundCanvasId(projectId?: string | number): number {
  try {
    const raw = localStorage.getItem(draftKey(projectId))
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { boundCanvasId?: number }
    return Number(parsed?.boundCanvasId || 0) || 0
  } catch {
    return 0
  }
}

/** 保存草稿（仅保留可序列化字段）；projectId 用于按项目隔离，canvasId 用于把草稿绑定到画布 */
export function saveCanvasDraft(nodes: Node[], edges: Edge[], projectId?: string | number, boundCanvasId?: number) {
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
      data: { kind: 'text', ...pickPersistedNodeData((n.data || {}) as Record<string, unknown>) },
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
    // 画布绑定：草稿归属的唯一真相源，防止误上传到其他画布
    boundCanvasId: Number(boundCanvasId || 0) || 0,
  }
  try {
    localStorage.setItem(draftKey(projectId), JSON.stringify(draft))
  } catch {
    // localStorage 配额满或其他异常，静默跳过
  }
}

/** 将画布级的一次性脚本引导状态写入当前画布的本地草稿。 */
export function saveCanvasScriptCreationHandled(projectId: string | number | undefined, handled: boolean) {
  try {
    const draft = loadCanvasDraft(projectId)
    const next = draft || {
      nodes: [],
      edges: [],
      textContents: {},
      updatedAt: Date.now(),
      boundCanvasId: Number(projectId || 0) || 0,
    }
    localStorage.setItem(draftKey(projectId), JSON.stringify({ ...next, scriptCreationHandled: handled }))
  } catch {
    // localStorage 不可用时由云端 state 保存。
  }
}

/** 读取草稿，无草稿或解析失败返回 null */
export function loadCanvasDraft(projectId?: string | number): CanvasDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(projectId))
    if (!raw) return null
    return JSON.parse(raw) as CanvasDraft
  } catch {
    return null
  }
}

/** 清除指定项目的草稿 */
export function clearCanvasDraft(projectId?: string | number) {
  try {
    localStorage.removeItem(draftKey(projectId))
  } catch {
    // 静默
  }
}
