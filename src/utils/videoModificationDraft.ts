/**
 * 视频修改意见草稿工具：保存整片意见、时间片段意见及其与生成版本的绑定。
 * 版本优先使用稳定素材 ID，避免签名 URL 刷新后意见错配到其他视频。
 */
/** 单个时间范围内的视频修改意见。 */
export interface VideoFrameModification {
  start: number | null
  end: number | null
  text: string
}

/** 当前项目的视频修改意见及版本绑定状态。 */
export interface VideoModificationDraft {
  overallNote: string
  frameSlots: VideoFrameModification[]
  /** 使用 assetId 作为首选键，URL 仅用于尚未落库的兼容版本。 */
  noteByVersion: Record<string, string>
  /** 仅用于生成中的即时展示；结果归属由 generationId 决定，不能据此猜测。 */
  pendingNote: string
}

/** 云端草稿中保存视频修改意见的兼容字段名。 */
export const VIDEO_MODIFICATION_DRAFT_FIELD = '__videoModificationDraftV1'

/** 创建包含两个空片段槽位的初始修改草稿。 */
export function createEmptyVideoModificationDraft(): VideoModificationDraft {
  return {
    overallNote: '',
    frameSlots: [
      { start: null, end: null, text: '' },
      { start: null, end: null, text: '' },
    ],
    noteByVersion: {},
    pendingNote: '',
  }
}

/** 规范化修改草稿的片段范围、文本和版本映射。 */
export function normalizeVideoModificationDraft(value?: Partial<VideoModificationDraft>): VideoModificationDraft {
  const defaults = createEmptyVideoModificationDraft()
  const slots = Array.isArray(value?.frameSlots) ? value.frameSlots.slice(0, 2) : []
  while (slots.length < 2) slots.push(defaults.frameSlots[slots.length])
  return {
    overallNote: String(value?.overallNote || ''),
    frameSlots: slots.map((slot) => ({
      start: slot?.start != null && Number.isFinite(Number(slot.start)) ? Number(slot.start) : null,
      end: slot?.end != null && Number.isFinite(Number(slot.end)) ? Number(slot.end) : null,
      text: String(slot?.text || ''),
    })),
    noteByVersion: value?.noteByVersion && typeof value.noteByVersion === 'object' ? { ...value.noteByVersion } : {},
    pendingNote: String(value?.pendingNote || ''),
  }
}

/** 从对象或 JSON 字符串解析修改草稿，非法数据回退为空草稿。 */
export function parseVideoModificationDraft(value: unknown): VideoModificationDraft {
  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizeVideoModificationDraft(JSON.parse(value))
    } catch {
      return createEmptyVideoModificationDraft()
    }
  }
  if (value && typeof value === 'object') {
    return normalizeVideoModificationDraft(value as Partial<VideoModificationDraft>)
  }
  return createEmptyVideoModificationDraft()
}

/** 将规范化后的修改草稿序列化为云端可保存文本。 */
export function serializeVideoModificationDraft(value: VideoModificationDraft): string {
  return JSON.stringify(normalizeVideoModificationDraft(value))
}

/** 为视频结果生成稳定版本键，素材 ID 优先于兼容 URL。 */
export function getVideoModificationVersionKey(result: { assetId?: unknown; url?: unknown }): string {
  const assetId = Math.floor(Number(result?.assetId || 0) || 0)
  if (assetId > 0) return `asset:${assetId}`
  const url = String(result?.url || '').trim()
  return url ? `url:${url}` : ''
}

/** 仅在调用方已把具体生成与具体结果匹配后绑定意见；加载状态或当前选中视频不足以证明归属。 */
export function bindVideoModificationNote(
  value: unknown,
  result: { assetId?: unknown; url?: unknown },
  note: unknown,
  options: { clearPending?: boolean } = {},
): VideoModificationDraft {
  const draft = parseVideoModificationDraft(value)
  const versionKey = getVideoModificationVersionKey(result)
  const normalizedNote = String(note || '').trim()
  return {
    ...draft,
    noteByVersion:
      versionKey && normalizedNote
        ? {
            ...draft.noteByVersion,
            [versionKey]: normalizedNote,
          }
        : draft.noteByVersion,
    pendingNote: options.clearPending === false ? draft.pendingNote : '',
  }
}

/** 保留当前编辑器输入，同时接纳并发或后台完成流程写入的版本意见绑定。 */
export function mergeVideoModificationDraft(
  currentValue: unknown,
  latestValue: unknown,
  options: { preferLatestPending?: boolean } = {},
): VideoModificationDraft {
  const current = parseVideoModificationDraft(currentValue)
  const latest = parseVideoModificationDraft(latestValue)
  return {
    ...current,
    noteByVersion: {
      ...current.noteByVersion,
      ...latest.noteByVersion,
    },
    pendingNote: options.preferLatestPending ? latest.pendingNote : current.pendingNote,
  }
}
