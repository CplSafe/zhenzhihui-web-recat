/**
 * 画布线图草稿持久化（localStorage）
 * 防抖自动保存 nodes + edges + 文本内容，刷新页面后恢复
 * 草稿键按项目 id 隔离，避免不同画布项目互相覆盖
 */
import type { Node, Edge } from '@xyflow/react'
import type { CanvasElementMutation } from '@/api/canvasApi'
import {
  applyCanvasElementMutations,
  conflictingCanvasElementIds,
  diffCanvasMutations,
  edgeDeleteMutation,
  edgeToMutation,
  nodeDeleteMutation,
  nodeToMutation,
  pickPersistedNodeData,
  type ComparableNode,
  type ComparableEdge,
} from '@/utils/canvasElements'

type CanvasSyncBaseline = { nodes: ComparableNode[]; edges: ComparableEdge[] }

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
export interface CanvasDraftScope {
  userId: number
  workspaceId: number
  writerId?: string
}

function draftKey(projectId?: string | number, scope?: CanvasDraftScope): string {
  const id = String(projectId ?? '').trim()
  if (scope) return `${DRAFT_KEY_PREFIX}_u${scope.userId}_w${scope.workspaceId}_p${encodeURIComponent(id)}`
  return id ? `${DRAFT_KEY_PREFIX}_p${encodeURIComponent(id)}` : DRAFT_KEY_PREFIX
}

// Unique to this document, including when a tab is duplicated or opened with an opener.
export function createCanvasDraftWriterId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const documentWriterId = createCanvasDraftWriterId()
const pendingDraftPrefix = (key: string) => `${key}:pending:`
const draftWriterKey = (key: string, scope?: CanvasDraftScope) =>
  `${pendingDraftPrefix(key)}${scope?.writerId || documentWriterId}`
const ownedDraftKeys = new Map<string, string>()
let draftWriteSequence = 0

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
  pendingSync?: boolean
  confirmedRevision?: number
  syncBaseline?: CanvasSyncBaseline
  pendingState?: Record<string, unknown>
  submittedMutations?: CanvasElementMutation[]
  acknowledgedMutationIds?: string[]
  acknowledgedRevision?: number
  receiptBaselineDataKeys?: Record<string, string[]>
  graphFromBaseline?: boolean
  compactNodes?: Array<CanvasDraft['nodes'][number] & { baselineDataKeys?: string[] }>
}

export interface PendingCanvasDraft {
  key: string
  snapshot: string
  draft: CanvasDraft
  superseded?: PendingCanvasDraft[]
}

function readDraftRecord(key: string): PendingCanvasDraft | null {
  try {
    const snapshot = localStorage.getItem(key)
    if (!snapshot) return null
    const draft = JSON.parse(snapshot) as CanvasDraft
    if (draft?.syncBaseline && (draft.graphFromBaseline || draft.compactNodes || draft.receiptBaselineDataKeys)) {
      restoreDraftFromBaseline(draft, draft.syncBaseline)
    }
    return draft && Array.isArray(draft.nodes) && Array.isArray(draft.edges) ? { key, snapshot, draft } : null
  } catch {
    return null
  }
}

function storedCanvasRevision(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

/** Read the last confirmed shared snapshot even when a writer has a newer pending journal. */
export function readCanvasConfirmedRevision(projectId: string | number, scope: CanvasDraftScope): number {
  const shared = readDraftRecord(draftKey(projectId, scope))?.draft
  return shared?.boundCanvasId === Number(projectId) ? storedCanvasRevision(shared.confirmedRevision) : 0
}

/** A pending undo often returns the graph to its baseline and changes only a few fields in a sent node. */
function restoreDraftFromBaseline(draft: CanvasDraft, baseline: CanvasSyncBaseline) {
  if (draft.graphFromBaseline) {
    draft.nodes = baseline.nodes.map((node) => ({
      id: node.id,
      type: node.type || 'text',
      position: node.position ?? { x: 0, y: 0 },
      data: node.data ?? {},
      style: node.style as CanvasDraft['nodes'][number]['style'],
    }))
    draft.edges = baseline.edges
  }
  if (!draft.compactNodes && !draft.receiptBaselineDataKeys) return
  const nodeById = new Map(baseline.nodes.map((node) => [node.id, node]))
  if (draft.compactNodes) {
    draft.nodes = draft.compactNodes.map(({ baselineDataKeys, ...node }) => ({
      ...node,
      data: restoreBaselineNodeData(node.data, nodeById.get(node.id)?.data, baselineDataKeys),
    }))
  }
  draft.submittedMutations = draft.submittedMutations?.map((mutation) => {
    const linkedKeys = draft.receiptBaselineDataKeys?.[mutation.element_id]
    if (!linkedKeys?.length) return mutation
    return {
      ...mutation,
      payload: {
        ...mutation.payload,
        data: restoreBaselineNodeData(
          (mutation.payload?.data as Record<string, unknown>) ?? {},
          nodeById.get(mutation.element_id)?.data,
          linkedKeys,
        ),
      },
    }
  })
}

function restoreBaselineNodeData(
  data: Record<string, unknown>,
  baseline?: Record<string, unknown>,
  linkedKeys?: string[],
) {
  if (!baseline || !linkedKeys?.length) return data
  return { ...Object.fromEntries(linkedKeys.map((key) => [key, baseline[key]])), ...data }
}

function compactBaselineNodeData(data: Record<string, unknown>, baseline?: Record<string, unknown>) {
  if (!baseline) return { data }
  const baselineDataKeys: string[] = []
  const changed = Object.entries(data).filter(([key, value]) => {
    const original = baseline[key]
    if (value !== original && (typeof value !== 'object' || JSON.stringify(value) !== JSON.stringify(original))) {
      return true
    }
    baselineDataKeys.push(key)
    return false
  })
  return baselineDataKeys.length ? { data: Object.fromEntries(changed), baselineDataKeys } : { data }
}

function compactDraftGraph(draft: CanvasDraft, baselineNodes: Map<string, ComparableNode>) {
  const compactNodes = draft.nodes.map((node) => ({
    ...node,
    ...compactBaselineNodeData(node.data, baselineNodes.get(node.id)?.data),
  }))
  if (compactNodes.some((node) => node.baselineDataKeys?.length)) draft.compactNodes = compactNodes
}

function compactDraftReceipts(draft: CanvasDraft, baselineNodes: Map<string, ComparableNode>) {
  const linkedKeys: Array<[string, string[]]> = []
  draft.submittedMutations = draft.submittedMutations?.map((mutation) => {
    if (mutation.kind !== 'node' || mutation.op !== 'upsert') return mutation
    const { data, baselineDataKeys } = compactBaselineNodeData(
      (mutation.payload?.data as Record<string, unknown>) ?? {},
      baselineNodes.get(mutation.element_id)?.data,
    )
    if (!baselineDataKeys) return mutation
    linkedKeys.push([mutation.element_id, baselineDataKeys])
    return { ...mutation, payload: { ...mutation.payload, data } }
  })
  if (linkedKeys.length) draft.receiptBaselineDataKeys = Object.fromEntries(linkedKeys)
}

/** Review each independent draft against its own cloud baseline. The legacy pending snapshot is retained. */
export function loadPendingCanvasDrafts(projectId: string | number, scope: CanvasDraftScope): PendingCanvasDraft[] {
  const key = draftKey(projectId, scope)
  const prefix = pendingDraftPrefix(key)
  try {
    const keys = [key]
    for (let index = 0; index < localStorage.length; index++) {
      const candidate = localStorage.key(index)
      if (candidate?.startsWith(prefix)) keys.push(candidate)
    }
    const pending = keys
      .map(readDraftRecord)
      .filter((record): record is PendingCanvasDraft => Boolean(record?.draft.pendingSync))
      .sort((a, b) => a.key.localeCompare(b.key))
    const latestByWriter = new Map<string, PendingCanvasDraft>()
    for (const record of pending) {
      const writer = record.key === key ? key : record.key.slice(0, record.key.lastIndexOf(':'))
      const previous = latestByWriter.get(writer)
      if (previous) {
        const { superseded, ...oldSnapshot } = previous
        record.superseded = [...(superseded || []), oldSnapshot]
      }
      latestByWriter.set(writer, record)
    }
    return [...latestByWriter.values()].sort(compareDraftRecords)
  } catch {
    return []
  }
}

function compareDraftRecords(a: PendingCanvasDraft, b: PendingCanvasDraft): number {
  return (a.draft.updatedAt || 0) - (b.draft.updatedAt || 0) || a.key.localeCompare(b.key)
}

export function hasOwnPendingCanvasDraft(projectId?: string | number, scope?: CanvasDraftScope): boolean {
  const journal = ownedDraftKeys.get(draftWriterKey(draftKey(projectId, scope), scope))
  return Boolean(journal && readDraftRecord(journal)?.draft.pendingSync)
}

/** Retire only the recovered versions actually confirmed by the cloud. A newer write in another tab survives. */
export function clearRecoveredCanvasDrafts(records: PendingCanvasDraft[]) {
  for (const record of records.flatMap((item) => [...(item.superseded || []), item])) {
    try {
      if (localStorage.getItem(record.key) === record.snapshot) localStorage.removeItem(record.key)
    } catch {
      // Keeping a confirmed snapshot is safe. The next recovery compares it with the cloud.
    }
  }
}

/** Rebase edits made after dispatch, including undo back to the previous cloud baseline. */
export function reconcileCanvasSaveAttempt(
  baseline: CanvasSyncBaseline,
  localChanges: CanvasElementMutation[],
  remoteChanges: CanvasElementMutation[],
  submitted: CanvasElementMutation[],
  acknowledgedIds: ReadonlySet<string>,
) {
  const remoteById = new Map(remoteChanges.map((change) => [change.element_id, change]))
  const changedRemotely = conflictingCanvasElementIds(submitted, remoteChanges)
  const changedLocally = conflictingCanvasElementIds(submitted, localChanges)
  const confirmed = new Set<string>()
  const localById = new Map(localChanges.map((change) => [change.element_id, change]))
  const nodes = new Map(baseline.nodes.map((node) => [node.id, node]))
  const edges = new Map(baseline.edges.map((edge) => [edge.id, edge]))
  for (const { element_id: id, kind } of submitted) {
    const stillMatchesCloud = remoteById.get(id)?.kind === kind && !changedRemotely.has(id)
    if (stillMatchesCloud) confirmed.add(id)
    if (!stillMatchesCloud && !acknowledgedIds.has(id)) continue
    const current = localById.get(id)
    if (current?.kind === kind && !changedLocally.has(id)) {
      // The author made no newer edit to a submitted change, so this read owns the displayed version.
      localById.delete(id)
      continue
    }
    if (current || !remoteById.has(id)) continue
    // The local graph matches the pre-write baseline at this id, while the server has the submitted version.
    if (kind === 'node') {
      const node = nodes.get(id)
      localById.set(
        id,
        node
          ? nodeToMutation({ ...node, position: node.position ?? { x: 0, y: 0 }, data: node.data ?? {} })
          : nodeDeleteMutation(id),
      )
    } else {
      const edge = edges.get(id)
      localById.set(id, edge ? edgeToMutation(edge) : edgeDeleteMutation(id))
    }
  }
  return { remaining: [...localById.values()], confirmed }
}

/** Merge older journals first. Keep conflicting snapshots intact until recovery is confirmed and saved. */
export function mergePendingCanvasDrafts(
  cloud: { nodes: Node[]; edges: Edge[] },
  records: PendingCanvasDraft[],
  authoritativeCloud = cloud,
) {
  let graph = cloud
  let hasConflicts = false
  const restoredNodeIds = new Set<string>()
  const pendingState: Record<string, unknown> = {}
  for (const { draft } of records) {
    const baseline = draft.syncBaseline
    if (!baseline || !Array.isArray(baseline.nodes) || !Array.isArray(baseline.edges)) return null
    const submitted = Array.isArray(draft.submittedMutations) ? draft.submittedMutations : []
    const submittedIds = new Set(submitted.map(({ element_id }) => element_id))
    const acknowledgedIds = new Set(draft.acknowledgedMutationIds || [])
    // IDs without a payload were acknowledged, and the author had not modified them again.
    let changes = diffCanvasMutations(baseline, draft, draft.textContents).filter(
      ({ element_id }) => !acknowledgedIds.has(element_id) || submittedIds.has(element_id),
    )
    let remoteChanges = diffCanvasMutations(baseline, graph)
    if (submitted.length) {
      const { remaining, confirmed } = reconcileCanvasSaveAttempt(
        baseline,
        changes,
        diffCanvasMutations(baseline, authoritativeCloud),
        submitted,
        acknowledgedIds,
      )
      // Only other recovered drafts may supersede an own receipt. UI normalization of the cloud graph cannot do so.
      const superseded =
        graph === cloud
          ? new Set<string>()
          : conflictingCanvasElementIds(remoteChanges, diffCanvasMutations(baseline, cloud))
      changes = remaining
      remoteChanges = remoteChanges.filter(({ element_id }) => !confirmed.has(element_id) || superseded.has(element_id))
    }
    if (!hasConflicts) {
      hasConflicts = conflictingCanvasElementIds(changes, remoteChanges).size > 0
    }
    graph = applyCanvasElementMutations(graph, changes)
    for (const change of changes) {
      if (change.kind !== 'node') continue
      if (change.op === 'upsert') restoredNodeIds.add(change.element_id)
      else restoredNodeIds.delete(change.element_id)
    }
    for (const [key, value] of Object.entries(draft.pendingState || {})) {
      if (
        Object.prototype.hasOwnProperty.call(pendingState, key) &&
        JSON.stringify(pendingState[key]) !== JSON.stringify(value)
      ) {
        hasConflicts = true
      }
      pendingState[key] = value
    }
  }
  return { graph, hasConflicts, restoredNodeIds, pendingState }
}

/** 读取草稿绑定的画布 id（无草稿或未绑定时返回 0）。 */
export function readDraftBoundCanvasId(projectId?: string | number, scope?: CanvasDraftScope): number {
  return Number(loadCanvasDraft(projectId, scope)?.boundCanvasId || 0) || 0
}

/** 保存草稿（仅保留可序列化字段）；projectId 用于按项目隔离，canvasId 用于把草稿绑定到画布 */
export function saveCanvasDraft(
  nodes: Node[],
  edges: Edge[],
  projectId?: string | number,
  boundCanvasId?: number,
  scope?: CanvasDraftScope,
  sync?: {
    pendingSync: boolean
    confirmedRevision?: number
    syncBaseline?: CanvasSyncBaseline
    pendingState?: Record<string, unknown>
    submittedMutations?: CanvasElementMutation[]
    acknowledgedMutationIds?: string[]
    acknowledgedRevision?: number
    graphFromBaseline?: boolean
  },
) {
  const textMap = (window as any).__canvasTextContents as Map<string, string> | undefined
  const textContents: Record<string, string> = {}
  if (textMap) {
    textMap.forEach((v, k) => {
      textContents[k] = v
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
    ...(sync
      ? {
          pendingSync: sync.pendingSync,
          ...(storedCanvasRevision(sync.confirmedRevision) ? { confirmedRevision: sync.confirmedRevision } : {}),
          ...(sync.syncBaseline ? { syncBaseline: sync.syncBaseline } : {}),
          ...(sync.pendingState ? { pendingState: sync.pendingState } : {}),
          ...(sync.submittedMutations?.length ? { submittedMutations: sync.submittedMutations } : {}),
          ...(sync.acknowledgedMutationIds?.length ? { acknowledgedMutationIds: sync.acknowledgedMutationIds } : {}),
          ...(sync.acknowledgedRevision ? { acknowledgedRevision: sync.acknowledgedRevision } : {}),
        }
      : {}),
  }
  if (scope && sync?.pendingSync && sync.syncBaseline) {
    if (sync.graphFromBaseline) draft.graphFromBaseline = true
    if (draft.submittedMutations?.length || draft.acknowledgedMutationIds?.length) {
      const baselineNodes = new Map(sync.syncBaseline.nodes.map((node) => [node.id, node]))
      if (!draft.graphFromBaseline && draft.acknowledgedMutationIds?.length) compactDraftGraph(draft, baselineNodes)
      compactDraftReceipts(draft, baselineNodes)
    }
  }
  const key = draftKey(projectId, scope)
  const writerKey = draftWriterKey(key, scope)
  try {
    const shared = readDraftRecord(key)?.draft
    const previous = ownedDraftKeys.get(writerKey)
    if (shared?.scriptCreationHandled) draft.scriptCreationHandled = true
    if (scope && sync?.pendingSync) {
      const sequence = String(++draftWriteSequence).padStart(12, '0')
      const journal = `${writerKey}:${sequence}`
      // Older journal readers skip a compact graph rather than interpreting it as a deletion of every element.
      const stored =
        draft.graphFromBaseline || draft.compactNodes
          ? { ...draft, nodes: null, edges: draft.graphFromBaseline ? null : draft.edges }
          : draft
      localStorage.setItem(journal, JSON.stringify(stored))
      ownedDraftKeys.set(writerKey, journal)
      if (previous) localStorage.removeItem(previous)
      return true
    }
    // A cache refresh in one tab must never erase a legacy draft that is still pending recovery.
    const sharedIsNewer =
      shared?.boundCanvasId === draft.boundCanvasId &&
      storedCanvasRevision(shared.confirmedRevision) > storedCanvasRevision(draft.confirmedRevision)
    if (!scope || (!shared?.pendingSync && !sharedIsNewer)) localStorage.setItem(key, JSON.stringify(draft))
    if (scope && sync?.pendingSync === false && previous) {
      localStorage.removeItem(previous)
      ownedDraftKeys.delete(writerKey)
    }
    return true
  } catch {
    return false
  }
}

/** 将画布级的一次性脚本引导状态写入当前画布的本地草稿。 */
export function saveCanvasScriptCreationHandled(
  projectId: string | number | undefined,
  handled: boolean,
  scope?: CanvasDraftScope,
) {
  try {
    const key = draftKey(projectId, scope)
    const draft = readDraftRecord(key)?.draft
    const next = draft || {
      nodes: [],
      edges: [],
      textContents: {},
      updatedAt: Date.now(),
      boundCanvasId: Number(projectId || 0) || 0,
    }
    localStorage.setItem(key, JSON.stringify({ ...next, scriptCreationHandled: handled }))
  } catch {
    // localStorage 不可用时由云端 state 保存。
  }
}

/** 读取草稿，无草稿或解析失败返回 null */
export function loadCanvasDraft(projectId?: string | number, scope?: CanvasDraftScope): CanvasDraft | null {
  const key = draftKey(projectId, scope)
  const shared = readDraftRecord(key)?.draft
  if (!scope || projectId === undefined) return shared ?? null
  const pending = loadPendingCanvasDrafts(projectId, scope)
  const newest = pending[pending.length - 1]?.draft
  if (!newest) return shared ?? null
  return shared?.scriptCreationHandled ? { ...newest, scriptCreationHandled: true } : newest
}

/** 清除指定项目的草稿 */
export function clearCanvasDraft(projectId?: string | number, scope?: CanvasDraftScope) {
  try {
    const key = draftKey(projectId, scope)
    localStorage.removeItem(key)
    const writerKey = draftWriterKey(key, scope)
    const journal = ownedDraftKeys.get(writerKey)
    if (scope && journal) {
      localStorage.removeItem(journal)
      ownedDraftKeys.delete(writerKey)
    }
  } catch {
    // 静默
  }
}
