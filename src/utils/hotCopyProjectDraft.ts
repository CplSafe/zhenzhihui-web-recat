/**
 * 爆款复制项目草稿识别与绑定：区分本流程、空草稿和其他流程的数据。
 * 路由项目、重启项目与已绑定项目必须按明确优先级选择，避免把结果写入错误项目。
 */
/** 项目草稿经过检查后的流程归类。 */
export type HotCopyProjectDraftKind = 'hot-copy' | 'empty' | 'foreign' | 'invalid'

/** 爆款复制项目草稿的检查结果。 */
export interface HotCopyProjectDraftInspection {
  kind: HotCopyProjectDraftKind
  obj: Record<string, any> | null
  smart: Record<string, any> | null
  /** Explicit flow when one exists. Conflicting values are joined with "/". */
  flow: string
  legacy: boolean
}

/** 选择本次提交项目 ID 所需的候选绑定。 */
export interface HotCopyProjectBindingInput {
  routeProjectId?: unknown
  restartProjectId?: unknown
  boundProjectId?: unknown
}

/** 安全判断记录是否直接拥有指定字段。 */
const hasOwn = (value: Record<string, any>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

/** 将未知值收敛为非数组记录。 */
function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null
}

/** 将 flow 字段规范化为便于比较的小写文本。 */
function normalizeFlow(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

/** 将候选项目标识规范化为正整数。 */
function toProjectId(value: unknown): number {
  const id = Math.floor(Number(value) || 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

/**
 * 编辑器 URL 中的项目最权威；项目管理导航状态只桥接未绑定入口。
 * URL 替换渲染完成前使用内存绑定，确保刚创建的项目不会漂移。
 */
export function resolveHotCopySubmissionProjectId(input: HotCopyProjectBindingInput): number {
  return toProjectId(input.routeProjectId) || toProjectId(input.restartProjectId) || toProjectId(input.boundProjectId)
}

/** 恢复入口或视频步骤但不发起供应商操作；旧快照根据持久证据推断是否已进入生成步骤。 */
export function resolveHotCopyRestoredStarted(smartValue: unknown, projectDraftValue: unknown = null): boolean {
  const smart = asRecord(smartValue) || {}
  const projectDraft = asRecord(projectDraftValue) || {}
  if (typeof smart.started === 'boolean') return smart.started

  const hasResult = Boolean(
    toProjectId(smart.fullVideoAssetId) ||
    String(smart.fullVideoUrl || '').trim() ||
    toProjectId(projectDraft.generatedVideoAssetId) ||
    String(projectDraft.generatedVideoUrl || '').trim() ||
    (Array.isArray(smart.videoVersions) && smart.videoVersions.length > 0) ||
    (Array.isArray(projectDraft.videoHistoryList) && projectDraft.videoHistoryList.length > 0),
  )
  const hasActiveTask = Boolean(
    toProjectId(smart.vidGenTaskId) ||
    smart.videoGenerating ||
    (Array.isArray(smart.videoGenerations) &&
      smart.videoGenerations.some((generation: any) => String(generation?.status || '') === 'processing')),
  )
  return hasResult || hasActiveTask || Number(smart.step || 0) > 0
}

/** 判断草稿是否没有任何可恢复的爆款复制内容。 */
function isEmptyDraftObject(obj: Record<string, any>, smart: Record<string, any> | null): boolean {
  const topLevelKeys = Object.keys(obj).filter((key) => key !== 'smart')
  return topLevelKeys.length === 0 && (!smart || Object.keys(smart).length === 0)
}

/** 旧草稿缺少 flow 时仅接受至少两个爆款专有字段，防止误接管未标记的智能成片草稿。 */
function hasLegacyHotCopyShape(value: Record<string, any>): boolean {
  const markerKeys = [
    'entryInitial',
    'sourceVideo',
    'productAssetIds',
    'originalProductAssetIds',
    'sourceVideoDurationSec',
    'sourceVideoDurationAssetId',
  ]
  return markerKeys.reduce((count, key) => count + Number(hasOwn(value, key)), 0) >= 2
}

/** 应用状态前分类云端草稿，仅接受明确爆款流程、真正空草稿或可识别的旧版爆款快照。 */
export function inspectHotCopyProjectDraft(draftJson: unknown): HotCopyProjectDraftInspection {
  let parsed: unknown = draftJson
  if (typeof parsed === 'string') {
    if (!parsed.trim()) {
      return { kind: 'empty', obj: {}, smart: {}, flow: '', legacy: false }
    }
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return { kind: 'invalid', obj: null, smart: null, flow: '', legacy: false }
    }
  }

  if (parsed == null) {
    return { kind: 'empty', obj: {}, smart: {}, flow: '', legacy: false }
  }

  const obj = asRecord(parsed)
  if (!obj) return { kind: 'invalid', obj: null, smart: null, flow: '', legacy: false }

  const nestedSmart = asRecord(obj.smart)
  const smart = nestedSmart || obj
  const topLevelFlow = normalizeFlow(obj.flow)
  const nestedFlow = normalizeFlow(nestedSmart?.flow)
  const explicitFlows = [...new Set([topLevelFlow, nestedFlow].filter(Boolean))]

  if (explicitFlows.length > 0) {
    const isHotCopy = explicitFlows.length === 1 && explicitFlows[0] === 'hot-copy'
    return {
      kind: isHotCopy ? 'hot-copy' : 'foreign',
      obj,
      smart,
      flow: explicitFlows.join('/'),
      legacy: false,
    }
  }

  if (isEmptyDraftObject(obj, nestedSmart)) {
    return { kind: 'empty', obj, smart, flow: '', legacy: false }
  }

  if (hasLegacyHotCopyShape(smart) || (smart !== obj && hasLegacyHotCopyShape(obj))) {
    return { kind: 'hot-copy', obj, smart, flow: '', legacy: true }
  }

  return { kind: 'foreign', obj, smart, flow: '', legacy: false }
}

/** 判断检查结果是否允许当前爆款复制页面接管该项目。 */
export function isAcceptedHotCopyProjectDraft(
  inspection: HotCopyProjectDraftInspection,
): inspection is HotCopyProjectDraftInspection & {
  kind: 'hot-copy' | 'empty'
  obj: Record<string, any>
  smart: Record<string, any>
} {
  return (inspection.kind === 'hot-copy' || inspection.kind === 'empty') && Boolean(inspection.obj && inspection.smart)
}
