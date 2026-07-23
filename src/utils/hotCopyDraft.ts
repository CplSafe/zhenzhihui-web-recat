/**
 * 爆款复制(HotCopy)会话草稿持久化(localStorage)。
 * 目的:生成视频途中切到别处 / 刷新后,不再回到入口、不再丢失在途生成 —— 与智能成片一致。
 * 只存「恢复生成步」所需的可序列化状态(不存 File / blob:objectURL);用 vidGenTaskId 续轮询在途任务。
 * 单工作空间一条草稿(/hot-copy 无 :id),按 workspaceId 隔离。
 */
import { sanitizePersistentMediaUrl } from './persistentMediaUrl'
import { sanitizeTelemetryText } from './observabilitySanitizer'
import { normalizeVideoModificationDraft, type VideoModificationDraft } from './videoModificationDraft'
import { isLogoutDraftWriteBlocked } from './logoutBarrier'

/** 爆款复制单次生成记录的生命周期状态。 */
export type HotCopyGenStatus = 'processing' | 'failed' | 'published' | 'cancelled'

/** 爆款复制的一次视频生成记录，用于恢复轮询和展示历史结果。 */
export interface HotCopyGenRecord {
  id: string
  status: HotCopyGenStatus
  taskId: number
  note: string
  /** 原始修改要求；note 可包含“重新生成”等 UI 标签。 */
  modificationNote?: string
  error?: string
  createdAt: number
}

/** 爆款复制页面可持久化的完整会话草稿。 */
export interface HotCopyDraft {
  /** 已建后端项目 id(>0):用于「/hot-copy 无 id 但在制」时重定向回 /hot-copy/:id */
  projectId?: number
  /** 入口页序列化快照:切路由后返回第一页时恢复已输入的视频/素材/文案/比例/时长 */
  entryInitial?: any
  started: boolean
  step: number
  maxReached: number
  basePrompt: string
  projectName: string
  nameTouched: boolean
  sourceVideo: { assetId: number; url: string }
  /** 源视频真实时长缓存；必须与 sourceVideoDurationAssetId 匹配后才能用于计费参数。 */
  sourceVideoDurationSec?: number
  sourceVideoDurationAssetId?: number
  /** 原始展示素材 ID；生成提交仍使用 productAssetIds 中的人脸脱敏素材。 */
  originalProductAssetIds?: number[]
  productAssetIds: number[]
  fullVideo: { url: string; assetId: number }
  videoVersions: { url: string; assetId: number }[]
  /** 第四步尚未提交的整段/片段修改，以及按稳定 assetId 关联的历史版本说明。 */
  videoModificationDraft?: VideoModificationDraft
  /** 显式标记当前是否正在生成/续轮询中,用于切路由后优先恢复到生成页而不是显示「暂无视频」 */
  videoGenerating?: boolean
  vidGenTaskId: number // >0 表示有在途生成任务,恢复时续轮询
  /** 用户在入口选择的成片尺寸(画面比例,如 9:16)与时长(秒);恢复后重新生成沿用同样设置 */
  genRatio?: string
  genDurationSec?: number
  /** 每次生成的独立记录(生成中/失败 → 项目里显示成可重试「草稿」;成功并入成片后置 published 即从草稿列表消失)。
   *  进行中那条的 createdAt 同时作为「加载进度锚点」:切页面/刷新回来按真实流逝时间续算,不从头爬。 */
  videoGenerations?: HotCopyGenRecord[]
}

/** 当前登录用户的草稿作用域，防止同浏览器账号间串稿。 */
let draftUserScope = ''
/** 更新爆款复制草稿所属用户，后续读写据此选择隔离键。 */
export function setHotCopyDraftUserScope(id: any): void {
  draftUserScope = String(id || '')
}

/** 将工作区 ID 规范化为存储键可用的整数。 */
const normalizedWorkspaceId = (workspaceId: number) => Math.floor(Number(workspaceId) || 0)
/** 旧版只按工作区隔离的草稿键，仅用于安全迁移。 */
const legacyKeyOf = (workspaceId: number) => `zzh_hotcopy_draft_v1_ws${normalizedWorkspaceId(workspaceId)}`
/** 按用户与工作区双重隔离的当前草稿键。 */
const keyOf = (workspaceId: number, userScope = draftUserScope) =>
  `zzh_hotcopy_draft_v1_u${userScope || 'anon'}_ws${normalizedWorkspaceId(workspaceId)}`

/** 从新版存储键反向读取草稿所有者，无法确认时返回 null。 */
function scopedDraftOwnerOf(storageKey: string | null): string | null {
  const prefix = 'zzh_hotcopy_draft_v1_u'
  if (!storageKey?.startsWith(prefix)) return null
  const suffix = storageKey.slice(prefix.length)
  const workspaceSeparator = suffix.lastIndexOf('_ws')
  if (workspaceSeparator <= 0 || !/^-?\d+$/.test(suffix.slice(workspaceSeparator + 3))) return null
  return suffix.slice(0, workspaceSeparator)
}

/** 判断存储键是否属于旧版未按用户隔离的数据。 */
function isLegacyDraftKey(storageKey: string | null): boolean {
  const prefix = 'zzh_hotcopy_draft_v1_ws'
  return Boolean(storageKey?.startsWith(prefix) && /^-?\d+$/.test(storageKey.slice(prefix.length)))
}

/** 清洗入口快照中的媒体地址与可观测文本，确保数据可安全持久化。 */
export function sanitizeHotCopyEntryInitial(value: any, workspaceId: number): any {
  if (!value || typeof value !== 'object') return value
  const libraryVideoSource = value.libraryVideo && typeof value.libraryVideo === 'object' ? value.libraryVideo : null
  const libraryVideoAssetId = Number(libraryVideoSource?.assetId || 0) || 0
  const libraryVideo = libraryVideoSource
    ? {
        ...libraryVideoSource,
        assetId: libraryVideoAssetId,
        src: sanitizePersistentMediaUrl(libraryVideoSource.src, {
          assetId: libraryVideoAssetId,
          workspaceId,
        }),
      }
    : null
  const persistentLibraryVideo = libraryVideo && (libraryVideo.assetId > 0 || libraryVideo.src) ? libraryVideo : null
  const videoPreview =
    sanitizePersistentMediaUrl(value.videoPreview, {
      assetId: libraryVideoAssetId,
      workspaceId,
    }) ||
    persistentLibraryVideo?.src ||
    ''
  const products = Array.isArray(value.products)
    ? value.products
        .map((product: any) => {
          if (!product || typeof product !== 'object') return null
          const assetId = Number(product.assetId || product.submitAssetId || 0) || 0
          return {
            ...product,
            url: sanitizePersistentMediaUrl(product.url, { assetId, workspaceId }),
            file: null,
          }
        })
        .filter(
          (product: any) =>
            product && (product.url || Number(product.assetId || 0) > 0 || Number(product.submitAssetId || 0) > 0),
        )
    : []
  const hasPersistentVideo = Boolean(videoPreview || persistentLibraryVideo)

  return {
    ...value,
    videoSource: hasPersistentVideo ? value.videoSource : '',
    videoFile: null,
    videoFileName: hasPersistentVideo ? String(value.videoFileName || '') : '',
    libraryVideo: persistentLibraryVideo,
    videoPreview,
    products,
  }
}

/**
 * localStorage 只能保存刷新后仍有效的媒体引用。blob:/data: 与 File 都只属于当前页面会话；
 * 保留它们会在刷新后形成无法播放的幽灵素材，并可能让大体积 data URL 撑满存储配额。
 */
function sanitizeHotCopyDraft(draft: HotCopyDraft, workspaceId: number): HotCopyDraft {
  const sourceVideo = draft?.sourceVideo || { assetId: 0, url: '' }
  const fullVideo = draft?.fullVideo || { assetId: 0, url: '' }
  const videoVersions = (Array.isArray(draft?.videoVersions) ? draft.videoVersions : [])
    .map((version) => {
      const assetId = Number(version?.assetId || 0) || 0
      return {
        ...version,
        assetId,
        url: sanitizePersistentMediaUrl(version?.url, { assetId, workspaceId }),
      }
    })
    .filter((version) => version.assetId > 0 || Boolean(version.url))
  const sourceAssetId = Number(sourceVideo.assetId || 0) || 0
  const fullAssetId = Number(fullVideo.assetId || 0) || 0

  return {
    ...draft,
    entryInitial: sanitizeHotCopyEntryInitial(draft?.entryInitial, workspaceId),
    sourceVideo: {
      ...sourceVideo,
      assetId: sourceAssetId,
      url: sanitizePersistentMediaUrl(sourceVideo.url, { assetId: sourceAssetId, workspaceId }),
    },
    fullVideo: {
      ...fullVideo,
      assetId: fullAssetId,
      url: sanitizePersistentMediaUrl(fullVideo.url, { assetId: fullAssetId, workspaceId }),
    },
    videoVersions,
    videoGenerations: Array.isArray(draft?.videoGenerations)
      ? draft.videoGenerations.map((generation) => ({
          ...generation,
          ...(generation?.error
            ? { error: sanitizeTelemetryText(String(generation.error)).slice(0, 500) }
            : { error: undefined }),
        }))
      : draft?.videoGenerations,
    ...(draft?.videoModificationDraft
      ? { videoModificationDraft: normalizeVideoModificationDraft(draft.videoModificationDraft) }
      : {}),
  }
}

/** 写入当前用户与工作区草稿；退出屏障生效时禁止旧页面回写。 */
export function saveHotCopyDraft(workspaceId: number, draft: HotCopyDraft): void {
  if (isLogoutDraftWriteBlocked(draftUserScope)) return
  const ws = Number(workspaceId || 0)
  if (!ws) return
  try {
    localStorage.setItem(keyOf(ws), JSON.stringify(sanitizeHotCopyDraft(draft, ws)))
  } catch {
    /* 配额满 / 隐私模式:忽略 */
  }
}

/** 读取并清洗草稿，且只迁移能够确认属于当前用户的旧数据。 */
export function loadHotCopyDraft(workspaceId: number): HotCopyDraft | null {
  const ws = Number(workspaceId || 0)
  if (!ws) return null
  try {
    const raw = localStorage.getItem(keyOf(ws))
    if (!raw) {
      const legacyKey = legacyKeyOf(ws)
      const legacy = localStorage.getItem(legacyKey)
      if (!legacy) return null
      localStorage.removeItem(legacyKey)
      // Workspace-only legacy drafts have no owner. They may have been left by
      // any previous account, so never assign them to the current session.
      return null
    }
    const d = JSON.parse(raw)
    const sanitized = d && typeof d === 'object' ? sanitizeHotCopyDraft(d as HotCopyDraft, ws) : null
    return sanitized
  } catch {
    return null
  }
}

/** 清除指定账号拥有的全部工作区爆款草稿，不影响其他账号。 */
export function clearHotCopyDraftsForUser(userId: unknown): void {
  const userScope = String(userId || '').trim()
  if (!userScope) return
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (scopedDraftOwnerOf(key) === userScope || isLegacyDraftKey(key)) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    /* 忽略 */
  }
}

/** 删除当前用户在指定工作区的爆款复制草稿。 */
export function clearHotCopyDraft(workspaceId: number): void {
  const ws = Number(workspaceId || 0)
  if (!ws) return
  try {
    localStorage.removeItem(keyOf(ws))
    localStorage.removeItem(legacyKeyOf(ws))
  } catch {
    /* 忽略 */
  }
}
