/**
 * 页面效果：完成一条可恢复、可编辑的「智能成片 2.1」创作流程。
 *
 * 用户从文字需求或参考图开始，依次完成营销思路拆解（可选）、分镜脚本、
 * 主体素材生成、镜头编排和整片视频生成；成片支持历史版本切换、分段修改、
 * 重新生成与下载。项目名称、草稿、生成任务和视频结果会同步到后端，刷新、
 * 切换页面或重新进入项目后仍可恢复，并通过任务中心展示真实生成状态。
 *
 * 本文件负责跨步骤编排与持久化，具体步骤界面由 components/smart 下的组件负责。
 */
import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import DraftSaveIndicator from '@/components/common/DraftSaveIndicator'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import SmartEntry, { clearSmartEntryDraft, type EntryMeta } from '@/components/smart/SmartEntry'
import TaskCenterDrawer from '@/components/task/TaskCenterDrawer'
import type { Shot } from '@/components/smart/ScriptStoryboardTable'
import SubjectAssetDialog from '@/components/smart/SubjectAssetDialog'
import type { ShotTrashItem } from '@/components/smart/ShotTrashBin/ShotTrashBin'
import type { ChatImg, ChatMessage, ImageComposerDraft, ImageVideoSelection } from '@/components/smart/ImageChat'
import iconProjectEdit from '@/assets/icons/project-edit.svg'
import Markdown from '@/components/common/Markdown'
import {
  createProjectNameFallback,
  generateProjectName,
  generateProjectNameFromImages,
  matchUploadsToSubjects,
  summarizeRequirement,
  refineElementPrompt,
  refineElementPromptWithImage,
  refineShotPrompt,
  polishText,
  skillBreakdownStructured,
  marketingDataToText,
  marketingFieldByKey,
  patchMarketingField,
  suggestOptions,
  validateProjectName,
  type MarketingBreakdownData,
  type MarketingFieldKey,
} from '@/api/aiPolish'
import { generateScriptShotsStream, generateShotInfo, extractSubjects, mergeSingleUseSubjects } from '@/api/smartScript'
import {
  generateShotImage,
  resumeShotImageGeneration,
  ensureAssetId,
  refreshAssetUrl,
  persistImageAsset,
  estimateShotImageCost,
  isTerminalShotImageTaskError,
} from '@/api/smartShotImage'
import {
  generateFullVideo,
  editFullVideo,
  resumeFullVideo,
  buildTimelinePrompt,
  totalDurationSec,
  estimateFullVideoCost,
  estimateVideoEditCost,
} from '@/api/smartVideo'
import { blurFacesOnAsset, isNoFaceDetectedError } from '@/api/smartFaceBlur'
import { readVideoDurationSec } from '@/utils/videoDuration'
import {
  createCreativeProject,
  patchCreativeProject,
  getCreativeProject,
  getBusinessErrorMessage,
  cancelAiTask,
  updateCreativeProjectDraft,
  uploadAssetFile,
  getAssetDownloadUrl,
  restoreCreativeTrashItem,
  deleteCreativeTrashItem,
} from '@/api/business'
import { listAllAssets } from '@/utils/businessPagination'
import {
  useWorkspaceId,
  useCurrentUser,
  useAllWorkspaces,
  useModelPlanCandidates,
  useWorkspaceSessionStore,
  deriveModelPlanCandidates,
  deriveAllWorkspaces,
} from '@/stores/workspaceSession'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { openComingSoon, openMemberCenter, useUiStore } from '@/stores/ui'
import {
  buildTaskCenterId,
  isTaskCenterTerminalStatus,
  useTaskCenterStore,
  type TaskCenterStatus,
} from '@/stores/taskCenter'
import { openGuide, isSmartGuideArmed, disarmSmartGuide, syncSmartGuideStage, useGuideStore } from '@/stores/guide'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useAuth } from '@/auth/AuthContext'
import {
  saveSmartDraft,
  loadSmartDraft,
  clearSmartDraft,
  buildSmartSnapshot,
  canPersistSmartProjectDraft,
  parseSmartSnapshot,
  computeVideoContentSig,
  mergeCompletedVideoGenerationIds,
  type SmartDraft,
} from '@/utils/smartDraft'
import { mergeImageMessagesForRecovery, shouldMergeLocalImageRecovery } from '@/utils/smartImageRecovery'
import { persistVideoResultToBackend, persistVideoTerminalStateToBackend } from '@/utils/persistVideoResult'
import { enqueueCreativeProjectDraftSave, waitForCreativeProjectDraftSaves } from '@/utils/creativeDraftSaveQueue'
import {
  getCreativeProjectDraft,
  isCreativeProjectRestrictedForUser,
  mergeLatestProjectMetadata,
  resolveUserId,
} from '@/utils/creativeDraftMetadata'
import { deriveSmartVideoGenerationActivity, resolveSmartActiveTask } from '@/utils/smartVideoGenerationState'
import {
  isUnnamedProjectTitle as isUnnamedTitle,
  resolveCreativeProjectTitleWrite,
} from '@/utils/creativeProjectTitlePersistence'
import { resolveCreativeProjectId as resolveProjectId } from '@/utils/projectAssetAccess'
import { normalizeSmartScriptName } from '@/utils/smartScriptOptions'
import { stableDerivedVideoId } from '@/api/projectVideos'
import {
  mergeVideoVersionLists,
  readRequestedProjectVideoSelection,
  resolveRestoredVideoSelection,
  stableMediaUrlKey,
  type RequestedProjectVideoSelection,
  type SmartVideoVersion,
} from '@/utils/projectVideoSelection'
import { useLatestCallback } from '@/composables/useLatestCallback'
import { sanitizePersistentProjectVideoStore } from '@/utils/persistentMediaUrl'
import {
  persistSmartEntryImages,
  requireOrderedShotAssetIds,
  scriptStreamFailureMessage,
  stableGenerationAssetKey,
} from '@/utils/smartGenerationGuards'
import { validateCreativeDurationSelection } from '@/utils/creativeDurationPolicy'
import { SMART_VIDEO_DURATIONS, parseDurationSeconds, validateSmartVideoDuration } from '@/utils/videoDurationValue'
import {
  bindVideoModificationNote,
  parseVideoModificationDraft,
  serializeVideoModificationDraft,
  VIDEO_MODIFICATION_DRAFT_FIELD,
  type VideoModificationDraft,
} from '@/utils/videoModificationDraft'
import {
  assertCreativeDraftContentUnchanged,
  assertCreativeDraftWriteStillOwned,
  createCreativeDraftContentFingerprint,
  createDraftFingerprint,
  isCreativeDraftContentConflictError,
  isDraftConflictError,
  isRetryableDraftSaveError,
  waitForDraftSaveRetry,
  type DraftSaveStatus,
  type DraftWriteResult,
} from '@/utils/creativeDraftPersistence'
import {
  detachRunningVideoGen,
  findRunningVideoGen,
  getRunningVideoGen,
  getRunningVideoGenMeta,
  isVideoGenRunning,
  trackVideoGen,
  updateRunningVideoGenMeta,
} from '@/utils/videoGenRegistry'
import { buildDownloadName, downloadToDisk } from '@/utils/downloadToDisk'
import './SmartCreateView.css'

/** 按需加载分镜脚本编辑表。 */
const ScriptStoryboardTable = lazy(() => import('@/components/smart/ScriptStoryboardTable'))
/** 按需加载镜头编排工作区。 */
const ShotArrange = lazy(() => import('@/components/smart/ShotArrange'))
/** 按需加载图片创作对话区。 */
const ImageChat = lazy(() => import('@/components/smart/ImageChat'))
/** 按需加载营销思路拆解表。 */
const MarketingBreakdown = lazy(() => import('@/components/smart/MarketingBreakdown'))
/** 按需加载成片预览与修改区。 */
const VideoStage = lazy(() => import('@/components/smart/VideoStage'))

/** 懒加载大型步骤组件时使用的无障碍占位。 */
function LazyEditorFallback({ label = '正在加载编辑器…' }: { label?: string }) {
  return (
    <div className="smart__placeholder smart__placeholder--sm" role="status" aria-live="polite">
      <span className="smart__project-loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

// 素材在分镜脚本步已准备,去掉「准备素材」步,流程:分镜脚本 → 镜头编排 → 生成视频
const STEPS: StepItem[] = [
  { key: 'script', label: '分镜脚本' },
  { key: 'material', label: '准备素材' },
  { key: 'shots', label: '镜头编排' },
  { key: 'video', label: '生成视频' },
]
/** 流式脚本增量合并到界面的最小间隔。 */
const SCRIPT_STREAM_RENDER_INTERVAL_MS = 120
// 各步「当前进行中」时的子状态文案(进度条展示)
const ACTIVE_STATUS = ['脚本生成中', '素材上传中', '镜头编排中', '视频生成中']
// 选中 SKILL 时,在最前面多出的「营销思路拆解」步
const MARKETING_STEP: StepItem = { key: 'marketing', label: '营销思路拆解' }
/** 当前会话已确认无权访问的项目键，避免恢复链重复尝试。 */
const deniedSmartProjectKeys = new Set<string>()
/** 组合工作空间与项目 id，作为权限拒绝和草稿基线缓存键。 */
const smartProjectKey = (workspaceId: number, projectId: number) =>
  `${Math.floor(Number(workspaceId) || 0)}:${Math.floor(Number(projectId) || 0)}`

/** 每次图片生成用户动作的稳定幂等根键，网络重试只能复用该键，不能产生第二笔任务。 */
function createImageChatIdempotencyKey(): string {
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `smart_image_${randomId}`
}

// 后端在不同接口里会用下划线、驼峰或嵌套 data 返回草稿版本号。
// 保持为模块级纯函数，避免依赖它的保存回调在每次渲染时失效。
function normRev(payload: any): number {
  const value = Number(
    payload?.draft_revision ??
      payload?.draftRevision ??
      payload?.data?.draft_revision ??
      payload?.data?.draftRevision ??
      NaN,
  )
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : NaN
}

/** 智能成片支持时长的用户可读范围。 */
const SUPPORTED_VIDEO_DURATION_LABEL = '1至15秒内的整数'

/** 为不受模型支持的总时长生成明确调整提示。 */
function unsupportedVideoDurationMessage(value: unknown): string {
  const seconds = parseDurationSeconds(value)
  return seconds === null
    ? `参与生成的分镜总时长无效，请调整为${SUPPORTED_VIDEO_DURATION_LABEL}`
    : `当前参与生成的分镜总时长为${seconds}秒，视频模型仅支持${SUPPORTED_VIDEO_DURATION_LABEL}，请调整分镜时长后重试`
}

/** 侧边栏导航键与页面路径映射。 */
const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

/** 流程底栏主操作按钮的统一配置。 */
interface BottomButton {
  label: string
  variant: 'ghost' | 'primary' | 'text' | 'split'
  action: () => void
  disabled?: boolean
  /** 禁用时的悬停提示(说明为什么不可点) */
  tip?: string
  icon?: ReactNode
  /** 底栏对齐:重新生成靠左,其余靠右(默认右) */
  align?: 'left' | 'right'
  /** split 按钮:当前选中数量 */
  splitCount?: number
  /** split 按钮可选数量列表 */
  splitCountOptions?: number[]
  /** split 按钮:数量变更回调 */
  onSplitCountChange?: (n: number) => void
}

/** 移除主体标签开头的 @，得到用于跨镜头匹配的规范名称。 */
const stripAt = (t: string) =>
  String(t || '')
    .replace(/^@/, '')
    .trim()
/** 把多视频生成数量限制到界面支持的 1～10。 */
const normalizeVideoGenerateCount = (value: any) => Math.min(10, Math.max(1, Math.floor(Number(value || 1) || 1)))
/** 短暂错误后继续恢复同一视频任务的最长窗口。 */
const SMART_VIDEO_RECOVERY_MAX_MS = 70 * 60 * 1000
/** 草稿标记为处理中、但页面内已没有执行者时，留给恢复链接管的短暂宽限。 */
const SMART_STALE_VIDEO_STATE_GRACE_MS = 3000

/** 区分可继续轮询的网络/服务错误与不可重试的审核失败。 */
function isTransientVideoTaskRecoveryError(error: any): boolean {
  const status = Number(error?.status || 0)
  const code = String(error?.code || '').toUpperCase()
  const message = [error?.message, error?.response?.message, error?.response?.data?.message].filter(Boolean).join(' ')
  if (
    /安全审核|内容审核|内容安全|未通过.{0,8}审核|审核未通过|敏感内容|版权限制|copyright|content policy|policy violation|moderation|safety review/i.test(
      message,
    )
  ) {
    return false
  }
  return (
    code === 'TASK_MEDIA_PENDING' ||
    status >= 500 ||
    status === 429 ||
    error?.cause === 'timeout' ||
    /任务状态查询连续失败|任务生成超时|网络请求失败|网络请求超时|Failed to fetch|fetch failed/i.test(message)
  )
}

/** 兼容错误码和状态字段，判断服务商任务是否已取消或过期。 */
function isCancelledVideoTaskError(error: any): boolean {
  const code = String(error?.code || error?.response?.code || error?.response?.data?.code || '').toUpperCase()
  const status = String(error?.status || error?.response?.status || error?.response?.data?.status || '').toLowerCase()
  return code === 'TASK_CANCELLED' || status === 'cancelled' || status === 'expired'
}

/** 已拿到 taskId 后遇到短暂断网/5xx 时按退避策略恢复轮询，避免误判任务失败。 */
async function continueSmartVideoTaskAfterTransient(
  initialPromise: Promise<{ url: string; assetId: number }>,
  options: {
    workspaceId: number
    getTaskId: () => number
    onReconnect?: (taskId: number) => void
    onProgress?: (progress: number) => void
  },
): Promise<{ url: string; assetId: number }> {
  const startedAt = Date.now()
  let attempt = 0
  let currentPromise = initialPromise
  while (true) {
    try {
      return await currentPromise
    } catch (error: any) {
      const taskId = Number(options.getTaskId() || 0) || 0
      if (
        !taskId ||
        !isTransientVideoTaskRecoveryError(error) ||
        Date.now() - startedAt >= SMART_VIDEO_RECOVERY_MAX_MS
      ) {
        throw error
      }
      options.onReconnect?.(taskId)
      const delayMs = Math.min(8000, 1200 * Math.pow(2, Math.min(attempt, 3)))
      attempt += 1
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
      currentPromise = resumeFullVideo({
        workspaceId: options.workspaceId,
        taskId,
        onProgress: options.onProgress,
      })
    }
  }
}

// 准备素材:每个主体只出「单一独立元素」(供镜头编排时再组合),简洁背景、便于抠图合成。
// context = 广告主题 + 该元素出现的画面语境/用途,帮模型选对具体形态(如伞广告里的「地铁站」应是雨天出入口而非大厅)。
function subjectPrompt(name: string, kind: string, style?: string, context?: string) {
  const probe = name + kind
  const frame = /人物|角色|人|男|女|主角|闺蜜|宝妈|宝爸|学生|白领|model|girl|boy/i.test(probe)
    ? '只有一个人物,单人,全身或半身,正面清晰,纯色简洁背景,不要其他人物、不要文字'
    : /场景|街道|背景|环境|室内|室外|校园|店|路|空间|夜景|门口|广场/i.test(probe)
      ? '空场景/空镜,只有环境与背景,无任何人物、无产品,干净简洁'
      : '只有这一个物体,单个产品特写,白色/纯色背景,不要其他物体、不要文字'
  return [
    `只画「${name}」这一个元素`,
    frame,
    context && `需贴合以下广告语境与用途(据此选择最贴切的具体形态,但画面仍只含该单一元素):${context}`,
    style && `${style}视觉风格`,
    '高清,单一主体',
  ]
    .filter(Boolean)
    .join(',')
}

/** 兼容字符串和对象形式，把项目草稿安全解析为普通对象。 */
function parseDraftObject(draftJson: any): any | null {
  let obj = draftJson
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return null
    }
  }
  return obj && typeof obj === 'object' ? obj : null
}

/** 从顶层或 smart 块读取草稿所属创作流程。 */
function getDraftFlow(draftJson: any): string {
  const obj = parseDraftObject(draftJson)
  if (!obj) return ''
  return String(obj?.smart?.flow || obj?.flow || '').toLowerCase()
}

/** 判断项目草稿是否属于爆款复制，防止跨流程误加载。 */
function isHotCopyDraft(draftJson: any): boolean {
  return getDraftFlow(draftJson) === 'hot-copy'
}

/**
 * 兜底:从后端项目 draft_json 里抽取「整片视频」(最近一版 + 历史版本)。
 * 用于智能成片快照(obj.smart)里没有整片视频、但视频结果由后端写到了项目级字段
 * (generatedVideoUrl / videoHistoryList,常见于上次在「生成视频」中途切走、完成时组件已卸载)
 * 的场景——和项目管理页读取同一批字段,保证「生成视频」步骤能把视频加载出来。
 */
function extractProjectVideoFallback(
  draftJson: any,
  project?: any,
): {
  latest: SmartVideoVersion
  versions: SmartVideoVersion[]
} {
  const obj = parseDraftObject(draftJson)
  if (!obj || typeof obj !== 'object') return { latest: { url: '', assetId: 0 }, versions: [] }
  if (isHotCopyDraft(obj)) return { latest: { url: '', assetId: 0 }, versions: [] }
  const smart = obj.smart && typeof obj.smart === 'object' ? obj.smart : obj
  const vv = Array.isArray(smart?.videoVersions) ? smart.videoVersions : []
  const vh = Array.isArray(obj?.videoHistoryList || obj?.video_history_list)
    ? obj.videoHistoryList || obj.video_history_list
    : []
  const src = vv.length ? vv : vh
  const projectCreatedAt = String(
    project?.created_at || project?.createdAt || project?.data?.created_at || project?.data?.createdAt || '',
  ).trim()
  const versions: SmartVideoVersion[] = []
  for (const v of src) {
    const url = String((typeof v === 'string' ? v : v?.url || v?.src) || '').trim()
    const assetId = Number((typeof v === 'string' ? 0 : v?.assetId || v?.asset_id) || 0) || 0
    const createdAt = String((typeof v === 'string' ? '' : v?.created_at || v?.createdAt) || projectCreatedAt).trim()
    if (url || assetId) {
      versions.push({
        url,
        assetId,
        ...(createdAt ? { createdAt } : {}),
        id: stableDerivedVideoId(v, assetId, url, createdAt),
      })
    }
  }
  const gvUrl = String(obj?.generatedVideoUrl || obj?.generated_video_url || smart?.fullVideoUrl || '').trim()
  const gvId = Number(obj?.generatedVideoAssetId || obj?.generated_video_asset_id || smart?.fullVideoAssetId || 0) || 0
  if (!versions.length && (gvUrl || gvId)) {
    const projectId = Number(project?.id || project?.data?.id || 0) || 0
    versions.push({
      url: gvUrl,
      assetId: gvId,
      ...(projectCreatedAt ? { createdAt: projectCreatedAt } : {}),
      id: projectId ? `derived-generated-${projectId}` : stableDerivedVideoId({}, gvId, gvUrl, projectCreatedAt),
    })
  }
  const latest = versions.length ? versions[versions.length - 1] : { url: gvUrl, assetId: gvId }
  return { latest: { ...latest, url: latest.url || '', assetId: latest.assetId || 0 }, versions }
}

/** 仅接受智能成片草稿并返回实际状态块。 */
function extractSmartDraftBlock(draftJson: any): any | null {
  const obj = parseDraftObject(draftJson)
  if (!obj || typeof obj !== 'object') return null
  if (isHotCopyDraft(obj)) return null
  const smart = obj.smart && typeof obj.smart === 'object' ? obj.smart : obj
  return smart && typeof smart === 'object' ? smart : null
}

/** 把历史生成记录规范为可恢复的 id、状态、任务号和时间结构。 */
function normalizeVideoGenerationRecord(record: any): any | null {
  const id = String(record?.id || '').trim()
  const status = String(record?.status || '').toLowerCase()
  if (!id || status !== 'processing') return null
  const taskId = Number(record?.taskId ?? record?.task_id ?? 0) || 0
  const idempotencyKey = String(record?.idempotencyKey ?? record?.idempotency_key ?? '').trim()
  return {
    ...record,
    id,
    status: 'processing',
    taskId,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    running: Boolean(record?.running) && taskId > 0,
    note: String(record?.note || ''),
    modificationNote: String(record?.modificationNote || ''),
    error: String(record?.error || ''),
    createdAt: Number(record?.createdAt ?? record?.created_at ?? 0) || 0,
  }
}

/** 以后端终态优先合并页面与云端的生成记录。 */
function mergeVideoGenerationRecords(current: any, backend: any): any[] {
  const merged = new Map<string, any>()
  for (const source of [backend, current]) {
    for (const raw of Array.isArray(source) ? source : []) {
      const record = normalizeVideoGenerationRecord(raw)
      if (!record) continue
      const existing = merged.get(record.id)
      if (!existing) {
        merged.set(record.id, record)
        continue
      }
      const taskId = Number(record.taskId || existing.taskId || 0) || 0
      merged.set(record.id, {
        ...existing,
        ...record,
        taskId,
        running: Boolean(record.running || existing.running),
        createdAt: Number(record.createdAt || existing.createdAt || 0) || 0,
      })
    }
  }
  return Array.from(merged.values())
}

/** 合并多视频排队记录，并移除已经具有对应终态的过期队列项。 */
function mergeVideoGenQueues(current: any, backend: any, generations: any[]): any[] {
  const pendingIds = new Set(
    (Array.isArray(generations) ? generations : [])
      .filter((g) => String(g?.status || '') === 'processing' && !(Number(g?.taskId || 0) > 0))
      .map((g) => String(g.id || '').trim())
      .filter(Boolean),
  )
  if (!pendingIds.size) return []
  const seen = new Set<string>()
  const merged: any[] = []
  for (const source of [current, backend]) {
    for (const raw of Array.isArray(source) ? source : []) {
      const id = String(raw?.id || '').trim()
      if (!id || seen.has(id)) continue
      if (!pendingIds.has(id)) continue
      seen.add(id)
      const idempotencyKey = String(raw?.idempotencyKey ?? raw?.idempotency_key ?? '').trim()
      merged.push({ ...raw, id, ...(idempotencyKey ? { idempotencyKey } : {}) })
    }
  }
  return merged
}

/**
 * 后端草稿仍是项目内容的权威来源；本地草稿只补同一项目尚未完成的任务凭证。
 * 这样既不会把旧步骤/旧素材覆盖回后端，又能覆盖“切页时最后一次 PUT 还没完成”的短窗口。
 */
function mergeSmartInFlightRecovery(
  backendDraft: SmartDraft | null,
  localDraft: SmartDraft | null,
  projectId: number,
): SmartDraft | null {
  const localMatches = localDraft && localDraft.started && Number(localDraft.projectId || 0) === Number(projectId || 0)
  if (!backendDraft) return localMatches ? localDraft : null
  const recoveryDraft: SmartDraft = localMatches && localDraft ? localDraft : {}

  const backendGenerationsRaw = Array.isArray(backendDraft.videoGenerations) ? backendDraft.videoGenerations : []
  const localGenerationsRaw = Array.isArray(recoveryDraft.videoGenerations) ? recoveryDraft.videoGenerations : []
  const backendCompletedIds = mergeCompletedVideoGenerationIds(
    backendDraft.completedVideoGenerationIds,
    backendDraft.lastCompletedVideoGenerationId,
  )
  const localCompletedIds = mergeCompletedVideoGenerationIds(
    recoveryDraft.completedVideoGenerationIds,
    recoveryDraft.lastCompletedVideoGenerationId,
  )
  const completedGenerationIds = mergeCompletedVideoGenerationIds(localCompletedIds, backendCompletedIds)
  const completedGenerationIdSet = new Set(completedGenerationIds)
  const completedTaskIds = new Set(
    [...backendGenerationsRaw, ...localGenerationsRaw]
      .filter((generation: any) => completedGenerationIdSet.has(String(generation?.id || '').trim()))
      .map((generation: any) => Number(generation?.taskId || 0) || 0)
      .filter((taskId: number) => taskId > 0),
  )
  const backendGenerations = backendGenerationsRaw.filter(
    (generation: any) => !completedGenerationIdSet.has(String(generation?.id || '').trim()),
  )
  const localGenerations = localGenerationsRaw.filter(
    (generation: any) => !completedGenerationIdSet.has(String(generation?.id || '').trim()),
  )
  const localQueue = (Array.isArray(recoveryDraft.videoGenQueue) ? recoveryDraft.videoGenQueue : []).filter(
    (job: any) => !completedGenerationIdSet.has(String(job?.id || '').trim()),
  )
  const backendCompletedIdSet = new Set(backendCompletedIds)
  const hasLocalCompletionState = localCompletedIds.some((id) => !backendCompletedIdSet.has(id))
  const hasBackendCompletionResidue =
    backendGenerationsRaw.some((generation: any) =>
      completedGenerationIdSet.has(String(generation?.id || '').trim()),
    ) ||
    (Array.isArray(backendDraft.videoGenQueue) ? backendDraft.videoGenQueue : []).some((job: any) =>
      completedGenerationIdSet.has(String(job?.id || '').trim()),
    )
  const localImageMessages = Array.isArray(recoveryDraft.imageMessages) ? recoveryDraft.imageMessages : []
  const hasLocalImageRecovery = shouldMergeLocalImageRecovery(
    backendDraft,
    localMatches ? recoveryDraft : null,
    projectId,
  )
  const needsRecoveryMerge = Boolean(
    Number(recoveryDraft.vidGenTaskId || 0) > 0 ||
    localGenerations.some((g: any) => String(g?.status || '') === 'processing') ||
    localQueue.length > 0 ||
    recoveryDraft.materialBatchPending ||
    recoveryDraft.scriptPending ||
    recoveryDraft.scriptError ||
    hasLocalCompletionState ||
    hasBackendCompletionResidue ||
    hasLocalImageRecovery,
  )
  if (!needsRecoveryMerge) return backendDraft

  const mergedGenerations = mergeVideoGenerationRecords(localGenerations, backendGenerations)
  const mergedQueue = mergeVideoGenQueues(localQueue, backendDraft.videoGenQueue, mergedGenerations)
  const activeTaskId =
    [
      Number(backendDraft.vidGenTaskId || 0) || 0,
      Number(recoveryDraft.vidGenTaskId || 0) || 0,
      Number(mergedGenerations.find((g: any) => Number(g?.taskId || 0) > 0)?.taskId || 0) || 0,
    ].find((taskId) => taskId > 0 && !completedTaskIds.has(taskId)) || 0
  const hasVideoInFlight = activeTaskId > 0 || mergedGenerations.length > 0 || mergedQueue.length > 0
  return {
    ...backendDraft,
    vidGenTaskId: activeTaskId,
    videoGenerations: mergedGenerations,
    videoGenQueue: mergedQueue,
    completedVideoGenerationIds: completedGenerationIds,
    ...(backendDraft.lastCompletedVideoGenerationId || recoveryDraft.lastCompletedVideoGenerationId
      ? {
          lastCompletedVideoGenerationId:
            backendDraft.lastCompletedVideoGenerationId || recoveryDraft.lastCompletedVideoGenerationId,
        }
      : {}),
    pendingVideoSig: hasVideoInFlight ? backendDraft.pendingVideoSig || recoveryDraft.pendingVideoSig || '' : '',
    materialBatchPending: Boolean(backendDraft.materialBatchPending || recoveryDraft.materialBatchPending),
    scriptPending: Boolean(backendDraft.scriptPending || recoveryDraft.scriptPending),
    scriptError: String(backendDraft.scriptError || recoveryDraft.scriptError || ''),
    ...(hasLocalImageRecovery
      ? {
          imageMessages: mergeImageMessagesForRecovery(backendDraft.imageMessages, localImageMessages),
          ...(recoveryDraft.imageComposerDraft ? { imageComposerDraft: recoveryDraft.imageComposerDraft } : {}),
        }
      : {}),
  }
}

/** 保存前合并后端可能晚到的视频结果，避免自动保存覆盖成片历史。 */
function mergeSnapshotVideoHistory(
  snapshot: any,
  draftJson: any,
  options: { preserveUpstreamContent?: boolean } = {},
): any {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const smart = snapshot.smart && typeof snapshot.smart === 'object' ? snapshot.smart : null
  if (!smart) return snapshot
  const backendSmart = extractSmartDraftBlock(draftJson)
  const backend = extractProjectVideoFallback(draftJson)
  const currentVersions = Array.isArray(smart.videoVersions) ? smart.videoVersions : []
  const currentLatest = {
    url: String(smart.fullVideoUrl || snapshot.generatedVideoUrl || '').trim(),
    assetId: Number(smart.fullVideoAssetId || snapshot.generatedVideoAssetId || 0) || 0,
  }
  const mergedVersions = mergeVideoVersionLists(backend.versions, currentVersions, [currentLatest])
  const latest = mergedVersions.length ? mergedVersions[mergedVersions.length - 1] : backend.latest
  smart.videoVersions = mergedVersions
  smart.fullVideoUrl = latest?.url || smart.fullVideoUrl || ''
  smart.fullVideoAssetId = Number(latest?.assetId || smart.fullVideoAssetId || 0) || 0
  snapshot.generatedVideoUrl = smart.fullVideoUrl
  snapshot.generatedVideoAssetId = smart.fullVideoAssetId
  snapshot.videoHistoryList = mergedVersions
  if (backendSmart) {
    const currentShots = Array.isArray(smart.shots) ? smart.shots : []
    const backendShots = Array.isArray(backendSmart.shots) ? backendSmart.shots : []
    if (options.preserveUpstreamContent !== false && currentShots.length === 0 && backendShots.length > 0) {
      const backendSnapshot = parseDraftObject(draftJson)
      smart.shots = backendShots
      smart.started = Boolean(smart.started || backendSmart.started)
      smart.requirement = smart.requirement || backendSmart.requirement || ''
      smart.reqSummary = smart.reqSummary || backendSmart.reqSummary || ''
      smart.entryMeta = smart.entryMeta || backendSmart.entryMeta || null
      smart.maxReached = Math.max(Number(smart.maxReached || 0), Number(backendSmart.maxReached || 0))
      if (!smart.subjectAssets || !Object.keys(smart.subjectAssets).length) {
        smart.subjectAssets = backendSmart.subjectAssets || {}
      }
      if (!smart.fields || !Object.keys(smart.fields).length) smart.fields = backendSmart.fields || {}
      if (Array.isArray(backendSnapshot?.storyboardItems)) {
        snapshot.storyboardItems = backendSnapshot.storyboardItems
      }
      snapshot.description = snapshot.description || backendSnapshot?.description || smart.requirement || ''
      snapshot.reqSummary = snapshot.reqSummary || backendSnapshot?.reqSummary || smart.reqSummary || ''
      snapshot.selectedDuration = snapshot.selectedDuration || backendSnapshot?.selectedDuration || ''
      snapshot.selectedRatio = snapshot.selectedRatio || backendSnapshot?.selectedRatio || ''
      if (!Array.isArray(snapshot.selectedStyles) || !snapshot.selectedStyles.length) {
        snapshot.selectedStyles = Array.isArray(backendSnapshot?.selectedStyles) ? backendSnapshot.selectedStyles : []
      }
    }
    const currentGenerations = Array.isArray(smart.videoGenerations) ? smart.videoGenerations : []
    const backendGenerations = Array.isArray(backendSmart.videoGenerations) ? backendSmart.videoGenerations : []
    const completedGenerationIds = mergeCompletedVideoGenerationIds(
      smart.completedVideoGenerationIds,
      smart.lastCompletedVideoGenerationId,
      backendSmart.completedVideoGenerationIds,
      backendSmart.lastCompletedVideoGenerationId,
    )
    const completedGenerationIdSet = new Set(completedGenerationIds)
    const completedTaskIds = new Set(
      [...currentGenerations, ...backendGenerations]
        .filter((generation: any) => completedGenerationIdSet.has(String(generation?.id || '').trim()))
        .map((generation: any) => Number(generation?.taskId || 0) || 0)
        .filter((taskId: number) => taskId > 0),
    )
    const safeCurrentGenerations = currentGenerations.filter(
      (generation: any) => !completedGenerationIdSet.has(String(generation?.id || '').trim()),
    )
    const safeBackendGenerations = backendGenerations.filter(
      (generation: any) => !completedGenerationIdSet.has(String(generation?.id || '').trim()),
    )
    if (completedGenerationIds.length) smart.completedVideoGenerationIds = completedGenerationIds
    const completedGenerationId = String(
      backendSmart.lastCompletedVideoGenerationId || smart.lastCompletedVideoGenerationId || '',
    ).trim()
    if (completedGenerationId) smart.lastCompletedVideoGenerationId = completedGenerationId
    const currentTaskId = Number(smart.vidGenTaskId || 0) || 0
    if (currentTaskId > 0 && completedTaskIds.has(currentTaskId)) smart.pendingVideoSig = ''
    smart.lastVideoSig = backendSmart.lastVideoSig || smart.lastVideoSig || ''
    const mergedGenerations = mergeVideoGenerationRecords(safeCurrentGenerations, safeBackendGenerations)
    smart.videoGenerations = mergedGenerations
    smart.videoGenQueue = mergeVideoGenQueues(smart.videoGenQueue, backendSmart.videoGenQueue, mergedGenerations)
    const backendTaskId = Number(backendSmart.vidGenTaskId || 0) || 0
    const activeOwner = resolveSmartActiveTask(mergedGenerations, backendTaskId)
    smart.vidGenTaskId = activeOwner.generationId
      ? activeOwner.taskId
      : (!completedTaskIds.has(backendTaskId) ? backendTaskId : 0) ||
        (!completedTaskIds.has(currentTaskId) ? currentTaskId : 0)
    if (
      Number(smart.vidGenTaskId || 0) > 0 &&
      Number(smart.vidGenTaskId || 0) === backendTaskId &&
      backendSmart.pendingVideoSig
    ) {
      smart.pendingVideoSig = backendSmart.pendingVideoSig
    }
    const hasVideoInFlight =
      Number(smart.vidGenTaskId || 0) > 0 || mergedGenerations.length > 0 || smart.videoGenQueue.length > 0
    if (!hasVideoInFlight) smart.pendingVideoSig = ''
    else if (!smart.pendingVideoSig && backendSmart.pendingVideoSig)
      smart.pendingVideoSig = backendSmart.pendingVideoSig
  }
  return snapshot
}

/** 增删分镜后按当前顺序重新生成“镜头 N”编号。 */
const renumberShots = (list: Shot[]): Shot[] => list.map((s, i) => ({ ...s, no: `镜头${i + 1}` }))
/** 同一毫秒内新增多个手动分镜时使用的递增后缀。 */
let manualShotUid = 0
/** 为本地手动新增分镜生成当前会话内唯一 id。 */
const newManualShotId = () => `manual_${Date.now().toString(36)}_${manualShotUid++}`
/** 分镜回收站 localStorage 键前缀。 */
const SHOT_TRASH_STORAGE_PREFIX = 'smart_shot_trash'

/** 生成按工作空间和项目隔离的分镜回收站缓存键。 */
function getShotTrashStorageKey(workspaceId: number, projectId: number) {
  const ws = Math.floor(Number(workspaceId) || 0)
  const pid = Math.floor(Number(projectId) || 0)
  if (ws <= 0 || pid <= 0) return ''
  return `${SHOT_TRASH_STORAGE_PREFIX}:${ws}:${pid}`
}

/** 从本地缓存恢复当前项目的已删分镜。 */
function loadShotTrashFromStorage(workspaceId: number, projectId: number): ShotTrashItem[] {
  if (typeof window === 'undefined') return []
  const key = getShotTrashStorageKey(workspaceId, projectId)
  if (!key) return []
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => normalizeShotTrashItem(item)).filter(Boolean) as ShotTrashItem[]
  } catch {
    return []
  }
}

/** 持久化当前项目分镜回收站；空列表时直接清除缓存。 */
function saveShotTrashToStorage(workspaceId: number, projectId: number, items: ShotTrashItem[]) {
  if (typeof window === 'undefined') return
  const key = getShotTrashStorageKey(workspaceId, projectId)
  if (!key) return
  try {
    if (!items.length) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(key, JSON.stringify(items))
  } catch {}
}

/** 把删除时间转换为回收站显示文本。 */
function toTrashTimeText(value: any): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number) => String(n).padStart(2, '0')
  return `删除于 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 兼容历史回收站结构并补齐分镜快照、索引和删除时间。 */
function normalizeShotTrashItem(raw: any, fallbackShot?: Shot, fallbackIndex?: number): ShotTrashItem | null {
  const shot = (raw?.shot ||
    raw?.snapshot?.shot ||
    raw?.payload?.shot ||
    raw?.content?.shot ||
    raw?.data?.shot ||
    fallbackShot ||
    null) as Shot | null
  const id = raw?.id ?? raw?.trash_id ?? raw?.trashId ?? raw?.data?.id ?? raw?.item?.id
  const title =
    String(raw?.title || raw?.name || shot?.no || shot?.title || raw?.meta?.shot_no || raw?.shot_no || '').trim() ||
    '未命名分镜'
  const duration =
    String(raw?.duration || shot?.duration || raw?.meta?.duration || raw?.snapshot?.duration || '').trim() || '5s'
  const thumb = String(
    raw?.thumbnail_url ||
      raw?.thumbnailUrl ||
      raw?.thumb ||
      shot?.image ||
      raw?.shot?.image ||
      raw?.snapshot?.thumbnail_url ||
      '',
  ).trim()
  const detail = String(
    raw?.detail || raw?.desc || shot?.desc || raw?.content?.desc || raw?.snapshot?.desc || '',
  ).trim()
  const deletedAt = toTrashTimeText(
    raw?.deleted_at || raw?.deletedAt || raw?.created_at || raw?.createdAt || new Date(),
  )
  const originalIndex = Number(
    raw?.original_index ??
      raw?.originalIndex ??
      raw?.meta?.original_index ??
      raw?.snapshot?.original_index ??
      fallbackIndex,
  )
  if (id == null && !shot) return null
  return {
    id: id ?? `local_${shot?.id ?? Date.now()}`,
    title,
    duration,
    thumb,
    detail,
    deletedAt,
    originalIndex: Number.isFinite(originalIndex) ? originalIndex : undefined,
    shot,
    canRestore: raw?.can_restore ?? raw?.canRestore ?? true,
  }
}

// true=每次进智能成片入口页都弹引导(仅本地调试用);false=仅支付成功(armSmartGuide)后进入口页触发一次。
const GUIDE_TESTING = false

/** 路由包装传入的会话令牌，用于隔离重挂载前后的异步回调。 */
interface SmartCreateViewProps {
  routeSessionToken?: string
}

/** 编排智能成片完整流程并负责草稿、任务、权限和结果恢复。 */
export default function SmartCreateView({ routeSessionToken = '' }: SmartCreateViewProps) {
  const navigate = useNavigate()
  const { id: routeId } = useParams()
  const location = useLocation()
  const requestedProjectVideoSelection: RequestedProjectVideoSelection | null = readRequestedProjectVideoSelection(
    location.search,
    location.state,
  )
  const explicitFreshEntrySession = Boolean(
    (location.state as any)?.taskCenterNewSession ||
    (location.state as any)?.workspaceSwitchReset ||
    Number((location.state as any)?.restartProjectId || 0) > 0,
  )
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const memberCenterOpen = useUiStore((state) => state.memberCenterOpen)
  const currentUser = useCurrentUser() as any
  const currentUserId = resolveUserId(currentUser)
  const requireAuth = useRequireAuth()
  const { isCheckingSession } = useAuth()
  const globalWorkspaceId = useWorkspaceId()
  // 打开项目「钉住」的所属空间(0=空白入口/无项目)。切换全局空间时,已打开的项目仍走它自己的空间
  // (保存 / 计费 / 素材加载),避免被全局切换重置。见 loadProjectById / startCreation 处的写入。
  const [projectWorkspaceId, setProjectWorkspaceId] = useState(0)
  // 有效空间:项目优先,否则用全局活跃空间。下游所有 Number(workspaceId||0) 用法均走此值。
  const workspaceId = projectWorkspaceId || globalWorkspaceId
  const workspaceIdRef = useRef(0)
  workspaceIdRef.current = workspaceId
  const pinProjectWorkspaceId = (value: number) => {
    const next = Number(value || 0) || 0
    workspaceIdRef.current = next || globalWorkspaceId
    setProjectWorkspaceId(next)
  }
  // 项目钉在与全局活跃空间【不同】的空间时,取其空间名用于在项目名旁提示(说明本项目保存/计费走该空间)。
  // 通过稳定 selector 订阅；未登录/会话冷启动时 deriveAllWorkspaces 的空数组回退不能直接作为快照，
  // 否则 Zustand 5 会把每次新数组视为新状态并触发无限重渲染。
  const allWorkspaces = useAllWorkspaces()
  const pinnedWsName =
    projectWorkspaceId && projectWorkspaceId !== globalWorkspaceId
      ? String((allWorkspaces as any[]).find((w) => Number(w?.id || 0) === projectWorkspaceId)?.name || '').trim()
      : ''
  const modelPlanCandidates = useModelPlanCandidates() as string[]
  const ensureModelPlanCandidatesLoaded = useWorkspaceSessionStore((s) => s.ensureModelPlanCandidatesLoaded)

  const guideActiveKey = useGuideStore((s) => s.activeKey)

  // 生成前确保工作空间真实套餐候选已加载,并读最新值(否则只有默认候选,列不到付费套餐模型)。
  // 与 2.0 useVideoGeneration 一致:先 ensure,再用 getState 读最新,避免闭包拿到旧的 modelPlanCandidates。
  const resolvePlanCandidates = async (): Promise<string[]> => {
    try {
      await ensureModelPlanCandidatesLoaded()
    } catch {
      /* 加载失败则退回当前已有候选 */
    }
    return (deriveModelPlanCandidates(useWorkspaceSessionStore.getState()) as string[]) || modelPlanCandidates
  }

  const [started, setStarted] = useState(false) // false=入口输入页, true=进入 4 步流程
  const [videoCount, setVideoCount] = useState(1) // 生成视频数量(1-10)
  const initialVideoGenerateCountRef = useRef(1)
  const [pendingVideoFocusToken, setPendingVideoFocusToken] = useState(0)
  const [splitOpen, setSplitOpen] = useState(false) // split 按钮下拉开关
  const [entryKey, setEntryKey] = useState(0) // 「制作新视频」自增 → 重挂载入口页,清空其内部输入状态
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [entryMeta, setEntryMeta] = useState<EntryMeta | null>(null)

  // ── 制作图片(chat 形式):消息流。image 模式不走分镜/视频 4 步,改为对话出图 ──
  const [imageMessages, setImageMessages] = useState<ChatMessage[]>([])
  const imageMessagesRef = useRef<ChatMessage[]>([])
  imageMessagesRef.current = imageMessages
  const msgIdRef = useRef(0)
  const nextMsgId = () => `m${++msgIdRef.current}-${Date.now()}`
  const imgMsgHydratedRef = useRef(false)
  const imageGenerationLockRef = useRef(false)
  // 新批次的恢复描述符写入云端前，禁止 useEffect/手动调度创建任何付费任务。
  const imageQueueCheckpointBlockedRef = useRef(false)
  const [imagePreparing, setImagePreparing] = useState(false)
  const [imageComposerRefCount, setImageComposerRefCount] = useState(0)
  const [imageComposerRatio, setImageComposerRatio] = useState('16:9')
  const [imageComposerOutputCount, setImageComposerOutputCount] = useState(1)
  const [imageComposerDraft, setImageComposerDraft] = useState<ImageComposerDraft>({
    text: '',
    ratio: '16:9',
    images: [],
    outputCount: 1,
  })
  const handleImageComposerRatioChange = useCallback((ratio: string) => {
    const nextRatio = ratio || '16:9'
    setImageComposerRatio(nextRatio)
    setImageComposerDraft((previous) => (previous.ratio === nextRatio ? previous : { ...previous, ratio: nextRatio }))
    setEntryMeta((previous) =>
      previous?.mode === 'image' && previous.ratio !== nextRatio ? { ...previous, ratio: nextRatio } : previous,
    )
  }, [])
  const handleImageComposerOutputCountChange = useCallback((value: number) => {
    const nextCount = Math.min(9, Math.max(1, Math.floor(Number(value) || 1)))
    setImageComposerOutputCount(nextCount)
    setImageComposerDraft((previous) =>
      previous.outputCount === nextCount ? previous : { ...previous, outputCount: nextCount },
    )
    setEntryMeta((previous) =>
      previous?.mode === 'image' && previous.outputCount !== nextCount
        ? { ...previous, outputCount: nextCount }
        : previous,
    )
  }, [])
  // 是否处于「制作图片」对话模式;有一轮正在出图(禁用发送)
  const isImageMode = entryMeta?.mode === 'image'
  const imageBusy = imagePreparing || imageMessages.some((m) => m.role === 'assistant' && m.status === 'pending')
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [durGuard, setDurGuard] = useState<{
    open: boolean
    currentSec: number
    expectedSec: number
    overMax: boolean
  }>({ open: false, currentSec: 0, expectedSec: 0, overMax: false })
  const durGuardProceedRef = useRef<null | (() => void)>(null)
  const [projectName, setProjectName] = useState('未命名项目')
  // AI 命名与新项目创建/路由加载并行。ref 记录同步意义上的最新名称，避免刚创建项目返回的
  // “未命名创意”通过异步旧闭包覆盖已经生成好的 AI 名称。
  const projectNameRef = useRef('未命名项目')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameTouched, setNameTouched] = useState(false) // 用户手动改过名后不再自动覆盖
  const nameTouchedRef = useRef(false)
  const [naming, setNaming] = useState(false)
  // 从「项目管理 → 新建视频」携带过来的、该项目上传过的素材图(预填入口)。
  // 关键:必须在【首帧】就就绪(SmartEntry 的 images 只在挂载时从 initial.images 初始化一次),
  // 所以用 useState 初始化器同步读 location.state,而不是挂载后再 setState(那样太晚,入口已用空数组初始化)。
  const [carriedEntry] = useState<{
    mode?: 'video' | 'image'
    text: string
    ratio?: string
    images: string[]
    imageAssetIds: number[]
  }>(() => {
    const st = (location.state as any) || {}
    const items = (Array.isArray(st.carryImages) ? st.carryImages : [])
      .map((item: any) => ({
        url: String(typeof item === 'string' ? item : item?.url || '').trim(),
        assetId: Math.max(0, Math.floor(Number(typeof item === 'string' ? 0 : (item?.assetId ?? item?.asset_id)) || 0)),
      }))
      .filter((item: ChatImg) => item.url || Number(item.assetId || 0) > 0)
    return {
      mode: st.carryMode === 'image' ? 'image' : items.length || st.carryMode === 'video' ? 'video' : undefined,
      text: String(st.carryText || ''),
      ratio: typeof st.carryRatio === 'string' ? st.carryRatio : undefined,
      images: items.map((item: ChatImg) => item.url),
      imageAssetIds: items.map((item: ChatImg) => Number(item.assetId || 0) || 0),
    }
  })
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  // 第一步:用户输入的创作需求(后续用于生成分镜脚本 + 自动命名项目)
  const [requirement, setRequirement] = useState('')
  const [reqSummary, setReqSummary] = useState('') // ≤100字核心摘要,仅用于生成(basePrompt/大纲),不再展示
  const nameAbortRef = useRef<AbortController | null>(null)
  const autoNameResumeKeyRef = useRef('')
  projectNameRef.current = projectName
  nameTouchedRef.current = nameTouched

  // ── 营销思路拆解(选中 SKILL 时,在分镜脚本前多出的第 1 步)──
  // marketingOpen=停留在该步;marketingText=skill 拆解出的营销建议(只读展示);确认后才进入分镜脚本流程。
  const [marketingOpen, setMarketingOpen] = useState(false)

  // 智能成片引导:任一支付成功后「装填」(armSmartGuide),进入口页(输入框可见)时【本次挂载只触发一次】,随后跟随流程。
  // 关键:openGuide 只在首次到达入口时调一次;从流程「上一步」退回入口(started 由 true→false,本效果 deps 含 started 会再跑)
  // 时【不能】再调 —— 否则 startGuide 会重置 shownStages/waiting/stageKey,把 syncSmartStage 刚同步出的 reentry 引导冲掉
  //(表现为:返回上一页后引导闪一下就没、或根本不出来)。退回入口的引导交由下方 syncSmartStage 跟随流程展示。
  const smartGuideOpenedRef = useRef(false)
  useEffect(() => {
    if (isCheckingSession || started || (!GUIDE_TESTING && !isSmartGuideArmed())) return
    if (smartGuideOpenedRef.current) return // 本次挂载已开过:退回入口交给 syncSmartStage,勿重置
    const t = window.setTimeout(() => {
      if (document.querySelector('[data-guide="smart-input"]')) {
        smartGuideOpenedRef.current = true
        if (!GUIDE_TESTING) disarmSmartGuide()
        openGuide('smart')
      }
    }, 700)
    return () => window.clearTimeout(t)
  }, [isCheckingSession, started])

  const [marketingText, setMarketingText] = useState('')
  // 结构化拆解(8 维度 desc+tags)→ 表格展示;marketingText 由它派生,供脚本生成/持久化/续接判断复用
  const [marketingData, setMarketingData] = useState<MarketingBreakdownData | null>(null)
  const [marketingTagBusy, setMarketingTagBusy] = useState<Partial<Record<MarketingFieldKey, boolean>>>({})
  const [marketingLoading, setMarketingLoading] = useState(false)
  const [marketingError, setMarketingError] = useState('')

  // 分镜脚本(后端 /ai/responses 生成)
  const [shots, setShots] = useState<Shot[]>([])
  const shotsRef = useRef<Shot[]>([])
  // 只有用户明确删空分镜时才允许把后端已有分镜保存为空；加载竞态/脚本重生成的短暂空态不算删除意图。
  const shotsExplicitlyClearedRef = useRef(false)
  const [shotTrashItems, setShotTrashItems] = useState<ShotTrashItem[]>([])
  const [shotTrashLoading, setShotTrashLoading] = useState(false)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [scriptError, setScriptError] = useState('')
  const [scriptPending, setScriptPending] = useState(false) // 脚本生成进行中(持久化):切走再回来据此自动续跑
  const scriptResumeRef = useRef(false) // 续跑只触发一次,避免循环
  const scriptRunningRef = useRef(false) // 脚本生成重入守卫(state 异步,连点/续跑叠加会并发两条流式生成 → 交错覆盖)
  // 分镜脚本页点击加号后，只生成这一条分镜词；独立于整条脚本/分镜图生成状态。
  const [insertTextGeneratingId, setInsertTextGeneratingId] = useState<Shot['id'] | null>(null)
  const insertTextRequestRef = useRef<{
    shotId: Shot['id']
    runId: number
    controller: AbortController
  } | null>(null)
  const insertTextRunSeqRef = useRef(0)
  const insertTextGenerating = insertTextGeneratingId !== null
  const cancelInsertTextGeneration = (shotId?: Shot['id']) => {
    const active = insertTextRequestRef.current
    if (!active || (shotId !== undefined && active.shotId !== shotId)) return
    active.controller.abort()
    insertTextRequestRef.current = null
    setInsertTextGeneratingId((current) => (current === active.shotId ? null : current))
  }
  const [projectId, setProjectId] = useState(0)
  const projectIdRef = useRef(0)
  const projectCreationAttemptRef = useRef(0)
  const creationStartingRef = useRef(false)
  const pendingCreatedProjectRef = useRef<{ workspaceId: number; projectId: number } | null>(null)
  useEffect(
    () => () => {
      projectCreationAttemptRef.current += 1
    },
    [],
  )
  const shotTrashHydratedKeyRef = useRef('')
  // 项目刚创建绑定后,需要「立即落盘一版草稿」的一次性标记。真正落盘由下方 effect 在
  // started/entryMeta/需求 等状态落定后执行(不能在 createCreativeProject().then 里直接存,
  // 那个闭包捕获的是创建前的旧 state → 会存成空草稿)。
  const pendingInitialSaveRef = useRef(false)
  // 按 /smart/:id 加载项目失败时的错误态(无权访问 / 项目不存在 / 服务器错误等)。
  // 非空时渲染明确的错误页 + 重试,避免静默回落到「新建视频」入口误导用户。
  const [projectLoading, setProjectLoading] = useState(() => Number(routeId || 0) > 0)
  const [loadError, setLoadError] = useState('')
  const [loadRetrying, setLoadRetrying] = useState(false)
  // 后端当前的项目标题(对齐 Vue serverProjectTitle):用于判断是否需要回写、避免覆盖已有真实标题
  const serverTitleRef = useRef('')
  // 历史 AI 标题不符合当前流程/时长时，允许一次本地安全修复覆盖旧服务端标题；不触发新的 AI 请求。
  const pendingAutoTitleCorrectionRef = useRef('')
  const pendingTitleSaveRef = useRef('')
  const titleSaveFailedRef = useRef(false)
  const draftRevisionRef = useRef(0) // 后端草稿版本号(乐观并发)
  // 项目「视频清单」存档(待分类归类记录,随草稿存云端,见 api/projectVideos)。本编辑器不维护它,
  // 但保存草稿会整盘重建 draft_json,故加载时原样存下、保存时原样写回,避免把它覆盖丢失。
  const projectVideoStoreRef = useRef<any>(null)
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>('idle')
  const draftSaveStatusRef = useRef<DraftSaveStatus>('idle')
  const draftSaveSequenceRef = useRef(0)
  const lastSavedDraftFingerprintRef = useRef('')
  const baseDraftContentFingerprintRef = useRef('')
  const draftContentConflictNotifiedRef = useRef(false)
  const queuedDraftSaveRef = useRef<{
    projectId: number
    workspaceId: number
    fingerprint: string
    contentFingerprint: string
    promise: Promise<DraftWriteResult>
  } | null>(null)
  // 新项目和“项目管理 → 新建视频”允许首次整版替换；授权绑定到精确项目并在首次成功写入后失效。
  // 普通保存绝不能再用“baseline 为空”隐式获得覆盖权限。
  const allowCreativeReplaceProjectIdRef = useRef(0)
  const blockRestrictedProjectRef = useRef<(project: any, projectId: number, workspaceId: number) => boolean>(
    () => false,
  )
  const viewAliveRef = useRef(true)
  useEffect(() => {
    viewAliveRef.current = true
    return () => {
      viewAliveRef.current = false
    }
  }, [])
  const updateDraftSaveStatus = useCallback((nextStatus: DraftSaveStatus): boolean => {
    // 内容冲突只能由重新加载项目、显式新建/重启或一次明确成功的冲突解决流程清除。
    // 标题 PATCH、旧请求失败或普通自动保存的晚到回调都不能把它降级成 error/saved。
    if (draftSaveStatusRef.current === 'conflict' && nextStatus !== 'conflict') return false
    draftSaveStatusRef.current = nextStatus
    if (viewAliveRef.current) setDraftSaveStatus(nextStatus)
    return true
  }, [])
  useEffect(() => {
    draftSaveStatusRef.current = 'idle'
    setDraftSaveStatus('idle')
    lastSavedDraftFingerprintRef.current = ''
    baseDraftContentFingerprintRef.current = ''
    draftContentConflictNotifiedRef.current = false
    queuedDraftSaveRef.current = null
    pendingTitleSaveRef.current = ''
    pendingAutoTitleCorrectionRef.current = ''
    titleSaveFailedRef.current = false
    draftSaveSequenceRef.current += 1
    const nextRouteId = Number(routeId || 0)
    if (allowCreativeReplaceProjectIdRef.current && allowCreativeReplaceProjectIdRef.current !== nextRouteId) {
      allowCreativeReplaceProjectIdRef.current = 0
    }
  }, [routeId])
  useEffect(() => {
    // 同一组件切换到另一个项目时，旧项目的单镜 AI 响应不能回填到新项目。
    const active = insertTextRequestRef.current
    if (active) {
      active.controller.abort()
      insertTextRequestRef.current = null
      setInsertTextGeneratingId(null)
    }
    nameAbortRef.current?.abort()
    nameAbortRef.current = null
    autoNameResumeKeyRef.current = ''
    setNaming(false)
    return () => {
      insertTextRequestRef.current?.controller.abort()
      nameAbortRef.current?.abort()
    }
  }, [routeId])
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const pid = Number(projectId || 0)
    const key = getShotTrashStorageKey(ws, pid)
    shotTrashHydratedKeyRef.current = key
    if (!key) {
      setShotTrashItems([])
      return
    }
    setShotTrashItems(loadShotTrashFromStorage(ws, pid))
  }, [workspaceId, projectId])

  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const pid = Number(projectId || 0)
    const key = getShotTrashStorageKey(ws, pid)
    if (!key || shotTrashHydratedKeyRef.current !== key) return
    saveShotTrashToStorage(ws, pid, shotTrashItems)
  }, [workspaceId, projectId, shotTrashItems])

  // 从「项目管理 → 新建视频」进入:沿用原项目名 + 携带上传素材 + 绑定到同一项目(归同一项目,不新建重复项目)。
  // 全程「全新流程」:不恢复旧的已生成草稿,只把上传素材预填入口;生成后保存到同一 projectId(覆盖其草稿)。
  useEffect(() => {
    const st = location.state as any
    if (!st) return
    if (typeof st.newProjectName === 'string' && st.newProjectName.trim()) {
      projectNameRef.current = st.newProjectName.trim()
      setProjectName(projectNameRef.current)
      nameTouchedRef.current = true
      setNameTouched(true)
    }
    // carriedEntry 已在 useState 初始化器同步读入(见上),此处不再 setState
    if (Number(st.restartProjectId)) {
      const restartProjectId = Number(st.restartProjectId)
      allowCreativeReplaceProjectIdRef.current = restartProjectId
      projectIdRef.current = restartProjectId
      setProjectId(restartProjectId)
      serverTitleRef.current = '' // 让沿用的项目名回写;draftRevisionRef 保持 0 → 首次保存自动拉取(防 409)
    }
    // 仅 mount 时注入一次([] 依赖),无需清 location.state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // split 按钮下拉:点击外部关闭
  useEffect(() => {
    if (!splitOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (target?.closest?.('.smart__btn-split--dropdown')) return
      if (target?.closest?.('.smart__btn-split--count')) return
      setSplitOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [splitOpen])

  // ── 主体素材统一管理:同名主体(@闺蜜A)共享素材,选定后所有同名处联动 ──
  // 版本/提示词存 registry;选定的图写回所有同名 subject(供表格 + 镜头编排一致展示)
  // 版本图 url + 其 asset_id(ids[url]=assetId,用于刷新签名URL/持久化,见 hydrate)
  const [subjectAssets, setSubjectAssets] = useState<
    Record<
      string,
      { versions: string[]; prompt?: string; sources?: Record<string, 'ai' | 'upload'>; ids?: Record<string, number> }
    >
  >({})
  const [subjectDlg, setSubjectDlg] = useState<{ open: boolean; name: string; kind: string; autoGen: boolean }>({
    open: false,
    name: '',
    kind: '',
    autoGen: false,
  })
  // 已选参考图(主推产品锚定的上传素材)的展示 URL 列表:打开弹窗时按 refAssetIds 解析(草稿恢复后也能显示多张)
  const [anchorRefs, setAnchorRefs] = useState<string[]>([])
  // 准备素材「一键生成」:逐个主体生成时的 loading(键=主体名),以及整体批量进行中标记
  const [subjectGenerating, setSubjectGenerating] = useState<Record<string, boolean>>({})
  const [batchGenning, setBatchGenning] = useState(false)
  // 「一键生成」是否在进行中(持久化进草稿):切到别的页面再回来,据此【自动续作】还没出图的素材,不被截断
  const [materialBatchPending, setMaterialBatchPending] = useState(false)
  const batchRunningRef = useRef(false)
  // 从分镜脚本返回后点「确认脚本」触发的这次素材重生,要求整批走全新生成:
  // 不复用 subjectAssets 版本库,也不自动带入入口上传图。
  const forceFreshMaterialsRef = useRef(false)
  // 把某元素的选定图(url+assetId)写回所有同名 subject
  const applySubjectImage = (name: string, url: string, assetId = 0) =>
    setShots((prev) =>
      prev.map((sh) => ({
        ...sh,
        subjects: sh.subjects.map((su) => (stripAt(su.tag) === name ? { ...su, image: url, assetId } : su)),
      })),
    )
  // 准备素材:去掉某主体当前应用的图 → 回到占位「上传图片」,可重新生成 / 上传。
  // 必须同时清掉版本库该条,否则「同名素材图同步」effect 会用版本库里的图把它又补回来(× 看似无效)。
  const removeSubjectImage = (name: string) => {
    applySubjectImage(name, '', 0)
    setSubjectAssets((a) => {
      if (!a[name]) return a
      const next = { ...a }
      delete next[name]
      return next
    })
  }
  // 清空当前流程里所有主体的已生成/已选素材,让下一次批量生成从全新状态开始,不复用旧结果。
  const clearAllSubjectMaterials = () => {
    setShots((prev) =>
      prev.map((sh) => ({
        ...sh,
        subjects: sh.subjects.map((su) => ({ ...su, image: '', assetId: 0 })),
      })),
    )
    setSubjectAssets({})
  }
  // 清空镜头编排阶段产物,保留脚本/素材选择本身,让「生成分镜」按当前内容整页全新重生成。
  const resetShotArrangementOutputs = (list: Shot[]) =>
    (Array.isArray(list) ? list : []).map((sh) => ({
      ...sh,
      image: '',
      imageAssetId: 0,
      imagePrompt: '',
      imageVersions: [],
      blurredImageUrl: '',
      blurredImageAssetId: 0,
      blurredFromAssetId: 0,
    }))
  // 把生成/上传的图落库(dataURL→后端 asset,得签名URL+assetId),写入版本库 + 同名联动
  const addSubjectVersion = (name: string, url: string, assetId: number, source: 'ai' | 'upload', prompt?: string) => {
    setSubjectAssets((a) => {
      const e = a[name] || { versions: [] }
      return {
        ...a,
        [name]: {
          versions: [...e.versions, url],
          prompt: prompt ?? e.prompt,
          sources: { ...(e.sources || {}), [url]: source },
          ids: { ...(e.ids || {}), [url]: assetId },
        },
      }
    })
    applySubjectImage(name, url, assetId)
  }
  // 弹窗内上传素材:File → 后端 asset → 加为该主体新版本(并应用到同名主体)
  const uploadForSubject = async (name: string, file: File) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法上传素材', 'error')
      return
    }
    try {
      const out: any = await uploadAssetFile({ workspaceId: ws, file })
      const assetId = Number(out?.asset?.id || 0) || 0
      if (!assetId) throw new Error('未取得素材 asset_id')
      const url = (await getAssetDownloadUrl({ workspaceId: ws, assetId }).catch(() => '')) || ''
      if (!url) throw new Error('未取得素材地址')
      addSubjectVersion(name, url, assetId, 'upload')
    } catch (e: any) {
      showToast(`素材上传失败:${e?.message || '请检查存储配置/网络'}`, 'error')
    }
  }
  const subjectKindOf = (name: string) => {
    for (const sh of shots) for (const su of sh.subjects) if (stripAt(su.tag) === name && su.kind) return su.kind
    return ''
  }
  const subjectImageOf = (name: string) => {
    for (const sh of shots) for (const su of sh.subjects) if (stripAt(su.tag) === name && su.image) return su.image
    return ''
  }
  // 主体锚定的上传素材(主推产品):有则该主体生成时走「图生图保真」(从上传素材抠成干净单品)。
  // 多图归同一产品时返回全部 assetIds(都作图生图参考),url 取第一张供展示/VL 优化提示词。
  const subjectRefOf = (name: string): { url?: string; assetId?: number; assetIds?: number[] } => {
    for (const sh of shots)
      for (const su of sh.subjects)
        if (stripAt(su.tag) === name && (su.refImage || su.refAssetId || su.refAssetIds?.length))
          return {
            url: su.refImage,
            assetId: Number(su.refAssetId || 0) || undefined,
            assetIds: su.refAssetIds?.length ? su.refAssetIds : su.refAssetId ? [su.refAssetId] : undefined,
          }
    return {}
  }
  // 注入的主推产品(VL 没匹配上时):须用户手动生成,排除出「AI一键生成」批量。
  const subjectManualOf = (name: string): boolean => {
    for (const sh of shots) for (const su of sh.subjects) if (stripAt(su.tag) === name && su.manualGen) return true
    return false
  }
  // 打开素材弹窗时:把该主体锚定的多张上传素材按 refAssetIds 解析出展示 URL(草稿恢复后 refImage 被剥离,靠 assetId 取回)。
  useEffect(() => {
    if (!subjectDlg.open) {
      setAnchorRefs([])
      return
    }
    const ref = subjectRefOf(subjectDlg.name)
    const ids = ref.assetIds && ref.assetIds.length ? ref.assetIds : ref.assetId ? [ref.assetId] : []
    const ws = Number(workspaceId || 0)
    if (!ids.length || !ws) {
      setAnchorRefs(ref.url ? [ref.url] : [])
      return
    }
    let alive = true
    void (async () => {
      const urls = (await Promise.all(ids.map((id) => refreshAssetUrl(ws, id).catch(() => '')))).filter(Boolean)
      if (alive) setAnchorRefs(urls.length ? urls : ref.url ? [ref.url] : [])
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectDlg.open, subjectDlg.name, workspaceId])
  // 横屏/竖屏适配:把项目比例(如 9:16 / 16:9)写成全局 CSS 变量 --frame-ratio,
  // 各处分镜图/视频预览/缩略图据它设 aspect-ratio(默认 16/9)。卸载时清理。
  useEffect(() => {
    const r = String(entryMeta?.ratio || '16:9').replace(':', ' / ')
    document.documentElement.style.setProperty('--frame-ratio', r)
    return () => {
      document.documentElement.style.removeProperty('--frame-ratio')
    }
  }, [entryMeta?.ratio])
  // 素材出图:
  //  - carryCurrent=true(修改):带上当前这张图作 img2img 底图,在其基础上改;
  //  - carryCurrent=false(重新生成):不带当前图,从头生成;
  //  - refImageUrl(参考图,产品真实照片):VL 读图优化提示词 + 作图生图参考(保证用你的产品)。
  const genForSubject = async (
    name: string,
    prompt: string,
    opts: { refImageUrls?: string[]; carryCurrent?: boolean; notify?: boolean } = {},
  ): Promise<boolean> => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      if (opts.notify !== false) showToast('未选择工作空间,无法生成素材', 'error')
      return false
    }
    try {
      const plans = await resolvePlanCandidates()
      let finalPrompt = prompt
      const refAssetIds: number[] = []
      const cache: Record<string, number> = {}
      // 参考图:显式传入(弹窗手动加)优先;否则用该主体锚定的上传素材(主推产品 → 图生图保真,支持多张)。
      const anchored = subjectRefOf(name)
      const anchoredIds =
        anchored.assetIds && anchored.assetIds.length ? anchored.assetIds : anchored.assetId ? [anchored.assetId] : []
      if (opts.refImageUrls?.length) {
        // 弹窗手动加的参考图(可多张):第一张给 VL 优化提示词;全部作图生图参考(gpt-image 支持多张)
        try {
          finalPrompt = await refineElementPromptWithImage(prompt, opts.refImageUrls[0], {
            name,
            kind: subjectKindOf(name),
            style: entryMeta?.style,
          })
        } catch {
          /* 优化失败则用原提示词 */
        }
        for (const url of opts.refImageUrls) {
          try {
            const id = await ensureAssetId(ws, url, cache)
            if (id && !refAssetIds.includes(id)) refAssetIds.push(id)
          } catch {
            /* 单张失败跳过,不阻断其余 */
          }
        }
      } else if (anchoredIds.length) {
        // 锚定的上传素材:取第一张刷新出 URL 给 VL 优化提示词;全部 assetId 作图生图参考(草稿恢复后按 assetId 取最新)
        let refUrl = anchored.url
        try {
          refUrl = await refreshAssetUrl(ws, anchoredIds[0])
        } catch {
          /* 刷新失败则沿用 refImage 原值 */
        }
        if (refUrl) {
          try {
            finalPrompt = await refineElementPromptWithImage(prompt, refUrl, {
              name,
              kind: subjectKindOf(name),
              style: entryMeta?.style,
            })
          } catch {
            /* 优化失败则用原提示词 */
          }
        }
        refAssetIds.push(...anchoredIds)
      }
      // 修改:把当前这张图作底图(img2img)
      if (opts.carryCurrent) {
        const cur = subjectImageOf(name)
        if (cur) {
          try {
            const id = await ensureAssetId(ws, cur, cache)
            if (id) refAssetIds.push(id)
          } catch {
            /* ignore */
          }
        }
      }
      const { url, assetId } = await generateShotImage({
        workspaceId: ws,
        prompt: finalPrompt,
        refAssetIds,
        modelPlanCandidates: plans,
        ratio: entryMeta?.ratio,
        lowRes: true,
      })
      addSubjectVersion(name, url, assetId, 'ai', prompt)
      return true
    } catch (e: any) {
      if (opts.notify !== false) showToast(`素材「${name}」生成失败:${e?.message || '请重试'}`, 'error')
      return false
    }
  }
  // 主推产品锚定(支持多张上传素材):一次 VL 看全部上传图 + 主体清单 → 产品分组。
  //  - 同一产品的多张图归一组,该组所有命中主体「产品合一」成 1 个产品素材,组内多张图都作图生图参考(保真);
  //  - 不同产品 → 各自一个素材;主体归属互斥(由 VL 统一裁决);场景/背景/无关道具不锚定,保持 AI 文生图;
  //  - 某产品在分镜清单里没有对应主体(matches 空)→ 注入该「主推产品」并标 manualGen(排除批量、须手动生成)。
  const anchorUploadsToSubjects = async (list: Shot[], images: string[], assetIds?: number[]): Promise<Shot[]> => {
    const ws = Number(workspaceId || 0)
    const imgs = (images || []).filter(Boolean)
    if (!imgs.length || !list.length) return list
    const allNames = Array.from(
      new Set(list.flatMap((sh) => (sh.subjects || []).map((su) => stripAt(su.tag)).filter(Boolean))),
    )
    // 1) 持久化全部上传图,拿 durable {url, assetId}(已给 assetId 则复用)
    const cache: Record<string, number> = {}
    const persisted = await Promise.all(
      imgs.map(async (url, i) => {
        let u = url
        let aid = Number(assetIds?.[i] || 0) || 0
        if (!aid && ws) {
          try {
            const out: any = await persistImageAsset(ws, url, cache)
            u = out?.url || url
            aid = Number(out?.assetId || 0) || 0
          } catch {
            /* 持久化失败:仍用原 url,生成时再 ensureAssetId */
          }
        }
        return { url: u, assetId: aid }
      }),
    )
    // 2) 一次 VL 看全部图 → 产品分组(同产品多图归组、主体互斥)
    let products: { product: string; kind: string; imageIndexes: number[]; matches: string[] }[] = []
    try {
      products = (
        await matchUploadsToSubjects(
          persisted.map((p) => p.url),
          allNames,
        )
      ).products
    } catch {
      /* VL 失败 → 下面兜底成一个「主推产品」 */
    }
    // VL 完全没结果:兜底成一个引用全部上传图的「主推产品」(注入、手动生成),至少把素材锚上
    if (!products.length) {
      products = [{ product: '主推产品', kind: '产品', imageIndexes: persisted.map((_, i) => i + 1), matches: [] }]
    }
    // 3) 逐产品组:命中 → 产品合一合并;未命中 → 注入
    let out = list.map((sh) => ({ ...sh, subjects: (sh.subjects || []).map((su) => ({ ...su })) }))
    const injections: {
      tag: string
      kind: string
      refImage?: string
      refAssetId?: number
      refAssetIds?: number[]
      image?: string
      assetId?: number
    }[] = []
    for (const p of products) {
      const groupIds = (p.imageIndexes || []).map((i) => persisted[i - 1]?.assetId || 0).filter(Boolean)
      const refImage = persisted[(p.imageIndexes?.[0] || 1) - 1]?.url || persisted[0]?.url
      const refAssetId = groupIds[0] || persisted[0]?.assetId || 0
      const refAssetIds = groupIds.length ? groupIds : refAssetId ? [refAssetId] : undefined
      const prodName = p.product || p.matches[0] || '主推产品'
      const prodKind = p.kind || '产品'
      if (p.matches.length) {
        const set = new Set(p.matches)
        out = out.map((sh) => {
          if (!sh.subjects.some((su) => set.has(stripAt(su.tag)))) return sh
          const kept = sh.subjects.filter((su) => !set.has(stripAt(su.tag)))
          const already = kept.some((su) => stripAt(su.tag) === prodName)
          // 上传图直接作为该主体素材图(image/assetId):准备素材/分镜脚本立即展示,计入「已有图」、
          // 一键生成自动跳过(不被 AI 覆盖);refImage 仍保留,供需要时手动「重新生成」做图生图参考。
          const productSubject = {
            tag: '@' + prodName,
            kind: prodKind,
            refImage,
            refAssetId,
            refAssetIds,
            image: refImage,
            assetId: refAssetId,
          }
          return { ...sh, subjects: already ? kept : [productSubject, ...kept] }
        })
      } else {
        injections.push({
          tag: '@' + prodName,
          kind: prodKind,
          refImage,
          refAssetId,
          refAssetIds,
          image: refImage,
          assetId: refAssetId,
        })
      }
    }
    if (injections.length) {
      out = out.map((sh) => {
        const have = new Set(sh.subjects.map((su) => stripAt(su.tag)))
        const add = injections.filter((inj) => !have.has(stripAt(inj.tag))).map((inj) => ({ ...inj, manualGen: true })) // 注入的主推产品:排除批量、须手动生成
        return add.length ? { ...sh, subjects: [...add, ...sh.subjects] } : sh
      })
    }
    return out
  }
  // 上传「额外参考图」(镜头编排面板用):直传后端成 asset(http url + asset_id),供云端草稿持久化
  const uploadRef = async (file: File): Promise<{ url: string; assetId?: number }> => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法上传参考图', 'error')
      return { url: '' }
    }
    try {
      const out: any = await uploadAssetFile({ workspaceId: ws, file })
      const assetId = Number(out?.asset?.id || 0) || 0
      if (!assetId) throw new Error('未取得 asset_id')
      const url = (await getAssetDownloadUrl({ workspaceId: ws, assetId }).catch(() => '')) || ''
      if (!url) throw new Error('未取得素材地址')
      return { url, assetId }
    } catch (e: any) {
      showToast(`参考图上传失败:${e?.message || '请检查存储配置/网络'}`, 'error')
      return { url: '' }
    }
  }
  const openSubject = (name: string, autoGen = false) =>
    setSubjectDlg({ open: true, name, kind: subjectKindOf(name), autoGen })

  // 该主体的广告语境:整体主题 + 它出现的分镜画面描述(帮模型选对元素的具体形态)
  const subjectContext = (name: string) => {
    const theme = (reqSummary || requirement || '').slice(0, 80)
    const descs: string[] = []
    for (const sh of shots) {
      if (sh.subjects.some((su) => stripAt(su.tag) === name) && sh.desc) descs.push(sh.desc)
      if (descs.length >= 2) break
    }
    return [theme && `广告主题:${theme}`, descs.length && `该元素出现的画面:${descs.join(';').slice(0, 160)}`]
      .filter(Boolean)
      .join('。')
  }

  // 准备素材:某镜头脚本没给出主体素材时,给它加一个占位主体(全局唯一名)并打开素材弹窗。
  // autoGen=true 时进弹窗即自动生成一次(供「AI自动生成」用);false 仅打开等用户上传/操作。
  const addShotMaterial = (shot: Shot, autoGen = false) => {
    const used = new Set<string>()
    shots.forEach((sh) => sh.subjects.forEach((su) => used.add(stripAt(su.tag))))
    let name = '素材'
    let k = 1
    while (used.has(name)) name = `素材${++k}`
    setShots((prev) =>
      prev.map((sh) => (sh.id === shot.id ? { ...sh, subjects: [...sh.subjects, { tag: `@${name}`, kind: '' }] } : sh)),
    )
    openSubject(name, autoGen)
  }

  // 无弹窗后台生成单个主体素材(与弹窗 autoGen 一致:构造默认提示词→润色→出图)。
  const generateSubjectAuto = async (name: string, opts: { notify?: boolean } = {}): Promise<boolean> => {
    const kind = subjectKindOf(name)
    const saved = subjectAssets[name]?.prompt
    let prompt = saved || subjectPrompt(name, kind, entryMeta?.style, subjectContext(name))
    if (!saved) {
      try {
        prompt = await refineElementPrompt(prompt, { name, kind, style: entryMeta?.style })
      } catch {
        /* 润色失败用原提示词 */
      }
    }
    return genForSubject(name, prompt, { notify: opts.notify })
  }

  // 真正执行批量:把所有还没有图的主体逐个后台生成,但 UI 上一次性全部显示「生成中…」,每张完成后逐个解除。
  // 由下方 effect 据 materialBatchPending 触发(点按钮 / 切回来续作 都走这里)。
  const runBatchGenerate = async () => {
    if (batchRunningRef.current) return
    if (!Number(workspaceId || 0)) {
      setMaterialBatchPending(false)
      return
    }
    // 去重主体名(按出现顺序),只生成还没有图的
    const names: string[] = []
    const seen = new Set<string>()
    for (const sh of shots)
      for (const su of sh.subjects) {
        const n = stripAt(su.tag)
        if (n && !seen.has(n)) {
          seen.add(n)
          names.push(n)
        }
      }
    // 排除:已有图的;以及「注入的主推产品(manualGen)」——后者须用户手动生成,不进一键批量。
    // 注:VL 命中的产品主体(有 refImage 但非 manualGen)仍进批量,自动走图生图保真(从上传素材抠成单品)。
    const targets = names.filter((n) => !subjectImageOf(n) && !subjectManualOf(n))
    if (!targets.length) {
      setMaterialBatchPending(false) // 没有要生成的:清掉续作标记
      return
    }
    batchRunningRef.current = true
    setBatchGenning(true)
    try {
      setSubjectGenerating((m) => {
        const next = { ...m }
        targets.forEach((name) => (next[name] = true))
        return next
      })
      // 降低并发，避免模型服务/素材存储在一键批量时被瞬时打满导致偶发 500。
      const CONCURRENCY = 3
      let successCount = 0
      const failedNames: string[] = []
      const pool = new Set<Promise<void>>()
      for (const name of targets) {
        const p = (async () => {
          try {
            const ok = await generateSubjectAuto(name, { notify: false })
            if (ok) successCount += 1
            else failedNames.push(name)
          } catch {
            failedNames.push(name)
          } finally {
            setSubjectGenerating((m) => ({ ...m, [name]: false }))
            pool.delete(p)
          }
        })()
        pool.add(p)
        if (pool.size >= CONCURRENCY) await Promise.race(pool)
      }
      await Promise.all(pool)
      if (failedNames.length) {
        const preview = failedNames
          .slice(0, 3)
          .map((name) => `「${name}」`)
          .join('、')
        const suffix = preview ? ` (${preview}${failedNames.length > 3 ? '等' : ''})` : ''
        showToast(`素材生成完成:成功 ${successCount} 张,失败 ${failedNames.length} 张${suffix},可再次点击重试`, 'error')
      } else {
        showToast(`素材生成完成:成功 ${successCount} 张`, 'success')
      }
    } finally {
      batchRunningRef.current = false
      setBatchGenning(false)
      setMaterialBatchPending(false)
    }
  }

  // 点「一键生成」:只置「批量进行中」标记并持久化进草稿,真正生成由下方 effect 启动。
  // 这样中途切走再回来(草稿恢复标记)会自动续作未出图的素材,不被截断。
  const generateAllSubjects = () => {
    if (!Number(workspaceId || 0)) {
      showToast('未选择工作空间,无法生成素材', 'error')
      return
    }
    setMaterialBatchPending(true)
  }

  // 批量(续作)驱动:在准备素材步且标记为「批量进行中」时,自动(继续)生成未出图的素材。
  useEffect(() => {
    if (materialBatchPending && step === 1 && shots.length > 0 && !batchRunningRef.current) {
      void runBatchGenerate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialBatchPending, step, shots.length])

  useEffect(() => {
    if (step !== 1) forceFreshMaterialsRef.current = false
  }, [step])

  // 脚本续跑:恢复后若"脚本生成进行中"标记仍在(切走打断了)、当前没在生成、有入口信息 → 自动重新生成脚本。
  // 流式脚本没有 task id 可续,这里以"重新生成"作为续跑;只触发一次。
  useEffect(() => {
    if (!hydratedRef.current || scriptResumeRef.current) return
    if (scriptPending && !scriptLoading && step === 0 && !marketingOpen && entryMeta && started) {
      scriptResumeRef.current = true
      void generateScript(reqSummary || requirement, entryMeta)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptPending, scriptLoading, step, marketingOpen, entryMeta, started])

  // 去重后的主体素材(脚本步 / 镜头编排顶部共用)
  // 后端"上传类"asset 的 id 集合(asset.source==='upload');用于可靠区分 上传/AI(对齐 2.0)
  const [uploadAssetIds, setUploadAssetIds] = useState<Set<number>>(new Set())
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws || !started) return
    let cancelled = false
    listAllAssets({
      workspaceId: ws,
      type: 'image',
      isCurrent: () => !cancelled && Number(workspaceIdRef.current || 0) === ws,
    })
      .then((items: any[]) => {
        if (cancelled) return
        const ids = new Set<number>()
        items.forEach((a: any) => {
          if (String(a?.source || '') === 'upload' && Number(a?.id)) ids.add(Number(a.id))
        })
        setUploadAssetIds(ids)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspaceId, started, subjectAssets, entryMeta])

  // url → asset_id(各来源汇总),供按后端 source 判定
  const urlAssetId = (() => {
    const map = new Map<string, number>()
    ;(entryMeta?.images || []).forEach((u: string, i: number) => {
      const id = Number((entryMeta as any)?.imageAssetIds?.[i] || 0)
      if (u && id) map.set(u, id)
    })
    Object.values(subjectAssets).forEach((e: any) =>
      Object.entries(e?.ids || {}).forEach(([u, id]: any) => {
        if (Number(id)) map.set(u, Number(id))
      }),
    )
    shots.forEach((sh) => {
      if (sh.image && sh.imageAssetId) map.set(sh.image, Number(sh.imageAssetId))
    })
    return map
  })()

  // 当前项目内所有图(去重,标注来源 + asset_id):入口上传原图 + 各元素版本 + 分镜图。
  // 来源判定优先用后端 asset.source(uploadAssetIds);未知时回退创建时的客户端标记。
  const projectImages: { url: string; source: 'ai' | 'upload'; assetId?: number }[] = (() => {
    const classify = (url: string, guess: 'ai' | 'upload'): 'ai' | 'upload' => {
      const id = urlAssetId.get(url)
      if (id && uploadAssetIds.has(id)) return 'upload'
      if (id && uploadAssetIds.size) return 'ai' // 已加载 asset 列表、该 id 不在 upload 集 → AI
      return guess
    }
    const m = new Map<string, 'ai' | 'upload'>()
    ;(entryMeta?.images || []).forEach((u: string) => u && m.set(u, classify(u, 'upload')))
    Object.values(subjectAssets).forEach((e: any) =>
      (e?.versions || []).forEach((u: string) => {
        if (u) m.set(u, classify(u, e?.sources?.[u] || 'upload'))
      }),
    )
    shots.forEach((sh) => {
      if (sh.image) m.set(sh.image, classify(sh.image, 'ai'))
    })
    const built = [...m.entries()]
      // 接受 http(s) / data: / 同源绝对路径(如 /api/v1/assets/:id/download —— 新建视频携带的素材就是这种)
      .filter(([u]) => /^(https?:|data:|\/)/.test(u))
      .map(([url, source]) => ({ url, source, assetId: urlAssetId.get(url) || 0 }))
    // 再按 asset_id 收敛:同一张图(同一 asset)在项目里会以 data: / 签名URL / /api 下载等多种 URL 形态出现,
    // 仅按 url 去重会把同一张图重复展示。有 asset_id 的按 asset_id 归一(只保留一条),无 asset_id 的退回按 url。
    // 同一 asset 多个 URL 时保留更稳定的展示地址:同源 /api 下载(不过期) > http(s) 签名 > data:。
    const urlRank = (u: string) => (/^\//.test(u) ? 3 : /^https?:/.test(u) ? 2 : 1)
    const seen = new Map<string, { url: string; source: 'ai' | 'upload'; assetId: number }>()
    for (const it of built) {
      const key = it.assetId > 0 ? `id:${it.assetId}` : `url:${it.url}`
      const prev = seen.get(key)
      if (!prev) {
        seen.set(key, it)
      } else if (urlRank(it.url) > urlRank(prev.url)) {
        seen.set(key, { ...prev, url: it.url }) // 来源沿用先到的判定,只升级展示 URL
      }
    }
    return [...seen.values()]
  })()

  // ── 镜头编排:按 画面描述 + 该镜头素材 + 上一张分镜图(连贯)+ 项目摘要 生成分镜图(后端文/图生图) ──
  const [shotGen, setShotGen] = useState<Record<string, boolean>>({})
  const [shotGenRunning, setShotGenRunning] = useState(false)
  const shotGenAbortRef = useRef<AbortController | null>(null)
  const shotGenRunSeqRef = useRef(0)
  const shotGenTaskIdsRef = useRef<Set<number>>(new Set())

  const cancelShotGeneration = async () => {
    shotGenRunSeqRef.current += 1
    shotGenAbortRef.current?.abort()
    shotGenAbortRef.current = null
    const ws = Number(workspaceId || 0)
    const taskIds = [...shotGenTaskIdsRef.current]
    shotGenTaskIdsRef.current.clear()
    setShotGen({})
    setShotGenRunning(false)
    if (!ws || !taskIds.length) return
    await Promise.allSettled(taskIds.map((taskId) => cancelAiTask({ workspaceId: ws, taskId })))
  }
  // 分镜图加载失败追踪(键=shot.id):缩略图 onError 标记、onLoad 清除。
  // 任一参与分镜的图加载失败 → 禁止「生成视频」(避免拿坏图/过期URL出片)。
  const [shotImgError, setShotImgError] = useState<Record<string | number, boolean>>({})
  const [shotImgRetryTokens, setShotImgRetryTokens] = useState<Record<string | number, number>>({})
  const [shotImgReloading, setShotImgReloading] = useState<Record<string | number, boolean>>({})
  const clearShotImgReloading = (id: string | number) =>
    setShotImgReloading((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  const markShotImgRetrying = (id: string | number) =>
    setShotImgReloading((current) => (current[id] ? current : { ...current, [id]: true }))
  const markShotImgError = (id: string | number) => {
    clearShotImgReloading(id)
    setShotImgError((current) => (current[id] ? current : { ...current, [id]: true }))
  }
  const markShotImgLoad = (id: string | number) => {
    clearShotImgReloading(id)
    setShotImgError((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }
  const retryFailedShotImageLoads = async () => {
    const failedShots = shotsRef.current.filter((shot) => shotImgError[shot.id] && shot.image)
    if (!failedShots.length) return
    setShotImgReloading((current) => ({
      ...current,
      ...Object.fromEntries(failedShots.map((shot) => [shot.id, true])),
    }))
    const ws = Number(workspaceIdRef.current || workspaceId || 0)
    const refreshedUrls = new Map<Shot['id'], string>()
    if (ws) {
      await Promise.all(
        failedShots.map(async (shot) => {
          const assetId = Number(shot.imageAssetId || 0) || 0
          if (!assetId) return
          try {
            const freshUrl = await refreshAssetUrl(ws, assetId)
            if (freshUrl) refreshedUrls.set(shot.id, freshUrl)
          } catch {
            // 签名地址刷新失败时仍保留当前地址，交给下方有限次数的图片重试继续恢复。
          }
        }),
      )
    }
    setShots((current) => {
      const next = current.map((shot) => {
        const freshUrl = refreshedUrls.get(shot.id)
        return freshUrl ? { ...shot, image: freshUrl } : shot
      })
      shotsRef.current = next
      return next
    })
    setShotImgRetryTokens((current) => {
      const next = { ...current }
      for (const shot of failedShots) next[shot.id] = Number(next[shot.id] || 0) + 1
      return next
    })
  }
  const autoGenRef = useRef(false)
  // 上次「分镜图 / 整片视频」生成时的输入签名:用于区分「草稿恢复/未改动(沿用旧结果)」与
  // 「上游改动(需重新生成)」。进入下一步时输入签名变了 → 重新生成,与产品逻辑一致。
  const shotGenSigRef = useRef('')
  const videoGenSigRef = useRef('')

  // 分镜图的生成输入:每镜「画面描述 + 该镜素材(subjects 选定图)」+ 风格/比例。
  // 改了脚本描述 / 换了素材后再进镜头编排,签名变化 → 重新生成分镜图(否则沿用旧图,与产品逻辑冲突)。
  const shotImageInputSig = (list: Shot[], meta: EntryMeta | null) =>
    JSON.stringify({
      ratio: meta?.ratio || '',
      style: meta?.style || '',
      shots: (list || []).map((s) => ({
        id: s.id,
        desc: s.desc || '',
        subjects: (s.subjects || []).map((su) => stableGenerationAssetKey(su.image, su.assetId)),
      })),
    })

  // 整片视频的生成输入:参与视频的分镜(分镜图 + 时长 + 台词 + 字幕 + 音效 + 顺序)+ 风格/比例/大纲。
  // 镜头编排里改了任意分镜(图/时长/文案/顺序/勾选)后再进生成视频,签名变化 → 重新出片。
  const videoInputSig = (list: Shot[], meta: EntryMeta | null, base: string) =>
    JSON.stringify({
      ratio: meta?.ratio || '',
      style: meta?.style || '',
      base: base || '',
      shots: (list || [])
        .filter((s) => s.includeInVideo !== false)
        .map((s) => ({
          id: s.id,
          image: stableGenerationAssetKey(s.image, s.imageAssetId),
          duration: s.duration || '',
          line: s.line || '',
          subtitle: s.subtitle || '',
          sfx: s.sfx || '',
        })),
    })

  // 生成单个分镜图:画面描述 + 该镜头素材(多参考图)+ 上一张分镜图(连贯);返回新图 url
  const genShotFrame = async (
    ws: number,
    sh: Shot,
    prevUrl: string,
    cache: Record<string, number>,
    theme: string,
    plans: string[],
    feedback?: string,
    opts: {
      editPrompt?: string
      refUrls?: string[]
      carryCurrent?: boolean
      signal?: AbortSignal
      onTask?: (taskId: number) => void
    } = {},
  ) => {
    // manual=面板手动出图(指定素材 + 是否携带当前图);否则=批量自动(用全部元素 + 上一张连贯)
    const manual = opts.refUrls !== undefined
    const elUrls = manual
      ? opts.refUrls!
      : (Array.from(new Set(sh.subjects.map((s) => s.image).filter(Boolean))) as string[])
    const refIds: number[] = []
    for (const u of elUrls) {
      try {
        const id = await ensureAssetId(ws, u, cache)
        if (id) refIds.push(id)
      } catch {
        /* 单张参考上传失败则跳过 */
      }
    }
    // 是否携带当前分镜图作底图(img2img):manual 看 carryCurrent;批量靠 prevUrl 连贯
    const carry = manual ? !!opts.carryCurrent : !!(feedback || opts.editPrompt)
    const baseUrl = carry ? sh.image || '' : manual ? '' : prevUrl
    if (baseUrl) {
      try {
        const id = await ensureAssetId(ws, baseUrl, cache)
        if (id) refIds.push(id)
      } catch {
        /* ignore */
      }
    }
    // 该镜元素名(锚定画面只含这些主体,避免把无关产品/主题塞进来)
    const elNames = Array.from(new Set(sh.subjects.map((s) => stripAt(s.tag)).filter(Boolean))).join('、')
    // 提示词:① 用户编辑过的 imagePrompt 直接用;② 否则按 该镜画面描述 + 该镜元素 + 风格 组合
    // 注意:不再注入"整体广告主题",否则会把全局产品(如雅迪车)塞进每个无关镜头。
    const prompt = opts.editPrompt
      ? [opts.editPrompt, feedback && `修改要求:${feedback}`].filter(Boolean).join(';')
      : [
          sh.desc,
          feedback && `修改要求:${feedback}`,
          elNames && `画面主体仅含:${elNames}(不要出现其它无关物体)`,
          entryMeta?.style && `${entryMeta.style}风格`,
          carry
            ? '在当前画面基础上按修改要求调整,保持其余部分一致'
            : prevUrl && '与上一镜头保持人物形象、场景、配色、画风一致',
          '画面比例 ' + (entryMeta?.ratio || '16:9'),
        ]
          .filter(Boolean)
          .join(';')
    // 全云端:后端文/图生图(带素材组合 + 连贯),产出即后端 asset(http + asset_id),天然持久
    const r = await generateShotImage({
      workspaceId: ws,
      prompt,
      refAssetIds: refIds,
      modelPlanCandidates: plans,
      ratio: entryMeta?.ratio,
      signal: opts.signal,
      onTask: opts.onTask,
    })
    const url = r.url
    const assetId = Number(r.assetId || 0) || 0
    setShots((prev) =>
      prev.map((x) =>
        x.id === sh.id
          ? {
              ...x,
              image: url,
              imageAssetId: assetId,
              imagePrompt: prompt,
              // 出图即不再是「插入的新分镜」(清除「生成分镜」按钮)
              isNew: false,
              // 每版记录自己用到的提示词与素材 url,切换历史版本可还原
              imageVersions: [...(x.imageVersions || []), { url, assetId, prompt, refs: elUrls }],
              // 手动出图:把这次选中的素材固化为该镜的选中态(随草稿持久)
              ...(manual ? { selectedRefs: elUrls } : {}),
            }
          : x,
      ),
    )
    // 镜头编排即脱敏(对齐 Vue 2.0):生成分镜图后立即人脸脱敏,结果缓存到分镜,供视频生成直接复用。
    // 脱敏失败/后端未配 image.face_detect 模型则静默跳过,视频生成时回退原图,不阻塞镜头编排。
    // 脱敏开关关闭则跳过(出片直接用原图)。
    if (assetId && faceBlurEnabledRef.current) {
      try {
        const blur = await blurFacesOnAsset({ workspaceId: ws, assetId, modelPlanCandidates: plans })
        if (blur.ok && blur.assetId) {
          setShots((prev) =>
            prev.map((x) =>
              x.id === sh.id
                ? { ...x, blurredImageUrl: blur.url, blurredImageAssetId: blur.assetId, blurredFromAssetId: assetId }
                : x,
            ),
          )
        }
      } catch {
        /* 脱敏失败不阻塞镜头编排 */
      }
    }
    return url
  }

  // 串行生成全部分镜图。list 缺省取当前 shots;插入新分镜后传入「已写入新描述」的列表,避免读到旧 state
  const generateShotImages = async (list: Shot[] = shots) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成分镜图', 'error')
      return
    }
    if (shotGenRunning) return
    const runId = ++shotGenRunSeqRef.current
    const ctrl = new AbortController()
    shotGenAbortRef.current = ctrl
    shotGenTaskIdsRef.current.clear()
    setShotGenRunning(true)
    // 记录本次出图所依据的输入签名(供「下次进镜头编排时输入未变则不重生成」判断)。
    // 始终按【全部分镜】算签名:即便本次只续作部分(list 为缺图子集),签名仍代表完整输入,避免误判为「改动」而全量重生成。
    shotGenSigRef.current = shotImageInputSig(shots, entryMeta)
    const cache: Record<string, number> = {}
    const theme = (reqSummary || '').slice(0, 60)
    const plans = await resolvePlanCandidates()
    let prevUrl = ''
    try {
      for (const sh of list) {
        if (ctrl.signal.aborted || runId !== shotGenRunSeqRef.current) break
        setShotGen((m) => ({ ...m, [sh.id]: true }))
        let activeTaskId = 0
        try {
          prevUrl = await genShotFrame(ws, sh, prevUrl, cache, theme, plans, undefined, {
            signal: ctrl.signal,
            onTask: (taskId) => {
              activeTaskId = Number(taskId) || 0
              if (activeTaskId > 0) shotGenTaskIdsRef.current.add(activeTaskId)
            },
          })
        } catch (e: any) {
          if (ctrl.signal.aborted || /已取消/.test(String(e?.message || ''))) break
          showToast(`分镜「${sh.no}」生成失败:${e?.message || ''}`, 'error')
        } finally {
          if (activeTaskId > 0) shotGenTaskIdsRef.current.delete(activeTaskId)
          setShotGen((m) => ({ ...m, [sh.id]: false }))
        }
      }
    } finally {
      if (shotGenAbortRef.current === ctrl) shotGenAbortRef.current = null
      if (runId === shotGenRunSeqRef.current) setShotGenRunning(false)
    }
  }

  // 单镜「编辑 / 新增」弹框统一生成(返回是否成功,供弹框「后端真正返回成功才关闭」)。
  // 重点:把【全部现有分镜的完整信息】作上下文 + 用户描述 + 上传素材,
  //   先由 LLM 产出/修改该镜头完整内容(画面描述 + 台词/字幕/音效 + 主体),与前后连贯,
  //   再据此 + 上传素材出分镜图。这样新分镜不再与其它无关,且台词/字幕/音效会一并补全。
  const generateShotFromDialog = async (
    sh: Shot,
    opts: { mode: 'edit' | 'insert'; intent: string; uploadRefUrls: string[] },
  ): Promise<boolean> => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成', 'error')
      return false
    }
    if (shotGen[sh.id]) return false
    setShotGen((m) => ({ ...m, [sh.id]: true }))
    try {
      const plans = await resolvePlanCandidates()
      const intent = (opts.intent || '').trim()
      const doText = opts.mode === 'insert' || intent.length > 0
      let target = sh
      if (doText) {
        const idx = shots.findIndex((s) => s.id === sh.id)
        // 上下文带「全部分镜」:新增时排除自身这条占位空分镜
        const ctxShots = opts.mode === 'insert' ? shots.filter((s) => s.id !== sh.id) : shots
        const info = await generateShotInfo({
          shots: ctxShots,
          targetIndex: idx < 0 ? ctxShots.length : idx,
          mode: opts.mode,
          intent,
          style: entryMeta?.style,
          ratio: entryMeta?.ratio,
          images: opts.uploadRefUrls,
        })
        // 文本字段一律回填(台词/字幕/音效);主体与时长仅新增时采用 LLM 结果,编辑保留原有
        const nextSubjects =
          opts.mode === 'insert' ? (info.subjects?.length ? info.subjects : sh.subjects) : sh.subjects
        target = {
          ...sh,
          desc: info.desc || sh.desc,
          line: info.line,
          subtitle: info.subtitle,
          sfx: info.sfx,
          duration: opts.mode === 'insert' ? info.duration || sh.duration : sh.duration,
          subjects: nextSubjects,
          isNew: false,
        }
        setShots((prev) =>
          prev.map((x) =>
            x.id === sh.id
              ? {
                  ...x,
                  desc: target.desc,
                  line: target.line,
                  subtitle: target.subtitle,
                  sfx: target.sfx,
                  duration: target.duration,
                  subjects: target.subjects,
                }
              : x,
          ),
        )
      }
      // 出图:已有主体素材 + 本次上传素材作参考;编辑在当前图基础上改(img2img)
      const subjectUrls = (target.subjects || []).map((s) => s.image).filter(Boolean) as string[]
      const refUrls = Array.from(new Set([...subjectUrls, ...opts.uploadRefUrls]))
      await genShotFrame(ws, target, '', {}, (reqSummary || '').slice(0, 60), plans, undefined, {
        refUrls,
        carryCurrent: opts.mode === 'edit',
      })
      // 单镜编辑/新增后,把「已生成」基线签名更新成当前最新 shots:
      // 否则之后离开再回到镜头编排,会因签名变化被判为「上游改动」而整列重生成。
      setShots((prev) => {
        shotGenSigRef.current = shotImageInputSig(prev, entryMeta)
        return prev
      })
      return true
    } catch (e: any) {
      showToast(`分镜「${sh.no}」生成失败:${e?.message || ''}`, 'error')
      return false
    } finally {
      setShotGen((m) => ({ ...m, [sh.id]: false }))
    }
  }

  const removeShotLocally = (shotId: Shot['id']) => {
    cancelInsertTextGeneration(shotId)
    setShots((prev) => {
      const next = renumberShots(prev.filter((s) => s.id !== shotId))
      if (prev.length > 0 && next.length === 0) shotsExplicitlyClearedRef.current = true
      shotsRef.current = next
      return next
    })
    setShotGen((m) => {
      if (!m || !m[shotId]) return m
      const next = { ...m }
      delete next[shotId]
      return next
    })
    setShotImgError((m) => {
      if (!m || !m[shotId]) return m
      const next = { ...m }
      delete next[shotId]
      return next
    })
    setShotImgReloading((current) => {
      if (!current[shotId]) return current
      const next = { ...current }
      delete next[shotId]
      return next
    })
    setShotImgRetryTokens((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, shotId)) return current
      const next = { ...current }
      delete next[shotId]
      return next
    })
  }

  const updateShotsFromEditor = (next: Shot[]) => {
    if (shotsRef.current.length > 0 && next.length === 0) shotsExplicitlyClearedRef.current = true
    shotsRef.current = next
    setShots(next)
  }

  const generateInsertedStoryboardText = async (
    shot: Shot,
    contextShots: Shot[],
    targetIndex: number,
    durationSec: number,
  ) => {
    if (insertTextRequestRef.current) return
    const runId = ++insertTextRunSeqRef.current
    const controller = new AbortController()
    insertTextRequestRef.current = { shotId: shot.id, runId, controller }
    setInsertTextGeneratingId(shot.id)

    const originalRequirement = String(requirement || '').trim()
    const summary = String(reqSummary || '').trim()
    const intent = [
      originalRequirement && `整体创作需求：${originalRequirement}`,
      summary && summary !== originalRequirement && `项目摘要：${summary}`,
      `请在这个位置自动补充一个时长固定为 ${durationSec} 秒的新镜头，生成具体、可拍摄且与前后镜头连贯、不重复的分镜词。`,
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const info = await generateShotInfo({
        shots: contextShots,
        targetIndex,
        mode: 'insert',
        intent,
        style: entryMeta?.style,
        ratio: entryMeta?.ratio,
        images: entryMeta?.images || [],
        signal: controller.signal,
      })
      const desc = String(info.desc || '').trim()
      if (!desc) throw new Error('AI 未返回有效的分镜词')

      const active = insertTextRequestRef.current
      if (!active || active.runId !== runId || active.shotId !== shot.id || controller.signal.aborted) return
      const latest = shotsRef.current
      const existing = latest.find((item) => item.id === shot.id)
      if (!existing) return
      updateShotsFromEditor(
        latest.map((item) =>
          item.id === shot.id
            ? {
                ...item,
                desc,
                line: info.line || '',
                subtitle: info.subtitle || '',
                sfx: info.sfx || '',
                subjects: info.subjects?.length ? info.subjects : item.subjects,
                // 时长继续采用插入时按剩余总时长计算出的值，避免 AI 返回值突破 15 秒。
                duration: item.duration,
              }
            : item,
        ),
      )
      showToast(`${existing.no}的分镜词已生成`, 'success')
    } catch (e: any) {
      if (controller.signal.aborted || /已取消/.test(String(e?.message || ''))) return
      const active = insertTextRequestRef.current
      if (active?.runId === runId && active.shotId === shot.id) {
        showToast(`AI 生成分镜词失败，已保留空白分镜：${e?.message || '可双击手动填写'}`, 'error')
      }
    } finally {
      const active = insertTextRequestRef.current
      if (active?.runId === runId && active.shotId === shot.id) {
        insertTextRequestRef.current = null
        setInsertTextGeneratingId(null)
      }
    }
  }

  // 分镜脚本 / 准备素材共用的手工插入:只新增上游分镜数据,不在这两步提前生成分镜图。
  // 两页均读取同一个 shots,所以插入、编号、素材与草稿会自然同步。
  const insertStoryboardShot = (rawIndex: number) => {
    if (insertTextRequestRef.current) {
      showToast('上一条新增分镜的 AI 分镜词仍在生成，请稍候', 'error')
      return
    }
    const current = shotsRef.current
    const currentSec = totalDurationSec(current)
    const remainingSec = 15 - currentSec
    if (remainingSec < 1) {
      showToast('当前分镜总时长已达到15秒，请先缩短已有镜头再新增', 'error')
      return
    }

    const defaultDurationSec = Math.max(1, Math.min(5, Math.floor(remainingSec)))
    const shot: Shot = {
      id: newManualShotId(),
      no: '镜头',
      duration: `${defaultDurationSec}s`,
      desc: '',
      subjects: [],
      isNew: true,
    }
    const index = Math.max(0, Math.min(current.length, Math.floor(Number(rawIndex) || 0)))
    const next = current.slice()
    next.splice(index, 0, shot)
    updateShotsFromEditor(renumberShots(next))
    // 上游结构变化后不允许从进度条直接跳过脚本/素材确认。
    setMaxReached((value) => Math.min(value, step))
    autoGenRef.current = false
    showToast(`已新增镜头${index + 1}，正在生成分镜词`, 'success')
    void generateInsertedStoryboardText(shot, current, index, defaultDurationSec)
  }

  const deleteShot = async (shot: Shot, index: number) => {
    // 删除确认框打开期间 AI 可能刚好完成回填；入垃圾桶前按 id 读取最新版，避免存进空描述旧快照。
    const latestShot = shotsRef.current.find((item) => item.id === shot.id) || shot
    const latestIndex = shotsRef.current.findIndex((item) => item.id === shot.id)
    const trashItem = normalizeShotTrashItem(
      {
        title: latestShot.no || latestShot.title,
        duration: latestShot.duration,
        thumbnail_url: latestShot.image,
        desc: latestShot.desc,
        deleted_at: new Date().toISOString(),
        original_index: latestIndex >= 0 ? latestIndex : index,
      },
      latestShot,
      latestIndex >= 0 ? latestIndex : index,
    )
    if (trashItem) {
      setShotTrashItems((prev) => [trashItem, ...prev.filter((x) => String(x.id) !== String(trashItem.id))])
    }
    removeShotLocally(latestShot.id)
    showToast('分镜已移入垃圾桶', 'success')
  }

  const loadShotTrash = async () => {
    // 当前删除链路为前端本地移入回收站，不再从后端垃圾桶接口拉取，避免无意义的重复请求。
    setShotTrashLoading(false)
  }

  const restoreShotFromTrash = async (item: ShotTrashItem) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间，无法恢复分镜', 'error')
      return
    }
    const insertShot = (shot: Shot, rawIndex?: number) => {
      setShots((prev) => {
        const next = prev.slice()
        const at = Math.min(next.length, Math.max(0, Number(rawIndex ?? next.length)))
        next.splice(at, 0, shot)
        const renumbered = renumberShots(next)
        shotsRef.current = renumbered
        return renumbered
      })
    }
    try {
      if (Number(item.id) > 0) {
        const payload = await restoreCreativeTrashItem({ id: item.id, workspaceId: ws })
        const restored =
          normalizeShotTrashItem(
            payload?.item || payload?.data || payload,
            item.shot || undefined,
            item.originalIndex,
          ) || item
        if (restored.shot) insertShot(restored.shot, restored.originalIndex)
      } else if (item.shot) {
        insertShot(item.shot, item.originalIndex)
      }
      setShotTrashItems((prev) => prev.filter((x) => String(x.id) !== String(item.id)))
      showToast('分镜已恢复', 'success')
    } catch (e: any) {
      showToast(getBusinessErrorMessage(e, '恢复分镜失败，请稍后重试'), 'error')
    }
  }

  const deleteShotTrash = async (item: ShotTrashItem) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间，无法永久删除', 'error')
      return
    }
    try {
      if (Number(item.id) > 0) await deleteCreativeTrashItem({ id: item.id, workspaceId: ws })
      setShotTrashItems((prev) => prev.filter((x) => String(x.id) !== String(item.id)))
      showToast('已永久删除', 'success')
    } catch (e: any) {
      showToast(getBusinessErrorMessage(e, '永久删除失败，请稍后重试'), 'error')
    }
  }

  const restoreAllShotTrash = async (items: ShotTrashItem[]) => {
    for (const item of items) {
      await restoreShotFromTrash(item)
    }
  }

  const clearAllShotTrash = async (items: ShotTrashItem[]) => {
    for (const item of items) {
      await deleteShotTrash(item)
    }
  }

  // 每次「进入」镜头编排(step→2)重置闸门,允许做一次自动生成/续作评估。
  useEffect(() => {
    if (step === 2) autoGenRef.current = false
  }, [step])

  // 进入/返回镜头编排时评估【一次】:上游(脚本描述/素材)改动 → 全量重生成;否则只补「还没出图」的分镜
  //(续作被中断的那几张)。用 autoGenRef 闸门保证「本次进入只评估一次」:
  //  - 避免在镜头编排内「单镜编辑」改了 shots(签名变化)而触发整列重生成 + 把刚生成的那张又重生成一次;
  //  - 生成中离开再回来 → step→2 重置闸门 → 重新评估 → 自动续作未出图的。
  useEffect(() => {
    if (step !== 2 || !shots.length || shotGenRunning) return
    if (autoGenRef.current) return
    const sig = shotImageInputSig(shots, entryMeta)
    const changed = sig !== shotGenSigRef.current
    const missing = shots.filter((s) => !s.image)
    autoGenRef.current = true // 本次进入已评估,后续单镜编辑/补图不再触发整列重生成
    if (!changed && missing.length === 0) return // 全部已出图且上游未改动 → 不动(草稿恢复/未改动)
    void generateShotImages(changed ? shots : missing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shots])

  // ── 生成视频:整片一次生成(所有分镜图+脚本+台词+字幕+音效 → Seedance)──
  const [fullVideo, setFullVideo] = useState<{ url: string; assetId: number }>({ url: '', assetId: 0 })
  const fullVideoRef = useRef<{ url: string; assetId: number }>({ url: '', assetId: 0 })
  useEffect(() => {
    fullVideoRef.current = fullVideo
  }, [fullVideo])
  const [videoVersions, setVideoVersions] = useState<{ url: string; assetId: number; createdAt?: string }[]>([])
  const videoVersionsRef = useRef<{ url: string; assetId: number; createdAt?: string }[]>([])
  const replaceVideoVersions = (next: { url: string; assetId: number; createdAt?: string }[]) => {
    videoVersionsRef.current = next
    setVideoVersions(next)
  }
  const appendVideoVersion = (item: { url: string; assetId: number; createdAt?: string }) => {
    const url = String(item.url || '').trim()
    const assetId = Number(item.assetId || 0) || 0
    if (!url && !assetId) return
    setVideoVersions((prev) => {
      const exists =
        assetId > 0
          ? prev.some((v) => Number((v as any)?.assetId || 0) === assetId)
          : prev.some((v) => String((v as any)?.url || '') === url)
      if (exists) {
        videoVersionsRef.current = prev
        return prev
      }
      // createdAt = 本版生成完成时间(项目管理按它展示每条视频的时间)
      const next = [...prev, { url, assetId, createdAt: item.createdAt || new Date().toISOString() }]
      videoVersionsRef.current = next
      return next
    })
  }
  // 各修改框文本，以及按具体视频版本归档的整片修改说明。
  const [fields, setFields] = useState<Record<string, string>>({})
  const videoModificationDraft = parseVideoModificationDraft(fields[VIDEO_MODIFICATION_DRAFT_FIELD])
  const setVideoModificationDraft = useCallback((nextOrUpdater: SetStateAction<VideoModificationDraft>) => {
    setFields((previousFields) => {
      const previous = parseVideoModificationDraft(previousFields[VIDEO_MODIFICATION_DRAFT_FIELD])
      const next =
        typeof nextOrUpdater === 'function'
          ? (nextOrUpdater as (value: VideoModificationDraft) => VideoModificationDraft)(previous)
          : nextOrUpdater
      return {
        ...previousFields,
        [VIDEO_MODIFICATION_DRAFT_FIELD]: serializeVideoModificationDraft(next),
      }
    })
  }, [])
  const [vidGenRunning, setVidGenRunning] = useState(false)
  // 提交前积分预估(estimate-cost):整片生成(video.generate)口径
  const [videoCost, setVideoCost] = useState<{
    loading: boolean
    error: string
    estimate: { estimatedCost: number; balance: number; canAfford: boolean } | null
  }>({ loading: false, error: '', estimate: null })
  // 每一步调模型前的积分预估:step0 分镜脚本(文本)、step1/2 出图(单张图)。perImage=按单张口径显示。
  const [stepCost, setStepCost] = useState<{
    loading: boolean
    error: string
    perImage: boolean
    count: number // 下一步要出的图片张数(出图口径);估价已按张数汇总为总额
    // perOne = 再加一张图片的增量积分(元素图=文生图单价;分镜帧=图生图单价,因新增分镜带上一帧)
    estimate: { estimatedCost: number; balance: number; canAfford: boolean; perOne?: number } | null
  }>({ loading: false, error: '', perImage: false, count: 0, estimate: null })
  // 进行中的整片生成任务 id:生成开始即记录并随草稿持久化,切路由/刷新后凭它续轮询(不重新生成)
  const [vidGenTaskId, setVidGenTaskId] = useState(0)
  // 每次「重新生成」的独立记录(生成中/失败);成功的成片仍进 videoVersions。
  // 让项目下能看到每次生成作为一条草稿:生成中、失败(可重试)。
  type GenRecord = {
    id: string
    status: 'processing' | 'failed' | 'published'
    taskId: number
    idempotencyKey?: string
    running?: boolean
    note: string
    /** 原始修改要求，不含多视频序号等 UI 文案。 */
    modificationNote?: string
    error?: string
    createdAt: number
  }
  type VideoGenJob = {
    id: string
    idempotencyKey?: string
    batchId?: string
    note?: string
    variationIndex?: number
    variationTotal?: number
    sourceImageAssetIds?: number[]
    preparedImageAssetIds?: number[]
    opts?: { edit?: boolean }
    /** 入队时锁定的不可变上下文。创建新视频后，旧任务仍只写回原项目。 */
    context?: {
      sessionId: number
      workspaceId: number
      projectId: number
      projectTitle: string
      shots: Shot[]
      basePrompt: string
      ratio?: string
      style?: string
      durationSec: number
      thumbnailUrl?: string
      sourceVideo?: { url: string; assetId: number }
      lockedSig: string
    }
  }
  const videoGenerationsRef = useRef<GenRecord[]>([])
  const [videoGenerations, setVideoGenerationsState] = useState<GenRecord[]>([])
  const setVideoGenerations = useCallback((nextOrUpdater: GenRecord[] | ((prev: GenRecord[]) => GenRecord[])) => {
    if (typeof nextOrUpdater !== 'function') {
      videoGenerationsRef.current = nextOrUpdater
      setVideoGenerationsState(nextOrUpdater)
      return
    }
    setVideoGenerationsState((prev) => {
      const next = nextOrUpdater(prev)
      videoGenerationsRef.current = next
      return next
    })
  }, [])
  const bindGenerationNoteToResult = useCallback(
    (generationId: string | null | undefined, result: { url: string; assetId: number }, note?: string) => {
      const generation = videoGenerationsRef.current.find((item) => item.id === generationId)
      const modificationNote =
        note !== undefined ? note : String(generation?.modificationNote ?? generation?.note ?? '')
      const hasOtherPending = videoGenerationsRef.current.some(
        (item) => item.status === 'processing' && item.id !== generationId,
      )
      setVideoModificationDraft((previous) =>
        bindVideoModificationNote(previous, result, modificationNote, { clearPending: !hasOtherPending }),
      )
    },
    [setVideoModificationDraft],
  )
  const [runningGenerationId, setRunningGenerationId] = useState('')
  const runningGenerationIdRef = useRef('')
  const setActiveRunningGenerationId = useCallback((id: string) => {
    runningGenerationIdRef.current = id
    setRunningGenerationId(id)
  }, [])
  const markRunningGeneration = useCallback(
    (id: string) => {
      setActiveRunningGenerationId(id)
      setVideoGenerations((prev) =>
        prev.map((g) => {
          const running = g.status === 'processing' && g.id === id
          return g.running === running ? g : { ...g, running }
        }),
      )
    },
    [setActiveRunningGenerationId, setVideoGenerations],
  )
  const clearRunningGeneration = useCallback(() => {
    setActiveRunningGenerationId('')
    setVideoGenerations((prev) => {
      let changed = false
      const next = prev.map((g) => {
        if (!g.running) return g
        changed = true
        return { ...g, running: false }
      })
      return changed ? next : prev
    })
  }, [setActiveRunningGenerationId, setVideoGenerations])
  const [videoGenQueueDraft, setVideoGenQueueDraft] = useState<VideoGenJob[]>([])
  const videoGenQueueDraftRef = useRef<VideoGenJob[]>([])
  const videoGenQueueRef = useRef<VideoGenJob[]>([])
  const videoGenSessionIdRef = useRef(1)
  const videoGenDrainingSessionsRef = useRef(new Set<number>())
  // drain 之外，恢复轮询 / registry 订阅也代表该 session 已经有唯一执行方。
  // reset 时不能再把它的剩余队列交给第二个 drain，否则会提前并发甚至重复提交。
  const videoGenOwnedSessionsRef = useRef(new Set<number>())
  const isCurrentVideoSession = (sessionId: number) => sessionId === videoGenSessionIdRef.current
  const isCurrentVideoDraining = () => videoGenDrainingSessionsRef.current.has(videoGenSessionIdRef.current)
  const isVideoSessionOwned = (sessionId: number) =>
    videoGenDrainingSessionsRef.current.has(sessionId) || videoGenOwnedSessionsRef.current.has(sessionId)
  const videoRegistryFollowTimerRef = useRef(0)
  useEffect(
    () => () => {
      // 组件卸载后旧 promise 仍会继续生成/落库，但不得再把 taskId 或旧草稿写回当前用户的新页面会话。
      const endingSessionId = videoGenSessionIdRef.current
      videoGenSessionIdRef.current += 1
      videoGenOwnedSessionsRef.current.delete(endingSessionId)
      if (videoRegistryFollowTimerRef.current) window.clearTimeout(videoRegistryFollowTimerRef.current)
      videoRegistryFollowTimerRef.current = 0
    },
    [],
  )
  // 失败记录只在当前页内存中显示黑色卡片与失败原因，不持久化到草稿。
  // 这样刷新、切菜单、切页面后不会再恢复出「失败视频」。
  const getPersistedVideoGenerations = (gens: GenRecord[]): GenRecord[] =>
    (Array.isArray(gens) ? gens : [])
      .filter(
        (g) =>
          g?.status === 'processing' && !(!(Number(g?.taskId || 0) > 0) && String(g?.note || '').trim() === '重新编辑'),
      )
      .map((g) => {
        const taskId = g.status === 'processing' ? Number(g.taskId || 0) || 0 : 0
        const idempotencyKey = String(g.idempotencyKey || (g as any).idempotency_key || '').trim()
        return {
          ...g,
          taskId,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          running: Boolean(g.running) && taskId > 0,
        }
      })
  // 上一版整片成片所依据的「内容签名」:随草稿持久化。项目管理据此判「内容改了没出新片 → 草稿(在制)」。
  // 只在出片成功时盖章(见 commitVideoSig),普通编辑不动它。
  const [lastVideoSig, setLastVideoSig] = useState('')
  // 本次在途出片【入队时锁定】的内容签名:随任务上下文及草稿持久化,完成时 commitVideoSig 用它盖章。
  // 避免用"完成那一刻的当前分镜"盖章(用户生成中/后改了内容会把签名盖成新内容 → 列表误判"没变")。
  const [pendingVideoSig, setPendingVideoSig] = useState('')
  const pendingVideoSigRef = useRef('')
  // 出片成功盖章:只用【锁定签名】(显式传入 → ref → 持久化 pending)。
  // 拿不到锁定签名时【不本地盖章】—— 绝不用"当前分镜"兜底(用户可能已改内容,会把签名盖成新内容 → 列表误判"没变");
  // 此时以后端 persistVideoResult 的权威盖章为准(它用草稿里的 pendingVideoSig),下次加载 applyDraft 再对齐。
  const commitVideoSig = (sig?: string) => {
    const finalSig = sig || pendingVideoSigRef.current || pendingVideoSig
    if (finalSig) setLastVideoSig(finalSig)
    pendingVideoSigRef.current = ''
    setPendingVideoSig('')
  }
  const genSeqRef = useRef(0)
  const createVideoTaskIdempotencyKey = () => {
    const uuid = globalThis.crypto?.randomUUID?.()
    return `task_${uuid || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`
  }
  const immediateSaveRef = useRef(false) // processing 记录写入后请求立即落盘:草稿即时出现在项目里(不等防抖)
  const createPendingGenRecord = (note?: string, modificationNote?: string): GenRecord => {
    genSeqRef.current += 1
    return {
      id: `gen-${Date.now()}-${genSeqRef.current}`,
      status: 'processing',
      taskId: 0,
      idempotencyKey: createVideoTaskIdempotencyKey(),
      running: false,
      note: note || '',
      modificationNote: modificationNote || '',
      error: '',
      createdAt: Date.now(),
    }
  }
  const setGenTask = (id: string, taskId: number) => {
    const next = videoGenerationsRef.current.map((g) => {
      if (g.id === id) return { ...g, taskId: Number(taskId) || 0, running: true }
      return g.status === 'processing' && g.running ? { ...g, running: false } : g
    })
    setVideoGenerations(next)
  }
  // 标记本条记录为 已并入成片 / 失败;resume 没有 id 时按「当前生成中的那条」处理
  const markGen = (id: string | null, status: 'published' | 'failed', error = '') =>
    setVideoGenerations((prev) => {
      const targetId =
        id ||
        runningGenerationIdRef.current ||
        prev.find((g) => g.status === 'processing' && Number(g.taskId || 0) > 0)?.id ||
        prev.find((g) => g.status === 'processing')?.id
      if (!targetId) return prev
      return prev.map((g) =>
        g.id === targetId
          ? {
              ...g,
              status,
              taskId: 0,
              running: false,
              error: status === 'failed' ? error || g.error || '生成失败，请重试' : '',
            }
          : g,
      )
    })
  const failStaleVideoGenerations = useCallback(
    (reason = '生成请求已停止，请重新生成') => {
      const previous = videoGenerationsRef.current
      const changed = previous.some((generation) => generation.status === 'processing')
      immediateSaveRef.current = true
      // 先同步 ref 再触发 React 更新；后续队列恢复不能读到上一帧的 processing 而错误 return。
      setVideoGenerations(
        previous.map((g) => {
          if (g.status !== 'processing') return g
          return { ...g, status: 'failed', taskId: 0, running: false, error: reason }
        }),
      )
      clearRunningGeneration()
      setVidGenTaskId(0)
      setVidGenRunning(false)
      if (changed || Number(vidGenTaskId || 0) > 0) showToast(`视频生成失败:${reason}`, 'error')
    },
    [clearRunningGeneration, setVideoGenerations, showToast, vidGenTaskId],
  )
  // 草稿即时出现:startGen 后(videoGenerations 变化)立刻把草稿落库,不等防抖
  useEffect(() => {
    if (!immediateSaveRef.current || !appliedRef.current) return
    immediateSaveRef.current = false
    const ws = Number(workspaceId || 0)
    saveSmartDraft(currentDraft(), ws)
    if (projectIdRef.current) void putSmartDraftToBackend(ws)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoGenerations, workspaceId])
  useEffect(() => {
    videoGenerationsRef.current = videoGenerations
  }, [videoGenerations])
  useEffect(() => {
    shotsRef.current = shots
    if (shots.length > 0) shotsExplicitlyClearedRef.current = false
  }, [shots])
  useEffect(() => {
    runningGenerationIdRef.current = runningGenerationId
  }, [runningGenerationId])
  useEffect(() => {
    videoGenQueueDraftRef.current = videoGenQueueDraft
  }, [videoGenQueueDraft])

  const syncVideoGenQueue = (
    next: VideoGenJob[],
    sessionId = videoGenSessionIdRef.current,
    targetQueue = videoGenQueueRef.current,
  ) => {
    targetQueue.splice(0, targetQueue.length, ...next)
    if (!isCurrentVideoSession(sessionId)) return
    videoGenQueueRef.current = targetQueue
    setVideoGenQueueDraft([...targetQueue])
  }
  const dropVideoGenQueueJob = (
    id: string,
    sessionId = videoGenSessionIdRef.current,
    targetQueue = videoGenQueueRef.current,
  ) => {
    if (!id) return
    const current = targetQueue
    const next = current.filter((job) => job.id !== id)
    if (next.length !== current.length) syncVideoGenQueue(next, sessionId, targetQueue)
  }

  const syncSmartTask = (job: VideoGenJob, status: TaskCenterStatus, patch: Record<string, unknown> = {}) => {
    const context = job.context
    const pid = Number(context?.projectId || projectIdRef.current || 0) || 0
    const ws = Number(context?.workspaceId || workspaceId || 0) || 0
    if (!pid || !ws) return
    const id = buildTaskCenterId('smart', ws, pid, job.id)
    const store = useTaskCenterStore.getState()
    const existing = store.tasks.find((task) => task.id === id)
    // 同一 generation 的终态不可被晚到的轮询/catch 降回 active；若远端最终成功，仍允许 succeeded 覆盖失败态。
    if (
      existing &&
      isTaskCenterTerminalStatus(existing.status) &&
      status !== existing.status &&
      status !== 'succeeded'
    ) {
      return
    }
    store.upsertTask({
      id,
      scope: 'smart',
      workspaceId: ws,
      projectId: pid,
      generationId: job.id,
      taskId: Number(existing?.taskId || 0) || 0,
      status,
      title: context?.projectTitle || projectName || '智能成片',
      ratio: context?.ratio || entryMeta?.ratio || '',
      durationSec: Number(context?.durationSec || totalDurationSec(context?.shots || shotsRef.current) || 0) || 0,
      thumbnailUrl: context?.thumbnailUrl || context?.shots?.find((shot) => shot.image)?.image || '',
      thumbnailAssetId:
        Number(context?.shots?.find((shot) => Number(shot.imageAssetId || 0) > 0)?.imageAssetId || 0) || 0,
      operationCode: job.opts?.edit ? 'video.edit' : 'video.generate',
      startedAt: Number(existing?.startedAt || Date.now()),
      updatedAt: Date.now(),
      ...patch,
    })
  }

  /** 将图片对话中的一次生成同步到任务中心；generationId 使用 assistant 消息 id，跨刷新稳定。 */
  const syncImageTask = (
    message: ChatMessage,
    status: TaskCenterStatus,
    patch: Record<string, unknown> = {},
    context: { workspaceId?: number; projectId?: number } = {},
  ) => {
    const ws = Number(context.workspaceId || workspaceIdRef.current || 0) || 0
    const pid = Number(context.projectId || projectIdRef.current || 0) || 0
    if (!ws || !pid || !message.id) return
    const id = buildTaskCenterId('image', ws, pid, message.id)
    const store = useTaskCenterStore.getState()
    const existing = store.tasks.find((task) => task.id === id)
    if (
      existing &&
      isTaskCenterTerminalStatus(existing.status) &&
      status !== existing.status &&
      status !== 'succeeded'
    ) {
      return
    }
    const requestImages = message.request?.refImages || []
    const thumbnail = requestImages.find((image) => image.url) || message.images?.find((image) => image.url)
    store.upsertTask({
      id,
      scope: 'image',
      workspaceId: ws,
      projectId: pid,
      generationId: message.id,
      taskId: Number(message.taskId || existing?.taskId || 0) || 0,
      status,
      title: projectNameRef.current || '图片生成任务',
      ratio: message.request?.ratio || entryMeta?.ratio || '',
      durationSec: 0,
      thumbnailUrl: thumbnail?.url || '',
      thumbnailAssetId: Number(thumbnail?.assetId || 0) || undefined,
      operationCode: message.operationCode || 'image.text_to_image',
      startedAt: Number(message.startedAt || existing?.startedAt || Date.now()),
      updatedAt: Date.now(),
      ownerUserId: currentUserId || undefined,
      ...patch,
    })
  }

  /**
   * 失败/取消也必须先写回该 job 入队时锁定的项目，再把任务中心切到终态。
   * 旧页面卸载或创建新视频后，这里不再读取可变 projectIdRef/workspaceId；落库失败则保持
   * reconnecting，交给全局 TaskCenterCoordinator 用同一 task/generation 继续收口。
   */
  const persistSmartJobTerminal = async (
    job: VideoGenJob,
    status: 'failed' | 'cancelled',
    error: string,
    taskId = 0,
  ): Promise<boolean> => {
    const context = job.context
    const ws = Number(context?.workspaceId || 0) || 0
    const pid = Number(context?.projectId || 0) || 0
    const safeTaskId = Number(taskId || 0) || 0
    if (!ws || !pid || !job.id) return false

    const taskCenterId = buildTaskCenterId('smart', ws, pid, job.id)
    const currentTask = useTaskCenterStore.getState().tasks.find((task) => task.id === taskCenterId)
    // catch 等待期间，另一条恢复链可能已经落库服务商的成功结果；
    // 已成功任务后面不能再排入失败或取消草稿，避免终态倒退。
    if (currentTask?.status === 'succeeded') return false

    syncSmartTask(job, 'reconnecting', { taskId: safeTaskId, error })
    const persisted = await persistVideoTerminalStateToBackend({
      projectId: pid,
      workspaceId: ws,
      taskId: safeTaskId,
      genId: job.id,
      status,
      error,
    }).catch(() => false)
    if (!persisted) return false

    // 可能有另一条全局恢复链已经先拿到成功结果；成功终态永远优先，不能被晚到的 catch 覆盖。
    const latestTask = useTaskCenterStore.getState().tasks.find((task) => task.id === taskCenterId)
    if (latestTask?.status === 'succeeded') return true
    syncSmartTask(job, status, { taskId: 0, error })
    return true
  }

  const autoVidRef = useRef(false)
  // 人脸脱敏:正式出视频前对每张进入视频的分镜图脱敏。阶段提示 + 每镜调试信息(开发可见)
  const [blurPhase, setBlurPhase] = useState('')
  const [blurDebug, setBlurDebug] = useState<any[]>([])
  // 人脸脱敏恒开(不提供开关):正式出片前先对每张进入视频的分镜图抠人脸/脱敏,再提交给 Seedance。
  // 明确确认无人脸时使用原图；检测服务异常时停止本轮，不能把未经确认的原图送去生成。
  const [faceBlurEnabled] = useState(true)
  const faceBlurEnabledRef = useRef(true)
  useEffect(() => {
    faceBlurEnabledRef.current = faceBlurEnabled
  }, [faceBlurEnabled])

  // 生成/重生成整片的单次执行单元;多条生成由外层队列顺序消费。
  // 「确认修改」仍专走 video.edit;普通重生成继续走固定的 Seedance 整片模型。
  const runVideoJob = async (
    job: VideoGenJob,
    sessionId = job.context?.sessionId || videoGenSessionIdRef.current,
    sessionQueue = videoGenQueueRef.current,
  ) => {
    const context = job.context
    const ws = Number(context?.workspaceId || workspaceId || 0)
    const pid = Number(context?.projectId || projectIdRef.current) || 0
    const currentShots = context?.shots?.length ? context.shots : shotsRef.current
    const currentRatio = context?.ratio || entryMeta?.ratio
    const currentStyle = context?.style || entryMeta?.style
    const currentPrompt = context?.basePrompt || reqSummary || requirement
    const sourceVideo = context?.sourceVideo || fullVideo
    const updateCurrentUi = () => isCurrentVideoSession(sessionId)
    if (!ws) {
      if (updateCurrentUi()) {
        showToast('未选择工作空间,无法生成视频', 'error')
        markGen(job.id, 'failed', '未选择工作空间，无法生成视频')
      }
      syncSmartTask(job, 'failed', { error: '未选择工作空间，无法生成视频' })
      return
    }
    if (!currentShots.length) {
      const msg = '暂无分镜，无法生成视频'
      const terminalPersisted = await persistSmartJobTerminal(job, 'failed', msg)
      if (updateCurrentUi() && terminalPersisted) {
        showToast('暂无分镜,无法生成视频', 'error')
        markGen(job.id, 'failed', msg)
      }
      return
    }
    const durationValidation = validateSmartVideoDuration(totalDurationSec(currentShots))
    if (!durationValidation.valid) {
      const msg = unsupportedVideoDurationMessage(durationValidation.seconds)
      const terminalPersisted = await persistSmartJobTerminal(job, 'failed', msg)
      if (updateCurrentUi()) {
        showToast(msg, 'error')
        if (terminalPersisted) markGen(job.id, 'failed', msg)
      }
      return
    }

    // 队列开始消费该 job 时就标记为「生成中」。
    // 后端 task_id 要等模型选择/人脸脱敏/提交任务后才返回；如果只在 onTask 里标记，
    // 多视频生成刚开始会全部显示「排队中」，过一会儿才跳成加载态。
    if (updateCurrentUi()) markRunningGeneration(job.id)
    syncSmartTask(job, 'preparing')

    // 「确认修改」:把上次整片当 video 输入,按修改提示在原视频基础上改(片段时间段写进提示)
    if (job.opts?.edit && sourceVideo.assetId) {
      const lockedSig = context?.lockedSig || computeVideoContentSig(currentShots, null, currentPrompt)
      if (updateCurrentUi()) {
        pendingVideoSigRef.current = lockedSig
        setPendingVideoSig(lockedSig)
      }
      let activeTaskId = 0
      try {
        const plans = await resolvePlanCandidates()
        const editPrompt = [
          '请在保留原视频镜头内容、顺序与节奏的前提下,按以下修改要求调整画面(只改提到的部分,其余保持不变):',
          job.note || '',
          job.variationTotal && job.variationTotal > 1
            ? `这是同一需求下的第 ${job.variationIndex || 1}/${job.variationTotal} 个不同版本，请保持脚本一致，但在表演细节、镜头运动、构图与节奏细节上给出明显不同的变体效果。`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
        const editSrcDur = (await readVideoDurationSec(sourceVideo.url)) || 0
        const editPromise = editFullVideo({
          workspaceId: ws,
          videoAssetId: sourceVideo.assetId,
          prompt: editPrompt,
          ratio: currentRatio,
          durationSec: totalDurationSec(currentShots) || 10,
          sourceVideoDurationSec: editSrcDur, // 按原整片真实时长计费(video.edit)
          modelPlanCandidates: plans,
          idempotencyKey: job.idempotencyKey,
          onTask: (id) => {
            const nextTaskId = Number(id) || 0
            activeTaskId = nextTaskId
            syncSmartTask(job, 'processing', { taskId: nextTaskId })
            if (updateCurrentUi()) {
              setVidGenTaskId(nextTaskId)
              setGenTask(job.id, nextTaskId)
            }
            if (nextTaskId > 0) {
              updateRunningVideoGenMeta('smart', ws, pid, {
                taskId: nextTaskId,
                generationId: job.id,
                status: 'processing',
              })
              if (updateCurrentUi()) {
                markRunningGeneration(job.id)
                saveSmartDraft(currentDraft(), ws)
                if (projectIdRef.current === pid) void putSmartDraftToBackend(ws)
              }
              dropVideoGenQueueJob(job.id, sessionId, sessionQueue)
            }
          },
          onProgress: (progress) => syncSmartTask(job, 'processing', { progress }),
        })
        const { url, assetId } = await trackVideoGen(
          'smart',
          ws,
          pid,
          continueSmartVideoTaskAfterTransient(editPromise, {
            workspaceId: ws,
            getTaskId: () => activeTaskId,
            onReconnect: (taskId) => {
              syncSmartTask(job, 'reconnecting', { taskId })
              updateRunningVideoGenMeta('smart', ws, pid, {
                taskId,
                generationId: job.id,
                status: 'reconnecting',
              })
            },
            onProgress: (progress) => syncSmartTask(job, 'processing', { progress }),
          }),
          { generationId: job.id, status: 'preparing' },
        )
        if (updateCurrentUi()) {
          setFullVideo({ url, assetId })
          appendVideoVersion({ url, assetId })
          bindGenerationNoteToResult(job.id, { url, assetId }, job.note || '')
          markGen(job.id, 'published')
          commitVideoSig(lockedSig) // 盖章:用发起时锁定的签名(不读完成时的当前分镜)
        }
        // B:修改完成即落后端(切走也保存);多条队列等这一版落库后再跑下一条,避免历史版本被旧草稿覆盖。
        const persisted = await persistVideoResultToBackend({
          projectId: pid,
          workspaceId: ws,
          url,
          assetId,
          taskId: activeTaskId,
          genId: job.id,
          modificationNote: job.note || '',
          lockedSig,
        }).catch(() => false)
        if (!persisted) throw new Error('视频已生成，但保存到项目失败')
        syncSmartTask(job, 'succeeded', { resultUrl: url, resultAssetId: assetId, progress: 100, error: '' })
      } catch (e: any) {
        const msg = e?.message || '请重试'
        const resultSavePending = msg === '视频已生成，但保存到项目失败'
        const cancelled = isCancelledVideoTaskError(e)
        const terminalPersisted = resultSavePending
          ? false
          : await persistSmartJobTerminal(job, cancelled ? 'cancelled' : 'failed', msg, activeTaskId)
        if (resultSavePending) {
          syncSmartTask(job, 'reconnecting', { taskId: activeTaskId, progress: 99, error: msg })
        }
        if (updateCurrentUi()) {
          if (resultSavePending) showToast('视频已生成，正在后台保存到项目', 'info')
          else if (terminalPersisted) {
            showToast(cancelled ? '视频生成已中断' : `视频修改失败:${msg}`, cancelled ? 'info' : 'error')
            markGen(job.id, 'failed', msg)
          } else {
            showToast('视频任务终态正在后台同步，请稍后查看', 'info')
          }
        }
      }
      return
    }

    // 仅勾选「参与视频生成」的分镜进入视频(未勾选的跳过)
    const activeShots = currentShots.filter((s) => s.includeInVideo !== false)
    if (!activeShots.length) {
      const msg = '请至少勾选一个分镜参与视频生成'
      const terminalPersisted = await persistSmartJobTerminal(job, 'failed', msg)
      if (updateCurrentUi() && terminalPersisted) {
        showToast('请至少勾选一个分镜参与视频生成', 'error')
        markGen(job.id, 'failed', msg)
      }
      return
    }
    // 记录本次出片所依据的分镜签名(供「下次进生成视频时分镜未变则不重生成」判断)
    if (updateCurrentUi()) videoGenSigRef.current = videoInputSig(currentShots, entryMeta, currentPrompt)
    const lockedSig = context?.lockedSig || computeVideoContentSig(currentShots, entryMeta, currentPrompt)
    if (updateCurrentUi()) {
      pendingVideoSigRef.current = lockedSig
      setPendingVideoSig(lockedSig)
    }
    let activeTaskId = 0
    try {
      // 把整段生成(脱敏 + 建任务 + 轮询 + 落库)包成一个【按 projectId 登记的结果 promise】,活在组件之外:
      // 即使中途切走、组件卸载,它也继续跑到完成并落后端;回来时凭登记表订阅同一个,不重启 → 真正「切页面也继续生成」。
      const { url, assetId } = await trackVideoGen(
        'smart',
        ws,
        pid,
        (async (): Promise<{ url: string; assetId: number }> => {
          const plans = await resolvePlanCandidates()
          const cache: Record<string, number> = {}
          const imageAssetIds: number[] = []
          const lockedSourceIds = (job.sourceImageAssetIds || []).map((id) => Number(id) || 0).filter((id) => id > 0)
          const lockedPreparedIds = (job.preparedImageAssetIds || [])
            .map((id) => Number(id) || 0)
            .filter((id) => id > 0)
          const canReuseBatchAssets =
            lockedSourceIds.length === activeShots.length && lockedPreparedIds.length === activeShots.length

          if (canReuseBatchAssets) {
            imageAssetIds.push(...lockedPreparedIds)
            if (updateCurrentUi())
              setBlurDebug(
                lockedPreparedIds.map((outAssetId, index) => ({
                  no: activeShots[index]?.no || '',
                  srcAssetId: lockedSourceIds[index],
                  outAssetId,
                  outUrl: '',
                  status: 'batch_cached',
                  ok: true,
                  cached: true,
                  noFace: outAssetId === lockedSourceIds[index],
                })),
              )
          } else {
            // ① 先确定每镜「原始分镜图」asset_id(按镜头顺序):优先已有 imageAssetId,缺则现传一次。
            const sourceAssetIds = await Promise.all(
              activeShots.map(async (sh, index) => {
                const label = sh.no || `分镜 ${index + 1}`
                if (!sh.image && !Number(sh.imageAssetId || 0)) {
                  throw new Error(`${label}缺少分镜图，已停止本次视频生成`)
                }
                let id = Number(sh.imageAssetId || 0) || 0
                if (!id && sh.image) {
                  try {
                    id = await ensureAssetId(ws, sh.image, cache)
                  } catch (error: any) {
                    throw new Error(`${label}的分镜图保存失败：${error?.message || '请稍后重试'}`)
                  }
                }
                if (!id) throw new Error(`${label}的分镜图尚未保存，已停止本次视频生成`)
                return id
              }),
            )
            const completeSourceAssetIds = requireOrderedShotAssetIds(activeShots, sourceAssetIds)
            const srcIds = activeShots.map((shot, index) => ({
              shotId: shot.id,
              id: completeSourceAssetIds[index],
            }))

            // ② 每批视频只做人脸预处理一次。同批后续任务复用同一组安全素材，避免某一轮检测失败后回退原图。
            if (faceBlurEnabledRef.current) {
              const dbg: any[] = []
              const roundCache = new Map<number, { assetId: number; url: string; noFace?: boolean }>()
              for (let j = 0; j < srcIds.length; j++) {
                const { shotId, id } = srcIds[j]
                const sh = currentShots.find((s) => s.id === shotId)
                if (updateCurrentUi()) setBlurPhase(`人脸脱敏 ${j + 1}/${srcIds.length}…`)
                const cached = roundCache.get(id)
                if (cached) {
                  imageAssetIds.push(cached.assetId)
                  dbg.push({
                    no: sh?.no || '',
                    srcAssetId: id,
                    cached: true,
                    outAssetId: cached.assetId,
                    outUrl: cached.url,
                    status: cached.noFace ? 'no_face' : 'cached',
                    ok: true,
                    noFace: Boolean(cached.noFace),
                  })
                  continue
                }

                const result = await blurFacesOnAsset({ workspaceId: ws, assetId: id, modelPlanCandidates: plans })
                const noFace = !result.ok && isNoFaceDetectedError(result.debug?.error)
                dbg.push({
                  no: sh?.no || '',
                  ...result.debug,
                  status: noFace ? 'no_face' : result.debug?.status,
                  outAssetId: noFace ? id : result.debug?.outAssetId,
                  ok: result.ok || noFace,
                  cached: false,
                  noFace,
                })
                if (result.ok && result.assetId) {
                  imageAssetIds.push(result.assetId)
                  roundCache.set(id, { assetId: result.assetId, url: result.url })
                } else if (noFace) {
                  imageAssetIds.push(id)
                  roundCache.set(id, { assetId: id, url: sh?.image || '', noFace: true })
                } else {
                  if (updateCurrentUi()) setBlurDebug(dbg)
                  throw new Error(`${sh?.no || `分镜 ${j + 1}`}人脸检测失败，已停止本次视频生成，请稍后重试`)
                }
              }
              if (updateCurrentUi()) setBlurDebug(dbg)
            } else {
              for (const source of srcIds) imageAssetIds.push(source.id)
            }

            if (job.batchId && srcIds.length > 0 && imageAssetIds.length === srcIds.length) {
              const sourceImageAssetIds = srcIds.map((source) => source.id)
              const preparedImageAssetIds = [...imageAssetIds]
              syncVideoGenQueue(
                sessionQueue.map((queuedJob) =>
                  queuedJob.batchId === job.batchId
                    ? { ...queuedJob, sourceImageAssetIds, preparedImageAssetIds }
                    : queuedJob,
                ),
                sessionId,
                sessionQueue,
              )
              // 在创建视频任务前先保存批次素材锁定结果，覆盖此刻刷新/切路由的恢复窗口。
              if (updateCurrentUi()) {
                saveSmartDraft(currentDraft(), ws)
                if (projectIdRef.current === pid) void putSmartDraftToBackend(ws)
              }
            }
          }
          if (updateCurrentUi()) setBlurPhase('')
          const completeImageAssetIds = requireOrderedShotAssetIds(activeShots, imageAssetIds)
          const generationPromise = generateFullVideo({
            workspaceId: ws,
            shots: activeShots,
            basePrompt: currentPrompt,
            ratio: currentRatio,
            style: currentStyle,
            imageAssetIds: completeImageAssetIds,
            note: job.note,
            variationIndex: job.variationIndex,
            variationTotal: job.variationTotal,
            modelPlanCandidates: plans,
            idempotencyKey: job.idempotencyKey,
            // 任务一创建就记录 task_id 并随草稿持久化:中途切路由/刷新后可凭它续轮询
            onTask: (id) => {
              const nextTaskId = Number(id) || 0
              activeTaskId = nextTaskId
              syncSmartTask(job, 'processing', { taskId: nextTaskId })
              if (updateCurrentUi()) {
                setVidGenTaskId(nextTaskId)
                setGenTask(job.id, nextTaskId)
              }
              if (nextTaskId > 0) {
                updateRunningVideoGenMeta('smart', ws, pid, {
                  taskId: nextTaskId,
                  generationId: job.id,
                  status: 'processing',
                })
                if (updateCurrentUi()) {
                  markRunningGeneration(job.id)
                  saveSmartDraft(currentDraft(), ws)
                  if (projectIdRef.current === pid) void putSmartDraftToBackend(ws)
                }
                dropVideoGenQueueJob(job.id, sessionId, sessionQueue)
              }
            },
            onProgress: (progress) => syncSmartTask(job, 'processing', { progress }),
          })
          return continueSmartVideoTaskAfterTransient(generationPromise, {
            workspaceId: ws,
            getTaskId: () => activeTaskId,
            onReconnect: (taskId) => {
              syncSmartTask(job, 'reconnecting', { taskId })
              updateRunningVideoGenMeta('smart', ws, pid, {
                taskId,
                generationId: job.id,
                status: 'reconnecting',
              })
            },
            onProgress: (progress) => syncSmartTask(job, 'processing', { progress }),
          })
        })(),
        {
          generationId: job.id,
          status: 'preparing',
        },
      )
      if (updateCurrentUi()) {
        setFullVideo({ url, assetId })
        appendVideoVersion({ url, assetId })
        bindGenerationNoteToResult(job.id, { url, assetId }, job.note || '')
        markGen(job.id, 'published')
        commitVideoSig(lockedSig) // 盖章:用发起时锁定的签名(不读完成时的当前分镜)
      }
      // 完成即直接落后端(不依赖组件挂载);多条队列等这一版落库后再跑下一条。
      const persisted = await persistVideoResultToBackend({
        projectId: pid,
        workspaceId: ws,
        url,
        assetId,
        taskId: activeTaskId,
        genId: job.id,
        modificationNote: job.note || '',
        lockedSig,
      }).catch(() => false)
      if (!persisted) throw new Error('视频已生成，但保存到项目失败')
      syncSmartTask(job, 'succeeded', { resultUrl: url, resultAssetId: assetId, progress: 100, error: '' })
    } catch (e: any) {
      const msg = e?.message || '请重试'
      const resultSavePending = msg === '视频已生成，但保存到项目失败'
      const cancelled = isCancelledVideoTaskError(e)
      const terminalPersisted = resultSavePending
        ? false
        : await persistSmartJobTerminal(job, cancelled ? 'cancelled' : 'failed', msg, activeTaskId)
      if (resultSavePending) {
        syncSmartTask(job, 'reconnecting', { taskId: activeTaskId, progress: 99, error: msg })
      }
      if (updateCurrentUi()) {
        if (resultSavePending) showToast('视频已生成，正在后台保存到项目', 'info')
        else if (terminalPersisted) {
          showToast(cancelled ? '视频生成已中断' : `视频生成失败:${msg}`, cancelled ? 'info' : 'error')
          markGen(job.id, 'failed', msg)
        } else {
          showToast('视频任务终态正在后台同步，请稍后查看', 'info')
        }
      }
    } finally {
      if (updateCurrentUi()) {
        setBlurPhase('')
        setVidGenTaskId(0) // 每轮结束清掉进行中标记,避免恢复时误续
      }
    }
  }

  const drainVideoGenQueue = async (
    sessionId = videoGenSessionIdRef.current,
    sessionQueue = videoGenQueueRef.current,
  ) => {
    if (videoGenDrainingSessionsRef.current.has(sessionId)) return
    videoGenDrainingSessionsRef.current.add(sessionId)
    if (isCurrentVideoSession(sessionId)) setVidGenRunning(true)
    try {
      while (sessionQueue.length) {
        const [job] = sessionQueue
        if (!job) {
          syncVideoGenQueue(sessionQueue.slice(1), sessionId, sessionQueue)
          continue
        }
        await runVideoJob(job, sessionId, sessionQueue)
        dropVideoGenQueueJob(job.id, sessionId, sessionQueue)
      }
    } finally {
      videoGenDrainingSessionsRef.current.delete(sessionId)
      if (isCurrentVideoSession(sessionId)) {
        clearRunningGeneration()
        setBlurPhase('')
        setVidGenTaskId(0)
        setVidGenRunning(false)
      }
    }
  }

  const resumeQueuedVideoJobs = () => {
    const sessionId = videoGenSessionIdRef.current
    const sessionQueue = videoGenQueueRef.current
    if (videoGenDrainingSessionsRef.current.has(sessionId)) return
    if (videoGenerationsRef.current.some((g) => g.status === 'processing' && Number(g.taskId || 0) > 0)) return
    if (!sessionQueue.length) return
    void drainVideoGenQueue(sessionId, sessionQueue)
  }

  const queueFullVideo = (note?: string, opts?: { edit?: boolean }, count?: number) => {
    const ws = Number(workspaceId || 0)
    const currentShots = shotsRef.current
    if (!ws) {
      showToast('未选择工作空间,无法生成视频', 'error')
      return
    }
    if (!currentShots.length) {
      showToast('暂无分镜,无法生成视频', 'error')
      return
    }
    const durationValidation = validateSmartVideoDuration(totalDurationSec(currentShots))
    if (!durationValidation.valid) {
      showToast(unsupportedVideoDurationMessage(durationValidation.seconds), 'error')
      return
    }
    const total = normalizeVideoGenerateCount(count)
    const sessionId = videoGenSessionIdRef.current
    const sessionQueue = videoGenQueueRef.current
    const pid = Number(projectIdRef.current || 0) || 0
    if (!pid) {
      showToast('项目尚未创建成功，无法生成视频，请返回入口后重试', 'error')
      return
    }
    const forceNew = total > 1 || !!vidGenRunning || isCurrentVideoDraining()
    const existing = !forceNew ? videoGenerationsRef.current.find((g) => g.status === 'processing') || null : null
    const newRecords: GenRecord[] = []
    let patchedExisting: GenRecord | null = null
    const batchId = total > 1 ? createVideoTaskIdempotencyKey().replace(/^task_/, 'batch_') : ''
    const jobs: VideoGenJob[] = Array.from({ length: total }, (_, i) => {
      const displayNote = note
        ? total > 1
          ? `${note}（${i + 1}/${total}）`
          : note
        : total > 1
          ? `生成视频 ${i + 1}/${total}`
          : ''
      const useExisting = !forceNew && i === 0 && existing
      const baseRecord = useExisting ? existing : createPendingGenRecord(displayNote, note)
      const record = baseRecord.idempotencyKey
        ? { ...baseRecord, modificationNote: note || '' }
        : {
            ...baseRecord,
            modificationNote: note || '',
            idempotencyKey: createVideoTaskIdempotencyKey(),
          }
      if (useExisting) {
        if (record !== existing) patchedExisting = record
      } else {
        newRecords.push(record)
      }
      return {
        id: record.id,
        idempotencyKey: record.idempotencyKey,
        ...(batchId ? { batchId } : {}),
        note,
        variationIndex: total > 1 ? i + 1 : undefined,
        variationTotal: total > 1 ? total : undefined,
        opts,
        context: {
          sessionId,
          workspaceId: ws,
          projectId: pid,
          projectTitle: projectName || '智能成片',
          shots: currentShots.map((shot) => ({ ...shot })),
          basePrompt: reqSummary || requirement,
          ratio: entryMeta?.ratio,
          style: entryMeta?.style,
          durationSec: totalDurationSec(currentShots) || 0,
          thumbnailUrl: currentShots.find((shot) => shot.image)?.image || '',
          sourceVideo: { ...fullVideo },
          lockedSig: computeVideoContentSig(currentShots, entryMeta, reqSummary || requirement),
        },
      }
    })
    if (newRecords.length || patchedExisting) {
      const nextGenerations = [
        ...newRecords,
        ...videoGenerationsRef.current.map((g) =>
          patchedExisting && g.id === patchedExisting.id ? patchedExisting : g,
        ),
      ]
      setVideoGenerations(nextGenerations)
    }
    immediateSaveRef.current = true
    syncVideoGenQueue([...sessionQueue, ...jobs], sessionId, sessionQueue)
    for (const job of jobs) syncSmartTask(job, 'queued')
    if (jobs.length) useTaskCenterStore.getState().setDrawerExpanded(true)
    void (async () => {
      try {
        saveSmartDraft(currentDraft(), ws)
        if (projectIdRef.current) await putSmartDraftToBackend(ws)
      } finally {
        if (isCurrentVideoSession(sessionId)) {
          resumeQueuedVideoJobs()
        } else if (sessionQueue.length && !isVideoSessionOwned(sessionId)) {
          void drainVideoGenQueue(sessionId, sessionQueue)
        }
      }
    })()
  }

  // 单个重生成:只允许当前整片任务空闲时触发。
  const runFullVideo = (note?: string, opts?: { edit?: boolean }, count?: number) => {
    if (vidGenRunning || isCurrentVideoDraining()) return
    const ws = Number(workspaceIdRef.current || workspaceId || 0)
    const pid = Number(projectIdRef.current || projectId || 0)
    if (ws > 0 && pid > 0 && isVideoGenRunning('smart', ws, pid)) {
      showToast('该项目已在另一个页面生成视频，请等待任务完成', 'info')
      return
    }
    queueFullVideo(note, opts, normalizeVideoGenerateCount(count))
  }

  const generationWorkspaceId = Number(workspaceIdRef.current || workspaceId || 0)
  const generationProjectId = Number(projectIdRef.current || projectId || 0) || 0
  const hasRegisteredVideoGeneration =
    generationProjectId > 0 && isVideoGenRunning('smart', generationWorkspaceId, generationProjectId)
  // “正在执行”与“草稿里残留 processing”必须分开。过去 actualVideoGenerating 同时包含二者，
  // 清理 effect 又用 actualVideoGenerating 作为退出条件，形成 processing 永远无法被清掉的自锁。
  const videoGenerationActivity = deriveSmartVideoGenerationActivity({
    generations: videoGenerations,
    taskId: vidGenTaskId,
    queueLength: videoGenQueueRef.current.length,
    localRunning: vidGenRunning,
    draining: isCurrentVideoDraining(),
    registered: hasRegisteredVideoGeneration,
  })
  const actualVideoGenerating = videoGenerationActivity.visibleActive
  const staleVideoRecoveryState = videoGenerationActivity.staleRecoveryState
  const resolveRunningVideoGenerationId = (records: GenRecord[] = videoGenerations): string => {
    const processing = [...records]
      .filter((g) => g.status === 'processing')
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    if (!processing.length) return ''
    const activeTaskId = Number(vidGenTaskId || 0) || 0
    return (
      (activeTaskId > 0 ? processing.find((g) => Number(g.taskId || 0) === activeTaskId)?.id || '' : '') ||
      processing.find((g) => g.running)?.id ||
      processing.find((g) => Number(g.taskId || 0) > 0)?.id ||
      runningGenerationIdRef.current ||
      runningGenerationId ||
      (vidGenRunning || actualVideoGenerating || isCurrentVideoDraining() ? processing[0].id : '')
    )
  }
  const setWorkspaceSwitchLockSource = useUiStore((s) => s.setWorkspaceSwitchLockSource)
  const workspaceSwitchLockSourceRef = useRef(Symbol('smart-create-workspace-switch-lock'))
  const shouldLockWorkspaceSwitch =
    imageBusy || actualVideoGenerating || videoGenerations.some((g) => String(g.status || '') === 'processing')

  useEffect(() => {
    const source = workspaceSwitchLockSourceRef.current
    setWorkspaceSwitchLockSource(
      source,
      shouldLockWorkspaceSwitch,
      imageBusy ? '当前图片处理中，暂不支持切换团队' : '当前视频处理中，暂不支持切换团队',
    )
    return () => {
      setWorkspaceSwitchLockSource(source, false)
    }
  }, [imageBusy, setWorkspaceSwitchLockSource, shouldLockWorkspaceSwitch])
  useEffect(() => {
    const hasTaskBackedGeneration = videoGenerations.some(
      (generation) => generation.status === 'processing' && Number(generation.taskId || 0) > 0,
    )
    if (
      !videoGenQueueDraft.length ||
      videoGenerationActivity.runtimeActive ||
      hasTaskBackedGeneration ||
      Number(vidGenTaskId || 0) > 0
    ) {
      return
    }
    // 队列是“待执行凭证”而不是执行者。若恢复回调的同一帧曾读到旧 processing，
    // 这里会在提交后的状态上再次接管，保证队列不会无人消费却一直显示转圈。
    resumeQueuedVideoJobs()
    // resumeQueuedVideoJobs 通过 ref 读取当前 session/queue，本 effect 只由稳定状态字段触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoGenQueueDraft, videoGenerationActivity.runtimeActive, vidGenTaskId, videoGenerations])
  useEffect(() => {
    if (!staleVideoRecoveryState) return
    // applyDraft 与 resumePendingVideo 在相邻更新中完成，给恢复链一个短暂接管窗口；
    // 到期后再次读取 registry/ref，只有确认没有任何执行者才把幽灵状态收口为失败。
    const timer = window.setTimeout(() => {
      const ws = Number(workspaceIdRef.current || workspaceId || 0)
      const pid = Number(projectIdRef.current || projectId || 0) || 0
      const stillRunning = vidGenRunning || isCurrentVideoDraining() || (pid > 0 && isVideoGenRunning('smart', ws, pid))
      const stillHasRecoveryState =
        Number(vidGenTaskId || 0) > 0 ||
        videoGenQueueRef.current.length > 0 ||
        videoGenerationsRef.current.some((g) => g.status === 'processing')
      if (!stillRunning && stillHasRecoveryState) {
        failStaleVideoGenerations()
      }
    }, SMART_STALE_VIDEO_STATE_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [failStaleVideoGenerations, projectId, staleVideoRecoveryState, vidGenRunning, vidGenTaskId, workspaceId])

  // 恢复一个【已提交但前端中途离开】的整片生成任务:不重新建任务,凭 taskId 续轮询到完成。
  // 把一次「在途生成的结果」并入本组件 UI(去重,避免和后台路径重复 push 版本)
  const adoptVideoResult = (url: string, assetId: number, genId?: string) => {
    setFullVideo({ url, assetId })
    appendVideoVersion({ url, assetId })
    bindGenerationNoteToResult(genId, { url, assetId })
    markGen(genId || null, 'published')
    commitVideoSig() // 盖章:用锁定签名(续跑/在途由原发起方 persist 已按 pending 盖章)
  }

  // 切走→回来:登记表里若还握着【同项目的在途生成】(同会话内,promise 活在组件之外)→ 直接订阅它,
  // 不重启、也不另起一路轮询。覆盖「切走时 taskId 还没存进草稿」的窗口(脱敏/建任务阶段)。返回是否已接管。
  const subscribeRunningVideo = (pid: number, genId = ''): boolean => {
    const registryWorkspaceId = Number(workspaceIdRef.current || workspaceId || 0) || 0
    const inflight = pid ? getRunningVideoGen('smart', registryWorkspaceId, pid) : null
    if (!inflight) return false
    const metadata = getRunningVideoGenMeta('smart', registryWorkspaceId, pid)
    const subscribedSessionId = videoGenSessionIdRef.current
    const trackedGenId = genId || String(metadata?.generationId || '')
    const trackedTaskId = Number(metadata?.taskId || 0) || 0
    const subscribedWorkspaceId = Number(metadata?.workspaceId || workspaceIdRef.current || workspaceId || 0) || 0
    const subscribedDraft = latestDraftStateRef.current
    const subscribedEntryMeta = subscribedDraft.entryMeta as EntryMeta | null | undefined
    const subscribedJob: VideoGenJob = {
      id: trackedGenId || (trackedTaskId > 0 ? `task-${trackedTaskId}` : `resume-${pid}`),
      context: {
        sessionId: subscribedSessionId,
        workspaceId: subscribedWorkspaceId,
        projectId: pid,
        projectTitle: String(subscribedDraft.projectName || projectName || '智能成片'),
        shots: shotsRef.current.map((shot) => ({ ...shot })),
        basePrompt: String(
          subscribedDraft.reqSummary || subscribedDraft.requirement || reqSummary || requirement || '',
        ),
        ratio: subscribedEntryMeta?.ratio,
        style: subscribedEntryMeta?.style,
        durationSec: totalDurationSec(shotsRef.current) || 0,
        thumbnailUrl: shotsRef.current.find((shot) => shot.image)?.image || '',
        sourceVideo: { ...fullVideoRef.current },
        lockedSig: pendingVideoSigRef.current || String(subscribedDraft.pendingVideoSig || '') || pendingVideoSig,
      },
    }
    videoGenOwnedSessionsRef.current.add(subscribedSessionId)
    autoVidRef.current = true // 防止「自动生成」effect 再触发一次
    setVidGenRunning(true)
    if (trackedGenId) {
      dropVideoGenQueueJob(trackedGenId)
      markRunningGeneration(trackedGenId)
      if (trackedTaskId > 0) setGenTask(trackedGenId, trackedTaskId)
    }
    if (trackedTaskId > 0) setVidGenTaskId(trackedTaskId)
    inflight
      .then(({ url, assetId }) => {
        if (isCurrentVideoSession(subscribedSessionId)) adoptVideoResult(url, assetId, trackedGenId)
      })
      .catch(async (e: any) => {
        const message = e?.message || '视频生成失败，请重试'
        const terminalPersisted = await persistSmartJobTerminal(
          subscribedJob,
          isCancelledVideoTaskError(e) ? 'cancelled' : 'failed',
          message,
          trackedTaskId,
        )
        if (terminalPersisted && isCurrentVideoSession(subscribedSessionId)) {
          markGen(trackedGenId || null, 'failed', message)
        }
      })
      .finally(() => {
        if (!isCurrentVideoSession(subscribedSessionId)) {
          videoGenOwnedSessionsRef.current.delete(subscribedSessionId)
          return
        }
        setVidGenTaskId(0)
        clearRunningGeneration()
        // 同一浏览器内切路由后，原页面仍拥有多视频队列。这里只跟随登记表中的下一条任务，
        // 绝不在新页面抢占/重跑队列，避免同一个 idempotency job 被提交两次。
        const followNext = () => {
          if (!isCurrentVideoSession(subscribedSessionId)) {
            videoGenOwnedSessionsRef.current.delete(subscribedSessionId)
            return
          }
          const next = getRunningVideoGen('smart', subscribedWorkspaceId, pid)
          if (next && next !== inflight) {
            videoRegistryFollowTimerRef.current = 0
            const nextMeta = getRunningVideoGenMeta('smart', subscribedWorkspaceId, pid)
            subscribeRunningVideo(pid, String(nextMeta?.generationId || ''))
            return
          }
          const hasPending =
            videoGenQueueRef.current.length > 0 || videoGenerationsRef.current.some((g) => g.status === 'processing')
          if (!hasPending) {
            videoRegistryFollowTimerRef.current = 0
            videoGenOwnedSessionsRef.current.delete(subscribedSessionId)
            setVidGenRunning(false)
            return
          }
          videoRegistryFollowTimerRef.current = window.setTimeout(followNext, 800)
        }
        if (videoRegistryFollowTimerRef.current) window.clearTimeout(videoRegistryFollowTimerRef.current)
        videoRegistryFollowTimerRef.current = window.setTimeout(followNext, 0)
      })
    return true
  }

  const resumePendingVideo = async (taskId: number) => {
    const ws = Number(workspaceIdRef.current || workspaceId || 0)
    if (!ws || !taskId || vidGenRunning) return
    const pid = Number(projectIdRef.current) || 0
    const resumeSessionId = videoGenSessionIdRef.current
    const resumeSessionQueue = videoGenQueueRef.current
    const activeGenId =
      videoGenerationsRef.current.find((g) => Number(g.taskId || 0) === Number(taskId || 0))?.id ||
      videoGenerationsRef.current.find((g) => g.status === 'processing')?.id ||
      ''
    const restoredDraft = latestDraftStateRef.current
    const restoredEntryMeta = restoredDraft.entryMeta as EntryMeta | null | undefined
    const restoredFullVideo = fullVideoRef.current
    const resumeJob: VideoGenJob = {
      id: activeGenId || `task-${taskId}`,
      context: {
        sessionId: resumeSessionId,
        workspaceId: ws,
        projectId: pid,
        projectTitle: String(restoredDraft.projectName || projectName || '智能成片'),
        shots: shotsRef.current.map((shot) => ({ ...shot })),
        basePrompt: String(restoredDraft.reqSummary || restoredDraft.requirement || reqSummary || requirement || ''),
        ratio: restoredEntryMeta?.ratio,
        style: restoredEntryMeta?.style,
        durationSec: totalDurationSec(shotsRef.current) || 0,
        thumbnailUrl: shotsRef.current.find((shot) => shot.image)?.image || '',
        sourceVideo: { ...restoredFullVideo },
        lockedSig: pendingVideoSigRef.current || String(restoredDraft.pendingVideoSig || '') || pendingVideoSig,
      },
    }
    syncSmartTask(resumeJob, 'reconnecting', { taskId })
    // 同会话内切走→回来:登记表里还握着那次在途生成 → 订阅它(不对同一任务起第二路轮询)。
    if (subscribeRunningVideo(pid, activeGenId)) {
      if (activeGenId) markRunningGeneration(activeGenId)
      return
    }
    videoGenOwnedSessionsRef.current.add(resumeSessionId)
    autoVidRef.current = true // 防止「自动生成」effect 同时再触发一次
    setVidGenRunning(true)
    setVidGenTaskId(taskId)
    if (activeGenId) markRunningGeneration(activeGenId)
    try {
      // 硬刷新后登记表为空 → 凭 taskId 续轮询同一后端任务(不重新生成)。
      const resumePromise = continueSmartVideoTaskAfterTransient(
        resumeFullVideo({
          workspaceId: ws,
          taskId,
          onProgress: (progress) => syncSmartTask(resumeJob, 'processing', { progress }),
        }),
        {
          workspaceId: ws,
          getTaskId: () => taskId,
          onReconnect: (reconnectingTaskId) => {
            updateRunningVideoGenMeta('smart', ws, pid, {
              taskId: reconnectingTaskId,
              generationId: activeGenId,
              status: 'reconnecting',
            })
          },
          onProgress: (progress) => syncSmartTask(resumeJob, 'processing', { progress }),
        },
      )
      const { url, assetId } = await trackVideoGen('smart', ws, pid, resumePromise, {
        taskId,
        generationId: activeGenId,
        status: 'reconnecting',
      })
      if (isCurrentVideoSession(resumeSessionId)) adoptVideoResult(url, assetId, activeGenId)
      // B:续跑完成即落后端(切走也保存)
      const persisted = await persistVideoResultToBackend({
        projectId: pid,
        workspaceId: ws,
        url,
        assetId,
        taskId,
        genId: activeGenId,
      }).catch(() => false)
      if (!persisted) throw new Error('视频已生成，但保存到项目失败')
      syncSmartTask(resumeJob, 'succeeded', { resultUrl: url, resultAssetId: assetId, progress: 100, error: '' })
    } catch (e: any) {
      const msg = e?.message || '请重试'
      const resultSavePending = msg === '视频已生成，但保存到项目失败'
      const cancelled = isCancelledVideoTaskError(e)
      const terminalPersisted = resultSavePending
        ? false
        : await persistSmartJobTerminal(resumeJob, cancelled ? 'cancelled' : 'failed', msg, taskId)
      if (resultSavePending) {
        syncSmartTask(resumeJob, 'reconnecting', { taskId, progress: 99, error: msg })
      }
      if (isCurrentVideoSession(resumeSessionId)) {
        if (resultSavePending) showToast('视频已生成，正在后台保存到项目', 'info')
        else if (terminalPersisted) {
          showToast(cancelled ? '视频生成已中断' : `恢复视频生成失败:${msg}`, cancelled ? 'info' : 'error')
          markGen(activeGenId || null, 'failed', msg)
        } else {
          showToast('视频任务终态正在后台同步，请稍后查看', 'info')
        }
      }
    } finally {
      videoGenOwnedSessionsRef.current.delete(resumeSessionId)
      if (isCurrentVideoSession(resumeSessionId)) {
        clearRunningGeneration()
        setVidGenRunning(false)
        setVidGenTaskId(0)
        resumeQueuedVideoJobs()
      } else if (resumeSessionQueue.length && !isVideoSessionOwned(resumeSessionId)) {
        // reset / 卸载后仍让原 session 按顺序跑完剩余任务，但不能抢占仍在恢复中的当前 task。
        void drainVideoGenQueue(resumeSessionId, resumeSessionQueue)
      }
    }
  }

  // 进入生成视频:整片未生成、或镜头编排已改动(分镜图/时长/文案/顺序/勾选)则自动生成一次。
  // 已有整片且分镜签名未变(草稿恢复 / 未改动)→ 不重生成;改了镜头编排 → 签名变化 → 重新出片。
  useEffect(() => {
    if (step !== 3 || !shots.length || vidGenRunning) return
    if (autoVidRef.current) return
    // 已有整片(url 或仅 assetId——可能正等签名URL刷新)且分镜未变 → 不再自动重生成,避免重复出片 / 误判「没视频」
    if (
      (fullVideo.url || fullVideo.assetId) &&
      videoInputSig(shots, entryMeta, reqSummary || requirement) === videoGenSigRef.current
    )
      return
    autoVidRef.current = true
    const initialCount = normalizeVideoGenerateCount(initialVideoGenerateCountRef.current)
    initialVideoGenerateCountRef.current = 1
    void runFullVideo(undefined, undefined, initialCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shots])

  // 提交前积分预估(estimate-cost):在生成视频步、非生成中、已有分镜时估一次(整片 video.generate 口径)。
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasInflight = pid > 0 && isVideoGenRunning('smart', ws, pid)
    if (!ws || step !== 3 || actualVideoGenerating || hasInflight || !shots.length) return
    let alive = true
    setVideoCost((s) => ({ ...s, loading: true, error: '' }))
    const timer = window.setTimeout(async () => {
      try {
        const plans = await resolvePlanCandidates()
        const res: any = await estimateFullVideoCost({
          workspaceId: ws,
          shots,
          ratio: entryMeta?.ratio,
          modelPlanCandidates: plans,
        })
        if (!alive) return
        setVideoCost({
          loading: false,
          error: '',
          estimate: {
            estimatedCost: Number(res?.estimated_cost ?? 0),
            balance: Number(res?.balance ?? 0),
            canAfford: res?.can_afford === true,
          },
        })
      } catch (e: any) {
        if (alive) setVideoCost({ loading: false, error: e?.message || '预估失败', estimate: null })
      }
    }, 500)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualVideoGenerating, projectId, shots, step, workspaceId])

  // 「前瞻预估」:在当前步就显示「下一步生成要花多少」,让用户进下一步前先看成本。
  // 映射:分镜脚本/准备素材 → 下一步出图(image,单张);镜头编排 → 下一步生成视频(video,整片);
  // 图片模式 → 出图(image)。step3 视频由 VideoStage 单独显示;营销拆解步不预估。
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const isImg = isImageMode && started
    // 前瞻:每步显示【下一步】要花多少。
    //   step0 分镜脚本 → 下一步「准备素材」= 元素图(按唯一主体数,AI 从描述生成 → 文生图口径)
    //   step1 准备素材 → 下一步「镜头编排」= 分镜帧(首镜文生图 + 其余带上一帧 → 图生图,按分镜数)
    //   step2 镜头编排 → 下一步「生成视频」= 整片
    //   图片模式 → 出图(单张)
    const kind = isImg ? 'frames' : step === 0 ? 'elements' : step === 1 ? 'frames' : step === 2 ? 'video' : ''
    if (!ws || marketingOpen || !kind) {
      setStepCost((s) =>
        s.estimate || s.loading || s.error
          ? { loading: false, error: '', perImage: false, count: 0, estimate: null }
          : s,
      )
      return
    }
    let alive = true
    const perImage = kind !== 'video'
    // 分镜帧张数 = 参与视频的分镜数;元素图张数 = 分镜里唯一主体数。
    const partShots = kind === 'frames' && !isImg ? shots.filter((s) => s.includeInVideo !== false) : []
    const frameCount = partShots.length
    const elementCount =
      kind === 'elements'
        ? new Set(shots.flatMap((s) => (s.subjects || []).map((su: any) => stripAt(su.tag || '')).filter(Boolean))).size
        : 0
    const count = isImg
      ? Math.min(9, Math.max(1, Math.floor(Number(imageComposerOutputCount) || 1)))
      : kind === 'elements'
        ? elementCount
        : kind === 'frames'
          ? frameCount
          : 0
    setStepCost({ loading: true, error: '', perImage, count, estimate: null })
    const timer = window.setTimeout(async () => {
      try {
        const plans = await resolvePlanCandidates()
        if (isImg) {
          // 图片对话按当前输入框是否带参考图，精确区分文生图/图生图；不能再固定按图生图展示费用。
          const res: any = await estimateShotImageCost({
            workspaceId: ws,
            hasRefs: imageComposerRefCount > 0,
            ratio: imageComposerRatio || entryMeta?.ratio,
            modelPlanCandidates: plans,
          })
          if (!alive) return
          const perImageCost = Math.max(0, Number(res?.estimated_cost ?? 0) || 0)
          const estimatedCost = perImageCost * count
          const balance = Number(res?.balance ?? 0)
          const canAfford = res?.can_afford !== false && estimatedCost <= balance
          setStepCost({
            loading: false,
            error: '',
            perImage: true,
            count,
            estimate: {
              estimatedCost,
              balance,
              canAfford,
              perOne: perImageCost,
            },
          })
          return
        }
        if (kind === 'video') {
          const res: any = await estimateFullVideoCost({
            workspaceId: ws,
            shots,
            ratio: entryMeta?.ratio,
            modelPlanCandidates: plans,
          })
          if (!alive) return
          const per = Number(res?.estimated_cost ?? 0)
          const balance = Number(res?.balance ?? 0)
          setStepCost({
            loading: false,
            error: '',
            perImage,
            count: 0,
            estimate: { estimatedCost: per, balance, canAfford: per <= balance },
          })
          return
        }
        if (kind === 'elements') {
          // 准备素材:每个唯一主体出一张独立元素图,AI 从描述生成 → 文生图口径;总额 = 文生图单价 × 主体数。
          const res: any = await estimateShotImageCost({
            workspaceId: ws,
            hasRefs: false,
            ratio: entryMeta?.ratio,
            modelPlanCandidates: plans,
          })
          if (!alive) return
          const per = Number(res?.estimated_cost ?? 0)
          const balance = Number(res?.balance ?? 0)
          const total = elementCount > 0 ? per * elementCount : per
          setStepCost({
            loading: false,
            error: '',
            perImage,
            count: elementCount,
            estimate: { estimatedCost: total, balance, canAfford: total <= balance, perOne: per },
          })
          return
        }
        // kind === 'frames'(镜头编排分镜帧):链式生成 —— 首镜(无自带素材)走【文生图】,第 2 镜起带上一帧 →【图生图】。
        // 两者后端计费不同,故分别估价再按分镜数求和:总额 = 文生图×文生图数 + 图生图×图生图数。张数未知则按 1 张图生图估。
        const n = frameCount
        const firstHasMaterials = n > 0 ? (partShots[0]?.subjects || []).some((su: any) => Boolean(su?.image)) : false
        const textCount = n > 0 && !firstHasMaterials ? 1 : 0
        const i2iCount = n > 0 ? n - textCount : 1
        // 图生图始终估(供 total + 「每加一张」增量,新增分镜带上一帧=图生图);文生图仅首镜需要时估。
        const [i2iRes, t2iRes]: any[] = await Promise.all([
          estimateShotImageCost({
            workspaceId: ws,
            hasRefs: true,
            ratio: entryMeta?.ratio,
            modelPlanCandidates: plans,
          }),
          textCount > 0
            ? estimateShotImageCost({
                workspaceId: ws,
                hasRefs: false,
                ratio: entryMeta?.ratio,
                modelPlanCandidates: plans,
              })
            : Promise.resolve(null),
        ])
        if (!alive) return
        const i2iPer = Number(i2iRes?.estimated_cost ?? 0)
        const t2iPer = Number(t2iRes?.estimated_cost ?? 0)
        const total = i2iPer * i2iCount + t2iPer * textCount
        const balance = Number(i2iRes?.balance ?? t2iRes?.balance ?? 0)
        setStepCost({
          loading: false,
          error: '',
          perImage,
          count: n,
          estimate: { estimatedCost: total, balance, canAfford: total <= balance, perOne: i2iPer },
        })
      } catch (e: any) {
        if (alive) setStepCost({ loading: false, error: e?.message || '暂不支持预估', perImage, count, estimate: null })
      }
    }, 500)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    step,
    marketingOpen,
    workspaceId,
    isImageMode,
    started,
    shots.length,
    entryMeta?.ratio,
    imageComposerRefCount,
    imageComposerRatio,
    imageComposerOutputCount,
    memberCenterOpen,
  ])

  // 同名主体素材联动 + 纳入版本库:
  // 脚本只在部分镜头(常仅镜头1)匹配到 imageIndex,这里把每个主体已有的图回填到所有同名缺图的分镜。
  useEffect(() => {
    if (forceFreshMaterialsRef.current) return
    // 1) name -> 已有图(取第一个非空){url, assetId}
    const imgByName = new Map<string, { url: string; assetId: number }>()
    shots.forEach((sh) =>
      sh.subjects.forEach((su) => {
        const n = stripAt(su.tag)
        if (su.image && !imgByName.has(n)) imgByName.set(n, { url: su.image, assetId: Number(su.assetId || 0) || 0 })
      }),
    )
    // 1b) 版本库回填:脚本重生成(如「上一步」回到入口后重新生成脚本)会清空分镜,但主体素材版本库仍在。
    //     同名主体若当前分镜里都没图,就用版本库里最后一版补回,避免准备素材已生成/上传的素材丢失。
    Object.entries(subjectAssets).forEach(([name, e]: any) => {
      if (imgByName.has(name)) return
      const vs: string[] = e?.versions || []
      const last = vs[vs.length - 1]
      if (last) imgByName.set(name, { url: last, assetId: e?.ids?.[last] || 0 })
    })
    // 2) 回填到所有同名缺图的 subject(图 + assetId)
    let shotsChanged = false
    const nextShots = shots.map((sh) => {
      let touched = false
      const subjects = sh.subjects.map((su) => {
        const got = imgByName.get(stripAt(su.tag))
        if (got && !su.image) {
          touched = true
          return { ...su, image: got.url, assetId: got.assetId }
        }
        return su
      })
      if (touched) {
        shotsChanged = true
        return { ...sh, subjects }
      }
      return sh
    })
    if (shotsChanged) {
      setShots(nextShots)
      return // 本次先回填,下一轮再并入版本库(避免重复计算)
    }
    // 3) 纳入对应主体版本库
    setSubjectAssets((prev) => {
      let changed = false
      const next = { ...prev }
      imgByName.forEach((got, n) => {
        const img = got.url
        const e = next[n] || { versions: [] }
        if (!e.versions.includes(img)) {
          next[n] = {
            versions: [...e.versions, img],
            prompt: e.prompt,
            sources: { ...(e.sources || {}), [img]: e.sources?.[img] || 'upload' },
            ids: { ...(e.ids || {}), [img]: got.assetId },
          }
          changed = true
        }
      })
      return changed ? next : prev
    })
    // subjectAssets 入依赖:脚本重生成后由版本库回填(步骤 1b);step3 幂等(已含则不改),不会死循环
  }, [shots, subjectAssets])

  // ② 上传素材「保守按 kind 自动带入」:模型常不回传 imageIndex,导致顶部上传的素材一张都没绑到主体。
  // 直接用入口/脚本步上传的素材池(entryMeta.images + 平行 imageAssetIds,不依赖来源分类,避免误判漏掉),
  // 把【未被任何主体用到的上传图】按顺序填给【缺图、且 kind 不是人物】的主体
  // (人物脸部敏感,不拿真实环境图顶替;仅 场景/物体/产品/占位 主体接收);匹配不上的留空。
  // 受限:上传图本身无 kind 标注,只能用「主体的 kind」作闸门,故为 best-effort,错配可手动改。
  useEffect(() => {
    if (step !== 1) return // 仅准备素材步(step===1,见下方 materialMode 定义)
    if (forceFreshMaterialsRef.current) return
    const imgs = (entryMeta?.images || []).filter((u: string) => /^(https?:|data:)/.test(u))
    if (!imgs.length) return
    const aids = (entryMeta as any)?.imageAssetIds || []
    const usedImgs = new Set<string>()
    shots.forEach((sh) => sh.subjects.forEach((su) => su.image && usedImgs.add(su.image)))
    const free = imgs
      .map((url: string, i: number) => ({ url, assetId: Number(aids[i] || 0) || 0 }))
      .filter((f) => !usedImgs.has(f.url))
    if (!free.length) return
    let fi = 0
    let changed = false
    const next = shots.map((sh) => {
      let touched = false
      const subjects = sh.subjects.map((su) => {
        if (su.image || fi >= free.length) return su
        if (/人物|人像|人|角色|model/i.test(su.kind || '')) return su // 跳过人物主体
        touched = true
        const f = free[fi++]
        return { ...su, image: f.url, assetId: f.assetId || 0 }
      })
      if (touched) {
        changed = true
        return { ...sh, subjects }
      }
      return sh
    })
    if (changed) setShots(next)
  }, [step, shots, entryMeta])

  // ── 加载后水合签名URL(对齐 2.0):草稿里存的签名URL会过期,按 asset_id 重新取新签名URL ──
  // 按“工作空间 + 项目 + asset”记录成功项，而不是整个页面只允许执行一次：后续新生成的版本同样需要水合；
  // 单个资源失败只重试它自己，不能让一次短暂失败永久留下过期 URL。
  const hydratedAssetKeysRef = useRef(new Set<string>())
  const hydratingAssetKeysRef = useRef(new Set<string>())
  const assetHydrationAttemptsRef = useRef(new Map<string, number>())
  const assetHydrationScopeRef = useRef('')
  const assetHydrationRetryTimerRef = useRef(0)
  const [assetHydrationVersion, setAssetHydrationVersion] = useState(0)
  useEffect(() => {
    const scope = `${Number(workspaceId || 0)}:${Number(projectId || routeId || 0)}`
    assetHydrationScopeRef.current = scope
    hydratedAssetKeysRef.current.clear()
    hydratingAssetKeysRef.current.clear()
    assetHydrationAttemptsRef.current.clear()
    if (assetHydrationRetryTimerRef.current) window.clearTimeout(assetHydrationRetryTimerRef.current)
    assetHydrationRetryTimerRef.current = 0
    setAssetHydrationVersion((version) => version + 1)
    return () => {
      if (assetHydrationScopeRef.current === scope) assetHydrationScopeRef.current = ''
    }
  }, [projectId, routeId, workspaceId])
  useEffect(
    () => () => {
      if (assetHydrationRetryTimerRef.current) window.clearTimeout(assetHydrationRetryTimerRef.current)
    },
    [],
  )
  useEffect(() => {
    if (!hydratedRef.current) return
    const ws = Number(workspaceId || 0)
    if (!ws || !started) return
    const scope = `${ws}:${Number(projectId || routeId || 0)}`
    if (assetHydrationScopeRef.current !== scope) return
    // 收集所有 asset_id(分镜图 + 元素图 + 版本库)
    const ids = new Set<number>()
    shots.forEach((sh) => {
      if (sh.imageAssetId) ids.add(Number(sh.imageAssetId))
      ;(sh.imageVersions || []).forEach((v: any) => {
        const id = typeof v === 'string' ? 0 : Number(v?.assetId || 0)
        if (id) ids.add(id)
      })
      sh.subjects.forEach((su) => {
        if (su.assetId) ids.add(Number(su.assetId))
      })
      ;(sh.extraRefs || []).forEach((r: any) => {
        if (r?.assetId) ids.add(Number(r.assetId))
      })
      if (sh.blurredImageAssetId) ids.add(Number(sh.blurredImageAssetId))
    })
    Object.values(subjectAssets).forEach((e: any) =>
      Object.values(e?.ids || {}).forEach((id: any) => {
        if (id) ids.add(Number(id))
      }),
    )
    if (fullVideo.assetId) ids.add(Number(fullVideo.assetId))
    videoVersions.forEach((v) => {
      if (v.assetId) ids.add(Number(v.assetId))
    })
    ;((entryMeta as any)?.imageAssetIds || []).forEach((id: any) => {
      if (id) ids.add(Number(id))
    })
    if (!ids.size) return // 暂无 asset_id(数据可能还没装载完)→ 下一轮再试
    const pendingIds = [...ids].filter((id) => {
      const key = `${scope}:${id}`
      return (
        !hydratedAssetKeysRef.current.has(key) &&
        !hydratingAssetKeysRef.current.has(key) &&
        Number(assetHydrationAttemptsRef.current.get(key) || 0) < 3
      )
    })
    if (!pendingIds.length) return
    pendingIds.forEach((id) => hydratingAssetKeysRef.current.add(`${scope}:${id}`))
    void (async () => {
      const map = new Map<number, string>()
      const results = await Promise.all(
        pendingIds.map(async (id) => {
          try {
            const url = await refreshAssetUrl(ws, id)
            return { id, url: String(url || '') }
          } catch {
            return { id, url: '' }
          }
        }),
      )
      results.forEach(({ id }) => hydratingAssetKeysRef.current.delete(`${scope}:${id}`))
      if (assetHydrationScopeRef.current !== scope) return
      const retryKeys: string[] = []
      results.forEach(({ id, url }) => {
        const key = `${scope}:${id}`
        if (url) {
          map.set(id, url)
          hydratedAssetKeysRef.current.add(key)
          assetHydrationAttemptsRef.current.delete(key)
          return
        }
        const attempt = Number(assetHydrationAttemptsRef.current.get(key) || 0) + 1
        assetHydrationAttemptsRef.current.set(key, attempt)
        if (attempt < 3) retryKeys.push(key)
      })
      const scheduleRetry = () => {
        if (!retryKeys.length || assetHydrationRetryTimerRef.current) return
        const attempt = Math.max(...retryKeys.map((key) => Number(assetHydrationAttemptsRef.current.get(key) || 1)))
        assetHydrationRetryTimerRef.current = window.setTimeout(
          () => {
            assetHydrationRetryTimerRef.current = 0
            if (assetHydrationScopeRef.current === scope) setAssetHydrationVersion((version) => version + 1)
          },
          attempt > 1 ? 1200 : 400,
        )
      }
      if (!map.size) {
        scheduleRetry()
        return
      }
      setShots((prev) =>
        prev.map((sh) => {
          // 该镜内 旧url→新url 映射(元素/额外参考/版本/当前图各自带 asset_id),用于刷新 selectedRefs/版本refs
          const urlRemap = new Map<string, string>()
          const note = (oldUrl: string | undefined, id: any) => {
            const nu = id && map.get(Number(id))
            if (oldUrl && nu) urlRemap.set(oldUrl, nu)
          }
          note(sh.image, sh.imageAssetId)
          sh.subjects.forEach((su) => note(su.image, su.assetId))
          ;(sh.extraRefs || []).forEach((r: any) => note(r?.url, r?.assetId))
          ;(sh.imageVersions || []).forEach((v: any) => {
            if (v && typeof v !== 'string') note(v.url, v.assetId)
          })
          const remap = (u: string) => urlRemap.get(u) || u
          return {
            ...sh,
            image: sh.imageAssetId && map.get(Number(sh.imageAssetId)) ? map.get(Number(sh.imageAssetId))! : sh.image,
            imageVersions: (sh.imageVersions || []).map((v: any) => {
              const o = typeof v === 'string' ? { url: v, assetId: 0 } : v
              const nu = o.assetId && map.get(Number(o.assetId))
              return {
                ...o,
                url: nu || o.url,
                ...(o.refs ? { refs: o.refs.map(remap) } : {}),
              }
            }),
            subjects: sh.subjects.map((su) =>
              su.assetId && map.get(Number(su.assetId)) ? { ...su, image: map.get(Number(su.assetId))! } : su,
            ),
            extraRefs: (sh.extraRefs || []).map((r: any) =>
              r?.assetId && map.get(Number(r.assetId)) ? { ...r, url: map.get(Number(r.assetId))! } : r,
            ),
            selectedRefs: sh.selectedRefs ? sh.selectedRefs.map(remap) : sh.selectedRefs,
            blurredImageUrl:
              sh.blurredImageAssetId && map.get(Number(sh.blurredImageAssetId))
                ? map.get(Number(sh.blurredImageAssetId))!
                : sh.blurredImageUrl,
          }
        }),
      )
      setSubjectAssets((prev) => {
        const next: any = { ...prev }
        for (const [name, e] of Object.entries(prev) as any) {
          const oldIds = e.ids || {}
          let changed = false
          const versions = e.versions.map((u: string) => {
            const id = oldIds[u]
            const nu = id && map.get(Number(id))
            if (nu) {
              changed = true
              return nu
            }
            return u
          })
          if (!changed) continue
          const ids2: Record<string, number> = {}
          const sources2: Record<string, any> = {}
          e.versions.forEach((u: string, i: number) => {
            const id = oldIds[u] || 0
            const nu = versions[i]
            ids2[nu] = id
            if (e.sources?.[u]) sources2[nu] = e.sources[u]
          })
          next[name] = { ...e, versions, ids: ids2, sources: sources2 }
        }
        return next
      })
      // 入口上传图:按 asset_id 刷新签名URL
      setEntryMeta((prev: any) => {
        const aids = prev?.imageAssetIds || []
        if (!Array.isArray(prev?.images) || !aids.length) return prev
        const images = prev.images.map((u: string, i: number) => {
          const nu = aids[i] && map.get(Number(aids[i]))
          return nu || u
        })
        return { ...prev, images }
      })
      // 整片视频:按 asset_id 刷新当前 + 各历史版本签名URL
      setFullVideo((prev) =>
        prev.assetId && map.get(Number(prev.assetId)) ? { ...prev, url: map.get(Number(prev.assetId))! } : prev,
      )
      setVideoVersions((prev) => {
        const next = prev.map((v) =>
          v.assetId && map.get(Number(v.assetId)) ? { ...v, url: map.get(Number(v.assetId))! } : v,
        )
        videoVersionsRef.current = next
        return next
      })
      scheduleRetry()
    })()
  }, [
    assetHydrationVersion,
    entryMeta,
    fullVideo,
    projectId,
    routeId,
    shots,
    started,
    subjectAssets,
    videoVersions,
    workspaceId,
  ])

  // ── 制作图片对话:加载后按 asset_id 重换图片签名URL(草稿里存的签名URL会过期)──
  useEffect(() => {
    if (!hydratedRef.current || imgMsgHydratedRef.current) return
    const ws = Number(workspaceId || 0)
    if (!ws || !started || !isImageMode) return
    const ids = new Set<number>()
    imageMessages.forEach((m) => (m.images || []).forEach((im) => im.assetId && ids.add(Number(im.assetId))))
    imageComposerDraft.images.forEach((image) => image.assetId && ids.add(Number(image.assetId)))
    if (!ids.size) return
    imgMsgHydratedRef.current = true
    void (async () => {
      const map = new Map<number, string>()
      await Promise.all(
        [...ids].map(async (id) => {
          const u = await refreshAssetUrl(ws, id)
          if (u) map.set(id, u)
        }),
      )
      if (!map.size) return
      setImageMessages((prev) =>
        prev.map((m) => ({
          ...m,
          images: (m.images || []).map((im) =>
            im.assetId && map.get(Number(im.assetId)) ? { ...im, url: map.get(Number(im.assetId))! } : im,
          ),
        })),
      )
      setImageComposerDraft((previous) => ({
        ...previous,
        images: previous.images.map((image) =>
          image.assetId && map.get(Number(image.assetId)) ? { ...image, url: map.get(Number(image.assetId))! } : image,
        ),
      }))
    })()
  }, [workspaceId, started, isImageMode, imageMessages, imageComposerDraft.images])

  // ── 草稿:本地(localStorage)+ 后端(/creative/projects/:id/draft)双层持久化 ──
  // 保存队列里的 task 可能晚于发起它的 render 执行，因此不能依赖旧闭包里的页面状态。
  // ref 始终指向最近一次渲染/最近一次后端草稿应用的内容，避免延迟保存把新状态回写成旧步骤。
  const latestDraftStateRef = useRef<SmartDraft>({})
  latestDraftStateRef.current = {
    started,
    requirement,
    reqSummary,
    entryMeta,
    projectName,
    nameTouched,
    step,
    maxReached,
    shots,
    subjectAssets,
    fields,
    projectId: Number(projectIdRef.current || projectId || 0) || 0,
    materialBatchPending,
    scriptPending,
    scriptError,
    lastVideoSig,
    pendingVideoSig,
    faceBlurEnabled,
    marketingOpen,
    marketingText,
    marketingData,
    imageMessages,
    imageComposerDraft,
  }

  /** 同步更新图片消息 state、即时 ref 与草稿快照，供 taskId 回调后立刻可靠落盘。 */
  const commitImageMessages = useCallback((nextOrUpdater: SetStateAction<ChatMessage[]>): ChatMessage[] => {
    const previous = imageMessagesRef.current
    const next =
      typeof nextOrUpdater === 'function'
        ? (nextOrUpdater as (value: ChatMessage[]) => ChatMessage[])(previous)
        : nextOrUpdater
    imageMessagesRef.current = next
    latestDraftStateRef.current = { ...latestDraftStateRef.current, imageMessages: next }
    setImageMessages(next)
    return next
  }, [])

  /** 同步图片输入草稿到 state 与即时快照，返回入口或刷新时都不会丢失未发送内容。 */
  const commitImageComposerDraft = useCallback((draft: ImageComposerDraft) => {
    const next: ImageComposerDraft = {
      text: String(draft.text || ''),
      ratio: String(draft.ratio || '16:9'),
      images: Array.isArray(draft.images) ? draft.images : [],
      outputCount: Math.min(9, Math.max(1, Math.floor(Number(draft.outputCount) || 1))),
    }
    latestDraftStateRef.current = { ...latestDraftStateRef.current, imageComposerDraft: next }
    setImageComposerDraft(next)
    setImageComposerRefCount(next.images.length)
    setImageComposerRatio(next.ratio)
    setImageComposerOutputCount(next.outputCount)
  }, [])

  // 把当前页面状态打包成草稿对象(localStorage 与后端快照共用)
  const currentDraft = (): SmartDraft => {
    const latestState = latestDraftStateRef.current
    const latestFullVideo = fullVideoRef.current || fullVideo
    const latestVideoGenerations = videoGenerationsRef.current
    const latestVideoQueue = videoGenQueueRef.current
    const hasProcessingVideo = latestVideoGenerations.some((g) => g.status === 'processing')
    const recordTaskId =
      Number(latestVideoGenerations.find((g) => g.status === 'processing' && Number(g.taskId || 0) > 0)?.taskId || 0) ||
      0
    const activeVideoTaskId = recordTaskId || (hasProcessingVideo ? Number(vidGenTaskId || 0) || 0 : 0)
    return {
      ...latestState,
      fullVideoUrl: latestFullVideo.url,
      fullVideoAssetId: latestFullVideo.assetId,
      vidGenTaskId: activeVideoTaskId,
      videoVersions: videoVersionsRef.current,
      videoGenerations: getPersistedVideoGenerations(latestVideoGenerations),
      videoGenQueue: latestVideoQueue,
    }
  }
  const hasRestoredVideoInProgress = (d: SmartDraft, generations: GenRecord[], queue: VideoGenJob[]): boolean => {
    if (Number(d.vidGenTaskId || 0) > 0) return true
    if ((generations || []).some((g) => String(g?.status || '') === 'processing' || Number(g?.taskId || 0) > 0))
      return true
    return (queue || []).length > 0
  }

  // 把草稿回填到页面状态(本地恢复 / 后端恢复共用)
  const applyDraft = (d: SmartDraft) => {
    setStarted(true)
    setRequirement(d.requirement || '')
    setReqSummary(d.reqSummary || '')
    if (d.entryMeta) setEntryMeta(d.entryMeta)
    if (d.projectName && (!isUnnamedTitle(d.projectName) || isUnnamedTitle(projectNameRef.current))) {
      projectNameRef.current = d.projectName
      setProjectName(d.projectName)
    }
    nameTouchedRef.current = !!d.nameTouched
    setNameTouched(nameTouchedRef.current)
    const restoredGenerations = getPersistedVideoGenerations((d.videoGenerations as GenRecord[]) || [])
    const restoredVideoQueue = Array.isArray(d.videoGenQueue)
      ? (d.videoGenQueue as any[])
          .map((job) => ({
            ...job,
            id: String(job?.id || ''),
            idempotencyKey:
              String(job?.idempotencyKey || job?.idempotency_key || '') || createVideoTaskIdempotencyKey(),
          }))
          .filter((job) => job.id)
      : []
    const hasRestoredVideo = Boolean(
      d.fullVideoUrl || d.fullVideoAssetId || (Array.isArray(d.videoVersions) && d.videoVersions.length > 0),
    )
    const restoredStep =
      hasRestoredVideoInProgress(d, restoredGenerations, restoredVideoQueue) || hasRestoredVideo
        ? STEPS.length - 1
        : Math.min(STEPS.length - 1, Math.max(0, d.step || 0))
    const restoredMaxReached = Math.max(d.maxReached || 0, restoredStep)
    const restoredShots = Array.isArray(d.shots) ? d.shots : []
    latestDraftStateRef.current = {
      ...d,
      started: true,
      step: restoredStep,
      maxReached: restoredMaxReached,
      shots: restoredShots,
    }
    setStep(restoredStep)
    setMaxReached(restoredMaxReached)
    shotsExplicitlyClearedRef.current = false
    shotsRef.current = restoredShots
    setShots(restoredShots)
    setSubjectAssets(d.subjectAssets || {})
    setFields(d.fields || {})
    const restoredFullVideo = { url: d.fullVideoUrl || '', assetId: d.fullVideoAssetId || 0 }
    fullVideoRef.current = restoredFullVideo
    setFullVideo(restoredFullVideo)
    replaceVideoVersions(Array.isArray(d.videoVersions) ? d.videoVersions : [])
    setVideoGenerations(restoredGenerations)
    syncVideoGenQueue(restoredVideoQueue)
    setLastVideoSig(String(d.lastVideoSig || ''))
    const restoredPendingSig = String(d.pendingVideoSig || '')
    setPendingVideoSig(restoredPendingSig)
    pendingVideoSigRef.current = restoredPendingSig
    // 恢复「一键生成」进行中标记 → 进准备素材步会由 effect 自动续作未出图的素材(不被截断)
    setMaterialBatchPending(!!d.materialBatchPending)
    setScriptPending(!!d.scriptPending)
    setScriptError(String(d.scriptError || ''))
    // 恢复「生成中」:
    // ① 同会话内切走→回来:登记表里还握着那次在途生成 → 直接订阅(即便 taskId 还没存进草稿,
    //    比如切走发生在脱敏/建任务阶段)→ 真正「切到别的页面也继续生成」。
    // ② 否则草稿里有进行中的任务 id(硬刷新后登记表为空)→ 凭它续轮询同一个后端任务(不重新生成)。
    // 注意:不要求"没有旧视频"——重新生成/确认修改时会有上一轮旧视频,但新任务仍在跑,照样要续上。
    const restoredPid = Number(d.projectId || 0) || 0
    if (!subscribeRunningVideo(restoredPid)) {
      const pendingTask =
        Number(d.vidGenTaskId || 0) ||
        Number(restoredGenerations.find((g) => Number(g.taskId || 0) > 0)?.taskId || 0) ||
        0
      if (pendingTask > 0) {
        void resumePendingVideo(pendingTask)
      } else {
        resumeQueuedVideoJobs()
      }
    }
    setMarketingOpen(!!d.marketingOpen)
    setMarketingText(d.marketingText || '')
    setMarketingData((d.marketingData as MarketingBreakdownData) || null)
    const restoredImageMessages = Array.isArray(d.imageMessages) ? (d.imageMessages as ChatMessage[]) : []
    imageMessagesRef.current = restoredImageMessages
    setImageMessages(restoredImageMessages)
    const restoredComposer = d.imageComposerDraft as Partial<ImageComposerDraft> | undefined
    const restoredComposerDraft: ImageComposerDraft = {
      text: String(restoredComposer?.text || ''),
      ratio: String(restoredComposer?.ratio || d.entryMeta?.ratio || '16:9'),
      images: Array.isArray(restoredComposer?.images)
        ? restoredComposer.images
            .map((image: any) => ({
              url: String(image?.url || ''),
              assetId: Math.max(0, Math.floor(Number(image?.assetId || 0) || 0)),
            }))
            .filter((image: ChatImg) => image.url || Number(image.assetId || 0) > 0)
        : [],
      outputCount: Math.min(
        9,
        Math.max(1, Math.floor(Number(restoredComposer?.outputCount || d.entryMeta?.outputCount || 1) || 1)),
      ),
    }
    setImageComposerDraft(restoredComposerDraft)
    setImageComposerRefCount(restoredComposerDraft.images.length)
    setImageComposerRatio(restoredComposerDraft.ratio)
    setImageComposerOutputCount(restoredComposerDraft.outputCount)
    imgMsgHydratedRef.current = false // 恢复后按 asset_id 重换图片签名URL
    autoGenRef.current = true // 已有分镜图/草稿,进入镜头编排不自动重生成
    autoVidRef.current = true
    // 以恢复时的状态作为「已生成」基线签名:之后未改动就不重生成,改了上游再进下一步才重新生成
    shotGenSigRef.current = shotImageInputSig(restoredShots, d.entryMeta || null)
    videoGenSigRef.current = videoInputSig(restoredShots, d.entryMeta || null, d.reqSummary || d.requirement || '')
  }

  const fetchRevision = useCallback(async (id: number, ws: number): Promise<number> => {
    try {
      const proj: any = await getCreativeProject({ projectId: id, workspaceId: ws })
      const r = normRev(proj)
      if (Number.isFinite(r) && projectIdRef.current === id && Number(workspaceIdRef.current || 0) === ws) {
        draftRevisionRef.current = r
      }
      return r
    } catch {
      return NaN
    }
  }, [])

  // 项目标题 PATCH 与草稿 PUT 共用 draft_revision，必须进入同一保存队列，避免并发写入互相 409。
  const patchSmartTitleToBackend = useCallback(
    (id: number, title: string, ws: number): Promise<DraftWriteResult> => {
      const normalizedTitle = String(title || '').trim()
      if (!id || !ws || !normalizedTitle) return Promise.resolve('error')
      const expectedTitle = serverTitleRef.current
      const fallbackContentFingerprint = baseDraftContentFingerprintRef.current
      return enqueueCreativeProjectDraftSave({
        projectId: id,
        workspaceId: ws,
        task: async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              const latestProject: any = await getCreativeProject({ projectId: id, workspaceId: ws })
              if (blockRestrictedProjectRef.current(latestProject, id, ws)) return 'error'
              const latestRevision = normRev(latestProject)
              if (
                Number.isFinite(latestRevision) &&
                projectIdRef.current === id &&
                Number(workspaceIdRef.current || 0) === ws
              ) {
                draftRevisionRef.current = latestRevision
              }
              const latestDraftValue =
                latestProject?.draft_json ?? latestProject?.data?.draft_json ?? latestProject?.draft
              // 标题任务也在草稿保存队列中。等待期间，同一标签页可能已经把图片 taskId、结果或
              // 批次合并写入云端；此时应采用队列前一笔“实际落库”的内容指纹，而不是调用标题
              // 保存时捕获的旧基线。真正来自其他页面的内容仍不会更新该 ref，仍会被下面的 CAS 拦截。
              const expectedContentFingerprint =
                projectIdRef.current === id && Number(workspaceIdRef.current || 0) === ws
                  ? baseDraftContentFingerprintRef.current || fallbackContentFingerprint
                  : fallbackContentFingerprint
              if (!expectedContentFingerprint) return 'conflict'
              assertCreativeDraftContentUnchanged(expectedContentFingerprint, latestDraftValue)
              const latestTitle = String(latestProject?.title || latestProject?.name || '').trim()
              const titleDecision = resolveCreativeProjectTitleWrite(expectedTitle, normalizedTitle, latestTitle)
              if (titleDecision === 'already-saved') return 'saved'
              if (titleDecision === 'conflict') return 'conflict'
              const payload: any = await patchCreativeProject({
                projectId: id,
                workspaceId: ws,
                title: normalizedTitle,
                name: normalizedTitle,
              })
              const nextRevision = normRev(payload)
              if (
                Number.isFinite(nextRevision) &&
                projectIdRef.current === id &&
                Number(workspaceIdRef.current || 0) === ws
              ) {
                draftRevisionRef.current = nextRevision
              } else await fetchRevision(id, ws)
              return 'saved'
            } catch (error) {
              if (isCreativeDraftContentConflictError(error)) return 'conflict'
              const conflict = isDraftConflictError(error)
              const retryable = isRetryableDraftSaveError(error)
              if ((!conflict && !retryable) || attempt >= 2) return 'error'
              if (retryable && !conflict) await waitForDraftSaveRetry(attempt)
              await fetchRevision(id, ws)
            }
          }
          return 'error'
        },
      })
    },
    [fetchRevision],
  )

  const retrySmartCloudSave = async () => {
    const id = Number(projectIdRef.current || 0)
    const ws = Number(workspaceId || 0)
    if (!id || !ws || draftSaveStatusRef.current === 'conflict') return
    const pendingTitle = pendingTitleSaveRef.current
    updateDraftSaveStatus('saving')
    const draftResult = await putSmartDraftToBackend(ws)
    if (projectIdRef.current !== id || Number(workspaceIdRef.current || 0) !== ws || draftResult !== 'saved') {
      return
    }
    if (pendingTitle) {
      const titleResult = await patchSmartTitleToBackend(id, pendingTitle, ws)
      if (
        pendingTitleSaveRef.current !== pendingTitle ||
        projectIdRef.current !== id ||
        Number(workspaceIdRef.current || 0) !== ws
      ) {
        return
      }
      if (titleResult === 'conflict') {
        updateDraftSaveStatus('conflict')
        if (!draftContentConflictNotifiedRef.current) {
          draftContentConflictNotifiedRef.current = true
          showToast('检测到其他页面修改了项目，已停止云端保存，当前页面内容不会覆盖对方修改', 'error')
        }
        return
      }
      if (titleResult !== 'saved') {
        titleSaveFailedRef.current = true
        updateDraftSaveStatus('error')
        return
      }
      titleSaveFailedRef.current = false
      serverTitleRef.current = pendingTitle
      if (pendingAutoTitleCorrectionRef.current === pendingTitle) pendingAutoTitleCorrectionRef.current = ''
      if (pendingTitleSaveRef.current === pendingTitle) pendingTitleSaveRef.current = ''
    }
    updateDraftSaveStatus('saved')
  }

  type SmartDraftSaveRequest = {
    projectId: number
    workspaceId: number
    snapshot: any
    coverAssetId: number
    preserveUpstreamContent: boolean
    initialRevision: number
    baseContentFingerprint: string
    allowCreativeReplace: boolean
  }

  const putSmartDraftToBackend = useLatestCallback((workspaceIdOverride?: number): Promise<DraftWriteResult> => {
    const id = projectIdRef.current
    const ws = Number(workspaceIdOverride || workspaceId || 0)
    const draft = currentDraft()
    if (
      !canPersistSmartProjectDraft({
        applied: appliedRef.current,
        started: Boolean(draft.started),
        projectId: id,
        workspaceId: ws,
      })
    ) {
      return Promise.resolve('error')
    }
    if (draftSaveStatusRef.current === 'conflict') return Promise.resolve('conflict')
    // 保存请求入队时就锁定项目与快照。队列可能晚到 reset / 新项目创建之后才执行，届时绝不能再读可变 ref。
    const snapshot = buildSmartSnapshot(draft, ws)
    if (projectVideoStoreRef.current) {
      snapshot.projectVideoStore = sanitizePersistentProjectVideoStore(projectVideoStoreRef.current, ws)
    }
    const latestGeneratedImageAssetId = [...((draft.imageMessages as ChatMessage[]) || [])]
      .reverse()
      .flatMap((message) => [...(message.images || [])].reverse())
      .map((image) => Number(image.assetId || 0) || 0)
      .find((assetId) => assetId > 0)
    const entryImageAssetId = Number(
      ((draft.entryMeta as any)?.imageAssetIds || []).find((value: any) => Number(value) > 0) || 0,
    )
    const shotCoverAssetId = Number(
      shotsRef.current.find((shot) => Number(shot.imageAssetId || 0) > 0)?.imageAssetId || 0,
    )
    // 图片项目优先采用最新生成结果作封面；视频项目继续使用首个分镜，避免两种模式互相串封面。
    const coverAssetId =
      draft.entryMeta?.mode === 'image'
        ? Number(latestGeneratedImageAssetId || entryImageAssetId || 0)
        : Number(shotCoverAssetId || entryImageAssetId || 0)
    const fingerprint = createDraftFingerprint(snapshot, coverAssetId)
    const contentFingerprint = createCreativeDraftContentFingerprint(snapshot)
    const queuedSave =
      queuedDraftSaveRef.current?.projectId === id && queuedDraftSaveRef.current?.workspaceId === ws
        ? queuedDraftSaveRef.current
        : null
    if (fingerprint && queuedSave?.fingerprint === fingerprint) {
      const adoptedSequence = ++draftSaveSequenceRef.current
      updateDraftSaveStatus('saving')
      return queuedSave.promise.then((result) => {
        if (
          viewAliveRef.current &&
          projectIdRef.current === id &&
          Number(workspaceIdRef.current || 0) === ws &&
          draftSaveSequenceRef.current === adoptedSequence
        ) {
          if (result === 'saved') lastSavedDraftFingerprintRef.current = fingerprint
          const nextStatus: DraftSaveStatus =
            result === 'saved'
              ? titleSaveFailedRef.current
                ? 'error'
                : pendingTitleSaveRef.current
                  ? 'saving'
                  : 'saved'
              : result
          updateDraftSaveStatus(nextStatus)
          if (result === 'conflict' && !draftContentConflictNotifiedRef.current) {
            draftContentConflictNotifiedRef.current = true
            showToast('检测到其他页面修改了项目，已停止云端保存，当前页面内容不会覆盖对方修改', 'error')
          }
        }
        return result
      })
    }
    const saveSequence = ++draftSaveSequenceRef.current
    updateDraftSaveStatus('saving')
    // 同一标签页连续产生不同快照时，后一个快照以“前一个已排队快照”作为预期云端内容。
    // 只有首个明确的新建/重启写入可整版替换；后续快照仍必须经过内容指纹校验。
    const allowCreativeReplace = !queuedSave && allowCreativeReplaceProjectIdRef.current === id
    const request: SmartDraftSaveRequest = {
      projectId: id,
      workspaceId: ws,
      snapshot,
      coverAssetId,
      preserveUpstreamContent: !allowCreativeReplace && !shotsExplicitlyClearedRef.current,
      initialRevision: Number(draftRevisionRef.current || 0) || 0,
      baseContentFingerprint: queuedSave?.contentFingerprint || baseDraftContentFingerprintRef.current,
      allowCreativeReplace,
    }
    const savePromise: Promise<DraftWriteResult> = enqueueCreativeProjectDraftSave({
      projectId: id,
      workspaceId: ws,
      task: async (): Promise<DraftWriteResult> => {
        // 若前一份快照没有真正落库，后一份的预期基线就不可能成立；直接传播其精确结果，
        // 避免把 conflict 降级成普通 error，也避免越过失败快照继续覆盖云端。
        if (queuedSave) {
          const previousResult = await queuedSave.promise
          if (previousResult !== 'saved') return previousResult
          // 前一份快照在真正落库前还会合并后端的视频历史/权限元数据，最终内容指纹可能与
          // “刚入队时”的指纹不同。当前项目必须以它实际落库后的指纹继续 CAS；否则图片
          // 批次最后一张完成并紧接着合并多图消息时，会把同一标签页的串行保存误判成外部修改。
          if (projectIdRef.current === id && Number(workspaceIdRef.current || 0) === ws) {
            request.baseContentFingerprint = baseDraftContentFingerprintRef.current || request.baseContentFingerprint
          }
        }
        try {
          return (await doPutDraft(request)) ? 'saved' : 'error'
        } catch (error) {
          return isCreativeDraftContentConflictError(error) ? 'conflict' : 'error'
        }
      },
    })
      .then((result) => {
        if (
          result === 'saved' &&
          fingerprint &&
          projectIdRef.current === id &&
          Number(workspaceIdRef.current || 0) === ws &&
          draftSaveSequenceRef.current === saveSequence
        ) {
          lastSavedDraftFingerprintRef.current = fingerprint
        }
        if (
          viewAliveRef.current &&
          projectIdRef.current === id &&
          Number(workspaceIdRef.current || 0) === ws &&
          draftSaveSequenceRef.current === saveSequence
        ) {
          const nextStatus: DraftSaveStatus =
            result === 'saved'
              ? titleSaveFailedRef.current
                ? 'error'
                : pendingTitleSaveRef.current
                  ? 'saving'
                  : 'saved'
              : result
          updateDraftSaveStatus(nextStatus)
          if (result === 'conflict' && !draftContentConflictNotifiedRef.current) {
            draftContentConflictNotifiedRef.current = true
            showToast('检测到其他页面修改了项目，已停止云端保存，当前页面内容不会覆盖对方修改', 'error')
          }
        }
        return result
      })
      .finally(() => {
        if (queuedDraftSaveRef.current?.promise === savePromise) queuedDraftSaveRef.current = null
      })
    queuedDraftSaveRef.current = {
      projectId: id,
      workspaceId: ws,
      fingerprint,
      contentFingerprint,
      promise: savePromise,
    }
    return savePromise
  })

  // 把当前草稿写到后端。对齐 2.0 putDraftSnapshot:保存前先确保有当前 revision,
  // 保存后用返回的 revision 同步;返回体没带 revision 则重新拉一次;409 冲突→拉新 revision 重试。
  const doPutDraft = async (request: SmartDraftSaveRequest): Promise<boolean> => {
    const id = request.projectId
    const ws = request.workspaceId
    let snapshot = request.snapshot
    let coverAssetId = request.coverAssetId
    let revision = request.initialRevision
    const intendedContentFingerprint = createCreativeDraftContentFingerprint(request.snapshot)
    const syncRevision = (value: number) => {
      if (!Number.isFinite(value) || value < 0) return
      revision = Math.floor(value)
      // 旧 session 的保存可继续完成，但不能把旧项目 revision 写进新项目会话。
      if (projectIdRef.current === id && Number(workspaceIdRef.current || 0) === ws) {
        draftRevisionRef.current = revision
      }
    }
    const mergeLatestProjectDraft = (latestProj: any, acceptIntendedContent = false) => {
      const next = normRev(latestProj)
      if (Number.isFinite(next)) syncRevision(next)
      const latestDraftJson = latestProj?.draft_json ?? latestProj?.data?.draft_json ?? latestProj?.draft
      if (!request.allowCreativeReplace) {
        const latestContentFingerprint = assertCreativeDraftWriteStillOwned({
          baseFingerprint: request.baseContentFingerprint,
          intendedFingerprint: intendedContentFingerprint,
          latestDraft: latestDraftJson,
          acceptIntendedContent,
        })
        // 当前编辑器的后台完成回调可能已经先写入同一份目标内容；自动保存排到队列时，
        // 应把该内容接纳为新的 CAS 基线，避免把自己的写入误报为并发冲突。
        if (latestContentFingerprint === intendedContentFingerprint) {
          request.baseContentFingerprint = latestContentFingerprint
        }
      }
      snapshot = mergeSnapshotVideoHistory(snapshot, latestDraftJson, {
        preserveUpstreamContent: request.preserveUpstreamContent,
      })
      snapshot = mergeLatestProjectMetadata(snapshot, latestProj)
      const latestDraft = getCreativeProjectDraft(latestProj)
      if (
        projectIdRef.current === id &&
        Number(workspaceIdRef.current || 0) === ws &&
        latestDraft &&
        Object.prototype.hasOwnProperty.call(latestDraft, 'projectVideoStore')
      ) {
        projectVideoStoreRef.current = latestDraft.projectVideoStore ?? null
      }
      if (!coverAssetId) {
        const snapshotShots = Array.isArray(snapshot?.smart?.shots) ? snapshot.smart.shots : []
        coverAssetId =
          Number(snapshotShots.find((shot: any) => Number(shot?.imageAssetId || 0) > 0)?.imageAssetId || 0) || 0
      }
    }
    const refreshLatestProjectDraft = async (acceptIntendedContent = false): Promise<boolean> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const latestProj: any = await getCreativeProject({ projectId: id, workspaceId: ws })
          if (blockRestrictedProject(latestProj, id, ws)) return false
          mergeLatestProjectDraft(latestProj, acceptIntendedContent)
          return true
        } catch (error) {
          if (isCreativeDraftContentConflictError(error)) throw error
          if (!isRetryableDraftSaveError(error) || attempt >= 2) return false
          await waitForDraftSaveRetry(attempt)
        }
      }
      return false
    }
    // 视频生成会有「后台完成写入」与「页面自动保存」并发交错的窗口。
    // 保存前先把后端已存在的视频历史合并回来，避免当前页稍旧的 snapshot 把已完成的视频覆盖掉。
    // 这是整盘 PUT 的安全前提：读取失败绝不能继续写，否则旧标签页会清掉成员权限/归类记录。
    if (!(await refreshLatestProjectDraft())) return false
    // 409 冲突(常见于切空间后 revision 过期):拉最新 revision 再试,最多 3 次,
    // 避免一次冲突就把整版草稿静默丢弃(中途切走/刷新带不回数据的元凶之一)。
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const payload: any = await updateCreativeProjectDraft({
          projectId: id,
          workspaceId: ws,
          draft: snapshot,
          draftRevision: revision,
          coverAssetId,
        })
        const next = normRev(payload)
        if (Number.isFinite(next)) syncRevision(next)
        else {
          const fetched = await fetchRevision(id, ws) // 返回体没带 revision → 重新拉,保持同步
          if (Number.isFinite(fetched)) syncRevision(fetched)
        }
        if (projectIdRef.current === id && Number(workspaceIdRef.current || 0) === ws) {
          baseDraftContentFingerprintRef.current = createCreativeDraftContentFingerprint(snapshot)
          if (request.allowCreativeReplace && allowCreativeReplaceProjectIdRef.current === id) {
            allowCreativeReplaceProjectIdRef.current = 0
          }
          draftContentConflictNotifiedRef.current = false
        }
        return true
      } catch (e: any) {
        const conflict = isDraftConflictError(e)
        const retryable = isRetryableDraftSaveError(e)
        if ((!conflict && !retryable) || attempt >= 2) return false
        if (retryable && !conflict) await waitForDraftSaveRetry(attempt)
        // 冲突或短暂服务异常后不能只沿用旧快照；重新合并最新草稿和元数据后再重试。
        if (!(await refreshLatestProjectDraft(true))) return false
      }
    }
    return false
  }

  const hydratedRef = useRef(false)
  // 「数据已应用」标记:hydratedRef 是在异步 loadProjectById【之前】就置 true 的,存在
  // 「已水合但后端数据还没应用」的窗口;若此时切走,卸载 flush / autosave 会把【初始空态】写盘覆盖好草稿
  // (频繁切换 → 回到分镜脚本"暂无分镜"的根因)。故所有【保存类】逻辑改用本标记:仅在草稿真正应用后才放行。
  // 新建 / 空白入口无异步加载 → 进入即 true;/smart/:id 需等 applyLoadedProject 成功后才 true(失败保持 false,
  // 不让 flush 用空态覆盖)。
  const appliedRef = useRef(false)
  const [draftApplicationVersion, setDraftApplicationVersion] = useState(0)
  useEffect(() => {
    if (draftApplicationVersion > 0) appliedRef.current = true
  }, [draftApplicationVersion])

  // 把后端返回的项目数据应用到本视图:恢复草稿 / 整片兜底 / 标题回填。
  const applyLoadedProject = (proj: any, rid: number, ws: number) => {
    draftRevisionRef.current = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
    const draftJson = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
    if (isHotCopyDraft(draftJson)) {
      navigate(`/hot-copy/${rid}`, { replace: true })
      return
    }
    allowCreativeReplaceProjectIdRef.current = 0
    baseDraftContentFingerprintRef.current = createCreativeDraftContentFingerprint(draftJson)
    draftContentConflictNotifiedRef.current = false
    // 留存项目视频清单存档(归类记录),保存时原样写回,避免被本编辑器的草稿快照覆盖
    {
      let raw: any = draftJson
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw)
        } catch {
          raw = null
        }
      }
      projectVideoStoreRef.current = raw && typeof raw === 'object' ? raw.projectVideoStore || null : null
    }
    const d = parseSmartSnapshot(draftJson)
    const localDraft = loadSmartDraft(ws)
    // 已创建项目以后端项目草稿为权威源，不再让 localStorage 草稿参与覆盖。
    // 否则刷新时可能把本地旧 step 与后端 video task 混合，出现“视频生成中却回到分镜脚本”的错位。
    const recoveredDraft = mergeSmartInFlightRecovery(d, localDraft, rid)
    const fallbackVideo = extractProjectVideoFallback(draftJson, proj)
    // 项目管理可能打开的是某一条历史成片。恢复前先把 smart 快照与项目级视频历史合并，
    // 再统一决定主播放器记录，避免“右侧选中 A、左侧仍播放 B”或只显示 0:00 黑屏。
    const restoredDraft = recoveredDraft
      ? (() => {
          const resolvedVideo = resolveRestoredVideoSelection(
            {
              url: String(recoveredDraft.fullVideoUrl || fallbackVideo.latest.url || ''),
              assetId: Number(recoveredDraft.fullVideoAssetId || fallbackVideo.latest.assetId || 0) || 0,
            },
            mergeVideoVersionLists(
              fallbackVideo.versions,
              Array.isArray(recoveredDraft.videoVersions) ? recoveredDraft.videoVersions : [],
            ),
            requestedProjectVideoSelection,
          )
          return {
            ...recoveredDraft,
            fullVideoUrl: resolvedVideo.current.url,
            fullVideoAssetId: resolvedVideo.current.assetId,
            videoVersions: resolvedVideo.versions,
          }
        })()
      : null
    if (restoredDraft) {
      applyDraft(restoredDraft)
    } else if (fallbackVideo.latest.url || fallbackVideo.latest.assetId) {
      const resolvedVideo = resolveRestoredVideoSelection(
        fallbackVideo.latest,
        fallbackVideo.versions,
        requestedProjectVideoSelection,
      )
      setStarted(true)
      fullVideoRef.current = resolvedVideo.current
      setFullVideo(resolvedVideo.current)
      replaceVideoVersions(resolvedVideo.versions)
      latestDraftStateRef.current = {
        ...latestDraftStateRef.current,
        started: true,
        step: STEPS.length - 1,
        maxReached: Math.max(Number(latestDraftStateRef.current.maxReached || 0), STEPS.length - 1),
      }
      setStep(STEPS.length - 1)
      setMaxReached((value) => Math.max(value, STEPS.length - 1))
    }
    const t = String(proj?.title || proj?.name || '').trim()
    const candidateTitle = t || projectNameRef.current.trim()
    const namingDuration =
      restoredDraft?.entryMeta?.mode === 'video'
        ? parseDurationSeconds(restoredDraft.entryMeta.duration) || undefined
        : undefined
    const namingContext = { flow: 'smart' as const, durationSec: namingDuration }
    const shouldRepairHistoricalAiTitle =
      restoredDraft?.nameTouched === false &&
      !!candidateTitle &&
      !isUnnamedTitle(candidateTitle) &&
      !validateProjectName(candidateTitle, namingContext).valid
    if (shouldRepairHistoricalAiTitle) {
      const repairedTitle = createProjectNameFallback({
        requirement: restoredDraft?.requirement || '',
        ...namingContext,
      })
      projectNameRef.current = repairedTitle
      setProjectName(repairedTitle)
      pendingAutoTitleCorrectionRef.current = repairedTitle
      // 保留服务端旧标题，标题同步 effect 会在草稿 CAS 成功后进行一次安全覆盖。
      serverTitleRef.current = t
    } else if (t) {
      const localTitle = projectNameRef.current
      // 新建项目的默认标题不能覆盖并行返回的 AI 名称；真实服务端标题仍保持权威。
      if (!isUnnamedTitle(t) || isUnnamedTitle(localTitle)) {
        projectNameRef.current = t
        setProjectName(t)
      }
      serverTitleRef.current = t
    }
    // 等上述 React state 真正提交后再放行 autosave / 卸载 flush。异步 GET 回调里立刻
    // 放行仍有一个“ref 已就绪但页面 state 还是初始空值”的覆盖窗口。
    setDraftApplicationVersion((version) => version + 1)
  }

  const blockRestrictedProject = (project: any, expectedProjectId: number, expectedWorkspaceId: number): boolean => {
    const key = smartProjectKey(expectedWorkspaceId, expectedProjectId)
    if (!isCreativeProjectRestrictedForUser(project, currentUserId)) {
      deniedSmartProjectKeys.delete(key)
      return false
    }
    deniedSmartProjectKeys.add(key)
    const localDraft = loadSmartDraft(expectedWorkspaceId)
    if (Number(localDraft?.projectId || 0) === Number(expectedProjectId || 0)) clearSmartDraft(expectedWorkspaceId)
    detachRunningVideoGen('smart', expectedWorkspaceId, expectedProjectId)
    // 旧项目/旧空间的队列可以被安全终止，但不能把用户从已经切换到的新页面踢走。
    // projectId 不能单独标识当前页面：不同工作区可能出现相同 id，权限响应必须同时匹配工作区。
    if (
      projectIdRef.current !== expectedProjectId ||
      Number(workspaceIdRef.current || 0) !== Number(expectedWorkspaceId || 0)
    ) {
      return true
    }
    projectIdRef.current = 0
    setProjectId(0)
    appliedRef.current = false
    allowCreativeReplaceProjectIdRef.current = 0
    pinProjectWorkspaceId(0)
    showToast('您没有权限访问该项目', 'error')
    navigate('/projects', { replace: true })
    return true
  }
  blockRestrictedProjectRef.current = blockRestrictedProject

  // 按 id 从后端拉取项目并恢复草稿。失败时设置 loadError(暴露后端真实原因)并弹 toast,
  // 由渲染层据此显示错误页;成功则清空 loadError。供首次进入与「重试」复用。
  //
  // 深链接(/smart/:id)不带工作空间上下文:当前激活空间若不是项目所属空间,后端会 403/404。
  // 由于「手动切换的空间」只存内存、不持久化(刷新/换设备即丢失),同一链接会出现「有人能开有人不能、
  // 手机上必现」。因此首拉失败(且是 403/404)时,在用户名下其它工作空间里逐个重试,命中即切换激活空间,
  // 让「谁打开、哪台设备、刷不刷新」只要有权限就能进。
  const loadProjectById = async (rid: number, ws: number) => {
    setLoadError('')
    setProjectLoading(true)
    appliedRef.current = false
    projectIdRef.current = rid
    setProjectId(rid)
    try {
      await waitForCreativeProjectDraftSaves({ projectId: rid, workspaceId: ws })
      const proj: any = await getCreativeProject({ projectId: rid, workspaceId: ws })
      if (blockRestrictedProject(proj, rid, ws)) return
      pinProjectWorkspaceId(ws) // 钉住项目所属空间:后续全局切换不影响本项目的保存/计费/素材
      applyLoadedProject(proj, rid, ws)
      return
    } catch (e) {
      const status = Number((e as any)?.status || 0)
      // 仅 403/404(空间不匹配 / 当前空间下查不到)才值得跨空间重试;5xx/网络错误重试别的空间无意义。
      if (status === 403 || status === 404) {
        // 先确保拿到「用户名下完整空间列表」再兜底:/smart 页不在 AppLayout 内,平时没人调 loadWorkspaces,
        // userWorkspaces 为空时 deriveAllWorkspaces 只剩会话回退列表,团队项目会兜底失败 → 误报「项目加载失败」。
        try {
          await useWorkspaceSessionStore.getState().loadWorkspaces()
        } catch {
          /* 拉取失败则用现有候选继续兜底 */
        }
        const candidates = (deriveAllWorkspaces(useWorkspaceSessionStore.getState()) as any[])
          .map((w) => Number(w?.id || 0))
          .filter((id) => id > 0 && id !== ws)
        for (const candidate of candidates) {
          try {
            const proj: any = await getCreativeProject({ projectId: rid, workspaceId: candidate })
            if (blockRestrictedProject(proj, rid, candidate)) return
            pinProjectWorkspaceId(candidate) // 钉住项目所属空间(命中的兜底空间)
            applyLoadedProject(proj, rid, candidate)
            // 命中后只钉住本项目空间,不切换全局团队。后续 autosave / 账单 / 并发均通过 projectWorkspaceId 走项目空间。
            return
          } catch {
            /* 该空间也没有 → 继续试下一个 */
          }
        }
      }
      projectIdRef.current = 0 // 没有有效项目绑定,避免 autosave 把草稿 PUT 到无权访问的项目
      // 若是「本地草稿自动跳转」到了一个当前用户无权访问的项目(403/404,典型:同浏览器换了账号、
      // 或项目已被删)→ 清掉这份陈旧草稿并回落空白入口,而不是弹错误页(否则每次进 /smart 都循环报错)。
      const localDraft = loadSmartDraft(Number(workspaceId || 0))
      const cameFromLocalDraft =
        (location.state as any)?.autoResumed === true && Number(localDraft?.projectId || 0) === rid
      if ((status === 403 || status === 404) && cameFromLocalDraft) {
        clearSmartDraft(Number(workspaceId || 0))
        navigate('/smart', { replace: true })
        return
      }
      // 其余情况(真实深链接、5xx/网络):暴露后端真实原因,不吞成笼统提示。
      const msg = getBusinessErrorMessage(e, '项目加载失败')
      setLoadError(msg)
      showToast(msg, 'error')
    } finally {
      setProjectLoading(false)
    }
  }

  // 错误页「重试」:用当前激活的工作空间重新加载。工作空间未就绪则提示。
  const retryLoadProject = async () => {
    const rid = Number(routeId || 0)
    const ws = Number(workspaceId || 0)
    if (rid <= 0) return
    if (!ws) {
      showToast('工作空间尚未就绪,请稍后重试', 'error')
      return
    }
    setLoadRetrying(true)
    try {
      await loadProjectById(rid, ws)
    } finally {
      setLoadRetrying(false)
    }
  }

  // 进入:有 /smart/:id → 从后端恢复;否则恢复 localStorage 草稿。
  // 用 useLayoutEffect:在浏览器【绘制前】完成"空白 /smart→/smart/:id"的跳转,避免先闪一下初始页。
  useLayoutEffect(() => {
    if (hydratedRef.current) return
    const navState = (location.state as any) || {}
    // 「创建新视频」明确要求进入空白入口：旧项目即使仍在 registry 生成，也只在任务管理里展示，
    // 不能再由 /smart 根路由自动把用户带回旧项目。
    if (navState.taskCenterNewSession) {
      clearSmartDraft(Number(workspaceId || 0))
      clearSmartEntryDraft()
      pinProjectWorkspaceId(0)
      hydratedRef.current = true
      appliedRef.current = true
      return
    }
    if (navState.workspaceSwitchReset) {
      clearSmartEntryDraft()
      pinProjectWorkspaceId(0) // 空白入口切空间:解除项目钉住,后续新建走新的全局空间
      hydratedRef.current = true
      appliedRef.current = true
      navigate('/smart', { replace: true })
      return
    }
    // 从「项目管理 → 新建视频」进入(携带 restartProjectId):全新流程。
    // 不恢复本地草稿、也不跳回旧 /smart/:id;并清掉旧的本地在制草稿,避免它把页面带回上次未完成的步骤。
    // 项目绑定 + 携带素材由 carry effect / useState 初始化器处理。
    if (Number((location.state as any)?.restartProjectId)) {
      clearSmartDraft(Number(workspaceId || 0))
      clearSmartEntryDraft() // 从「项目管理→新建视频」进入:全新流程,清掉入口暂存
      pinProjectWorkspaceId(0) // 全新流程:解除旧项目钉住,新项目用当前全局空间创建
      hydratedRef.current = true
      appliedRef.current = true // 全新流程无异步加载,进入即可放行保存
      return
    }
    const rid = Number(routeId || 0)
    if (rid > 0) {
      const ws = Number(workspaceId || 0)
      if (!ws) return // 等工作空间就绪
      hydratedRef.current = true
      // 已有项目页只读后端项目草稿。加载成功前不置 appliedRef,避免 localStorage 旧草稿或初始空态反写后端。
      void loadProjectById(rid, ws)
    } else {
      // 会话未确定前不要读草稿:草稿按用户隔离(keyOf 用 userId),登录用户在会话就绪前作用域还是 anon,
      // 会读不到自己的 _u<id> 草稿 → 误判"无在制"→ 落空白页且 hydratedRef 置真后不再重试。
      // 故等 isCheckingSession=false(登录用户会话已载 / 匿名已确定)再决定;此处 return 不置 hydratedRef,
      // 会话就绪后 effect 依赖 isCheckingSession 变化会重跑。
      if (isCheckingSession) return
      const runningProject = findRunningVideoGen('smart', Number(workspaceId || 0))
      if (
        runningProject?.meta.projectId &&
        !deniedSmartProjectKeys.has(
          smartProjectKey(Number(workspaceId || 0), Number(runningProject.meta.projectId || 0)),
        )
      ) {
        setProjectLoading(true)
        navigate(`/smart/${runningProject.meta.projectId}`, {
          replace: true,
          state: { registryResumed: true },
        })
        return
      }
      // 点回空白 /smart 时:若本地草稿是个【已开始 + 已建项目】的项目 → 自动跳回那个 /smart/:id,
      // 回到当时那一步(含「生成视频已出片」——出片后仍要能回到视频步看/改/重生成,不能落到空白入口)。
      // 想新建走「创建新视频」(resetToNewVideo 会清草稿,清后此判断为 false → 回到入口)。
      const d = loadSmartDraft(Number(workspaceId || 0))
      const pendingPid = Number(d?.projectId || 0) || 0
      const inProgress = !!d?.started && pendingPid > 0
      if (inProgress) {
        // autoResumed:标记"由本地草稿自动跳转"。若目标项目不属于当前用户(403/404),
        // loadProjectById 会据此清掉陈旧草稿并回落空白入口,而不是弹错误页且每次循环。
        setProjectLoading(true)
        navigate(`/smart/${pendingPid}`, { replace: true, state: { autoResumed: true } })
        return // 不置 hydratedRef,等重定向到 /smart/:id 再水合 + 续轮询
      }
      // 空白 /smart:始终以最初的空输入框进入,不恢复本地草稿。
      // (同一次进入内点「上一步」回到输入框会保留历史输入——那是组件 state,不依赖这里;
      //  切换路由再回来则会重新挂载、state 清空,故得到全新空白页。)
      hydratedRef.current = true
      appliedRef.current = true // 空白入口无异步加载,进入即可放行保存
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, workspaceId, isCheckingSession, location.key])

  /** 同步保存当前图片草稿到本地；返回 false 表示当前会话不具备合法项目写入上下文。 */
  const saveCurrentImageDraftLocally = (workspaceIdOverride?: number): boolean => {
    const ws = Number(workspaceIdOverride || workspaceIdRef.current || 0) || 0
    const draft = currentDraft()
    if (
      !canPersistSmartProjectDraft({
        applied: appliedRef.current,
        started: Boolean(draft.started),
        projectId: projectIdRef.current,
        workspaceId: ws,
      })
    ) {
      return false
    }
    try {
      saveSmartDraft(draft, ws)
    } catch {
      /* 本地存储不可用时仍继续写云端 */
    }
    return true
  }

  /** 图片任务拿到 taskId/结果后立即写本地与云端，避免离开页面早于常规防抖导致恢复凭证丢失。 */
  const checkpointImageDraft = (workspaceIdOverride?: number) => {
    const ws = Number(workspaceIdOverride || workspaceIdRef.current || 0) || 0
    if (!saveCurrentImageDraftLocally(ws)) return
    if (projectIdRef.current) void putSmartDraftToBackend(ws)
  }

  /** 第一笔付费图片任务前必须确认恢复描述符已经写入云端；失败时 fail closed，不创建任务。 */
  const persistImageQueueBeforePaidTask = async (workspaceIdOverride?: number): Promise<DraftWriteResult> => {
    const ws = Number(workspaceIdOverride || workspaceIdRef.current || 0) || 0
    if (!saveCurrentImageDraftLocally(ws) || !projectIdRef.current) return 'error'
    return putSmartDraftToBackend(ws)
  }

  /** 批次完成后把成功结果合并为一条多图回复；失败子任务仍保留，供用户逐张重试。 */
  const collapseCompletedImageBatch = (batchId: string) => {
    if (!batchId) return
    const batch = imageMessagesRef.current
      .filter((message) => message.role === 'assistant' && message.batchId === batchId)
      .sort((left, right) => Number(left.batchIndex || 0) - Number(right.batchIndex || 0))
    if (!batch.length || batch.some((message) => message.status === 'pending')) return
    const successful = batch.filter((message) => message.status === 'done' && (message.images || []).length > 0)
    if (successful.length <= 1) return
    const primaryId = successful[0].id
    const successfulIds = new Set(successful.map((message) => message.id))
    const combinedImages = successful.flatMap((message) => message.images || [])
    commitImageMessages((messages) =>
      messages.flatMap((message) => {
        if (!successfulIds.has(message.id)) return [message]
        if (message.id !== primaryId) return []
        return [
          {
            ...message,
            status: 'done' as const,
            error: undefined,
            images: combinedImages,
            batchIndex: 0,
            batchTotal: combinedImages.length,
          },
        ]
      }),
    )
  }

  /** 积分、鉴权或空间类错误出现后停止尚未提交的子任务，避免继续创建不可支付任务。 */
  const shouldStopImageBatch = (error: unknown): boolean => {
    const message = getBusinessErrorMessage(error, '')
    return /积分|余额|充值|支付|payment|unauthorized|forbidden|工作空间|workspace|并发|concurrency/i.test(message)
  }

  /**
   * 串行收口所有图片 pending 消息：有 taskId 时只恢复原任务，没有 taskId 时用已持久化幂等键创建。
   * 一次只运行一个队列，刷新后也会从第一条未完成子任务继续，不会重复计费。
   */
  const processPendingImageQueue = async (ws: number) => {
    if (!ws || imageGenerationLockRef.current || imageQueueCheckpointBlockedRef.current) return
    if (!imageMessagesRef.current.some((message) => message.role === 'assistant' && message.status === 'pending')) {
      return
    }
    imageGenerationLockRef.current = true
    if (viewAliveRef.current) setImagePreparing(true)
    const context = { workspaceId: ws, projectId: Number(projectIdRef.current || projectId || 0) || 0 }
    let plans: string[] | null = null
    try {
      while (true) {
        const message = imageMessagesRef.current.find((item) => item.role === 'assistant' && item.status === 'pending')
        if (!message) break
        const taskId = Number(message.taskId || 0) || 0
        const request = message.request
        let activeTaskId = taskId
        const patchMessage = (next: Partial<ChatMessage>) =>
          commitImageMessages((messages) =>
            messages.map((item) => (item.id === message.id ? { ...item, ...next } : item)),
          )
        try {
          let result: { url: string; assetId: number }
          if (taskId > 0) {
            syncImageTask(message, 'reconnecting', { taskId, error: '' }, context)
            result = await resumeShotImageGeneration({ workspaceId: ws, taskId })
          } else {
            if (!request || !message.idempotencyKey) {
              throw new Error('图片生成队列缺少恢复信息，请重试这张图片')
            }
            if (!plans) plans = await resolvePlanCandidates()
            result = await generateShotImage({
              workspaceId: ws,
              prompt: request.text || '生成一张营销广告图片',
              refAssetIds: request.refAssetIds || [],
              modelPlanCandidates: plans,
              ratio: request.ratio,
              idempotencyKey: message.idempotencyKey,
              allowTextToImageFallback: false,
              onTask: (nextTaskId) => {
                activeTaskId = nextTaskId
                patchMessage({ taskId: nextTaskId, status: 'pending' })
                syncImageTask(
                  { ...message, taskId: nextTaskId },
                  'processing',
                  { taskId: nextTaskId, error: '' },
                  context,
                )
                checkpointImageDraft(ws)
              },
            })
          }
          patchMessage({
            taskId: activeTaskId,
            status: 'done',
            error: undefined,
            terminalFailure: undefined,
            images: [{ url: result.url, assetId: result.assetId }],
          })
          syncImageTask(
            { ...message, taskId: activeTaskId, status: 'done', images: [result] },
            'succeeded',
            {
              taskId: activeTaskId,
              progress: 100,
              resultUrl: result.url,
              resultAssetId: result.assetId,
              error: '',
            },
            context,
          )
          checkpointImageDraft(ws)
          collapseCompletedImageBatch(String(message.batchId || ''))
        } catch (error: any) {
          const hasSubmittedTask = activeTaskId > 0
          const terminalFailure = hasSubmittedTask && isTerminalShotImageTaskError(error)
          const errorMessage = `${hasSubmittedTask ? (terminalFailure ? '图片任务失败' : '图片任务连接中断') : '图片生成失败'}：${getBusinessErrorMessage(error, '请重试')}${hasSubmittedTask && !terminalFailure ? '。点击重试将继续查询原任务，不会重复计费' : ''}`
          patchMessage({ taskId: activeTaskId, status: 'error', terminalFailure, error: errorMessage })
          syncImageTask(
            { ...message, taskId: activeTaskId },
            hasSubmittedTask && !terminalFailure ? 'reconnecting' : 'failed',
            { taskId: activeTaskId, error: errorMessage },
            context,
          )
          if ((shouldStopImageBatch(error) || (hasSubmittedTask && !terminalFailure)) && message.batchId) {
            const skipped = imageMessagesRef.current.filter(
              (item) => item.batchId === message.batchId && item.status === 'pending' && Number(item.taskId || 0) === 0,
            )
            const skippedError = `${hasSubmittedTask && !terminalFailure ? '批次已暂停，请先继续查询上一张图片' : '批次已停止'}：${errorMessage}`
            commitImageMessages((messages) =>
              messages.map((item) =>
                skipped.some((candidate) => candidate.id === item.id)
                  ? { ...item, status: 'error', terminalFailure: true, error: skippedError }
                  : item,
              ),
            )
            skipped.forEach((item) => syncImageTask(item, 'cancelled', { taskId: 0, error: skippedError }, context))
          }
          checkpointImageDraft(ws)
          collapseCompletedImageBatch(String(message.batchId || ''))
        }
      }
    } finally {
      imageGenerationLockRef.current = false
      if (viewAliveRef.current) setImagePreparing(false)
    }
  }

  useEffect(() => {
    const ws = Number(workspaceId || 0) || 0
    if (!ws || !started || !isImageMode) return
    if (imageMessages.some((message) => message.role === 'assistant' && message.status === 'pending')) {
      void processPendingImageQueue(ws)
    }
    // imageMessages 变化用于发现恢复任务和批次中的下一张；全局锁会阻止重复处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageMessages, isImageMode, started, workspaceId])

  // 自动保存:本地立即(600ms 防抖)+ 后端(1.5s 防抖,仅在已建项目时)
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (
      !canPersistSmartProjectDraft({
        applied: appliedRef.current,
        started,
        projectId: projectIdRef.current,
        workspaceId: ws,
      })
    ) {
      return
    }
    if (projectIdRef.current && (draftSaveStatusRef.current === 'saved' || draftSaveStatusRef.current === 'saving')) {
      draftSaveSequenceRef.current += 1
      draftSaveStatusRef.current = 'dirty'
      setDraftSaveStatus('dirty')
    }
    const local = window.setTimeout(() => saveSmartDraft(currentDraft(), ws), 600)
    const remote = window.setTimeout(() => {
      if (projectIdRef.current) void putSmartDraftToBackend(ws)
    }, 1500)
    return () => {
      window.clearTimeout(local)
      window.clearTimeout(remote)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    started,
    requirement,
    reqSummary,
    entryMeta,
    projectName,
    nameTouched,
    step,
    maxReached,
    shots,
    subjectAssets,
    fields,
    projectId,
    fullVideo,
    videoVersions,
    videoGenerations, // 生成记录(生成中/失败)变化要存盘,切走也能在项目里看到这条草稿
    videoGenQueueDraft, // 尚未真正发出的排队任务也要存盘,恢复后才能继续把整批视频跑完
    lastVideoSig, // 成片内容签名变化(出片成功盖章)要存盘,项目管理据此判「在制/草稿」
    pendingVideoSig, // 在途出片锁定签名:发起时即持久化,完成/刷新恢复时据它盖章
    vidGenTaskId, // 任务 id 变化(生成开始)也要触发保存,否则长轮询期间不存盘 → 切走后无法恢复
    materialBatchPending, // 一键生成标记变化要存盘,切走再回来才能续作
    scriptPending, // 脚本生成标记变化要存盘,切走再回来才能续跑
    scriptError, // 流式中断错误也要存盘，恢复后不能误显示为完整脚本
    marketingOpen,
    marketingText,
    marketingData,
    imageMessages,
    imageComposerDraft,
  ])

  // 卸载即落盘:切到其它页面/路由时,上面的防抖保存会被 cleanup 取消,导致"最后一步操作"没存。
  // 用 ref 持有最新 flush 闭包(避免空依赖 effect 捕获旧 state),仅在真正卸载时强制保存一次:
  // 本地同步写(必成)+ 后端 PUT(SPA 内 fetch 不因组件卸载中断,通常能发完)。
  const flushDraftRef = useRef<() => void>(() => {})
  flushDraftRef.current = () => {
    const ws = Number(workspaceId || 0)
    const draft = currentDraft()
    if (
      !canPersistSmartProjectDraft({
        applied: appliedRef.current,
        started: Boolean(draft.started),
        projectId: projectIdRef.current,
        workspaceId: ws,
      })
    ) {
      return
    }
    try {
      saveSmartDraft(draft, ws)
    } catch {
      /* ignore */
    }
    if (projectIdRef.current) void putSmartDraftToBackend(ws)
  }
  useEffect(() => () => flushDraftRef.current(), [])

  // 项目刚创建绑定:等本流程状态(started / entryMeta / 需求)落定后,立即把首版草稿落盘一次,
  // 不等 1.5s 防抖。这样「建了空壳就马上切走/刷新」也能在项目里看到内容,再次点开能回到流程而非初始页。
  // 用 effect 而非 .then 直接存:effect 在 state 更新提交后运行,currentDraft() 拿到的是最新值(非空)。
  useEffect(() => {
    if (!appliedRef.current || !pendingInitialSaveRef.current) return
    if (!projectIdRef.current || !started) return
    pendingInitialSaveRef.current = false
    const ws = Number(workspaceId || 0)
    try {
      saveSmartDraft(currentDraft(), ws)
    } catch {
      /* ignore */
    }
    void putSmartDraftToBackend(ws)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, started, entryMeta, requirement, shots])

  const goStep = (i: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i))
    setStep(next)
    setMaxReached((m) => Math.max(m, next))
  }

  const guardDurationBeforeNext = async (proceed: () => void) => {
    if (!entryMeta || entryMeta.mode !== 'video') {
      proceed()
      return
    }
    const currentSec = totalDurationSec(shots)
    const expectedSec = parseDurationSeconds(entryMeta.duration) ?? 0
    const maxSec = 15
    if (currentSec > maxSec) {
      durGuardProceedRef.current = null
      setDurGuard({ open: true, currentSec, expectedSec, overMax: true })
      return
    }
    const selectedDuration = validateSmartVideoDuration(entryMeta.duration)
    if (!selectedDuration.valid) {
      showToast(`当前视频时长选项无效，请选择${SUPPORTED_VIDEO_DURATION_LABEL}`, 'error')
      return
    }
    const shotDuration = validateSmartVideoDuration(currentSec)
    if (!shotDuration.valid) {
      durGuardProceedRef.current = null
      showToast(unsupportedVideoDurationMessage(shotDuration.seconds), 'error')
      return
    }
    if (expectedSec > 0 && currentSec > 0 && currentSec !== expectedSec) {
      durGuardProceedRef.current = () => {
        setEntryMeta((m) => (m ? { ...m, duration: `${currentSec}s` } : m))
        proceed()
      }
      setDurGuard({ open: true, currentSec, expectedSec, overMax: false })
      return
    }
    proceed()
  }

  const guardInsertedShotBeforeNext = (proceed: () => void) => {
    if (insertTextGenerating) {
      showToast('请等待新增分镜的 AI 分镜词生成完成', 'error')
      return
    }
    if (shots.length === 0) {
      showToast('请至少添加一个分镜', 'error')
      return
    }
    const incomplete = shots.find((shot) => shot.isNew && !String(shot.desc || '').trim())
    if (incomplete) {
      showToast(`请先填写「${incomplete.no}」的画面描述`, 'error')
      return
    }
    proceed()
  }

  const onNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
    else openComingSoon() // 设置/视频编辑/投前预审/数据看板等未上线项:弹全局「功能待开放」弹窗
  }

  // 「制作新视频」:把整个智能成片流程初始化为全新空白页(等同切换路由再切回来)。
  // 清空本地草稿 + 所有页面状态 + 项目引用,回到入口输入页;入口页 key 自增以重挂载、清空其内部输入。
  const resetToNewVideo = (entryMode?: 'video' | 'image') => {
    if (entryMode === 'image' && imageBusy) {
      showToast('图片正在生成，请等待完成后再创建新对话', 'info')
      return
    }
    projectCreationAttemptRef.current += 1 // 忽略仍在返回途中的旧建项响应，避免它把新会话拉回旧项目
    pendingCreatedProjectRef.current = null
    nameAbortRef.current?.abort()
    nameAbortRef.current = null
    autoNameResumeKeyRef.current = ''
    setNaming(false)
    // 将旧队列交给原 session 的后台 drain；随后换一套全新队列/状态。
    // 旧任务持有入队时锁定的 workspace/project/shots，不会再读取下面即将清空的 ref。
    const previousSessionId = videoGenSessionIdRef.current
    const previousQueue = videoGenQueueRef.current
    if (previousQueue.length && !isVideoSessionOwned(previousSessionId)) {
      void drainVideoGenQueue(previousSessionId, previousQueue)
    }
    if (videoRegistryFollowTimerRef.current) window.clearTimeout(videoRegistryFollowTimerRef.current)
    videoRegistryFollowTimerRef.current = 0
    videoGenOwnedSessionsRef.current.delete(previousSessionId)
    videoGenSessionIdRef.current += 1
    videoGenQueueRef.current = []
    videoGenQueueDraftRef.current = []
    setVideoGenQueueDraft([])
    cancelInsertTextGeneration()
    clearSmartDraft(Number(workspaceId || 0))
    clearSmartEntryDraft() // 重置为全新入口:清掉入口暂存,避免重挂载后又回填旧输入
    pinProjectWorkspaceId(0) // 全新视频:解除项目钉住,回到用全局空间创建
    setStarted(false)
    shotsExplicitlyClearedRef.current = false
    shotsRef.current = []
    setShots([])
    setRequirement('')
    setReqSummary('')
    // 回到入口:默认全清(视频 tab);image=保持「制作图片」tab(供「创建新对话」)
    setEntryMeta(
      entryMode === 'image'
        ? { mode: 'image', style: '', ratio: '16:9', duration: '10s', imageCount: 0, images: [], outputCount: 1 }
        : null,
    )
    projectNameRef.current = '未命名项目'
    setProjectName(projectNameRef.current)
    nameTouchedRef.current = false
    setNameTouched(false)
    setStep(0)
    setMaxReached(0)
    setSubjectAssets({})
    setFields({})
    setShotImgError({})
    setShotImgRetryTokens({})
    setShotImgReloading({})
    fullVideoRef.current = { url: '', assetId: 0 }
    setFullVideo(fullVideoRef.current)
    replaceVideoVersions([])
    setVideoGenerations([])
    clearRunningGeneration()
    setVidGenTaskId(0)
    setVidGenRunning(false)
    setBlurPhase('')
    pendingVideoSigRef.current = ''
    setPendingVideoSig('')
    setMarketingOpen(false)
    setMarketingText('')
    setMarketingData(null)
    imageMessagesRef.current = []
    setImageMessages([])
    setImagePreparing(false)
    imageGenerationLockRef.current = false
    imageQueueCheckpointBlockedRef.current = false
    setImageComposerRefCount(0)
    setImageComposerRatio('16:9')
    setImageComposerOutputCount(1)
    setImageComposerDraft({ text: '', ratio: '16:9', images: [], outputCount: 1 })
    imgMsgHydratedRef.current = false
    projectIdRef.current = 0
    setProjectId(0)
    draftRevisionRef.current = 0
    allowCreativeReplaceProjectIdRef.current = 0
    baseDraftContentFingerprintRef.current = ''
    draftContentConflictNotifiedRef.current = false
    projectVideoStoreRef.current = null
    pendingTitleSaveRef.current = ''
    pendingAutoTitleCorrectionRef.current = ''
    titleSaveFailedRef.current = false
    draftSaveSequenceRef.current += 1
    lastSavedDraftFingerprintRef.current = ''
    queuedDraftSaveRef.current = null
    draftSaveStatusRef.current = 'idle'
    setDraftSaveStatus('idle')
    serverTitleRef.current = ''
    autoVidRef.current = false
    setEntryKey((k) => k + 1)
    navigate('/smart', { state: { taskCenterNewSession: true } })
  }

  const startRename = () => {
    setDraftName(projectName)
    setEditingName(true)
    setTimeout(() => nameInputRef.current?.select(), 0)
  }
  const commitRename = () => {
    const v = draftName.trim()
    if (v) {
      nameAbortRef.current?.abort()
      nameAbortRef.current = null
      setNaming(false)
      projectNameRef.current = v
      setProjectName(v)
      pendingAutoTitleCorrectionRef.current = ''
      nameTouchedRef.current = true
      setNameTouched(true) // 手动命名后,不再被自动命名覆盖
    }
    setEditingName(false)
  }

  // 入口页发送:记录需求/选项,进入流程,并据需求自动命名项目。
  // 生成分镜脚本(本地多模态模型,流式:边生成边显示);失败置错误态,可重试
  const generateScript = async (req: string, meta: EntryMeta) => {
    if (scriptRunningRef.current) return // 已有一条在跑就忽略(marketing/regenerate/续跑多入口并发)
    cancelInsertTextGeneration()
    scriptRunningRef.current = true
    setScriptLoading(true)
    setScriptPending(true) // 标记"脚本生成进行中",随草稿持久;中途切走再回来据此自动续跑(重生成)
    setScriptError('')
    shotsExplicitlyClearedRef.current = false
    shotsRef.current = []
    setShots([])
    autoGenRef.current = false // 新脚本 → 进入镜头编排时重新自动生成分镜图
    let got = 0
    let pendingPartial: Shot[] | null = null
    let partialRenderTimer = 0
    const flushPendingPartial = (urgent = false) => {
      if (partialRenderTimer) {
        window.clearTimeout(partialRenderTimer)
        partialRenderTimer = 0
      }
      const next = pendingPartial
      pendingPartial = null
      if (!next) return
      shotsRef.current = next
      if (urgent) {
        setShots(next)
        return
      }
      startTransition(() => setShots(next))
    }
    const schedulePartialRender = (partial: Shot[]) => {
      pendingPartial = partial
      if (partialRenderTimer) return
      partialRenderTimer = window.setTimeout(() => {
        partialRenderTimer = 0
        flushPendingPartial()
      }, SCRIPT_STREAM_RENDER_INTERVAL_MS)
    }
    try {
      const result = await generateScriptShotsStream(
        {
          requirement: req,
          style: meta.style,
          ratio: meta.ratio,
          duration: meta.duration,
          images: meta.images,
        },
        (partial) => {
          got = partial.length
          schedulePartialRender(partial)
        },
      )
      pendingPartial = null
      if (partialRenderTimer) {
        window.clearTimeout(partialRenderTimer)
        partialRenderTimer = 0
      }
      shotsRef.current = result
      setShots(result)
      // 兜底:对没拆出主体的镜头(弱模型常整体不给 subjects),单独聚焦提取主体后回填。
      // best-effort、并发、不阻塞主流程展示;失败的镜头保持空(可在准备素材步手动补)。
      let withSubjects = result
      const needFill = result.filter((s) => !s.subjects?.length && s.desc)
      if (needFill.length) {
        const filled = await Promise.all(
          needFill.map(async (s) => ({ id: s.id, subs: await extractSubjects(s.desc).catch(() => []) })),
        )
        const subsById = new Map(filled.filter((f) => f.subs.length).map((f) => [f.id, f.subs]))
        if (subsById.size) {
          withSubjects = result.map((s) => (subsById.has(s.id) ? { ...s, subjects: subsById.get(s.id)! } : s))
          setShots(withSubjects)
        }
      }
      // 主推产品锚定:用上传素材识别主推产品并绑定到对应主体(后续走图生图保真、不合并、不进一键批量);
      // 匹配不到则注入「主推产品」主体到所有镜头。best-effort,失败则用原结果。
      let anchored = withSubjects
      if (meta.images?.length) {
        try {
          anchored = await anchorUploadsToSubjects(withSubjects, meta.images, (meta as any).imageAssetIds)
          setShots(anchored)
        } catch {
          /* 锚定失败 → 用原结果 */
        }
      }
      // 主体合并:把「仅单镜出现一次」的多个主体按画面语义并成 1 个组合主体,减少不必要的素材生成
      //(跨镜复用 / 已绑定上传图 / 主推产品锚定的主体保持独立,确保一致性)。best-effort,失败则保持原拆分结果。
      try {
        const merged = await mergeSingleUseSubjects(anchored)
        setShots(merged)
      } catch {
        /* 合并失败 → 保持拆分结果 */
      }
    } catch (e: any) {
      // 流结束前失败时也立即呈现最后一批已收到的有效分镜，保持原有的部分恢复能力。
      flushPendingPartial(true)
      setScriptError(scriptStreamFailureMessage(e, got))
    } finally {
      if (partialRenderTimer) window.clearTimeout(partialRenderTimer)
      scriptRunningRef.current = false
      setScriptLoading(false)
      setScriptPending(false) // 结束(成功/失败)清掉续跑标记,避免恢复时误续
    }
  }

  // 项目名变化时回写后端标题(防抖)。对齐 Vue CreativeScriptView:
  // - title 与 name 一并回写(后端两字段都用,列表/历史才会同步)
  // - 已同步过相同标题则跳过,避免重复 PATCH
  // - 后端已有真实标题时,自动/AI 命名不覆盖;仅用户手动改名(nameTouched)才覆盖
  // best-effort:失败则清掉记录,下次名字再变时重试。
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    if (!projectId || !wsId) return
    const t = projectName.trim()
    if (!t || isUnnamedTitle(t) || t === serverTitleRef.current) return
    const isPendingAutoCorrection = pendingAutoTitleCorrectionRef.current === t
    if (!nameTouched && !isUnnamedTitle(serverTitleRef.current) && !isPendingAutoCorrection) return
    const timer = window.setTimeout(() => {
      pendingTitleSaveRef.current = t
      titleSaveFailedRef.current = false
      // 草稿标题先通过 revision/content CAS；只有成功写入该草稿的标签页才同步项目标题。
      void putSmartDraftToBackend(wsId).then(async (draftResult) => {
        if (
          pendingTitleSaveRef.current !== t ||
          projectIdRef.current !== projectId ||
          Number(workspaceIdRef.current || 0) !== wsId
        ) {
          return
        }
        if (draftResult !== 'saved') return
        const titleResult = await patchSmartTitleToBackend(projectId, t, wsId)
        if (
          pendingTitleSaveRef.current !== t ||
          projectIdRef.current !== projectId ||
          Number(workspaceIdRef.current || 0) !== wsId
        ) {
          return
        }
        if (titleResult === 'saved') {
          serverTitleRef.current = t
          if (pendingAutoTitleCorrectionRef.current === t) pendingAutoTitleCorrectionRef.current = ''
          titleSaveFailedRef.current = false
          pendingTitleSaveRef.current = ''
          updateDraftSaveStatus('saved')
          return
        }
        if (titleResult === 'conflict') {
          updateDraftSaveStatus('conflict')
          if (!draftContentConflictNotifiedRef.current) {
            draftContentConflictNotifiedRef.current = true
            showToast('检测到其他页面修改了项目，已停止云端保存，当前页面内容不会覆盖对方修改', 'error')
          }
          return
        }
        titleSaveFailedRef.current = true
        updateDraftSaveStatus('error')
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [
    nameTouched,
    patchSmartTitleToBackend,
    projectId,
    projectName,
    putSmartDraftToBackend,
    showToast,
    updateDraftSaveStatus,
    workspaceId,
  ])

  // 选中 SKILL:把「想法 + 素材」交给技能包,自动拆解出营销思路建议(只读展示在营销思路拆解步)。
  // 此时 meta.images 多为入口刚转好的 dataURL(尚未落库),正好可直接喂多模态视觉模型。
  const runSkillBreakdown = async (req: string, meta: EntryMeta) => {
    if (!meta.skill) return
    setMarketingLoading(true)
    setMarketingError('')
    setMarketingText('')
    setMarketingData(null)
    try {
      // 产品信息:用户文字 + 全部上传素材(最多 9 张,与入口上限一致)一并喂入(方案 A 多模态),结构化产出
      const data = await skillBreakdownStructured({
        skill: meta.skill,
        requirement: req,
        images: (meta.images || []).slice(0, 9),
      })
      setMarketingData(data)
      setMarketingText(marketingDataToText(data)) // 派生纯文本,供脚本生成/持久化/续接判断复用
    } catch (e: any) {
      setMarketingError(e?.message || '营销思路拆解失败,请重试')
    } finally {
      setMarketingLoading(false)
    }
  }

  // marketingText 始终由 marketingData 派生(供脚本生成/持久化复用)。放 effect 里,
  // 不在事件处理中手动同步,避免和「换一批」等更新方式不一致。
  useEffect(() => {
    if (marketingData) setMarketingText(marketingDataToText(marketingData))
  }, [marketingData])

  // 以下三个均用函数式 updater(与「换一批」完全一致的写法,确保拿到最新 state、可靠触发重渲染)
  // 表格内编辑某维度描述
  const updateMarketingField = (key: MarketingFieldKey, desc: string) => {
    setMarketingData((prev) => (prev ? patchMarketingField(prev, key, { desc }) : prev))
  }
  // 点击候选标签:不改动原描述,把标签作为「已选」徽章追加(已选则忽略)
  const pickMarketingTag = (key: MarketingFieldKey, tag: string) => {
    setMarketingData((prev) => {
      if (!prev) return prev
      const picked = marketingFieldByKey(prev, key)?.picked || []
      if (picked.includes(tag)) return prev
      return patchMarketingField(prev, key, { picked: [...picked, tag] })
    })
  }
  // 移除某维度已选的标签(点击徽章上的 ×)
  const removeMarketingTag = (key: MarketingFieldKey, tag: string) => {
    setMarketingData((prev) => {
      if (!prev) return prev
      const picked = (marketingFieldByKey(prev, key)?.picked || []).filter((t) => t !== tag)
      return patchMarketingField(prev, key, { picked })
    })
  }
  // 换一批:重新生成某维度的候选标签(轻量,据该维度名/描述 + 原始需求 + 已展示项排除)
  const refreshMarketingTags = async (key: MarketingFieldKey) => {
    if (marketingTagBusy[key]) return
    const field = marketingFieldByKey(marketingData, key)
    if (!field) return
    const label = field.desc || field.label || key
    setMarketingTagBusy((m) => ({ ...m, [key]: true }))
    try {
      const opts = await suggestOptions({
        label,
        context: [field.label, reqSummary || requirement, entryMeta?.skill].filter(Boolean).join(' / '),
        exclude: field.tags || [],
      })
      if (opts.length) {
        setMarketingData((prev) => (prev ? patchMarketingField(prev, key, { tags: opts }) : prev))
      }
    } catch {
      /* 换一批失败:静默,保留原标签 */
    } finally {
      setMarketingTagBusy((m) => ({ ...m, [key]: false }))
    }
  }

  // 营销思路拆解「确认」→ 用拆解结果生成分镜脚本,进入分镜脚本步。
  const confirmMarketing = () => {
    if (marketingLoading) return
    setMarketingOpen(false)
    setStep(0)
    setMaxReached(0)
    autoGenRef.current = false
    // 拆解结果作为脚本生成输入(更完整);页面「我的描述」仍展示原始需求。
    if (entryMeta) void generateScript(marketingText || requirement, entryMeta)
  }

  // 营销思路拆解「上一步 / 取消」→ 回到最初输入框(保留上次输入,含已选 SKILL)。
  const cancelMarketing = () => {
    setMarketingOpen(false)
    setStarted(false)
  }

  /** 按本轮真实文生图/图生图参数预估费用，并在创建付费任务前取得用户明确确认。 */
  const confirmImageGenerationCost = async (args: {
    workspaceId: number
    hasRefs: boolean
    ratio: string
    count?: number
  }): Promise<boolean> => {
    setStepCost((previous) => ({ ...previous, loading: true, error: '' }))
    try {
      const plans = await resolvePlanCandidates()
      const estimate: any = await estimateShotImageCost({
        workspaceId: args.workspaceId,
        hasRefs: args.hasRefs,
        ratio: args.ratio,
        modelPlanCandidates: plans,
      })
      if (Number(workspaceIdRef.current || 0) !== args.workspaceId) {
        setStepCost((previous) => ({
          ...previous,
          loading: false,
          error: '工作空间已变化，请重新确认生成费用',
        }))
        showToast('工作空间已变化，本次未发起图片生成', 'info')
        return false
      }
      const count = Math.min(9, Math.max(1, Math.floor(Number(args.count) || 1)))
      const perImageCost = Math.max(0, Number(estimate?.estimated_cost ?? 0) || 0)
      const estimatedCost = perImageCost * count
      const balance = Math.max(0, Number(estimate?.balance ?? 0) || 0)
      const canAfford = estimate?.can_afford !== false && estimatedCost <= balance
      setStepCost({
        loading: false,
        error: '',
        perImage: true,
        count,
        estimate: { estimatedCost, balance, canAfford, perOne: perImageCost },
      })

      if (!canAfford) {
        const recharge = await requestConfirm(
          `本次生成 ${count} 张图片，预计共消耗 ${estimatedCost} 积分（每张约 ${perImageCost} 积分），当前余额 ${balance} 积分。积分不足，系统不会创建生成任务。`,
          {
            title: '积分不足',
            confirmLabel: '前往充值',
            cancelLabel: '暂不生成',
          },
        )
        if (recharge === true) openMemberCenter()
        return false
      }

      const operationLabel = args.hasRefs ? '参考图创作' : '文字生成图片'
      return (
        (await requestConfirm(
          `${operationLabel}将生成 ${count} 张图片，预计共消耗 ${estimatedCost} 积分（每张约 ${perImageCost} 积分），当前余额 ${balance} 积分。图片将按顺序逐张生成，每张对应一笔独立任务。确认后才会创建付费生成任务。`,
          {
            title: '确认生成图片',
            confirmLabel: '确认并生成',
            cancelLabel: '取消',
          },
        )) === true
      )
    } catch (error: any) {
      const message = getBusinessErrorMessage(error, '费用预估失败')
      setStepCost({
        loading: false,
        error: message,
        perImage: true,
        count: Math.min(9, Math.max(1, Math.floor(Number(args.count) || 1))),
        estimate: null,
      })
      showToast(`${message}，为避免未知扣费，本次未发起生成`, 'error')
      return false
    }
  }

  /**
   * 发送一轮图片对话。确认完成后立即返回并清空输入框，真正的长轮询在后台收口；
   * taskId 一返回就写入消息与草稿，刷新后只恢复同一任务，绝不重新提交。
   */
  const sendImageChat = async (
    text: string,
    refUrls: string[],
    ratio: string,
    knownAssetIds: number[] = [],
    outputCount = 1,
    options: { costConfirmed?: boolean; idempotencyKey?: string } = {},
  ): Promise<boolean> => {
    if (imageGenerationLockRef.current) {
      showToast('已有图片正在生成，请等待完成后再发送', 'info')
      return false
    }
    const ws = Number(workspaceIdRef.current || workspaceId || 0) || 0
    if (!ws) {
      showToast('未选择工作空间，无法生成图片', 'error')
      return false
    }

    imageGenerationLockRef.current = true
    setImagePreparing(true)
    let queued = false
    let queuedWorkspaceId = 0
    let preparedMessages: ChatMessage[] = []
    let preparedTaskContext = { workspaceId: 0, projectId: 0 }
    try {
      const count = Math.min(9, Math.max(1, Math.floor(Number(outputCount) || 1)))
      const refs = refUrls
        .map((url, index) => ({ url: String(url || '').trim(), assetId: Number(knownAssetIds[index] || 0) || 0 }))
        .filter((item) => item.url || item.assetId)
      const cache: Record<string, number> = {}
      const missingUrls = [...new Set(refs.filter((item) => !item.assetId && item.url).map((item) => item.url))]
      // 不相关的参考图上传并行执行，减少点击确认前的等待；失败则整轮停止，不能静默改变计费操作。
      await Promise.all(
        missingUrls.map(async (url) => {
          cache[url] = await ensureAssetId(ws, url, cache)
        }),
      )
      const userImages = refs.map((item) => ({
        url: item.url,
        assetId: item.assetId || Number(cache[item.url] || 0) || 0,
      }))
      if (userImages.some((image) => !image.assetId)) {
        throw new Error('参考图上传失败，请重新选择后再试')
      }
      const refAssetIds = userImages.map((image) => image.assetId).filter((assetId) => assetId > 0)
      if (
        !options.costConfirmed &&
        !(await confirmImageGenerationCost({
          workspaceId: ws,
          hasRefs: refAssetIds.length > 0,
          ratio,
          count,
        }))
      ) {
        return false
      }

      const uid = nextMsgId()
      const prompt = text || '生成一张营销广告图片'
      const idempotencyRoot = options.idempotencyKey || createImageChatIdempotencyKey()
      const batchId = count > 1 ? `batch_${idempotencyRoot}` : ''
      const operationCode = refAssetIds.length ? 'image.image_to_image' : 'image.text_to_image'
      const request = {
        text: prompt,
        ratio,
        refAssetIds,
        refImages: userImages,
        outputCount: 1,
      }
      const assistantMessages: ChatMessage[] = Array.from({ length: count }, (_, index) => ({
        id: nextMsgId(),
        role: 'assistant' as const,
        status: 'pending' as const,
        taskId: 0,
        idempotencyKey: count === 1 ? idempotencyRoot : `${idempotencyRoot}_${String(index + 1).padStart(2, '0')}`,
        operationCode,
        ...(batchId ? { batchId, batchIndex: index, batchTotal: count } : {}),
        request,
        startedAt: Date.now(),
      }))
      imageQueueCheckpointBlockedRef.current = true
      preparedMessages = assistantMessages
      commitImageMessages((messages) => [
        ...messages,
        { id: uid, role: 'user', text, images: userImages },
        ...assistantMessages,
      ])
      const taskContext = { workspaceId: ws, projectId: Number(projectIdRef.current || projectId || 0) || 0 }
      preparedTaskContext = taskContext
      assistantMessages.forEach((message) => syncImageTask(message, 'preparing', { taskId: 0, error: '' }, taskContext))
      const checkpointResult = await persistImageQueueBeforePaidTask(ws)
      if (checkpointResult !== 'saved') {
        throw new Error(
          checkpointResult === 'conflict' ? '项目已在其他页面更新，请刷新确认后再生成' : '生成队列保存失败，请稍后重试',
        )
      }
      queued = true
      queuedWorkspaceId = ws
      return true
    } catch (error: any) {
      const errorMessage = getBusinessErrorMessage(error, '图片生成准备失败，请重试')
      if (preparedMessages.length) {
        const preparedIds = new Set(preparedMessages.map((message) => message.id))
        const safeError = `${errorMessage}，未提交任何付费任务`
        commitImageMessages((messages) =>
          messages.map((message) =>
            preparedIds.has(message.id)
              ? { ...message, status: 'error', terminalFailure: true, error: safeError }
              : message,
          ),
        )
        preparedMessages.forEach((message) =>
          syncImageTask(message, 'failed', { taskId: 0, error: safeError }, preparedTaskContext),
        )
        saveCurrentImageDraftLocally(preparedTaskContext.workspaceId)
        showToast(safeError, 'error')
      } else {
        showToast(errorMessage, 'error')
      }
      return false
    } finally {
      imageQueueCheckpointBlockedRef.current = false
      imageGenerationLockRef.current = false
      setImagePreparing(false)
      if (queued && queuedWorkspaceId) {
        window.setTimeout(() => void processPendingImageQueue(queuedWorkspaceId), 0)
      }
    }
  }

  /**
   * 已有 taskId 且未确认终态时只恢复原任务，不弹新费用确认也不创建新任务；
   * 只有后端明确终态失败，才按原输入重新确认费用并生成。
   */
  const retryImageMessage = (message: ChatMessage): Promise<boolean> => {
    const existingTaskId = Number(message.taskId || 0) || 0
    if (existingTaskId > 0 && message.terminalFailure !== true) {
      if (imageGenerationLockRef.current || imageQueueCheckpointBlockedRef.current) {
        showToast('已有图片任务正在处理，请稍后再试', 'info')
        return Promise.resolve(false)
      }
      commitImageMessages((messages) =>
        messages.map((item) =>
          item.id === message.id ? { ...item, status: 'pending', terminalFailure: false, error: undefined } : item,
        ),
      )
      const context = {
        workspaceId: Number(workspaceIdRef.current || workspaceId || 0) || 0,
        projectId: Number(projectIdRef.current || projectId || 0) || 0,
      }
      syncImageTask(message, 'reconnecting', { taskId: existingTaskId, error: '' }, context)
      checkpointImageDraft(context.workspaceId)
      window.setTimeout(() => void processPendingImageQueue(context.workspaceId), 0)
      return Promise.resolve(true)
    }

    const storedRequest = message.request
    if (storedRequest) {
      return sendImageChat(
        storedRequest.text,
        (storedRequest.refImages || []).map((image) => image.url),
        storedRequest.ratio || entryMeta?.ratio || '16:9',
        storedRequest.refAssetIds || [],
        1,
        { idempotencyKey: existingTaskId > 0 ? undefined : message.idempotencyKey },
      )
    }
    const index = imageMessagesRef.current.findIndex((item) => item.id === message.id)
    const previousUser = [...imageMessagesRef.current.slice(0, Math.max(0, index))]
      .reverse()
      .find((item) => item.role === 'user')
    return sendImageChat(
      previousUser?.text || '',
      (previousUser?.images || []).map((image) => image.url),
      entryMeta?.ratio || '16:9',
      (previousUser?.images || []).map((image) => Number(image.assetId || 0) || 0),
      1,
      { idempotencyKey: existingTaskId > 0 ? undefined : message.idempotencyKey },
    )
  }

  /** 使用全站统一安全下载链路保存生成图；有 assetId 时先刷新为当前工作空间的可用地址。 */
  const downloadImageMessage = async (image: { url: string; assetId?: number }) => {
    try {
      const result = await downloadToDisk({
        fileName: buildDownloadName(projectNameRef.current || 'AI图片', new Date(), 'png'),
        mimeType: 'image/png',
        resolveUrl: async () => {
          const assetId = Number(image.assetId || 0) || 0
          if (!assetId) return image.url
          return (await refreshAssetUrl(Number(workspaceIdRef.current || 0), assetId)) || image.url
        },
      })
      if (result === 'done') showToast('图片已保存', 'success')
      else if (result === 'started') showToast('已开始下载图片', 'success')
    } catch (error) {
      showToast(getBusinessErrorMessage(error, '图片下载失败，请稍后重试'), 'error')
    }
  }

  /** 非破坏性返回图片入口：保留项目、消息和未发送的修改内容。 */
  const backFromImageChat = (draft: ImageComposerDraft) => {
    commitImageComposerDraft(draft)
    checkpointImageDraft(Number(workspaceIdRef.current || workspaceId || 0))
    setStarted(false)
  }

  /**
   * 把一至九张生成结果交给全新的视频项目。整批图片先落为可恢复素材，原图片项目保存成功后
   * 再进入可编辑的视频入口；不在当前项目内切换 mode，避免图片历史和视频草稿混在同一个项目中。
   */
  const continueImagesAsVideo = async (selections: ImageVideoSelection[]) => {
    if (imageBusy) {
      showToast('请等待当前图片全部生成完成后再制作视频', 'info')
      return
    }
    const uniqueSelections: ImageVideoSelection[] = []
    const seenImages = new Set<string>()
    for (const selection of selections || []) {
      const image = selection?.image
      const key = Number(image?.assetId || 0) > 0 ? `asset:${Number(image.assetId)}` : `url:${String(image?.url || '')}`
      if ((!image?.url && Number(image?.assetId || 0) <= 0) || seenImages.has(key)) continue
      seenImages.add(key)
      uniqueSelections.push(selection)
    }
    if (!uniqueSelections.length) {
      showToast('请先选择至少一张图片', 'info')
      return
    }
    if (uniqueSelections.length > 9) {
      showToast('最多选择 9 张图片制作视频', 'info')
      return
    }
    const sourceWorkspaceId = Number(workspaceIdRef.current || workspaceId || 0) || 0
    if (!sourceWorkspaceId) {
      showToast('当前图片项目没有有效工作空间，无法继续制作视频', 'error')
      return
    }
    if (sourceWorkspaceId !== Number(globalWorkspaceId || 0)) {
      showToast('请先切换到该图片项目所属空间，再用图片制作视频', 'info')
      return
    }
    let durableImages: { images: string[]; imageAssetIds: number[] }
    try {
      durableImages = await persistSmartEntryImages(
        sourceWorkspaceId,
        uniqueSelections.map(({ image }) => image.url),
        persistImageAsset,
        uniqueSelections.map(({ image }) => Number(image.assetId || 0) || 0),
      )
    } catch (error) {
      showToast(getBusinessErrorMessage(error, '图片素材保存失败，请稍后重试'), 'error')
      return
    }
    const preparedImages: Array<{
      sourceMessageId: string
      sourceUrl: string
      sourceAssetId: number
      url: string
      assetId: number
    }> = uniqueSelections.map(({ image, message }, index) => ({
      sourceMessageId: String(message?.id || ''),
      sourceUrl: image.url,
      sourceAssetId: Math.max(0, Math.floor(Number(image.assetId || 0) || 0)),
      url: durableImages.images[index] || image.url,
      assetId: Number(durableImages.imageAssetIds[index] || 0) || 0,
    }))

    commitImageMessages((messages) =>
      messages.map((message) => {
        const replacements = preparedImages.filter(({ sourceMessageId }) => sourceMessageId === message.id)
        if (!replacements.length) return message
        return {
          ...message,
          images: (message.images || []).map((candidate) => {
            const replacement = replacements.find(
              ({ sourceUrl, sourceAssetId }) =>
                candidate.url === sourceUrl && Number(candidate.assetId || 0) === sourceAssetId,
            )
            return replacement ? { ...candidate, url: replacement.url, assetId: replacement.assetId } : candidate
          }),
        }
      }),
    )
    saveCurrentImageDraftLocally(sourceWorkspaceId)
    const saveResult = await putSmartDraftToBackend(sourceWorkspaceId)
    if (saveResult !== 'saved') {
      showToast(
        saveResult === 'conflict'
          ? '原图片项目已在其他页面更新，请刷新确认后再制作视频'
          : '原图片项目保存失败，暂未跳转，请稍后重试',
        'error',
      )
      return
    }

    navigate('/smart', {
      state: {
        taskCenterNewSession: true,
        carryMode: 'video',
        carryRatio: entryMeta?.ratio || imageComposerRatio || '16:9',
        carryImages: preparedImages.map(({ url, assetId }) => ({ url, assetId })),
        sourceImageProjectId: Number(projectIdRef.current || 0) || 0,
        sourceWorkspaceId,
      },
    })
  }

  // 入口提交「输入文字生成」→ 需登录(免登录可进页面/输入,但生成需登录)
  const handleStart = async (req: string, meta: EntryMeta): Promise<boolean> => {
    if (meta.mode === 'video') {
      const durationValidation = validateCreativeDurationSelection(req, meta.duration, {
        supportedDurations: SMART_VIDEO_DURATIONS,
        supportedDurationLabel: SUPPORTED_VIDEO_DURATION_LABEL,
      })
      if (!durationValidation.valid) {
        showToast(durationValidation.message, 'error')
        return false
      }
    }
    if (!(await requireAuth())) return false
    // 从已有图片项目返回入口后切到「制作视频」时，必须先 fork 新会话，不能覆盖当前图片项目。
    if (entryMeta?.mode === 'image' && meta.mode === 'video' && Number(projectIdRef.current || 0) > 0) {
      const sourceWorkspaceId = Number(workspaceIdRef.current || workspaceId || 0) || 0
      if (!sourceWorkspaceId || sourceWorkspaceId !== Number(globalWorkspaceId || 0)) {
        showToast('请先切换到该图片项目所属空间，再开始制作视频', 'info')
        return false
      }
      const previousStarted = Boolean(latestDraftStateRef.current.started)
      latestDraftStateRef.current = { ...latestDraftStateRef.current, started: true }
      checkpointImageDraft(sourceWorkspaceId)
      const saveResult = await putSmartDraftToBackend(sourceWorkspaceId)
      latestDraftStateRef.current = { ...latestDraftStateRef.current, started: previousStarted }
      if (saveResult !== 'saved') {
        showToast(
          saveResult === 'conflict'
            ? '图片项目已在其他页面更新，请刷新确认后再继续'
            : '图片项目保存失败，暂未创建视频项目',
          'error',
        )
        return false
      }
      navigate('/smart', {
        state: {
          taskCenterNewSession: true,
          carryMode: 'video',
          carryText: req,
          carryRatio: meta.ratio,
          carryImages: (meta.images || []).map((url, index) => ({
            url,
            assetId: Number(meta.imageAssetIds?.[index] || 0) || 0,
          })),
          sourceImageProjectId: Number(projectIdRef.current || 0) || 0,
          sourceWorkspaceId,
        },
      })
      return true
    }
    return startCreation(req, meta)
  }
  const startCreation = async (req: string, meta: EntryMeta): Promise<boolean> => {
    if (creationStartingRef.current) return false
    creationStartingRef.current = true
    const wsId = Number(workspaceId || 0)
    if (!wsId) {
      creationStartingRef.current = false
      showToast('工作空间尚未加载完成，请稍后重试', 'error')
      return false
    }

    if (
      meta.mode === 'image' &&
      !(await confirmImageGenerationCost({
        workspaceId: wsId,
        hasRefs: (meta.images || []).length > 0,
        ratio: meta.ratio || '16:9',
        count: meta.outputCount || 1,
      }))
    ) {
      creationStartingRef.current = false
      return false
    }

    const creationAttempt = ++projectCreationAttemptRef.current
    const pendingProject = pendingCreatedProjectRef.current
    const reusablePendingProjectId =
      pendingProject?.workspaceId === wsId ? Number(pendingProject.projectId || 0) || 0 : 0
    const existingProjectId = Number(projectIdRef.current || 0) || reusablePendingProjectId
    const needsProject = !existingProjectId

    if (needsProject) {
      draftRevisionRef.current = 0
      draftContentConflictNotifiedRef.current = false
      serverTitleRef.current = ''
    }

    try {
      // 建项目与素材上传互不依赖，并行准备；任一失败都不会启动 AI 生成。
      const [mediaResult, projectResult] = await Promise.allSettled([
        persistSmartEntryImages(wsId, meta.images || [], persistImageAsset, meta.imageAssetIds || []),
        needsProject ? createCreativeProject({ workspace_id: wsId }) : Promise.resolve(null),
      ])

      if (projectCreationAttemptRef.current !== creationAttempt || Number(workspaceIdRef.current || 0) !== wsId) {
        return false
      }

      if (projectResult.status === 'rejected') {
        throw new Error(getBusinessErrorMessage(projectResult.reason, '项目创建失败，请稍后重试'))
      }

      let readyProjectId = existingProjectId
      if (needsProject) {
        readyProjectId = resolveProjectId(projectResult.value)
        if (!readyProjectId) throw new Error('项目创建失败：服务端未返回有效项目 ID')
        // 素材若失败，保留本次已创建的空项目供原页面重试，避免每次重试都创建一个新空壳。
        pendingCreatedProjectRef.current = { workspaceId: wsId, projectId: readyProjectId }
      }

      if (mediaResult.status === 'rejected') throw mediaResult.reason
      const durableMeta: EntryMeta = {
        ...meta,
        images: mediaResult.value.images,
        imageAssetIds: mediaResult.value.imageAssetIds,
      }

      if (!projectIdRef.current) {
        allowCreativeReplaceProjectIdRef.current = readyProjectId
        projectIdRef.current = readyProjectId
        setProjectId(readyProjectId)
      }
      pinProjectWorkspaceId(wsId)
      pendingCreatedProjectRef.current = null
      pendingInitialSaveRef.current = true
      // restartProjectId 存在浏览器历史状态中，强制刷新后仍会保留。用户提交新入口后，
      // 立即绑定到正式项目地址并替换这份一次性状态，确保刷新时恢复已保存项目，
      // 而不是再次进入空白的“重新创建”分支。
      if (Number(routeId || 0) !== readyProjectId || explicitFreshEntrySession) {
        navigate(`/smart/${readyProjectId}`, {
          replace: true,
          state: {
            autoNameRequirement: req,
            smartCreationBindProjectId: readyProjectId,
            smartCreationBindSessionToken: routeSessionToken,
            smartCreationBindWorkspaceId: wsId,
          },
        })
      }

      setRequirement(req)
      setEntryMeta(durableMeta)
      setStarted(true)
      setStep(0)
      setMaxReached(0)
      shotsExplicitlyClearedRef.current = false
      shotsRef.current = []
      setShots([])
      setScriptError('')
      const imageMode = durableMeta.mode === 'image'
      if (imageMode) {
        imageMessagesRef.current = []
        setImageMessages([])
        const nextComposerDraft: ImageComposerDraft = {
          text: '',
          ratio: durableMeta.ratio || '16:9',
          images: [],
          outputCount: Math.min(9, Math.max(1, Math.floor(Number(durableMeta.outputCount) || 1))),
        }
        setImageComposerDraft(nextComposerDraft)
        setImageComposerRefCount(0)
        setImageComposerRatio(nextComposerDraft.ratio)
        setImageComposerOutputCount(nextComposerDraft.outputCount)
        latestDraftStateRef.current = {
          ...latestDraftStateRef.current,
          imageComposerDraft: nextComposerDraft,
        }
      }
      imgMsgHydratedRef.current = false
      setMarketingOpen(imageMode ? false : !!durableMeta.skill)
      setMarketingText('')
      setMarketingData(null)
      setMarketingError('')

      latestDraftStateRef.current = {
        ...latestDraftStateRef.current,
        started: true,
        requirement: req,
        entryMeta: durableMeta,
        projectId: readyProjectId,
        imageMessages: imageMode ? [] : latestDraftStateRef.current.imageMessages,
      }

      // 只有项目与入口素材均可恢复后，才允许发起会计费的生成任务。
      if (imageMode) {
        void sendImageChat(
          req,
          durableMeta.images || [],
          durableMeta.ratio,
          durableMeta.imageAssetIds,
          durableMeta.outputCount || 1,
          { costConfirmed: true },
        )
      } else if (durableMeta.skill) {
        void runSkillBreakdown(req, durableMeta)
      } else {
        void generateScript(req, durableMeta)
      }

      if (req.trim().length > 90) {
        summarizeRequirement(req)
          .then((summary) => setReqSummary(summary || req))
          .catch(() => setReqSummary(req))
      } else {
        setReqSummary(req)
      }
      return true
    } catch (error) {
      const fallback = error instanceof Error && error.message ? error.message : '创作准备失败，请稍后重试'
      showToast(getBusinessErrorMessage(error, fallback), 'error')
      return false
    } finally {
      creationStartingRef.current = false
    }
  }

  // 自动命名项目:有需求 → 按需求命名(generateProjectName);无需求但有上传素材 → 据素材图命名
  // (generateProjectNameFromImages,多模态读图)。用户已手动改名 / 正在命名 / 需求与素材皆空 则跳过。
  const autoNameProject = async (reqArg?: string, imagesArg?: string[]) => {
    const req = (reqArg ?? requirement).trim()
    const images = (imagesArg || []).filter(Boolean)
    const namingContext = {
      flow: 'smart' as const,
      durationSec: entryMeta?.mode === 'video' ? parseDurationSeconds(entryMeta.duration) || undefined : undefined,
    }
    if (nameTouchedRef.current || naming) return
    if (!req && !images.length) return
    nameAbortRef.current?.abort()
    const ctrl = new AbortController()
    nameAbortRef.current = ctrl
    setNaming(true)
    try {
      const nm = req
        ? await generateProjectName({ requirement: req, ...namingContext }, ctrl.signal)
        : await generateProjectNameFromImages(images, { requirement: '', ...namingContext }, ctrl.signal)
      if (nameAbortRef.current === ctrl && !nameTouchedRef.current) {
        projectNameRef.current = nm
        setProjectName(nm)
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError' && nameAbortRef.current === ctrl && !nameTouchedRef.current) {
        // AI 失败或返回跨流程/错误秒数名称时，仅做本地兜底；不重试 AI，避免额外计费。
        const fallback = createProjectNameFallback({ requirement: req, ...namingContext })
        projectNameRef.current = fallback
        setProjectName(fallback)
      }
    } finally {
      if (nameAbortRef.current === ctrl) {
        nameAbortRef.current = null
        setNaming(false)
      }
    }
  }

  // 项目绑定/加载后，依据需求或素材继续 AI 命名；同时修复历史遗留的未命名草稿。
  useEffect(() => {
    const id = Number(projectId || 0)
    if (!id || !appliedRef.current || nameTouched || naming || !isUnnamedTitle(projectName)) return
    const req = requirement.trim() || String((location.state as any)?.autoNameRequirement || '').trim()
    const images = Array.isArray(entryMeta?.images) ? entryMeta.images.filter(Boolean) : []
    if (!req && !images.length) return
    const key = `${id}:${req}:${images.length}`
    if (autoNameResumeKeyRef.current === key) return
    autoNameResumeKeyRef.current = key
    void autoNameProject(req, req ? undefined : images)
    // autoNameProject 有意通过 ref 读取最新的手动命名状态，依赖项无需重复展开。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryMeta?.images, nameTouched, naming, projectId, projectName, requirement])

  // 下载当前整片视频:优先按 asset_id 取新签名URL → fetch 成 blob 下载;CORS 失败则新标签打开
  // 下载视频:弹「另存为」让用户自选保存位置(不支持的浏览器回退自动下载)。
  // 解析 URL 时按 asset_id 刷新签名 URL,避免过期下载失败。
  const handleDownloadVideo = async () => {
    if (!fullVideo.url) {
      showToast('请先生成视频', 'info')
      return
    }
    const fileName = buildDownloadName(projectName || '视频', new Date())
    try {
      await downloadToDisk({
        fileName,
        resolveUrl: async () => {
          const ws = Number(workspaceId || 0)
          let url = fullVideo.url
          if (ws && fullVideo.assetId) {
            const fresh = await refreshAssetUrl(ws, fullVideo.assetId)
            if (fresh) url = fresh
          }
          return url
        },
      })
    } catch (e: any) {
      // 内容为空/未就绪等:明确提示,避免用户拿到空 mp4 还不知情
      showToast(e?.message || '视频下载失败,请稍后重试', 'error')
    }
  }

  /** 播放失败时按 assetId 获取可用地址，并只更新仍指向该版本的主播放器，避免异步响应覆盖用户新选择。 */
  const refreshVideoForPlayback = useCallback(
    async (video: { url: string; assetId: number }): Promise<{ url: string; assetId: number } | void> => {
      const ws = Number(workspaceIdRef.current || workspaceId || 0)
      const assetId = Number(video.assetId || 0) || 0
      if (!ws || !assetId) return
      try {
        const url = String((await refreshAssetUrl(ws, assetId)) || '').trim()
        if (!url || Number(workspaceIdRef.current || 0) !== ws) return
        const next = { url, assetId }
        const current = fullVideoRef.current
        const stillSelected =
          Number(current.assetId || 0) === assetId ||
          (!current.assetId && stableMediaUrlKey(current.url) === stableMediaUrlKey(video.url))
        if (stillSelected) {
          fullVideoRef.current = next
          setFullVideo(next)
        }
        setVideoVersions((previous) => {
          const updated = previous.map((version) =>
            Number(version.assetId || 0) === assetId ? { ...version, url } : version,
          )
          videoVersionsRef.current = updated
          return updated
        })
        return next
      } catch {
        return
      }
    },
    [workspaceId],
  )

  // ── 底栏导航箭头(上一步 / 下一步),与各步「主操作按钮」分离 ──
  // 上一步:step0 → 营销拆解(用了 skill)/ 入口;其余 → 上一步骤(纯导航,不重生成)。
  const goPrev = () => {
    if (step === 0) {
      if (entryMeta?.skill) setMarketingOpen(true)
      else setStarted(false)
    } else {
      goStep(step - 1)
    }
  }
  // 下一步:仅在「已生成过」的步骤之间向前导航(step < maxReached);前沿(下一步尚未生成)置灰,
  // 首次生成只走主按钮(确认脚本 / 镜头编排 / 生成视频)。
  const canGoNext = step < maxReached && !insertTextGenerating
  const goNext = () => {
    if (canGoNext) goStep(step + 1)
  }

  // 各步「主操作按钮」(不含上一步/下一步,导航箭头单独渲染)
  const bottomButtons: BottomButton[] = (() => {
    // 任意分镜图生成中(批量 shotGenRunning 或单张 shotGen[id])→ 禁用镜头编排步的生成类按钮
    const anyShotGenerating = shotGenRunning || Object.values(shotGen).some(Boolean)
    // 准备素材:所有主体素材是否都已就绪 —— 每个主体名都要有图;批量/单体生成中视为未完成。
    // 含主推产品(refImage 锚定)主体:它不进一键批量,须用户手动生成,这里同样要求它有图才放行。
    const subjNames = Array.from(
      new Set(shots.flatMap((sh) => sh.subjects.map((su) => stripAt(su.tag)).filter(Boolean))),
    )
    const anySubjectGenerating = batchGenning || Object.values(subjectGenerating).some(Boolean)
    const materialsAllReady = !anySubjectGenerating && subjNames.every((n) => !!subjectImageOf(n))
    switch (step) {
      case 0: {
        const revisitingScriptStep = maxReached >= 1
        return [
          {
            // 文案始终保持「确认脚本」;从下一步返回后再点,行为改为进入「准备素材」并重生成素材。
            label: '确认脚本',
            variant: 'primary',
            action: () => {
              guardInsertedShotBeforeNext(() => {
                void guardDurationBeforeNext(() => {
                  if (revisitingScriptStep) {
                    forceFreshMaterialsRef.current = true
                    clearAllSubjectMaterials()
                  }
                  goStep(1)
                  if (revisitingScriptStep) generateAllSubjects()
                })
              })
            },
            disabled: scriptLoading || insertTextGenerating || Boolean(scriptError),
            tip: scriptError ? '脚本生成未完整结束，请先重新生成' : undefined,
          },
        ]
      }
      case 1: {
        const revisitingShotStep = maxReached >= 2
        return [
          {
            // 文案统一改为「生成分镜」;首次点击进入镜头编排,返回后再点则全量重新生成分镜。
            label: '生成分镜',
            variant: 'primary',
            action: () => {
              guardInsertedShotBeforeNext(() => {
                void guardDurationBeforeNext(() => {
                  if (revisitingShotStep) {
                    void (async () => {
                      await cancelShotGeneration()
                      const nextShots = resetShotArrangementOutputs(shots)
                      setShots(nextShots)
                      setShotImgError({})
                      setShotImgRetryTokens({})
                      setShotImgReloading({})
                      shotGenSigRef.current = ''
                      autoGenRef.current = true
                      goStep(2)
                      void generateShotImages(nextShots)
                    })()
                    return
                  }
                  autoGenRef.current = false
                  goStep(2)
                })
              })
            },
            // 素材未全部生成完毕不可进入镜头编排(含主推产品需手动生成)
            disabled: scriptLoading || !materialsAllReady,
            tip: anySubjectGenerating
              ? '素材生成中,请稍候…'
              : !materialsAllReady
                ? '请先完成所有素材的生成(主推产品需手动点击生成)再进入镜头编排'
                : undefined,
          },
        ]
      }
      case 2: {
        // 参与视频的分镜:每张都要有图且加载成功(无图/加载失败 → 不能生成视频)
        const activeShots = shots.filter((s) => s.includeInVideo !== false)
        const failedShotImages = activeShots.filter((shot) => shotImgError[shot.id])
        const imageReloading = activeShots.some((shot) => shotImgReloading[shot.id])
        const shotImagesReady = activeShots.length > 0 && activeShots.every((s) => !!s.image && !shotImgError[s.id])
        // 镜头编排:重新生成 + 生成视频
        return [
          {
            label: imageReloading
              ? '重新加载中…'
              : failedShotImages.length
                ? '重新加载失败分镜'
                : shotGenRunning
                  ? '生成中…'
                  : '重新生成',
            variant: 'ghost',
            action: () => {
              if (failedShotImages.length) void retryFailedShotImageLoads()
              else void generateShotImages()
            },
            disabled: anyShotGenerating || imageReloading,
          },
          {
            label: '生成视频',
            variant: 'split',
            action: () => {
              void guardDurationBeforeNext(() => {
                videoGenSigRef.current = ''
                autoVidRef.current = false
                initialVideoGenerateCountRef.current = normalizeVideoGenerateCount(videoCount)
                setPendingVideoFocusToken((v) => v + 1)
                goStep(3)
              })
            },
            disabled: anyShotGenerating || imageReloading || !shotImagesReady,
            tip: anyShotGenerating
              ? '分镜图生成中,请稍候…'
              : imageReloading
                ? '分镜图正在自动重新加载,请稍候…'
                : !shotImagesReady
                  ? '有分镜图未生成或加载失败,请先重新加载失败分镜;资源确实失效时再单独编辑该分镜'
                  : undefined,
            splitCount: videoCount,
            splitCountOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            onSplitCountChange: (n: number) => setVideoCount(n),
          },
        ]
      }
      case 3: // 生成视频:总按钮已移到中间 VideoStage,这里不再渲染底部条
        return []
      default:
        return []
    }
  })()

  // 入口「下一步」:从入口回到已生成的流程,只往前一步(进入分镜脚本 / 用了 skill 则进营销拆解),不重生成。
  const resumeFlow = () => {
    setStarted(true)
    if (entryMeta?.skill && marketingText) setMarketingOpen(true)
  }
  // 入口是否可恢复：视频回到既有步骤；图片回到原对话，不重新提交任务。
  const canResumeFlow = entryMeta?.mode === 'image' ? imageMessages.length > 0 : shots.length > 0 || !!marketingText

  // 上报当前流程阶段给引导:用户【自己操作】进到某阶段时,自动展示该阶段引导。
  // 未开始且【从流程退回入口(canResumeFlow)】= reentry(高亮「重新生成」);未开始且全新 = entry;
  // 首次进入镜头编排 = arrangeTrash(高亮分镜回收站);其余创作流程 = process。
  // (放在 canResumeFlow 声明之后,避免 TDZ。)
  const lastSyncedStageRef = useRef('')
  useEffect(() => {
    if (guideActiveKey !== 'smart') {
      lastSyncedStageRef.current = ''
      return
    }
    const stage = !started
      ? canResumeFlow
        ? 'reentry'
        : 'entry'
      : entryMeta?.mode !== 'image' && !marketingOpen && step === 2
        ? 'arrangeTrash'
        : 'process'
    // 只在阶段【真正变化】时同步:否则返回入口时 started/canResumeFlow/step 连续变化会重复同步同一阶段,
    // 而 syncSmartStage 对"已展示过的同阶段再同步"会设 waiting=true → 刚弹出就被自己隐藏(闪退)。
    if (stage === lastSyncedStageRef.current) return
    lastSyncedStageRef.current = stage
    syncSmartGuideStage(stage)
  }, [guideActiveKey, started, canResumeFlow, entryMeta?.mode, marketingOpen, step])

  // 营销思路拆解步(选中 SKILL 时的第 1 步):我的描述(只读,与分镜脚本步一致)+ skill 拆解建议(可编辑)+ 确认/上一步。
  const renderMarketingBody = () => {
    const promptText = requirement || '（未填写需求）'
    return (
      <div className="smart__script smart__mkt-step">
        {/* 我的描述:直接展示上一步输入框的原始需求,只读 */}
        <div className="smart__prompt-label">我的描述：</div>
        <div className="smart__prompt smart__md">
          <Markdown>{promptText}</Markdown>
        </div>

        {/* 我上传的素材:直接陈列入口上传的图片 */}
        {(entryMeta?.images?.length ?? 0) > 0 && (
          <div className="smart__uploads">
            <div className="smart__uploads-label">我上传的素材：</div>
            <div className="smart__uploads-row">
              {entryMeta!.images!.map((u, i) => (
                <div className="smart__uploads-item" key={i}>
                  <img src={u} alt={`上传素材${i + 1}`} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* skill 拆解出的营销建议:可编辑;正文区填满剩余空间并内部滚动,底部按钮常驻可见 */}
        <div className="smart__marketing">
          <div className="smart__marketing-title">
            <span aria-hidden="true">💡</span>
            {normalizeSmartScriptName(entryMeta?.skill)}建议：
          </div>
          <div className="smart__marketing-content">
            {marketingLoading ? (
              <div className="smart__gen-hint">
                <span className="smart__gen-spin" aria-hidden="true" />
                正在拆解营销思路…
              </div>
            ) : marketingError ? (
              <div className="smart__script-error">
                {marketingError}
                <button
                  type="button"
                  className="smart__btn smart__btn--primary"
                  onClick={() => entryMeta && runSkillBreakdown(requirement, entryMeta)}
                >
                  重新生成
                </button>
              </div>
            ) : marketingData ? (
              <MarketingBreakdown
                data={marketingData}
                onChangeDesc={updateMarketingField}
                onPickTag={pickMarketingTag}
                onRemoveTag={removeMarketingTag}
                onRefreshTags={refreshMarketingTags}
                refreshing={marketingTagBusy}
              />
            ) : (
              <div className="smart__placeholder smart__placeholder--sm">暂无拆解结果</div>
            )}
          </div>
          <div className="smart__marketing-foot" data-guide="smart-foot">
            {/* 上一步:返回入口(与后面步骤一致的箭头按钮 + tooltip) */}
            <button
              type="button"
              className="smart__nav-btn"
              data-guide="smart-foot-prev"
              onClick={cancelMarketing}
              aria-label="上一步"
              data-tip="上一步"
            >
              <svg width="26" height="21" viewBox="0 0 29 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M27.8881 22.0104L28.1187 21.8116C28.3625 21.6053 28.5088 21.4777 27.5336 17.4193C25.8513 10.3938 19.1616 5.85705 11.6728 5.18001V0L0 9.06596L11.6728 18.1319V12.95C16.5247 12.5824 20.7876 13.0063 23.6458 16.0708C25.0542 17.588 26.7515 20.585 27.1585 21.4684C27.2166 21.594 27.3217 21.8247 27.5786 21.911L27.8881 22.0104Z"
                  fill="currentColor"
                />
              </svg>
            </button>
            {/* 下一步:营销拆解是叠在当前 step 上的浮层,关闭时必须显式落到它后面那一步=分镜脚本(step0),
                否则若用户是从靠后的步骤(如镜头编排)跳进来的,关闭会回到那一步而非紧接着的分镜脚本。 */}
            <button
              type="button"
              className="smart__nav-btn"
              data-guide="smart-foot-next"
              onClick={() => {
                setMarketingOpen(false)
                goStep(0)
              }}
              disabled={shots.length === 0}
              aria-label="下一步"
              data-tip="下一步"
            >
              <svg width="27" height="27" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M2.11194 25.7576L1.88126 25.5588C1.63745 25.3525 1.49117 25.2249 2.4664 21.1664C4.14869 14.141 10.8384 9.60425 18.3272 8.92721V3.74719L30 12.8132L18.3272 21.8791V16.6972C13.4753 16.3296 9.21243 16.7535 6.35423 19.818C4.94576 21.3352 3.24847 24.3322 2.8415 25.2156C2.78336 25.3412 2.67833 25.5719 2.42139 25.6582L2.11194 25.7576Z"
                  fill="currentColor"
                />
              </svg>
            </button>
            <button
              type="button"
              className="smart__btn smart__btn--primary"
              data-guide="smart-foot-confirm"
              onClick={confirmMarketing}
              disabled={marketingLoading || !marketingText.trim()}
            >
              确认营销思路
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 各步骤内容。0/1 暂为占位(等 Figma/后端);2/3 已接入「修改框 + AI 润色(本地模型)」。
  const renderStepBody = () => {
    // 分镜脚本(step0)/ 准备素材(step1):共用「需求摘要 + 用户上传素材 + 分镜表」。
    // step0 隐藏「准备素材」列;确认脚本后进入 step1,才把 AI 生成的主体素材回填、按图二样式展示。
    if (step === 0 || step === 1) {
      const materialMode = step === 1
      const promptText = requirement || '（未填写需求）'
      return (
        <div className="smart__script">
          {/* 我的描述:直接展示上一步输入框的原始需求(markdown 渲染),只读 */}
          <div className="smart__prompt-label">我的描述：</div>
          <div className="smart__prompt smart__md">
            <Markdown>{promptText}</Markdown>
          </div>

          {/* 我上传的素材:直接陈列入口上传的图片 */}
          {(entryMeta?.images?.length ?? 0) > 0 && (
            <div className="smart__uploads">
              <div className="smart__uploads-label">我上传的素材：</div>
              <div className="smart__uploads-row">
                {entryMeta!.images!.map((u, i) => (
                  <div className="smart__uploads-item" key={i}>
                    <img src={u} alt={`上传素材${i + 1}`} loading="lazy" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 生成状态 + 分镜表 */}
          <div className="smart__script-done">
            <span className="smart__script-done-icon" aria-hidden="true">
              💡
            </span>
            {scriptLoading
              ? '分镜脚本生成中…'
              : insertTextGenerating
                ? '正在生成新增分镜词…'
                : scriptError
                  ? '分镜脚本生成失败'
                  : '分镜脚本生成完成'}
          </div>
          {shots.length || (!scriptLoading && !scriptError) ? (
            <>
              <ScriptStoryboardTable
                shots={shots}
                showSubjects={materialMode}
                deferDurationValidation={!materialMode}
                onInsertShot={insertStoryboardShot}
                insertDisabled={
                  scriptLoading ||
                  insertTextGenerating ||
                  batchGenning ||
                  Object.values(subjectGenerating).some(Boolean)
                }
                shotTextGenerating={insertTextGeneratingId === null ? {} : { [String(insertTextGeneratingId)]: true }}
                subjectGenerating={subjectGenerating}
                onGenerateAll={materialMode ? generateAllSubjects : undefined}
                batchGenning={batchGenning}
                onRemoveSubject={removeSubjectImage}
                onDeleteShot={deleteShot}
                onGenerateMaterial={(s) => addShotMaterial(s, true)}
                onOpenSubject={openSubject}
                trashItems={shotTrashItems}
                trashLoading={shotTrashLoading}
                onLoadTrash={loadShotTrash}
                onRestoreTrash={restoreShotFromTrash}
                onDeleteTrash={deleteShotTrash}
                onRestoreAllTrash={restoreAllShotTrash}
                onClearTrash={clearAllShotTrash}
                /* AI自动生成:不后台直生,改为唤起素材弹窗并在弹窗内自动生成(autoGen),与「上传图片」一致 */
                onShotsChange={updateShotsFromEditor}
                onRegenerate={materialMode ? undefined : () => entryMeta && generateScript(requirement, entryMeta)}
                regenerating={scriptLoading || insertTextGenerating}
              />
              {(scriptLoading || insertTextGenerating) && (
                <div className="smart__gen-hint">
                  <span className="smart__gen-spin" aria-hidden="true" />
                  {scriptLoading ? '分镜持续生成中…' : '正在生成新增分镜词…'}
                </div>
              )}
              {!scriptLoading && scriptError && (
                <div className="smart__script-error" role="alert">
                  {scriptError}
                  <button
                    type="button"
                    className="smart__btn smart__btn--primary"
                    onClick={() => entryMeta && generateScript(requirement, entryMeta)}
                  >
                    重新生成
                  </button>
                </div>
              )}
            </>
          ) : scriptLoading ? (
            <div className="smart__placeholder smart__placeholder--sm">正在根据创作需求生成分镜脚本…</div>
          ) : scriptError ? (
            <div className="smart__script-error">
              {scriptError}
              <button
                type="button"
                className="smart__btn smart__btn--primary"
                onClick={() => entryMeta && generateScript(requirement, entryMeta)}
              >
                重新生成
              </button>
            </div>
          ) : (
            <div className="smart__placeholder smart__placeholder--sm">暂无分镜,点击下方「重新生成」</div>
          )}
        </div>
      )
    }
    if (step === 2) {
      // 镜头编排:左 分镜列表 + 右 素材修改(元素/分镜图版本/描述修改/台词/字幕/音效)
      return (
        <ShotArrange
          shots={shots}
          generating={shotGen}
          generatingAll={shotGenRunning}
          onShotsChange={updateShotsFromEditor}
          onUploadRef={uploadRef}
          onShotImgError={markShotImgError}
          onShotImgLoad={markShotImgLoad}
          onShotImgRetrying={markShotImgRetrying}
          imageRetryTokens={shotImgRetryTokens}
          onGenerateShot={generateShotFromDialog}
          onDeleteShot={deleteShot}
          trashItems={shotTrashItems}
          trashLoading={shotTrashLoading}
          onLoadTrash={loadShotTrash}
          onRestoreTrash={restoreShotFromTrash}
          onDeleteTrash={deleteShotTrash}
          onRestoreAllTrash={restoreAllShotTrash}
          onClearTrash={clearAllShotTrash}
          onPolishPrompt={(text, uploadRefUrls) =>
            refineShotPrompt({
              desc: text,
              outline: reqSummary || requirement, // 整体大纲(仅调性参考)
              // 把本次上传的素材图作为 materials(带 url → VL 读图),让润色理解用户上传的素材
              materials: (uploadRefUrls || []).filter(Boolean).map((url) => ({ url })),
              style: entryMeta?.style,
              ratio: entryMeta?.ratio,
            }).then((r: any) => r?.prompt || text)
          }
          onPolishText={(kind, text) => polishText(text, { kind })}
        />
      )
    }
    // step === 3 生成视频(第四步):整片视频 + 时间轴选片段 + 片段/整段修改框 + 总按钮(本步不再改分镜)
    return (
      <VideoStage
        shots={shots}
        videoUrl={fullVideo.url}
        videoAssetId={fullVideo.assetId}
        videoGenerating={actualVideoGenerating}
        videoStatusText={blurPhase || undefined}
        videoStartedAt={
          videoGenerations.find((g) => g.id === resolveRunningVideoGenerationId())?.createdAt ||
          [...videoGenerations]
            .filter((g) => g.status === 'processing')
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0]?.createdAt ||
          0
        }
        costEstimate={videoCost.estimate}
        costLoading={videoCost.loading}
        costError={videoCost.error}
        onEstimateEditCost={async (note) => {
          const ws = Number(workspaceId || 0)
          if (!ws || !fullVideo.assetId || !fullVideo.url) throw new Error('缺少可编辑的视频')
          const plans = await resolvePlanCandidates()
          const editPrompt = [
            '请在保留原视频镜头内容、顺序与节奏的前提下,按以下修改要求调整画面(只改提到的部分,其余保持不变):',
            note || '',
          ]
            .filter(Boolean)
            .join('\n')
          const sourceVideoDurationSec = (await readVideoDurationSec(fullVideo.url)) || 0
          const result: any = await estimateVideoEditCost({
            workspaceId: ws,
            prompt: editPrompt,
            ratio: entryMeta?.ratio,
            durationSec: totalDurationSec(shots) || 10,
            sourceVideoDurationSec,
            modelPlanCandidates: plans,
          })
          return {
            estimatedCost: Number(result?.estimated_cost ?? 0),
            balance: Number(result?.balance ?? 0),
            canAfford: result?.can_afford === true,
          }
        }}
        faceBlurDebug={blurDebug}
        videoVersions={videoVersions}
        failedGenerations={[...videoGenerations]
          .filter((g) => g.status === 'failed')
          .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
          .map((g) => ({ id: g.id, note: g.note, error: g.error, createdAt: g.createdAt }))}
        pendingGenerations={(() => {
          const processing = [...videoGenerations]
            .filter((g) => g.status === 'processing')
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
          const fallbackRunningId = resolveRunningVideoGenerationId(processing)
          return processing.map((g) => ({
            id: g.id,
            createdAt: g.createdAt,
            running: Boolean(g.running) || g.id === fallbackRunningId,
          }))
        })()}
        pendingVideoCount={videoGenerations.filter((g) => g.status === 'processing').length}
        modificationDraft={videoModificationDraft}
        onModificationDraftChange={setVideoModificationDraft}
        onSwitchVideo={(v) => {
          const next = { url: v.url, assetId: v.assetId }
          fullVideoRef.current = next
          setFullVideo(next)
        }}
        onRefreshVideo={refreshVideoForPlayback}
        onRegenerateVideo={(note, opts) => {
          setPendingVideoFocusToken((v) => v + 1)
          runFullVideo(note, opts, 1)
        }}
        onGenerateMultipleVideos={(note, opts, count) => {
          setPendingVideoFocusToken((v) => v + 1)
          queueFullVideo(note, opts, count || videoCount)
        }}
        onDownloadVideo={handleDownloadVideo}
        onPrev={() => goStep(2)}
        regenCount={videoCount}
        regenCountOptions={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
        onRegenCountChange={(n) => setVideoCount(n)}
        pendingFocusToken={pendingVideoFocusToken}
        debug={{
          prompt: buildTimelinePrompt({
            shots,
            basePrompt: reqSummary || requirement,
            ratio: entryMeta?.ratio,
            style: entryMeta?.style,
          }),
          firstImage: shots.find((s) => s.image)?.image || '',
          shots: shots.map((s) => ({
            no: s.no,
            duration: s.duration,
            desc: s.desc,
            line: s.line,
            subtitle: s.subtitle,
            sfx: s.sfx,
            image: s.image,
          })),
        }}
      />
    )
  }

  // 是否使用了营销 SKILL(决定流程是否多出「营销思路拆解」步、进度条是否整体后移)
  const usedSkill = !!entryMeta?.skill

  return (
    <div className="smart">
      {durGuard.open && (
        <div className="smart__durguard" role="dialog" aria-modal="true">
          <div
            className="smart__durguard-backdrop"
            aria-hidden="true"
            onClick={() => {
              durGuardProceedRef.current = null
              setDurGuard({ open: false, currentSec: 0, expectedSec: 0, overMax: false })
            }}
          />
          <div className="smart__durguard-card">
            <div className="smart__durguard-top">
              <span className="smart__durguard-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 16v-5" strokeLinecap="round" />
                  <path d="M12 8h.01" strokeLinecap="round" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </span>
              <div className="smart__durguard-msg">
                {durGuard.overMax
                  ? `您目前的视频秒数为${durGuard.currentSec}s（已超过最大限制15s，无法生成视频）`
                  : `您目前的视频秒数为${durGuard.currentSec}s（与期望的视频秒数${durGuard.expectedSec || parseDurationSeconds(entryMeta?.duration) || 0}s不符）`}
              </div>
            </div>
            <div className="smart__durguard-actions">
              <button
                type="button"
                className="smart__durguard-btn"
                onClick={() => {
                  durGuardProceedRef.current = null
                  setDurGuard({ open: false, currentSec: 0, expectedSec: 0, overMax: false })
                }}
              >
                重新输入
              </button>
              {!durGuard.overMax && (
                <button
                  type="button"
                  className="smart__durguard-btn smart__durguard-btn--primary"
                  onClick={() => {
                    const proceed = durGuardProceedRef.current
                    durGuardProceedRef.current = null
                    setDurGuard({ open: false, currentSec: 0, expectedSec: 0, overMax: false })
                    proceed?.()
                  }}
                >
                  知道了，继续生成
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <AppSidebar
        activeKey="creative"
        onNavigate={onNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="smart__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        {projectLoading ? (
          <div className="smart__project-loading" role="status" aria-live="polite">
            <span className="smart__project-loading-spinner" aria-hidden="true" />
            <span>正在恢复项目数据…</span>
          </div>
        ) : loadError ? (
          // 按 id 加载失败:显示明确错误态 + 重试 / 返回项目管理,而非静默回落到「新建视频」入口。
          <div className="smart__loaderr" role="alert">
            <div className="smart__loaderr-icon" aria-hidden="true">
              !
            </div>
            <div className="smart__loaderr-title">项目加载失败</div>
            <div className="smart__loaderr-msg">{loadError}</div>
            <div className="smart__loaderr-actions">
              <button
                type="button"
                className="smart__btn smart__btn--primary"
                onClick={retryLoadProject}
                disabled={loadRetrying}
              >
                {loadRetrying ? '重试中…' : '重试'}
              </button>
              <button type="button" className="smart__btn" onClick={() => navigate('/projects')}>
                返回项目管理
              </button>
            </div>
          </div>
        ) : !started ? (
          // 「上一步」返回输入框时回填上次输入(数据存在本视图 state,路由切换卸载即清空)
          <div className="smart__entry-with-tasks">
            <TaskCenterDrawer scope="smart" />
            <div className="smart__entry-content">
              <SmartEntry
                key={entryKey}
                onSubmit={handleStart}
                restoreSessionDraft={!explicitFreshEntrySession}
                onNewVideo={resetToNewVideo}
                canResume={canResumeFlow}
                onResume={resumeFlow}
                initial={{
                  mode: entryMeta?.mode ?? carriedEntry.mode,
                  text:
                    entryMeta?.mode === 'image' && imageComposerDraft.text
                      ? imageComposerDraft.text
                      : requirement || carriedEntry.text,
                  ratio: entryMeta?.ratio ?? carriedEntry.ratio,
                  duration: entryMeta?.duration,
                  images:
                    entryMeta?.mode === 'image' && imageComposerDraft.images.length
                      ? imageComposerDraft.images.map((image) => image.url)
                      : (entryMeta?.images ?? (carriedEntry.images.length ? carriedEntry.images : undefined)),
                  imageAssetIds:
                    entryMeta?.mode === 'image' && imageComposerDraft.images.length
                      ? imageComposerDraft.images.map((image) => Number(image.assetId || 0) || 0)
                      : (entryMeta?.imageAssetIds ??
                        (carriedEntry.imageAssetIds.some((assetId) => assetId > 0)
                          ? carriedEntry.imageAssetIds
                          : undefined)),
                  outputCount: entryMeta?.outputCount ?? imageComposerDraft.outputCount,
                  skill: entryMeta?.skill,
                }}
              />
            </div>
          </div>
        ) : isImageMode ? (
          // 制作图片:chat 对话视图(消息流 + 沉底输入框,工具栏仅比例 + @)
          <div className="smart__entry-with-tasks">
            <TaskCenterDrawer scope="image" />
            <div className="smart__entry-content">
              <Suspense fallback={<LazyEditorFallback label="正在加载图片编辑器…" />}>
                <ImageChat
                  messages={imageMessages}
                  initialRatio={entryMeta?.ratio || '16:9'}
                  initialOutputCount={entryMeta?.outputCount || 1}
                  initialComposerDraft={imageComposerDraft}
                  busy={imageBusy}
                  newChatDisabled={imageBusy}
                  costText={
                    stepCost.loading
                      ? '费用预估中…'
                      : stepCost.estimate
                        ? `${stepCost.count > 1 ? `共 ${stepCost.count} 张约 ` : '约 '}${stepCost.estimate.estimatedCost} 积分${stepCost.estimate.perOne != null ? ` · 每张约 ${stepCost.estimate.perOne} 积分` : ''} · 余额 ${stepCost.estimate.balance} 积分`
                        : stepCost.error
                          ? `费用暂不可用：${stepCost.error}`
                          : ''
                  }
                  costInsufficient={
                    !!stepCost.estimate &&
                    (stepCost.estimate.canAfford === false ||
                      stepCost.estimate.estimatedCost > stepCost.estimate.balance)
                  }
                  onSend={(text, images, ratio, assetIds, outputCount) =>
                    sendImageChat(text, images, ratio, assetIds, outputCount)
                  }
                  onRetry={(message) => void retryImageMessage(message)}
                  onDownload={(image) => void downloadImageMessage(image)}
                  onComposerReferenceCountChange={setImageComposerRefCount}
                  onRatioChange={handleImageComposerRatioChange}
                  onOutputCountChange={handleImageComposerOutputCountChange}
                  onComposerDraftChange={commitImageComposerDraft}
                  onBack={backFromImageChat}
                  backDisabled={imageBusy}
                  onContinueToVideo={(selections) => continueImagesAsVideo(selections)}
                  onNewChat={() => resetToNewVideo('image')}
                />
              </Suspense>
            </div>
          </div>
        ) : (
          <>
            {/* 创建新视频:固定在流程区最右上,点击重置为全新入口、重新走一遍生成流程 */}
            <button type="button" className="smart__newvideo" onClick={() => resetToNewVideo('video')}>
              创建新视频
            </button>
            {/* 进度条:用了 SKILL 时在最前面加一步「营销思路拆解」,索引整体后移 1 */}
            <div className="smart__progress" data-guide="smart-stepbar">
              <StepProgress
                steps={usedSkill ? [MARKETING_STEP, ...STEPS] : STEPS}
                current={usedSkill ? (marketingOpen ? 0 : step + 1) : step}
                clickableMax={usedSkill ? maxReached + 1 : maxReached}
                statuses={(() => {
                  // 4 个流程步的子状态:脚本有分镜 / 已进入镜头编排(素材就绪) / 有任一分镜图 / 有整片视频
                  const hasVideoOutput = Boolean(fullVideo.url || fullVideo.assetId || videoVersions.length)
                  const hasShotImage = shots.some((s) => s.image || Number(s.imageAssetId || 0) > 0)
                  // 上游新增/修改后 maxReached 会回退；旧分镜图/成片不能让后续步骤继续显示为可跳转的“已完成”。
                  const done = [
                    shots.length > 0 || hasVideoOutput,
                    maxReached >= 1 && (maxReached >= 2 || hasShotImage || hasVideoOutput),
                    maxReached >= 2 && (hasShotImage || hasVideoOutput),
                    maxReached >= 3 && hasVideoOutput,
                  ]
                  const running = [scriptLoading || insertTextGenerating, false, shotGenRunning, actualVideoGenerating]
                  const flow = STEPS.map((_, i) =>
                    running[i]
                      ? ACTIVE_STATUS[i]
                      : done[i]
                        ? '已完成'
                        : !marketingOpen && i === step
                          ? ACTIVE_STATUS[i]
                          : '待生成',
                  )
                  if (!usedSkill) return flow
                  const mkt = marketingLoading ? '思路拆解中' : marketingText ? '已完成' : '待生成'
                  return [mkt, ...flow]
                })()}
                onStepClick={(i) => {
                  const targetStep = usedSkill ? i - 1 : i
                  if (insertTextRequestRef.current && targetStep !== step) {
                    showToast('请等待新增分镜的 AI 分镜词生成完成', 'error')
                    return
                  }
                  if (targetStep > maxReached) {
                    showToast('请先完成当前步骤，再进入后续流程', 'error')
                    return
                  }
                  if (!usedSkill) return goStep(i)
                  if (i === 0) setMarketingOpen(true)
                  else {
                    setMarketingOpen(false)
                    goStep(i - 1)
                  }
                }}
              />
            </div>

            {/* 项目名 + 改名:单独一行,内层与正文同宽居中(1240),使项目名与「我的描述」左缘对齐 */}
            <div className="smart__projbar">
              <div className="smart__projbar-inner">
                {editingName ? (
                  <input
                    ref={nameInputRef}
                    className="smart__name-input"
                    value={draftName}
                    autoFocus
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                  />
                ) : (
                  <button type="button" className="smart__name" onClick={startRename} title="点击修改名称">
                    <span className="smart__name-text">{projectName}</span>
                    {naming && <span className="smart__name-naming">AI 命名中…</span>}
                    <img className="smart__name-edit" src={iconProjectEdit} alt="" width={20} height={20} />
                  </button>
                )}
                {/* 本项目钉在与当前活跃空间不同的空间:提示保存/计费走该空间(顶栏钱包显示的是活跃空间) */}
                {pinnedWsName && (
                  <span className="smart__name-space" title={`本项目属于「${pinnedWsName}」空间,保存与计费走该空间`}>
                    空间：{pinnedWsName}
                  </span>
                )}
                <DraftSaveIndicator status={draftSaveStatus} onRetry={() => void retrySmartCloudSave()} />
              </div>
            </div>

            {/* 步骤内容:营销思路拆解步 / 现有流程步 */}
            <div className="smart__body">
              <Suspense fallback={<LazyEditorFallback />}>
                {marketingOpen ? renderMarketingBody() : renderStepBody()}
              </Suspense>
            </div>

            {/* 底栏:上一步/下一步 导航箭头 + 各步主操作按钮(整组居中)。
                视频生成步(step3)总按钮在中间 VideoStage 内,这里不渲染。 */}
            {!marketingOpen && step !== 3 && (
              <footer className={`smart__footer ${step === 2 ? 'smart__footer--center' : 'smart__footer--right'}`}>
                {/* 前瞻预估:当前步显示「下一步生成」要花多少(估到价才显示) */}
                {stepCost.estimate &&
                  (() => {
                    const insufficient =
                      stepCost.estimate.canAfford === false ||
                      stepCost.estimate.estimatedCost > stepCost.estimate.balance
                    return (
                      <div className="smart__cost">
                        <span className={insufficient ? 'smart__cost--err' : undefined}>
                          {step === 0
                            ? `下一步准备素材 · ${stepCost.count > 1 ? `共 ${stepCost.count} 张约 ` : '约 '}`
                            : step === 1
                              ? `下一步镜头编排 · ${stepCost.count > 1 ? `共 ${stepCost.count} 张约 ` : '约 '}`
                              : step === 2
                                ? '下一步生成视频 · 约 '
                                : stepCost.count > 1
                                  ? `共 ${stepCost.count} 张约 `
                                  : '约 '}
                          {stepCost.estimate.estimatedCost} 积分 · 余额 {stepCost.estimate.balance} 积分
                          {stepCost.estimate.perOne != null && step !== 2 && (
                            <span className="smart__cost-per"> · 每加一张约 {stepCost.estimate.perOne} 积分</span>
                          )}
                          {insufficient && (
                            <>
                              {' · 积分不足,'}
                              <button type="button" className="smart__cost-recharge" onClick={openMemberCenter}>
                                请前往充值积分
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    )
                  })()}
                <div className="smart__footer-inner" data-guide="smart-foot">
                  {/* 上一步(悬停 tooltip:上一步) */}
                  <button
                    type="button"
                    className="smart__nav-btn"
                    data-guide="smart-foot-prev"
                    onClick={goPrev}
                    aria-label="上一步"
                    data-tip="上一步"
                  >
                    <svg width="26" height="21" viewBox="0 0 29 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M27.8881 22.0104L28.1187 21.8116C28.3625 21.6053 28.5088 21.4777 27.5336 17.4193C25.8513 10.3938 19.1616 5.85705 11.6728 5.18001V0L0 9.06596L11.6728 18.1319V12.95C16.5247 12.5824 20.7876 13.0063 23.6458 16.0708C25.0542 17.588 26.7515 20.585 27.1585 21.4684C27.2166 21.594 27.3217 21.8247 27.5786 21.911L27.8881 22.0104Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                  {/* 下一步:仅在已生成的步骤间导航;前沿置灰(悬停 tooltip:下一步) */}
                  <button
                    type="button"
                    className="smart__nav-btn"
                    data-guide="smart-foot-next"
                    onClick={goNext}
                    disabled={!canGoNext}
                    aria-label="下一步"
                    data-tip="下一步"
                  >
                    <svg width="27" height="27" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M2.11194 25.7576L1.88126 25.5588C1.63745 25.3525 1.49117 25.2249 2.4664 21.1664C4.14869 14.141 10.8384 9.60425 18.3272 8.92721V3.74719L30 12.8132L18.3272 21.8791V16.6972C13.4753 16.3296 9.21243 16.7535 6.35423 19.818C4.94576 21.3352 3.24847 24.3322 2.8415 25.2156C2.78336 25.3412 2.67833 25.5719 2.42139 25.6582L2.11194 25.7576Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                  {/* 各步主操作按钮 */}
                  {bottomButtons.map((b, bi) =>
                    b.variant === 'split' ? (
                      <span
                        key={b.label}
                        className="smart__btn-split"
                        data-guide={bi === bottomButtons.length - 1 ? 'smart-foot-confirm' : undefined}
                        title={b.disabled ? b.tip : undefined}
                      >
                        <button
                          type="button"
                          className="smart__btn-split--main"
                          onClick={b.action}
                          disabled={b.disabled}
                        >
                          {b.label}
                        </button>
                        <span className="smart__btn-split--sep" aria-hidden="true" />
                        <button
                          type="button"
                          className="smart__btn-split--count"
                          disabled={b.disabled}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSplitOpen((prev) => !prev)
                          }}
                        >
                          <span>{b.splitCount ?? 1}个</span>
                          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 4 }}>
                            <path
                              d="M3 4.5L6 7.5L9 4.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        {splitOpen && (
                          <span className="smart__btn-split--dropdown">
                            {(b.splitCountOptions ?? [1, 2, 3]).map((n: number) => (
                              <button
                                key={n}
                                type="button"
                                className={`smart__btn-split--option${n === (b.splitCount ?? 1) ? ' is-active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  b.onSplitCountChange?.(n)
                                  setSplitOpen(false)
                                }}
                              >
                                {n}个
                              </button>
                            ))}
                          </span>
                        )}
                      </span>
                    ) : (
                      <button
                        key={b.label}
                        type="button"
                        className={`smart__btn smart__btn--${b.variant}`}
                        data-guide={bi === bottomButtons.length - 1 ? 'smart-foot-confirm' : undefined}
                        onClick={b.action}
                        disabled={b.disabled}
                        title={b.disabled ? b.tip : undefined}
                      >
                        {b.icon}
                        {b.label}
                      </button>
                    ),
                  )}
                </div>
              </footer>
            )}
          </>
        )}
      </div>

      <SubjectAssetDialog
        /* 按主体名隔离实例:某主体生成/优化中,切到别的主体不会串状态(各自独立) */
        key={subjectDlg.name}
        open={subjectDlg.open}
        name={subjectDlg.name}
        kind={subjectDlg.kind}
        currentImage={subjectImageOf(subjectDlg.name)}
        anchorRefImages={anchorRefs}
        versions={subjectAssets[subjectDlg.name]?.versions || []}
        defaultPrompt={
          subjectAssets[subjectDlg.name]?.prompt ||
          subjectPrompt(subjectDlg.name, subjectDlg.kind, entryMeta?.style, subjectContext(subjectDlg.name))
        }
        autoGen={subjectDlg.autoGen}
        refinePrompt={
          subjectAssets[subjectDlg.name]?.prompt
            ? undefined // 已有润色过/编辑过的提示词,直接显示,不再润色
            : (intent: string) =>
                refineElementPrompt(intent, {
                  name: subjectDlg.name,
                  kind: subjectDlg.kind,
                  style: entryMeta?.style,
                })
        }
        projectImages={projectImages}
        onClose={() => setSubjectDlg((d) => ({ ...d, open: false }))}
        onGenerate={(p, opts) => genForSubject(subjectDlg.name, p, opts)}
        onSelect={(url) => applySubjectImage(subjectDlg.name, url, subjectAssets[subjectDlg.name]?.ids?.[url] || 0)}
        onUpload={(file) => uploadForSubject(subjectDlg.name, file)}
      />
    </div>
  )
}
