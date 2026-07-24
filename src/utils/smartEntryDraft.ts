/**
 * 智能成片入口临时草稿：在当前标签页保存文案、比例、时长和素材选择。
 * 存储按用户与工作区隔离，无法确认归属的旧键直接删除而不迁移，避免泄露输入内容。
 */
import { isLogoutDraftWriteBlocked } from './logoutBarrier'
import type { GenerationModelSelectionMap } from './generationModelCatalog'

/** 无归属信息的旧版入口草稿键。 */
const LEGACY_ENTRY_DRAFT_KEY = 'zzh.smart-entry.draft'
/** 当前入口草稿键前缀。 */
const ENTRY_DRAFT_KEY_PREFIX = 'zzh.smart-entry.draft.v2'

/** 智能成片入口可恢复的表单状态。 */
export interface SmartEntryDraftStore {
  mode?: 'video' | 'image'
  text?: string
  ratio?: string
  duration?: string
  skill?: string
  images?: string[]
  /** 与 images 按下标对齐的已落库素材 ID；本地新上传图片为 0。 */
  imageAssetIds?: number[]
  /** 图片模式单轮生成数量。 */
  outputCount?: number
  /** 按 operation_code 保存的后端模型版本选择。 */
  generationModels?: GenerationModelSelectionMap
}

/** 当前入口草稿用户作用域。 */
let entryDraftUserScope = ''
/** 当前入口草稿工作区作用域。 */
let entryDraftWorkspaceScope = 0

/** 将用户作用域规范化为稳定字符串。 */
function normalizeUserScope(value: unknown): string {
  return String(value || '').trim()
}

/** 将工作区标识规范化为正整数。 */
function normalizeWorkspaceId(value: unknown): number {
  const id = Math.floor(Number(value) || 0)
  return id > 0 ? id : 0
}

/** 为未登录状态提供明确的匿名作用域标签。 */
function scopeLabel(userScope = entryDraftUserScope): string {
  return normalizeUserScope(userScope) || 'anon'
}

/** 构建按用户和工作区隔离的入口草稿键。 */
function keyOf(userScope = entryDraftUserScope, workspaceId = entryDraftWorkspaceScope): string {
  return `${ENTRY_DRAFT_KEY_PREFIX}_u${scopeLabel(userScope)}_ws${normalizeWorkspaceId(workspaceId)}`
}

/** 从新版键中反向读取草稿用户，无法确认时返回 null。 */
function scopedDraftOwnerOf(storageKey: string | null): string | null {
  const prefix = `${ENTRY_DRAFT_KEY_PREFIX}_u`
  if (!storageKey?.startsWith(prefix)) return null
  const suffix = storageKey.slice(prefix.length)
  const workspaceSeparator = suffix.lastIndexOf('_ws')
  if (workspaceSeparator <= 0 || !/^\d+$/.test(suffix.slice(workspaceSeparator + 3))) return null
  return suffix.slice(0, workspaceSeparator)
}

/** 解析 sessionStorage 草稿，非法 JSON 返回 null。 */
function parseDraft(raw: string | null): SmartEntryDraftStore | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as SmartEntryDraftStore) : null
  } catch {
    return null
  }
}

/** 同步入口草稿的当前用户和工作区作用域。 */
export function setSmartEntryDraftScope(userId: unknown, workspaceId: unknown): void {
  entryDraftUserScope = normalizeUserScope(userId)
  entryDraftWorkspaceScope = normalizeWorkspaceId(workspaceId)
}

/** 读取当前作用域草稿，并删除无法安全归属的旧版数据。 */
export function loadSmartEntryDraft(): SmartEntryDraftStore | null {
  try {
    const scoped = parseDraft(window.sessionStorage.getItem(keyOf()))
    // The ownerless legacy key cannot be assigned safely, including to an
    // anonymous session. Remove it instead of migrating potentially private input.
    if (window.sessionStorage.getItem(LEGACY_ENTRY_DRAFT_KEY) !== null) {
      window.sessionStorage.removeItem(LEGACY_ENTRY_DRAFT_KEY)
    }
    return scoped
  } catch {
    return null
  }
}

/** 保存入口草稿；存储空间不足时移除图片后降级保存文本选项。 */
export function saveSmartEntryDraft(draft: SmartEntryDraftStore): void {
  if (isLogoutDraftWriteBlocked(entryDraftUserScope)) return
  try {
    window.sessionStorage.setItem(keyOf(), JSON.stringify(draft))
  } catch {
    try {
      window.sessionStorage.setItem(keyOf(), JSON.stringify({ ...draft, images: [], imageAssetIds: [] }))
    } catch {
      /* Storage is unavailable or full. */
    }
  }
}

/** 清除当前用户与工作区的入口草稿，保留其他作用域数据。 */
export function clearSmartEntryDraft(): void {
  try {
    window.sessionStorage.removeItem(keyOf())
    window.sessionStorage.removeItem(LEGACY_ENTRY_DRAFT_KEY)
  } catch {
    /* Storage may be unavailable. */
  }
}

/** 清除指定用户拥有的全部工作区入口草稿。 */
export function clearSmartEntryDraftsForUser(userId: unknown): void {
  const user = normalizeUserScope(userId)
  if (!user) return
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index)
      if (scopedDraftOwnerOf(key) === user) window.sessionStorage.removeItem(key)
    }
    // The legacy key is unowned, so retaining it across logout could expose it
    // to whichever account signs in next.
    window.sessionStorage.removeItem(LEGACY_ENTRY_DRAFT_KEY)
  } catch {
    /* Storage may be unavailable. */
  }
}
