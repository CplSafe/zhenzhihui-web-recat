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
  useMemo,
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
import {
  GenerationModelDropdown,
  filterGenerationModelGroupsByOperations,
  getGenerationModelDurationOptions,
  getGenerationModelSelectionConflicts,
  isGenerationModelSelectionComplete,
  type GenerationModelEstimateRequest,
  type GenerationModelEstimateResult,
} from '@/components/smart/GenerationModelPicker'
import TaskCenterDrawer from '@/components/task/TaskCenterDrawer'
import type { Shot } from '@/components/smart/ScriptStoryboardTable'
import type { ShotTrashItem } from '@/components/smart/ShotTrashBin/ShotTrashBin'
import type { ChatImg, ChatMessage, ImageComposerDraft, ImageVideoSelection } from '@/components/smart/ImageChat'
import iconProjectEdit from '@/assets/icons/project-edit.svg'
import Markdown from '@/components/common/Markdown'
import {
  createProjectNameFallback,
  generateProjectName,
  generateProjectNameFromImages,
  summarizeRequirement,
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
import {
  generateScriptShotsStream,
  generateShotInfo,
  extractSubjects,
  LONG_FORM_MAX_MIDDLE_SHOT_SEC,
  LONG_FORM_MIN_TOTAL_SEC,
} from '@/api/smartScript'
import {
  generateShotImage,
  resumeShotImageGeneration,
  ensureAssetId,
  refreshAssetUrl,
  persistImageAsset,
  estimateShotImageCost,
  compileShotImageRequestParams,
  isTerminalShotImageTaskError,
} from '@/api/smartShotImage'
import {
  generateFullVideo,
  resumeFullVideo,
  buildTimelinePrompt,
  totalDurationSec,
  estimateFullVideoCost,
  compileFullVideoModelRequest,
} from '@/api/smartVideo'
import { listRealPeople } from '@/api/realPeople'
import { readVideoDurationSec } from '@/utils/videoDuration'
import { getSidebarRoute } from '@/utils/sidebarNavigation'
import { getSmartMarketingRecoveryKey } from '@/utils/smartMarketingRecovery'
import {
  createCreativeProject,
  patchCreativeProject,
  getCreativeProject,
  getBusinessErrorMessage,
  cancelAiTask,
  updateCreativeProjectDraft,
  estimateAiTaskCost,
  listAiModels,
  restoreCreativeTrashItem,
  deleteCreativeTrashItem,
} from '@/api/business'
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
import { useGenerationModelCatalog } from '@/composables/useGenerationModelCatalog'
import { buildModelRestrictionSummary } from '@/utils/modelRestrictions'
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
  requireReferenceImageAssetIds,
  scriptStreamFailureMessage,
  stableGenerationAssetKey,
} from '@/utils/smartGenerationGuards'
import { getModelReferenceImageLimit } from '@/utils/modelInputConstraints'
import { formatSupportedDurationLabel, validateCreativeDurationSelection } from '@/utils/creativeDurationPolicy'
import { resolveShotElementReferenceAssetIds } from '@/utils/smartShotElementRefs'
import { SMART_VIDEO_DURATIONS, parseDurationSeconds, validateVideoDurationWithin } from '@/utils/videoDurationValue'
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
import { buildDownloadName, downloadToDisk, isWeChatBrowser } from '@/utils/downloadToDisk'
import {
  REQUIRED_GENERATION_OPERATION_CODES_BY_MODE,
  areGenerationModelOperationsReady,
  getImageGenerationOperationCode,
  getUnavailableGenerationOperations,
  isGenerationOperationCode,
  resolveGenerationModelSelections,
  unwrapGenerationModelCatalogResponse,
  type GenerationModelOption,
  type GenerationModelSelectionMap,
  type GenerationOperationCode,
} from '@/utils/generationModelCatalog'
import {
  getImageQueueModelLockError,
  getLockedGenerationModelAvailabilityError,
  getVideoQueueModelLockError,
} from '@/utils/generationQueueModelGuards'
import {
  getSmartVideoQueueOwnershipError,
  getSmartVideoQuoteValidationError,
  restoreSmartVideoQueueForOwner,
  type LockedSmartVideoQuotedCost,
  type SmartVideoQueueOwner,
} from '@/utils/smartVideoQueueSafety'
import {
  createLockedSmartImageQuote,
  getSmartImageQuoteBindingError,
  getSmartImageQuoteValidationError,
  type LockedSmartImageQuotedCost,
  type SmartImageGenerationOperation,
} from '@/utils/smartImageQueueSafety'
import { planGenerationModelSwitch } from '@/utils/generationModelSwitchPolicy'
import {
  mergeTransactionalScriptResult,
  planSmartImageModelRegeneration,
  type SmartImageOperationCode,
  type SmartModelSwitchRecoveryDescriptor,
  type SmartSubjectAssetVersionRegistry,
} from '@/utils/smartModelSwitchSafety'
import { findDuplicateSubjectGroups, type DuplicateSubjectGroup } from '@/utils/subjectDuplicates'
import {
  buildRealPersonIdentityPrompt,
  buildRealPersonVideoIdentityConstraint,
  buildRealPersonVideoIdentityPrompt,
  getFacePrivacyGenerationMessage,
  isRealPersonReferenceStillAuthorized,
  resolveShotRealPersonPreservation,
  type SmartRealPersonReference,
} from '@/utils/smartRealPerson'
import './SmartCreateView.css'

/** 业务生成接口使用正整数模型版本 ID；目录中的数字字符串在这里统一收窄。 */
type SelectedGenerationModel = Omit<GenerationModelOption, 'modelVersionId'> & { modelVersionId: number }
type LockedSmartImageModels = Partial<Record<SmartImageOperationCode, SelectedGenerationModel>>

/** 按需加载分镜脚本编辑表。 */
const ScriptStoryboardTable = lazy(() => import('@/components/smart/ScriptStoryboardTable'))
/** 按需加载镜头编排工作区。 */
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

/**
 * 流程只有两步:分镜脚本 → 生成视频。
 *
 * 「准备素材」和「镜头编排」已移除:这两步会先用 AI 重画一遍用户上传的素材
 * (主体素材图 → 分镜图),再拿重画后的结果去出片,用户的产品因此在成片里走样。
 * 现在用户上传的素材直接作为参考图提交给视频模型,中间没有任何重画环节。
 */
const STEP_SCRIPT = 0
const STEP_VIDEO = 1
const STEPS: StepItem[] = [
  { key: 'script', label: '分镜脚本' },
  { key: 'video', label: '生成视频' },
]
const REAL_PERSON_STEPS: StepItem[] = [
  { key: 'script', label: '真人策划' },
  { key: 'video', label: '真人成片' },
]
/** 流式脚本增量合并到界面的最小间隔。 */
const SCRIPT_STREAM_RENDER_INTERVAL_MS = 120
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

/** 付费任务尚未创建、仅因队列 checkpoint 失败而可原地恢复的图片消息。 */
function isUnsubmittedImagePreparationFailure(message: ChatMessage): boolean {
  return (
    Number(message.taskId || 0) === 0 &&
    Boolean(message.request && message.idempotencyKey) &&
    (message.preparationFailure === true ||
      (message.terminalFailure === true && /未提交任何付费任务/.test(String(message.error || ''))))
  )
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

/** 为不受模型支持的总时长生成明确调整提示；档位文案由所选模型实际支持的秒数推导。 */
function unsupportedVideoDurationMessage(value: unknown, supportedLabel: string): string {
  const seconds = parseDurationSeconds(value)
  return seconds === null
    ? `参与生成的分镜总时长无效，请调整为${supportedLabel}`
    : `当前参与生成的分镜总时长为${seconds}秒，视频模型仅支持${supportedLabel}，请调整分镜时长后重试`
}

/** 后端模型、镜头和队列上下文均按 JSON 数据复制，避免目录刷新或页面编辑改写已确认任务。 */
function cloneGenerationSnapshot<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value)
    } catch {
      // 目录和草稿按约定均为 JSON；少数运行时不支持 structuredClone 时继续走 JSON 复制。
    }
  }
  const serialized = JSON.stringify(value)
  return serialized === undefined ? value : JSON.parse(serialized)
}

/** 兼容不支持 AbortSignal.throwIfAborted 的浏览器（项目仍覆盖 Safari 13）。 */
function throwIfSmartRequestAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof DOMException === 'function') throw new DOMException('请求已取消', 'AbortError')
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  throw error
}

/** 未进入可恢复队列的临时图片任务；离页或重置时必须同时中止本地等待和后端任务。 */
interface EphemeralImageRequest {
  controller: AbortController
  workspaceId: number
  projectId: number
  routeSessionToken: string
  taskIds: Set<number>
}

/**
 * 视频修改的估价、入队快照和正式提交共用同一段提示词。
 * identityPersonName 非空（真人成片）时前置出镜身份约束：修改意见里「换个发型」「换套衣服」
 * 这类表述最容易把脸一起改掉，约束必须先于用户文字出现。
 */
function buildSmartVideoEditPrompt(
  note = '',
  variationIndex?: number,
  variationTotal?: number,
  identityPersonName = '',
): string {
  const body = [
    '请在保留原视频镜头内容、顺序与节奏的前提下,按以下修改要求调整画面(只改提到的部分,其余保持不变):',
    note,
    variationTotal && variationTotal > 1
      ? `这是同一需求下的第 ${variationIndex || 1}/${variationTotal} 个不同版本，请保持脚本一致，但在表演细节、镜头运动、构图与节奏细节上给出明显不同的变体效果。`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
  return identityPersonName ? buildRealPersonVideoIdentityPrompt(body, identityPersonName) : body
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
  /** smart=普通智能成片；real-person=认证真人素材驱动且不做人脸脱敏的独立流程。 */
  flowMode?: 'smart' | 'real-person'
}

/** 编排智能成片完整流程并负责草稿、任务、权限和结果恢复。 */
export default function SmartCreateView({ routeSessionToken = '', flowMode = 'smart' }: SmartCreateViewProps) {
  const navigate = useNavigate()
  const { id: routeId } = useParams()
  const location = useLocation()
  const isRealPersonMode = flowMode === 'real-person'
  const flowBasePath = isRealPersonMode ? '/real-person-video' : '/smart'
  const draftFlow: SmartDraft['flow'] = isRealPersonMode ? 'real-person-video' : 'smart'
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
  const { isAuthenticated, isCheckingSession } = useAuth()
  // 模型目录按 workspace 拉取，游客拿不到任何模型：入口置灰，点击走统一登录引导。
  // 会话仍在校验时不算游客，否则刷新瞬间入口会闪一下「登录后选择模型」。
  const modelEntryAuthRequired = !isAuthenticated && !isCheckingSession
  const requestModelEntryLogin = useCallback(() => {
    void requireAuth(undefined, { returnTo: `${location.pathname}${location.search}` })
  }, [requireAuth, location.pathname, location.search])
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
  // 产品规则：模型只在入口页选择；进入图片对话或视频四步流程后只读取入口快照。
  const showGenerationModelSelection = !started
  const [videoCount, setVideoCount] = useState(1) // 生成视频数量(1-10)
  const initialVideoGenerateCountRef = useRef(1)
  const [pendingVideoFocusToken, setPendingVideoFocusToken] = useState(0)
  const [splitOpen, setSplitOpen] = useState(false) // split 按钮下拉开关
  const [entryKey, setEntryKey] = useState(0) // 「制作新视频」自增 → 重挂载入口页,清空其内部输入状态
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [entryMeta, setEntryMeta] = useState<EntryMeta | null>(null)
  // 流程内切换模型后，紧接着发起的重生成必须读取这次不可变选择，不能等下一次 render 再读旧闭包。
  const entryMetaRef = useRef<EntryMeta | null>(null)
  entryMetaRef.current = entryMeta
  /**
   * 取本次已选真人的名字；普通智能成片选中真人素材时也必须保留身份约束。
   * 支持多人同框：每个出镜人都要写进约束，只写第一个会让其余人的长相失去保护。
   */
  const resolveRealPersonIdentityName = (): string =>
    Array.from(
      new Set(
        (entryMetaRef.current?.realPersonReferences || [])
          .map((reference) => String(reference?.personName || '').trim())
          .filter(Boolean),
      ),
    ).join('、')
  /**
   * 项目入口选定的真人素材是本次创作唯一的身份锚点。
   * 不依赖 AI 后续识别出的主体标签，避免标签/素材映射漂移后退回普通出图。
   */
  const resolveProjectRealPersonReference = (): SmartRealPersonReference | null =>
    entryMetaRef.current?.realPersonReferences?.[0] || null
  /**
   * 只有完整的、可回溯到真人库素材的引用才允许跳过通用人脸脱敏。
   * 不完整引用不能静默当作真人素材使用，避免把普通人像误送入出片链路。
   */
  const isValidRealPersonReference = (
    reference: SmartRealPersonReference | null | undefined,
  ): reference is SmartRealPersonReference =>
    Boolean(reference && Number(reference.realPersonId || 0) > 0 && Number(reference.localAssetId || 0) > 0)
  const modelSwitchSequenceRef = useRef(0)
  const modelSwitchingRef = useRef(false)
  const modelSwitchRecoveryRef = useRef<SmartModelSwitchRecoveryDescriptor | null>(null)
  const routeSessionTokenRef = useRef(routeSessionToken)
  routeSessionTokenRef.current = routeSessionToken
  const [modelSwitching, setModelSwitching] = useState(false)
  useEffect(
    () => () => {
      modelSwitchSequenceRef.current += 1
      modelSwitchingRef.current = false
    },
    [],
  )
  // 'smart'：智能成片 / 真人成片额外屏蔽 Seedance 2.5（画布不受影响）。
  const generationModelCatalog = useGenerationModelCatalog(workspaceId, 'smart')
  const generationModelCatalogRef = useRef(generationModelCatalog)
  generationModelCatalogRef.current = generationModelCatalog
  const textToImageModelSelectionId = entryMeta?.generationModels?.['image.text_to_image']
  const imageToImageModelSelectionId = entryMeta?.generationModels?.['image.image_to_image']
  const videoGenerationModelSelectionId = entryMeta?.generationModels?.['video.generate']

  // 全流程的时长档位与入口下拉同源（同一个 getGenerationModelDurationOptions）：
  // 模型 schema 声明了哪些秒数就以哪些为准，未声明才回落 1–15 秒。
  // 此前流程各处写死 1–15，模型支持 30 秒时会出现「下拉能选、提交被拒」。
  const supportedVideoDurations = useMemo(
    () =>
      getGenerationModelDurationOptions(
        generationModelCatalog.pickerGroups,
        entryMeta?.generationModels || {},
        'video.generate',
        SMART_VIDEO_DURATIONS,
      ),
    [generationModelCatalog.pickerGroups, entryMeta?.generationModels],
  )
  const supportedVideoDurationLabel = useMemo(
    () => formatSupportedDurationLabel(supportedVideoDurations),
    [supportedVideoDurations],
  )
  /** 分镜总时长上限：取所选模型的最长档位，模型未声明时仍是 15 秒。 */
  const maxVideoDurationSec = supportedVideoDurations[supportedVideoDurations.length - 1] ?? 15
  /**
   * 单镜时长上限：长片（本次成片达到 16 秒起）按产品规则「首尾各 3 秒、中间每镜最多 7 秒」限制，
   * 15 秒及以内沿用既有固定模板（15 秒是 3+9+3，中间那一镜本就可以到 9 秒），不收紧线上行为。
   */
  const maxShotDurationSec = useMemo(() => {
    const selectedSec = parseDurationSeconds(entryMeta?.duration) ?? 0
    return selectedSec >= LONG_FORM_MIN_TOTAL_SEC ? LONG_FORM_MAX_MIDDLE_SHOT_SEC : maxVideoDurationSec
  }, [entryMeta?.duration, maxVideoDurationSec])

  const requiredGenerationOperations = (
    mode: EntryMeta['mode'],
    referenceImageCount = 0,
    hasRealPersonReference = false,
  ): readonly GenerationOperationCode[] =>
    mode === 'image'
      ? [getImageGenerationOperationCode(referenceImageCount)]
      : hasRealPersonReference
        ? Array.from(new Set([...REQUIRED_GENERATION_OPERATION_CODES_BY_MODE.video, 'image.image_to_image']))
        : REQUIRED_GENERATION_OPERATION_CODES_BY_MODE.video

  /** 入口必须一次加载完整流程所需模型；后续页面只读取入口快照，不再提供补选入口。 */
  const generationModelCatalogMessage = (
    mode: EntryMeta['mode'],
    referenceImageCount = 0,
    hasRealPersonReference = false,
  ): string => {
    const firstUnavailableOperation = getUnavailableGenerationOperations(
      generationModelCatalog.operationStates,
      requiredGenerationOperations(mode, referenceImageCount, hasRealPersonReference),
    )[0]
    return (
      (firstUnavailableOperation && generationModelCatalog.operationStates[firstUnavailableOperation].message) ||
      (generationModelCatalog.loading ? '可用模型仍在加载，请稍后再试' : '') ||
      generationModelCatalog.error ||
      '当前创作模式需要的模型目录尚未就绪，请刷新后重试'
    )
  }

  /** 从当前后端目录校验草稿中的模型 ID；下架或跨空间失效的选择不会继续用于新任务。 */
  const selectedGenerationModel = (
    operationCode: GenerationOperationCode,
    selections: GenerationModelSelectionMap | undefined = entryMeta?.generationModels,
  ): SelectedGenerationModel | null => {
    const model = resolveGenerationModelSelections(generationModelCatalogRef.current.groups, selections)[operationCode]
    const modelVersionId = Number(model?.modelVersionId || 0)
    return model && Number.isSafeInteger(modelVersionId) && modelVersionId > 0 ? { ...model, modelVersionId } : null
  }

  /** 新建任务前的最后一道模型门禁；防止通过恢复态、快捷键或旧草稿绕过选择器。 */
  const requireGenerationModel = (
    operationCode: GenerationOperationCode,
    selections?: GenerationModelSelectionMap,
  ): SelectedGenerationModel | null => {
    const model = selectedGenerationModel(operationCode, selections)
    if (model) return model
    showToast(
      generationModelCatalog.loading
        ? '可用模型仍在加载，请稍后再试'
        : generationModelCatalog.error || '当前项目的模型配置不完整或已失效，请返回首页重新选择',
      'error',
    )
    return null
  }

  /** 交互式 responses.multimodal 操作不能回退到后端默认模型。 */
  const requireInteractiveResponseModel = (): SelectedGenerationModel => {
    const model = selectedGenerationModel('responses.multimodal')
    if (model) return model
    throw new Error(
      generationModelCatalog.loading
        ? '可用模型仍在加载，请稍后再试'
        : generationModelCatalog.error || '当前项目的脚本模型配置缺失或已失效，请返回首页重新选择',
    )
  }

  /** 将交互式脚本/润色调用绑定到当前项目空间及入口选中的完整模型快照。 */
  const responseRequestContextFor = (
    model: SelectedGenerationModel,
    workspaceIdOverride = Number(workspaceIdRef.current || workspaceId || 0),
  ) => {
    const lockedWorkspaceId = Math.max(0, Math.floor(Number(workspaceIdOverride) || 0))
    if (!lockedWorkspaceId) throw new Error('未选择工作空间，无法调用脚本模型')
    return {
      workspaceId: lockedWorkspaceId,
      modelVersionId: model.modelVersionId,
      // 已显式锁定 modelVersionId 后不再混入全局套餐候选，避免切换空间时把另一空间的候选带进旧请求。
      modelPlanCandidates: [],
      modelVersion: cloneGenerationSnapshot(model.source),
    }
  }

  /**
   * 重试门禁读取失败消息自己的操作类型；已有非终态 taskId 时只恢复原任务，
   * 不受当前输入框参考图和模型选择影响，也不会再次创建付费任务。
   */
  const getImageRetryDisabledReason = (message: ChatMessage): string => {
    if (!Number(workspaceIdRef.current || workspaceId || 0)) {
      return '当前工作空间尚未就绪，请刷新页面后重试'
    }
    if (!Number(projectIdRef.current || projectId || 0)) {
      return '当前图片项目尚未创建完成，请返回入口重新发起生成'
    }
    if (!appliedRef.current || !started) {
      return '当前图片项目仍在加载，请等待加载完成后重试'
    }
    // 已付费且未确认终态的任务只恢复原 taskId，不依赖当前模型选择，也不创建第二笔任务。
    if (Number(message.taskId || 0) > 0 && message.terminalFailure !== true) return ''
    if (draftSaveStatusRef.current === 'conflict') {
      return '项目已在其他页面更新，请刷新页面载入最新项目后再重新生成'
    }
    // checkpoint 失败的未提交任务使用消息自身锁定的模型与幂等键恢复；
    // 当前入口的模型选择可能在刷新/迁移草稿后丢失，不能据此错误禁用安全恢复。
    if (isUnsubmittedImagePreparationFailure(message)) {
      return getImageQueueModelLockError(message)
    }
    const operationCode = message.operationCode
    if (operationCode !== 'image.text_to_image' && operationCode !== 'image.image_to_image') {
      return '该失败记录缺少图片生成类型，请在输入框重新发起生成'
    }
    if (selectedGenerationModel(operationCode)) return ''
    if (generationModelCatalog.loading) return '可用模型仍在加载，请稍后再试'
    if (generationModelCatalog.error) return generationModelCatalog.error
    return `入口选择的${operationCode === 'image.image_to_image' ? '图生图' : '文生图'}模型缺失或已失效，请返回首页重新选择`
  }

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
  const marketingRequestSequenceRef = useRef(0)
  const marketingRequestRef = useRef<{
    runId: number
    workspaceId: number
    routeSessionToken: string
    controller: AbortController
  } | null>(null)
  const marketingTagRequestSequenceRef = useRef(0)
  const marketingTagRequestRef = useRef(
    new Map<
      MarketingFieldKey,
      {
        runId: number
        workspaceId: number
        routeSessionToken: string
        controller: AbortController
      }
    >(),
  )
  const cancelMarketingRequests = useCallback(() => {
    marketingRequestSequenceRef.current += 1
    marketingTagRequestSequenceRef.current += 1
    marketingRequestRef.current?.controller.abort()
    marketingRequestRef.current = null
    marketingTagRequestRef.current.forEach((request) => request.controller.abort())
    marketingTagRequestRef.current.clear()
    setMarketingLoading(false)
    setMarketingTagBusy({})
  }, [])
  const summaryRequestSequenceRef = useRef(0)
  const summaryRequestRef = useRef<{
    runId: number
    workspaceId: number
    routeSessionToken: string
    controller: AbortController
  } | null>(null)
  const cancelSummaryRequest = useCallback(() => {
    summaryRequestSequenceRef.current += 1
    summaryRequestRef.current?.controller.abort()
    summaryRequestRef.current = null
  }, [])
  useEffect(
    () => () => {
      marketingRequestRef.current?.controller.abort()
      marketingRequestRef.current = null
      marketingTagRequestRef.current.forEach((request) => request.controller.abort())
      marketingTagRequestRef.current.clear()
      summaryRequestRef.current?.controller.abort()
      summaryRequestRef.current = null
    },
    [],
  )
  useEffect(() => {
    const activeWorkspaceId = Number(workspaceId || 0)
    const active = marketingRequestRef.current
    if (active && (active.workspaceId !== activeWorkspaceId || active.routeSessionToken !== routeSessionToken)) {
      active.controller.abort()
      marketingRequestRef.current = null
      setMarketingLoading(false)
    }

    let abortedTagRequest = false
    marketingTagRequestRef.current.forEach((request, key) => {
      if (request.workspaceId === activeWorkspaceId && request.routeSessionToken === routeSessionToken) return
      request.controller.abort()
      marketingTagRequestRef.current.delete(key)
      abortedTagRequest = true
    })
    if (abortedTagRequest) setMarketingTagBusy({})

    const activeSummary = summaryRequestRef.current
    if (
      activeSummary &&
      (activeSummary.workspaceId !== activeWorkspaceId || activeSummary.routeSessionToken !== routeSessionToken)
    ) {
      activeSummary.controller.abort()
      summaryRequestRef.current = null
    }
  }, [routeSessionToken, workspaceId])

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
  const scriptRequestSequenceRef = useRef(0)
  const scriptRequestRef = useRef<{
    runId: number
    workspaceId: number
    routeSessionToken: string
    controller: AbortController
  } | null>(null)
  useEffect(
    () => () => {
      scriptRequestRef.current?.controller.abort()
      scriptRequestRef.current = null
      scriptRunningRef.current = false
    },
    [],
  )
  useEffect(() => {
    const active = scriptRequestRef.current
    if (
      !active ||
      (active.workspaceId === Number(workspaceId || 0) && active.routeSessionToken === routeSessionToken)
    ) {
      return
    }
    active.controller.abort()
    scriptRequestRef.current = null
    scriptRunningRef.current = false
    setScriptLoading(false)
    setScriptPending(false)
    modelSwitchRecoveryRef.current = null
  }, [routeSessionToken, workspaceId])
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
  const [subjectAssets, setSubjectAssets] = useState<Record<string, SmartSubjectAssetVersionRegistry>>({})
  const subjectAssetsRef = useRef<Record<string, SmartSubjectAssetVersionRegistry>>({})
  subjectAssetsRef.current = subjectAssets
  // 准备素材「一键生成」:逐个主体生成时的 loading(键=主体名),以及整体批量进行中标记
  const [subjectGenerating, setSubjectGenerating] = useState<Record<string, boolean>>({})
  const [batchGenning, setBatchGenning] = useState(false)
  // 「一键生成」是否在进行中(持久化进草稿):切到别的页面再回来,据此【自动续作】还没出图的素材,不被截断
  const [materialBatchPending, setMaterialBatchPending] = useState(false)
  const batchRunningRef = useRef(false)
  const subjectGenerationRequestsRef = useRef(new Map<string, EphemeralImageRequest>())
  const shotDialogGenerationRequestsRef = useRef(new Map<Shot['id'], EphemeralImageRequest>())

  /** 中止未进入持久化恢复队列的临时图片请求，并尽力取消已经创建的后端任务。 */
  const abortEphemeralImageRequests = useCallback(() => {
    const requests = [
      ...subjectGenerationRequestsRef.current.values(),
      ...shotDialogGenerationRequestsRef.current.values(),
    ]
    subjectGenerationRequestsRef.current.clear()
    shotDialogGenerationRequestsRef.current.clear()
    for (const request of requests) {
      request.controller.abort()
      for (const taskId of request.taskIds) {
        void cancelAiTask({ workspaceId: request.workspaceId, taskId }).catch(() => undefined)
      }
      request.taskIds.clear()
    }
  }, [])

  // 从分镜脚本返回后点「确认脚本」触发的这次素材重生,要求整批走全新生成:
  // 不复用 subjectAssets 版本库,也不自动带入入口上传图。
  const forceFreshMaterialsRef = useRef(false)
  // 把某元素的选定图(url+assetId)写回所有同名 subject
  /**
   * 疑似重复主体：同一产品被 AI 起了不同名字时，素材按名字共享的机制就失效了。
   * 只在准备素材阶段提示，检测本身是纯函数，不发任何请求。
   */
  const duplicateSubjectGroups = useMemo(() => findDuplicateSubjectGroups(shots), [shots])

  /**
   * 把一组疑似重复的主体统一成同一个名字。
   *
   * 改名即完成合并：素材本来就按名字全局共享（见 applySubjectImage），
   * 统一名字后这些镜头会立即共用同一张图，无需搬运素材本身。
   * 目标名已有素材时一并铺到组内其它镜头，避免留下空占位。
   */
  const mergeDuplicateSubjects = (group: DuplicateSubjectGroup) => {
    const canonical = group.canonical
    const aliases = new Set(group.names.filter((name) => name !== canonical))
    if (!aliases.size) return

    setShots((prev) => {
      // 先找出该组里已经绑定过的素材，作为统一后的用图
      let image = ''
      let assetId = 0
      for (const shot of prev) {
        for (const subject of shot.subjects || []) {
          const name = stripAt(subject.tag)
          if (name !== canonical && !aliases.has(name)) continue
          if (!image && subject.image) {
            image = subject.image
            assetId = Number(subject.assetId || 0)
          }
        }
      }

      const next = prev.map((shot) => {
        const seen = new Set<string>()
        const subjects = shot.subjects
          .map((subject) => {
            const name = stripAt(subject.tag)
            if (name !== canonical && !aliases.has(name)) return subject
            return {
              ...subject,
              tag: `@${canonical}`,
              ...(image ? { image, assetId } : {}),
            }
          })
          // 同一镜头里两个别名都出现过时，改名后会重名，去重保留第一个
          .filter((subject) => {
            const name = stripAt(subject.tag)
            if (name !== canonical) return true
            if (seen.has(name)) return false
            seen.add(name)
            return true
          })
        return { ...shot, subjects }
      })
      shotsRef.current = next
      return next
    })

    showToast(`已统一为「${canonical}」，这些镜头将使用同一张素材`, 'success')
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
  // 横屏/竖屏适配:把项目比例(如 9:16 / 16:9)写成全局 CSS 变量 --frame-ratio,
  // 各处分镜图/视频预览/缩略图据它设 aspect-ratio(默认 16/9)。卸载时清理。
  useEffect(() => {
    const r = String(entryMeta?.ratio || '16:9').replace(':', ' / ')
    document.documentElement.style.setProperty('--frame-ratio', r)
    return () => {
      document.documentElement.style.removeProperty('--frame-ratio')
    }
  }, [entryMeta?.ratio])

  // 兼容旧草稿:旧版本把「准备素材」「镜头编排」保存为 step 1 / 2。两步都已从流程移除
  // (用户上传的素材直接作为参考图提交给视频模型,不再中途重画),恢复后直接落到生成视频。
  useEffect(() => {
    if (step > STEP_VIDEO) goStep(STEP_VIDEO)
  }, [step])

  // 脚本续跑:恢复后若"脚本生成进行中"标记仍在(切走打断了)、当前没在生成、有入口信息 → 自动重新生成脚本。
  // 流式脚本没有 task id 可续,这里以"重新生成"作为续跑;只触发一次。
  useEffect(() => {
    if (!hydratedRef.current || scriptResumeRef.current) return
    if (generationModelCatalog.loading || !selectedGenerationModel('responses.multimodal')) return
    if (scriptPending && !scriptLoading && step === 0 && !marketingOpen && entryMeta && started) {
      scriptResumeRef.current = true
      void generateScript(reqSummary || requirement, entryMeta)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scriptPending,
    scriptLoading,
    step,
    marketingOpen,
    entryMeta,
    started,
    generationModelCatalog.loading,
    generationModelCatalog.groups,
  ])

  // ── 镜头编排:按 画面描述 + 该镜头素材 + 上一张分镜图(连贯)+ 项目摘要 生成分镜图(后端文/图生图) ──
  const [shotGen, setShotGen] = useState<Record<string, boolean>>({})
  const [shotGenRunning, setShotGenRunning] = useState(false)
  const shotGenAbortRef = useRef<AbortController | null>(null)
  const shotGenRunSeqRef = useRef(0)
  const shotGenTaskIdsRef = useRef<Set<number>>(new Set())
  const shotGenWorkspaceIdRef = useRef(0)

  const cancelShotGeneration = useCallback(async () => {
    shotGenRunSeqRef.current += 1
    shotGenAbortRef.current?.abort()
    shotGenAbortRef.current = null
    const ws = Number(shotGenWorkspaceIdRef.current || workspaceIdRef.current || 0)
    shotGenWorkspaceIdRef.current = 0
    const taskIds = [...shotGenTaskIdsRef.current]
    shotGenTaskIdsRef.current.clear()
    setShotGen({})
    setShotGenRunning(false)
    if (!ws || !taskIds.length) return
    await Promise.allSettled(taskIds.map((taskId) => cancelAiTask({ workspaceId: ws, taskId })))
  }, [])

  const cancelShotDialogGenerationRequest = (shotId: Shot['id']) => {
    const request = shotDialogGenerationRequestsRef.current.get(shotId)
    if (!request) return
    shotDialogGenerationRequestsRef.current.delete(shotId)
    request.controller.abort()
    for (const taskId of request.taskIds) {
      void cancelAiTask({ workspaceId: request.workspaceId, taskId }).catch(() => undefined)
    }
    request.taskIds.clear()
    setShotGen((current) => ({ ...current, [shotId]: false }))
  }

  useEffect(() => {
    const activeWorkspaceId = Number(workspaceId || 0)
    const activeProjectId = Number(projectId || 0)
    const hasStaleEphemeralRequest = [
      ...subjectGenerationRequestsRef.current.values(),
      ...shotDialogGenerationRequestsRef.current.values(),
    ].some(
      (request) =>
        request.workspaceId !== activeWorkspaceId ||
        request.projectId !== activeProjectId ||
        request.routeSessionToken !== routeSessionToken,
    )
    if (hasStaleEphemeralRequest) {
      abortEphemeralImageRequests()
      batchRunningRef.current = false
      setBatchGenning(false)
      setMaterialBatchPending(false)
      setSubjectGenerating({})
      setShotGen({})
    }
    if (shotGenAbortRef.current && shotGenWorkspaceIdRef.current !== activeWorkspaceId) {
      void cancelShotGeneration()
    }
  }, [abortEphemeralImageRequests, cancelShotGeneration, projectId, routeSessionToken, workspaceId])

  useEffect(
    () => () => {
      abortEphemeralImageRequests()
      const ws = Number(shotGenWorkspaceIdRef.current || workspaceIdRef.current || 0)
      shotGenAbortRef.current?.abort()
      shotGenAbortRef.current = null
      const taskIds = [...shotGenTaskIdsRef.current]
      shotGenTaskIdsRef.current.clear()
      shotGenWorkspaceIdRef.current = 0
      if (ws > 0) {
        for (const taskId of taskIds) {
          void cancelAiTask({ workspaceId: ws, taskId }).catch(() => undefined)
        }
      }
    },
    [abortEphemeralImageRequests],
  )
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
      imageModels: {
        textToImage: meta?.generationModels?.['image.text_to_image'] || '',
        imageToImage: meta?.generationModels?.['image.image_to_image'] || '',
      },
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
      videoModel: meta?.generationModels?.['video.generate'] || '',
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
    theme: string,
    plans: string[],
    feedback?: string,
    opts: {
      editPrompt?: string
      refUrls?: string[]
      carryCurrent?: boolean
      signal?: AbortSignal
      onTask?: (taskId: number) => void
      generationModels?: GenerationModelSelectionMap
      lockedImageModels?: LockedSmartImageModels
    } = {},
  ) => {
    // manual=面板手动出图(指定素材 + 是否携带当前图);否则=批量自动(用全部元素 + 上一张连贯)
    const manual = opts.refUrls !== undefined
    const elUrls = manual
      ? opts.refUrls!
      : (Array.from(new Set(sh.subjects.map((s) => s.image).filter(Boolean))) as string[])
    const projectRealPersonReference = resolveProjectRealPersonReference()
    const requiredRealPersonReference =
      projectRealPersonReference || resolveShotRealPersonPreservation(sh, subjectAssetsRef.current)
    if ((isRealPersonMode || projectRealPersonReference) && !isValidRealPersonReference(requiredRealPersonReference)) {
      throw new Error('当前镜头缺少已认证真人素材，无法生成真人画面')
    }
    // 当前镜头只携带脚本匹配到的上传元素；不同镜头不会互相混入无关产品。
    const elementRefIds = resolveShotElementReferenceAssetIds(sh)
    const refIds = Array.from(
      new Set([
        ...elementRefIds,
        ...(requiredRealPersonReference?.localAssetId ? [requiredRealPersonReference.localAssetId] : []),
      ]),
    )
    // 是否沿用当前画面的文字语义：manual 看 carryCurrent；批量靠上一镜保持连贯。
    const carry = manual ? !!opts.carryCurrent : !!(feedback || opts.editPrompt)
    const baseUrl = carry ? sh.image || '' : manual ? '' : prevUrl
    // 该镜元素名(锚定画面只含这些主体,避免把无关产品/主题塞进来)
    const elNames = Array.from(new Set(sh.subjects.map((s) => stripAt(s.tag)).filter(Boolean))).join('、')
    // 提示词:① 用户编辑过的 imagePrompt 直接用;② 否则按 该镜画面描述 + 该镜元素 + 风格 组合
    // 注意:不再注入"整体广告主题",否则会把全局产品(如雅迪车)塞进每个无关镜头。
    let prompt = opts.editPrompt
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
    if (elementRefIds.length) {
      prompt = [
        prompt,
        `必须携带参考图中的${elNames || '客户上传元素'}，保持其标志、文字、颜色、外形结构和比例一致，不得替换、遗漏或重新设计`,
      ]
        .filter(Boolean)
        .join(';')
    }
    if (requiredRealPersonReference) {
      prompt = buildRealPersonIdentityPrompt(prompt, requiredRealPersonReference.personName)
    }
    const operationCode: SmartImageOperationCode = refIds.length ? 'image.image_to_image' : 'image.text_to_image'
    const modelSelection =
      opts.lockedImageModels?.[operationCode] || requireGenerationModel(operationCode, opts.generationModels)
    if (!modelSelection) throw new Error('请先选择当前图片生成方式要使用的模型')
    // 全云端:后端文/图生图(带素材组合 + 连贯),产出即后端 asset(http + asset_id),天然持久
    const r = await generateShotImage({
      workspaceId: ws,
      prompt,
      refAssetIds: refIds,
      modelVersionId: modelSelection.modelVersionId,
      modelVersion: modelSelection.source,
      modelPlanCandidates: plans,
      ratio: entryMeta?.ratio,
      // 只要镜头绑定了客户元素，就不允许静默退回文生图，否则会把产品/Logo凭空重画。
      allowTextToImageFallback: refIds.length === 0,
      signal: opts.signal,
      onTask: opts.onTask,
    })
    throwIfSmartRequestAborted(opts.signal)
    const url = r.url
    const assetId = Number(r.assetId || 0) || 0
    setShots((prev) => {
      const next = prev.map((x) =>
        x.id === sh.id
          ? {
              ...x,
              image: url,
              imageAssetId: assetId,
              imagePrompt: prompt,
              imageOperationCode: operationCode,
              imageModelVersionId: modelSelection.modelVersionId,
              // 出图即不再是「插入的新分镜」(清除「生成分镜」按钮)
              isNew: false,
              // 每版记录自己用到的提示词与素材 url,切换历史版本可还原
              imageVersions: [
                ...(x.imageVersions || []),
                {
                  url,
                  assetId,
                  prompt,
                  refs: elUrls,
                  operationCode,
                  modelVersionId: modelSelection.modelVersionId,
                  dependsOnPrevious: Boolean(!manual && prevUrl && baseUrl === prevUrl),
                },
              ],
              // 手动出图:把这次选中的素材固化为该镜的选中态(随草稿持久)
              ...(manual ? { selectedRefs: elUrls } : {}),
            }
          : x,
      )
      shotsRef.current = next
      return next
    })
    return url
  }

  // 串行生成全部分镜图。list 缺省取当前 shots;插入新分镜后传入「已写入新描述」的列表,避免读到旧 state
  const generateShotImages = async (
    list: Shot[] = shots,
    options: {
      generationModels?: GenerationModelSelectionMap
      lockedImageModels?: LockedSmartImageModels
      stopOnFailure?: boolean
      initialPrevUrl?: string
      signatureList?: Shot[]
      beforeEachShot?: (shot: Shot, index: number) => Promise<boolean>
    } = {},
  ): Promise<boolean> => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成分镜图', 'error')
      return false
    }
    if (shotGenRunning || shotGenAbortRef.current) return false
    const runId = ++shotGenRunSeqRef.current
    const ctrl = new AbortController()
    shotGenAbortRef.current = ctrl
    shotGenWorkspaceIdRef.current = ws
    shotGenTaskIdsRef.current.clear()
    setShotGenRunning(true)
    // 记录本次出图所依据的输入签名(供「下次进镜头编排时输入未变则不重生成」判断)。
    // 始终按【全部分镜】算签名:即便本次只续作部分(list 为缺图子集),签名仍代表完整输入,避免误判为「改动」而全量重生成。
    const lockedEntryMeta =
      options.generationModels && entryMetaRef.current
        ? { ...entryMetaRef.current, generationModels: options.generationModels }
        : entryMetaRef.current || entryMeta
    shotGenSigRef.current = shotImageInputSig(options.signatureList || list, lockedEntryMeta)
    const theme = (reqSummary || '').slice(0, 60)
    const plans = options.generationModels || options.lockedImageModels ? [] : await resolvePlanCandidates()
    let prevUrl = String(options.initialPrevUrl || '')
    let failed = false
    try {
      for (const [index, sh] of list.entries()) {
        if (ctrl.signal.aborted || runId !== shotGenRunSeqRef.current) break
        if (options.beforeEachShot && !(await options.beforeEachShot(sh, index))) {
          failed = true
          break
        }
        setShotGen((m) => ({ ...m, [sh.id]: true }))
        let activeTaskId = 0
        try {
          prevUrl = await genShotFrame(ws, sh, prevUrl, theme, plans, undefined, {
            signal: ctrl.signal,
            onTask: (taskId) => {
              activeTaskId = Number(taskId) || 0
              if (activeTaskId > 0) shotGenTaskIdsRef.current.add(activeTaskId)
            },
            generationModels: options.generationModels,
            lockedImageModels: options.lockedImageModels,
          })
        } catch (e: any) {
          if (ctrl.signal.aborted || /已取消/.test(String(e?.message || ''))) break
          failed = true
          showToast(`分镜「${sh.no}」生成失败:${e?.message || ''}`, 'error')
          if (options.stopOnFailure) break
        } finally {
          if (activeTaskId > 0) shotGenTaskIdsRef.current.delete(activeTaskId)
          setShotGen((m) => ({ ...m, [sh.id]: false }))
        }
      }
    } finally {
      if (shotGenAbortRef.current === ctrl) shotGenAbortRef.current = null
      if (runId === shotGenRunSeqRef.current) {
        shotGenWorkspaceIdRef.current = 0
        setShotGenRunning(false)
      }
    }
    return !ctrl.signal.aborted && runId === shotGenRunSeqRef.current && !failed
  }

  const removeShotLocally = (shotId: Shot['id']) => {
    cancelInsertTextGeneration(shotId)
    cancelShotDialogGenerationRequest(shotId)
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
    const scriptModel = requireGenerationModel('responses.multimodal')
    if (!scriptModel) return
    const requestContext = responseRequestContextFor(scriptModel)
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
        modelVersionId: scriptModel.modelVersionId,
        requestContext,
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
    const remainingSec = maxVideoDurationSec - currentSec
    if (remainingSec < 1) {
      showToast(`当前分镜总时长已达到${maxVideoDurationSec}秒，请先缩短已有镜头再新增`, 'error')
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

  // 进入/返回镜头编排时评估【一次】:上游(脚本描述/素材)改动 → 全量重生成;否则只补「还没出图」的分镜
  //(续作被中断的那几张)。用 autoGenRef 闸门保证「本次进入只评估一次」:
  //  - 避免在镜头编排内「单镜编辑」改了 shots(签名变化)而触发整列重生成 + 把刚生成的那张又重生成一次;
  //  - 生成中离开再回来 → step→2 重置闸门 → 重新评估 → 自动续作未出图的。
  useEffect(() => {
    // 确认脚本后，主体素材与分镜图应并行生成。普通主体素材仅参与提示词，
    // 不作为图生图参考下发；真人素材始终使用已经持久化的 asset_id。
    // 因此不能等待主体素材批量任务结束，否则用户进入下一步后会看不到分镜图开始生成。
    if (modelSwitchingRef.current || step !== 2 || !shots.length || shotGenRunning) return
    if (autoGenRef.current) return
    if (generationModelCatalog.loading) return
    const activeShots = shots.filter((shot) => shot.includeInVideo !== false)
    const projectRealPersonReference = resolveProjectRealPersonReference()
    // 普通智能成片始终走文生图；主体素材和上一镜只参与提示词，不能再把多镜头误判为图生图。
    // 只有已绑定的真人素材才需要图生图模型来传递身份参考图。
    const hasRealPersonReference = (shot: Shot) =>
      Boolean(
        projectRealPersonReference?.localAssetId ||
        resolveShotRealPersonPreservation(shot, subjectAssetsRef.current)?.localAssetId,
      )
    const needsTextToImage = activeShots.some((shot) => !hasRealPersonReference(shot))
    const needsImageToImage = activeShots.some(hasRealPersonReference)
    if (
      (needsTextToImage && !selectedGenerationModel('image.text_to_image')) ||
      (needsImageToImage && !selectedGenerationModel('image.image_to_image'))
    ) {
      return
    }
    const sig = shotImageInputSig(shots, entryMeta)
    const changed = sig !== shotGenSigRef.current
    const missing = shots.filter((s) => !s.image)
    autoGenRef.current = true // 本次进入已评估,后续单镜编辑/补图不再触发整列重生成
    if (!changed && missing.length === 0) return // 全部已出图且上游未改动 → 不动(草稿恢复/未改动)
    void generateShotImages(changed ? shots : missing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    step,
    shots,
    generationModelCatalog.loading,
    generationModelCatalog.groups,
    textToImageModelSelectionId,
    imageToImageModelSelectionId,
  ])

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
    /** 新付费任务启动前，恢复描述符是否已经成功写入云端草稿。 */
    checkpointState?: 'pending' | 'saved'
    /** 入队时锁定的不可变上下文。创建新视频后，旧任务仍只写回原项目。 */
    context?: {
      sessionId: number
      workspaceId: number
      projectId: number
      projectTitle: string
      shots: Shot[]
      basePrompt: string
      ratio?: string
      /** 入队时锁定的出片分辨率；估价与提交共用同一个值。 */
      resolution?: string
      style?: string
      durationSec: number
      thumbnailUrl?: string
      sourceVideo?: { url: string; assetId: number }
      sourceVideoDurationSec?: number
      videoEditPrompt?: string
      /** 入队时锁定的真人身份锚点，任务执行期间不读取当前页面的可变选择。 */
      realPersonReference?: SmartRealPersonReference | null
      modelVersionId?: number
      modelVersion?: Record<string, unknown>
      modelPlanCandidates?: string[]
      operationCode?: 'video.generate' | 'video.edit'
      quotedCost?: LockedSmartVideoQuotedCost
      lockedSig: string
    }
  }
  type VideoQueueCheckpointRun = {
    sessionId: number
    workspaceId: number
    projectId: number
    jobIds: Set<string>
    promise: Promise<boolean>
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
  const restoredVideoQueueRewriteRef = useRef<'checkpoint' | 'save' | ''>('')
  const videoQueuePlanningRef = useRef(false)
  const [videoQueuePlanning, setVideoQueuePlanning] = useState(false)
  const videoQueueCheckpointBlockedRef = useRef(false)
  const videoQueueCheckpointRunRef = useRef<VideoQueueCheckpointRun | null>(null)
  const videoGenSessionIdRef = useRef(1)
  const videoGenDrainingSessionsRef = useRef(new Set<number>())
  // drain 之外，恢复轮询 / registry 订阅也代表该 session 已经有唯一执行方。
  // reset 时不能再把它的剩余队列交给第二个 drain，否则会提前并发甚至重复提交。
  const videoGenOwnedSessionsRef = useRef(new Set<number>())
  // session 的 owner 只能在当前页面已确认项目归属时登记；脱离当前页面后不可再从任务 context 反推。
  const videoGenSessionOwnersRef = useRef(new Map<number, SmartVideoQueueOwner>())
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
    if (!targetQueue.length) videoGenSessionOwnersRef.current.delete(sessionId)
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
    const pid = Number(context?.projectId || 0) || 0
    const ws = Number(context?.workspaceId || 0) || 0
    if (!context || !pid || !ws || !(Number(context.sessionId || 0) > 0)) return
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
      title: context.projectTitle || '智能成片',
      ratio: context.ratio || '',
      durationSec: Number(context.durationSec || totalDurationSec(context.shots || []) || 0) || 0,
      thumbnailUrl: context.thumbnailUrl || context.shots?.find((shot) => shot.image)?.image || '',
      thumbnailAssetId:
        Number(context.shots?.find((shot) => Number(shot.imageAssetId || 0) > 0)?.imageAssetId || 0) || 0,
      operationCode: 'video.generate',
      startedAt: Number(existing?.startedAt || Date.now()),
      updatedAt: Date.now(),
      locallyInitiated: true,
      ...patch,
    })
  }

  const currentVideoQueueOwner = (sessionId = videoGenSessionIdRef.current): SmartVideoQueueOwner => ({
    sessionId,
    workspaceId: Number(workspaceIdRef.current || 0) || 0,
    projectId: Number(projectIdRef.current || 0) || 0,
  })
  const isSameVideoQueueOwner = (left: SmartVideoQueueOwner | undefined, right: SmartVideoQueueOwner): boolean =>
    Boolean(
      left &&
      left.sessionId === right.sessionId &&
      left.workspaceId === right.workspaceId &&
      left.projectId === right.projectId,
    )

  /**
   * context 不可信时绝不能用它写另一个项目。当前页面只把同 ID 的本地 generation 收口为失败，
   * 清空队列后由现有草稿保存链写回当前项目；任务中心也只更新可证明属于当前 owner 的记录。
   */
  const failUnsafeVideoQueue = (
    targetQueue: VideoGenJob[],
    sessionId: number,
    message: string,
    owner = currentVideoQueueOwner(sessionId),
  ) => {
    const failedIds = new Set(targetQueue.map((job) => String(job.id || '')).filter(Boolean))
    for (const job of targetQueue) {
      if (!getSmartVideoQueueOwnershipError([job], owner)) {
        syncSmartTask(job, 'failed', { taskId: 0, error: message })
      }
    }
    targetQueue.splice(0, targetQueue.length)
    videoGenSessionOwnersRef.current.delete(sessionId)
    if (!isCurrentVideoSession(sessionId) || !isSameVideoQueueOwner(owner, currentVideoQueueOwner(sessionId))) return
    immediateSaveRef.current = true
    syncVideoGenQueue([], sessionId, targetQueue)
    setVideoGenerations((previous) =>
      previous.map((generation) =>
        failedIds.has(generation.id) && generation.status === 'processing'
          ? { ...generation, status: 'failed', taskId: 0, running: false, error: message }
          : generation,
      ),
    )
    showToast(message, 'error')
  }

  /**
   * 在创建任何付费视频任务前，把完整队列、模型快照和幂等键写入云端。
   * 本地或旧草稿恢复出的 pending 队列也必须重新完成该检查，不能直接启动。
   */
  const ensureVideoQueueCheckpoint = (
    sessionId = videoGenSessionIdRef.current,
    targetQueue = videoGenQueueRef.current,
  ): Promise<boolean> => {
    if (!targetQueue.length) return Promise.resolve(false)
    const owner = currentVideoQueueOwner(sessionId)
    const registeredOwner = videoGenSessionOwnersRef.current.get(sessionId)
    const ownershipError = getSmartVideoQueueOwnershipError(targetQueue, owner)
    if (ownershipError || !isCurrentVideoSession(sessionId) || !isSameVideoQueueOwner(registeredOwner, owner)) {
      const message = '生成队列与当前项目不一致，尚未创建付费任务，请返回项目后重新生成'
      failUnsafeVideoQueue(targetQueue, sessionId, message, registeredOwner || owner)
      return Promise.resolve(false)
    }
    const ws = owner.workspaceId
    const pid = owner.projectId
    const pendingJobs = targetQueue.filter((job) => job.checkpointState !== 'saved')
    if (!pendingJobs.length) return Promise.resolve(true)

    const activeCheckpoint = videoQueueCheckpointRunRef.current
    if (activeCheckpoint) {
      const coveredByActiveCheckpoint =
        activeCheckpoint.sessionId === sessionId &&
        activeCheckpoint.workspaceId === ws &&
        activeCheckpoint.projectId === pid &&
        pendingJobs.every((job) => activeCheckpoint.jobIds.has(job.id))
      if (coveredByActiveCheckpoint) return activeCheckpoint.promise
      // 新任务可能在上一份快照保存期间追加。严格串行等待后，再为尚未保存的任务创建新快照。
      return activeCheckpoint.promise.then((saved) =>
        saved ? ensureVideoQueueCheckpoint(sessionId, targetQueue) : false,
      )
    }

    videoQueueCheckpointBlockedRef.current = true
    const checkpointJobIds = new Set(pendingJobs.map((job) => job.id))
    pendingJobs.forEach((job) =>
      syncSmartTask(job, 'queued', {
        taskId: 0,
        error: '正在保存生成配置，保存成功后才会开始生成',
      }),
    )

    const checkpointRun: VideoQueueCheckpointRun = {
      sessionId,
      workspaceId: ws,
      projectId: pid,
      jobIds: checkpointJobIds,
      promise: Promise.resolve(false),
    }
    videoQueueCheckpointRunRef.current = checkpointRun
    const checkpointPromise = (async () => {
      try {
        // putSmartDraftToBackend 在调用的同步阶段即锁定 projectId 与 currentDraft 快照；
        // 这里先核对 owner，再调用，后续追加进队列的 job 不会混进本次已保存集合。
        saveSmartDraft(currentDraft(), ws)
        const result = await putSmartDraftToBackend(ws)
        if (result !== 'saved') {
          pendingJobs.forEach((job) =>
            syncSmartTask(job, 'queued', {
              taskId: 0,
              error:
                result === 'conflict' ? '项目已在其他页面修改，请处理冲突后重试' : '生成配置保存失败，尚未创建付费任务',
            }),
          )
          if (isCurrentVideoSession(sessionId)) {
            showToast(
              result === 'conflict'
                ? '检测到项目保存冲突，视频任务尚未启动'
                : '生成配置保存失败，视频任务尚未启动；网络恢复后请重试',
              'error',
            )
          }
          return false
        }

        const checkpointedQueue = targetQueue.map((job) =>
          checkpointJobIds.has(job.id) && job.checkpointState !== 'saved'
            ? { ...job, checkpointState: 'saved' as const }
            : job,
        )
        syncVideoGenQueue(checkpointedQueue, sessionId, targetQueue)
        saveSmartDraft(currentDraft(), ws)
        checkpointedQueue
          .filter((job) => checkpointJobIds.has(job.id))
          .forEach((job) => syncSmartTask(job, 'queued', { taskId: 0, error: '' }))
        return true
      } catch (error: any) {
        pendingJobs.forEach((job) =>
          syncSmartTask(job, 'queued', {
            taskId: 0,
            error: getBusinessErrorMessage(error, '生成配置保存失败，尚未创建付费任务'),
          }),
        )
        if (isCurrentVideoSession(sessionId)) {
          showToast('生成配置保存失败，视频任务尚未启动；网络恢复后请重试', 'error')
        }
        return false
      } finally {
        if (videoQueueCheckpointRunRef.current === checkpointRun) {
          videoQueueCheckpointRunRef.current = null
        }
        videoQueueCheckpointBlockedRef.current = false
      }
    })()
    checkpointRun.promise = checkpointPromise
    return checkpointPromise
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
    const revivingUnsubmittedPreparationFailure =
      existing?.status === 'failed' &&
      Number(existing.taskId || 0) === 0 &&
      isUnsubmittedImagePreparationFailure(message)
    if (
      existing &&
      isTaskCenterTerminalStatus(existing.status) &&
      status !== existing.status &&
      status !== 'succeeded' &&
      !revivingUnsubmittedPreparationFailure
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
  // 视频必须使用完整分镜图。透明挖脸会迫使视频模型重新补脸，导致脸部边缘割裂和身份漂移。
  // AI 分镜直接使用原图；已认证真人在提交前另行校验授权并注入身份约束。
  const faceBlurEnabled = false

  // 生成/重生成整片的单次执行单元;多条生成由外层队列顺序消费。
  // 「确认修改」仍专走 video.edit;普通重生成继续走固定的 Seedance 整片模型。
  const runVideoJob = async (
    job: VideoGenJob,
    sessionId = job.context?.sessionId || videoGenSessionIdRef.current,
    sessionQueue = videoGenQueueRef.current,
  ) => {
    const context = job.context
    const ws = Number(context?.workspaceId || 0)
    const pid = Number(context?.projectId || 0) || 0
    const currentShots = Array.isArray(context?.shots) ? context.shots : []
    const currentRatio = context && Object.prototype.hasOwnProperty.call(context, 'ratio') ? context.ratio : undefined
    const currentResolution =
      context && Object.prototype.hasOwnProperty.call(context, 'resolution') ? context.resolution : undefined
    const currentStyle = context && Object.prototype.hasOwnProperty.call(context, 'style') ? context.style : undefined
    const currentPrompt =
      context && Object.prototype.hasOwnProperty.call(context, 'basePrompt') ? context.basePrompt : ''
    // 已入队任务必须使用创建时锁定的真人身份，不能在用户切换项目/素材后读取当前页面状态。
    const hasLockedRealPersonReference = Boolean(
      context && Object.prototype.hasOwnProperty.call(context, 'realPersonReference'),
    )
    const projectRealPersonReference = hasLockedRealPersonReference
      ? context?.realPersonReference || null
      : resolveProjectRealPersonReference()
    // 入口可能选了多个真人，约束里要写全；resolveRealPersonIdentityName 已按入口列表汇总。
    // context 带来的单个引用（视频修改链路）作为兜底。
    const realPersonIdentityName =
      resolveRealPersonIdentityName() || String(projectRealPersonReference?.personName || '')
    const sourceVideo = context?.sourceVideo || { url: '', assetId: 0 }
    // 显式模型 ID 已锁定时禁止再混入全局套餐候选，避免候选顺序变化后静默切到其他模型。
    const lockedPlans: string[] = []
    const updateCurrentUi = () => isCurrentVideoSession(sessionId)
    const failBeforePaidTask = async (message: string) => {
      const terminalPersisted = context ? await persistSmartJobTerminal(job, 'failed', message) : false
      if (!terminalPersisted) {
        syncSmartTask(job, context ? 'reconnecting' : 'failed', {
          taskId: 0,
          error: message,
        })
      }
      if (updateCurrentUi()) {
        immediateSaveRef.current = true
        markGen(job.id, 'failed', message)
        showToast(message, 'error')
      }
    }
    const modelLockError = getVideoQueueModelLockError({
      modelVersionId: context?.modelVersionId,
      operationCode: context?.operationCode,
    })
    if (modelLockError) {
      await failBeforePaidTask(modelLockError)
      return
    }
    if (!context || !ws || !pid || Number(context.sessionId || 0) !== sessionId) {
      await failBeforePaidTask('视频任务缺少已锁定的项目上下文，尚未创建付费任务，请重新生成')
      return
    }
    if (!currentShots.length) {
      const msg = '暂无分镜，无法生成视频'
      await failBeforePaidTask(msg)
      return
    }
    const durationValidation = validateVideoDurationWithin(totalDurationSec(currentShots), supportedVideoDurations)
    if (!durationValidation.valid) {
      const msg = unsupportedVideoDurationMessage(durationValidation.seconds, supportedVideoDurationLabel)
      await failBeforePaidTask(msg)
      return
    }
    if (job.opts?.edit && !Number(sourceVideo.assetId || 0)) {
      await failBeforePaidTask('缺少可编辑的源视频，尚未创建付费任务，请重新选择视频')
      return
    }
    const getLockedQuoteError = (estimate: any): string => {
      const estimatedCost = Number(estimate?.estimated_cost)
      const balance = Number(estimate?.balance)
      return getSmartVideoQuoteValidationError(context.quotedCost, {
        operationCode: context.operationCode!,
        modelVersionId: Number(context.modelVersionId || 0),
        estimatedCost,
        balance,
        canAfford:
          estimate?.can_afford !== false &&
          Number.isFinite(estimatedCost) &&
          Number.isFinite(balance) &&
          estimatedCost <= balance,
      })
    }

    try {
      const catalogResponse = await listAiModels({
        workspaceId: ws,
        operationCode: context.operationCode,
        plan: '',
      })
      const availabilityError = getLockedGenerationModelAvailabilityError({
        operationCode: context.operationCode!,
        modelVersionId: context.modelVersionId,
        modelVersion: context.modelVersion,
        catalogModels: unwrapGenerationModelCatalogResponse(catalogResponse),
      })
      if (availabilityError) {
        await failBeforePaidTask(availabilityError)
        return
      }
      // 「确认修改」= 带上源视频重新生成一次，计费与提交口径都与普通整片生成一致，因此不再分叉。
      compileFullVideoModelRequest(context.modelVersion, {
        shots: currentShots,
        ratio: currentRatio,
        resolution: currentResolution,
        referenceImageCount: currentShots.filter((shot) => shot.includeInVideo !== false).length,
      })
      const currentEstimate = await estimateFullVideoCost({
        workspaceId: ws,
        shots: currentShots,
        ratio: currentRatio,
        resolution: currentResolution,
        modelVersionId: context.modelVersionId,
        modelVersion: context.modelVersion,
        modelPlanCandidates: lockedPlans,
      })
      const quoteError = getLockedQuoteError(currentEstimate)
      if (quoteError) {
        throw new Error(quoteError)
      }
    } catch (error: any) {
      await failBeforePaidTask(
        getBusinessErrorMessage(error, error?.message || '视频模型或费用校验失败，尚未创建付费任务'),
      )
      return
    }

    // 队列开始消费该 job 时就标记为「生成中」。
    // 后端 task_id 要等模型选择/人脸脱敏/提交任务后才返回；如果只在 onTask 里标记，
    // 多视频生成刚开始会全部显示「排队中」，过一会儿才跳成加载态。
    if (updateCurrentUi()) markRunningGeneration(job.id)
    syncSmartTask(job, 'preparing')

    // 「确认修改」不再单独走一条 video.edit 分支：它与普通重生成共用下面这条整片生成链路
    // （同样要准备分镜图、人脸脱敏、按锁定报价核价），差别只是额外把上一版整片作为 role:'video' 输入下发。
    const editingExistingVideo = Boolean(job.opts?.edit && sourceVideo.assetId)
    const editingVideoNote = editingExistingVideo
      ? context.videoEditPrompt ||
        buildSmartVideoEditPrompt(job.note, job.variationIndex, job.variationTotal, realPersonIdentityName)
      : ''
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
    const lockedEntryMeta =
      context?.operationCode === 'video.generate' && context.modelVersionId
        ? {
            ...entryMeta,
            generationModels: {
              ...(entryMeta?.generationModels || {}),
              'video.generate': context.modelVersionId,
            },
          }
        : entryMeta
    if (updateCurrentUi()) videoGenSigRef.current = videoInputSig(currentShots, lockedEntryMeta, currentPrompt)
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
          const plans = lockedPlans
          // 参考图 = 用户在入口上传/选择的素材（含从真人库选的真人素材）。
          // 中间不再有任何重画环节，所以提交的就是用户自己那几张图；后端按
          // local_asset_id 查真人库，命中的换成火山可信资产 URI 并校验授权
          //（见后端 ResolveProviderAsset），普通素材走签名 URL。
          const referenceAssetIds = ((lockedEntryMeta as any)?.imageAssetIds || [])
            .map((id: any) => Number(id) || 0)
            .filter((id: number) => id > 0)
          const completeImageAssetIds = requireReferenceImageAssetIds(
            referenceAssetIds,
            getModelReferenceImageLimit(context.modelVersion, 'video.generate'),
          )
          if (Number(workspaceIdRef.current || 0) !== ws) {
            throw new Error('工作空间已切换，本次视频生成已安全停止')
          }
          // 真正创建视频任务前再按锁定快照核价，避免使用准备阶段的旧余额/旧价格。
          const submissionEstimate = await estimateFullVideoCost({
            workspaceId: ws,
            shots: currentShots,
            ratio: currentRatio,
            resolution: currentResolution,
            modelVersionId: context.modelVersionId,
            modelVersion: context.modelVersion,
            modelPlanCandidates: lockedPlans,
          })
          const submissionQuoteError = getLockedQuoteError(submissionEstimate)
          if (submissionQuoteError) throw new Error(submissionQuoteError)
          const generationPromise = generateFullVideo({
            workspaceId: ws,
            shots: activeShots,
            basePrompt: currentPrompt,
            ratio: currentRatio,
            resolution: currentResolution,
            style: currentStyle,
            imageAssetIds: completeImageAssetIds,
            // 真人成片：参考图能带住长相，但运动生成过程仍会漂，身份约束要显式写进整片提示词。
            // 出镜人取入口选中的真人素材（授权状态由后端在提交时校验）。
            ...(realPersonIdentityName
              ? { identityConstraint: buildRealPersonVideoIdentityConstraint(realPersonIdentityName) }
              : {}),
            // 「确认修改」：上一版整片以 role:'video' 一并下发，模型据此在原片基础上重新生成
            ...(editingExistingVideo ? { sourceVideoAssetId: sourceVideo.assetId } : {}),
            note: editingExistingVideo ? editingVideoNote : job.note,
            variationIndex: job.variationIndex,
            variationTotal: job.variationTotal,
            modelVersionId: context?.modelVersionId,
            modelVersion: context?.modelVersion,
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
      const msg = getFacePrivacyGenerationMessage(getBusinessErrorMessage(e, '请重试'))
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
    if (!sessionQueue.length) return
    const registeredOwner = videoGenSessionOwnersRef.current.get(sessionId)
    const currentOwner = currentVideoQueueOwner(sessionId)
    const queueOwner: SmartVideoQueueOwner = registeredOwner || { sessionId, workspaceId: 0, projectId: 0 }
    const ownerRegistrationError =
      !registeredOwner || (isCurrentVideoSession(sessionId) && !isSameVideoQueueOwner(registeredOwner, currentOwner))
    const ownershipError = ownerRegistrationError || getSmartVideoQueueOwnershipError(sessionQueue, queueOwner)
    if (ownershipError) {
      failUnsafeVideoQueue(
        sessionQueue,
        sessionId,
        '视频生成队列归属校验失败，尚未创建付费任务，请重新生成',
        queueOwner,
      )
      return
    }
    if (
      sessionQueue.some((job) => job.checkpointState !== 'saved') &&
      !(await ensureVideoQueueCheckpoint(sessionId, sessionQueue))
    ) {
      return
    }
    videoGenDrainingSessionsRef.current.add(sessionId)
    if (isCurrentVideoSession(sessionId)) setVidGenRunning(true)
    try {
      while (sessionQueue.length) {
        const liveOwnershipError = getSmartVideoQueueOwnershipError(sessionQueue, queueOwner)
        if (liveOwnershipError) {
          failUnsafeVideoQueue(
            sessionQueue,
            sessionId,
            '视频生成队列在执行期间发生归属变化，已安全停止，请重新生成',
            queueOwner,
          )
          return
        }
        const [job] = sessionQueue
        if (!job) {
          syncVideoGenQueue(sessionQueue.slice(1), sessionId, sessionQueue)
          continue
        }
        // drain 运行期间允许用户追加新任务；每一条任务仍必须证明自己已进入云端恢复快照。
        if (job.checkpointState !== 'saved' && !(await ensureVideoQueueCheckpoint(sessionId, sessionQueue))) {
          return
        }
        await runVideoJob(job, sessionId, sessionQueue)
        dropVideoGenQueueJob(job.id, sessionId, sessionQueue)
      }
    } finally {
      videoGenDrainingSessionsRef.current.delete(sessionId)
      if (!sessionQueue.length) videoGenSessionOwnersRef.current.delete(sessionId)
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
    if (videoQueueCheckpointBlockedRef.current) return
    if (videoGenDrainingSessionsRef.current.has(sessionId)) return
    if (videoGenerationsRef.current.some((g) => g.status === 'processing' && Number(g.taskId || 0) > 0)) return
    if (!sessionQueue.length) return
    if (sessionQueue.some((job) => job.checkpointState !== 'saved')) {
      void ensureVideoQueueCheckpoint(sessionId, sessionQueue).then((saved) => {
        if (
          saved &&
          isCurrentVideoSession(sessionId) &&
          !videoGenDrainingSessionsRef.current.has(sessionId) &&
          sessionQueue.length
        ) {
          void drainVideoGenQueue(sessionId, sessionQueue)
        }
      })
      return
    }
    void drainVideoGenQueue(sessionId, sessionQueue)
  }

  const queueFullVideo = async (
    note?: string,
    opts?: { edit?: boolean; generationModels?: GenerationModelSelectionMap },
    count?: number,
  ) => {
    if (videoQueuePlanningRef.current) {
      showToast('正在确认上一批视频的模型与费用，请稍候', 'info')
      return
    }
    const ws = Number(workspaceIdRef.current || workspaceId || 0)
    const currentShots = cloneGenerationSnapshot(shotsRef.current)
    if (!ws) {
      showToast('未选择工作空间,无法生成视频', 'error')
      return
    }
    if (!currentShots.length) {
      showToast('暂无分镜,无法生成视频', 'error')
      return
    }
    // 生成与「确认修改」共用 video.generate：修改只是多带一条源视频输入，不再是另一个 operation。
    const operationCode: GenerationOperationCode = 'video.generate'
    const modelSelection = requireGenerationModel(operationCode, opts?.generationModels)
    if (!modelSelection) return
    const modelVersion = cloneGenerationSnapshot(modelSelection.source)
    const durationValidation = validateVideoDurationWithin(totalDurationSec(currentShots), supportedVideoDurations)
    if (!durationValidation.valid) {
      showToast(unsupportedVideoDurationMessage(durationValidation.seconds, supportedVideoDurationLabel), 'error')
      return
    }
    const total = normalizeVideoGenerateCount(count)
    const pid = Number(projectIdRef.current || 0) || 0
    if (!pid) {
      showToast('项目尚未创建成功，无法生成视频，请返回入口后重试', 'error')
      return
    }
    const sessionId = videoGenSessionIdRef.current
    const currentEntryMeta = entryMetaRef.current || entryMeta
    const generationMeta =
      opts?.generationModels && currentEntryMeta
        ? { ...currentEntryMeta, generationModels: opts.generationModels }
        : currentEntryMeta
    const ratio = generationMeta?.ratio
    const resolution = generationMeta?.resolution
    const style = generationMeta?.style
    const basePrompt = reqSummary || requirement
    const sourceVideo = cloneGenerationSnapshot(fullVideoRef.current || fullVideo)
    const lockedSig = computeVideoContentSig(currentShots, generationMeta, basePrompt)
    const selectedRealPersonReference = resolveProjectRealPersonReference()
    const queuedRealPersonReference: SmartRealPersonReference | null = selectedRealPersonReference
      ? { ...selectedRealPersonReference }
      : null
    if (isRealPersonMode && !isValidRealPersonReference(queuedRealPersonReference)) {
      showToast('当前真人素材身份引用无效，请重新选择已认证真人素材后再生成', 'error')
      return
    }

    videoQueuePlanningRef.current = true
    setVideoQueuePlanning(true)
    try {
      // 显式模型版本已经锁定；视频估价/提交不得再携带全局活跃空间的 plan candidates，
      // 否则项目钉在其它空间时会把另一个空间的套餐上下文带进来。
      const plans: string[] = []
      if (
        Number(workspaceIdRef.current || 0) !== ws ||
        Number(projectIdRef.current || 0) !== pid ||
        videoGenSessionIdRef.current !== sessionId
      ) {
        throw new Error('项目或工作空间已变化，本次未创建视频任务')
      }

      let sourceVideoDurationSec = 0
      let estimatedCost = 0
      let estimateBalance = 0
      let canAfford = true
      let perJobQuotedCosts: number[] = []
      const readValidVideoEstimate = (estimate: any) => {
        const cost = Number(estimate?.estimated_cost)
        const balance = Number(estimate?.balance)
        if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(balance) || balance < 0) {
          throw new Error('视频费用预估结果无效，本次未创建付费任务')
        }
        return {
          cost,
          balance,
          canAfford: estimate?.can_afford !== false && cost <= balance,
        }
      }
      if (opts?.edit) {
        // 「确认修改」= 带上源视频重新生成一次；仍读一次源视频真实时长，
        // 拿不到就说明这条修改根本无从提交，直接拦在创建付费任务之前。
        if (!Number(sourceVideo.assetId || 0) || !sourceVideo.url) {
          throw new Error('缺少可修改的视频，请重新选择成片')
        }
        sourceVideoDurationSec = (await readVideoDurationSec(sourceVideo.url)) || 0
      }
      {
        compileFullVideoModelRequest(modelVersion, {
          shots: currentShots,
          ratio,
          resolution,
          referenceImageCount: currentShots.filter((shot) => shot.includeInVideo !== false).length,
        })
        const estimate: any = await estimateFullVideoCost({
          workspaceId: ws,
          shots: currentShots,
          ratio,
          resolution,
          modelVersionId: modelSelection.modelVersionId,
          modelVersion,
          modelPlanCandidates: plans,
        })
        const normalizedEstimate = readValidVideoEstimate(estimate)
        const perVideoCost = normalizedEstimate.cost
        perJobQuotedCosts = Array.from({ length: total }, () => perVideoCost)
        estimatedCost = perVideoCost * total
        estimateBalance = normalizedEstimate.balance
        canAfford = normalizedEstimate.canAfford && estimatedCost <= estimateBalance
        setVideoCost({
          loading: false,
          error: '',
          estimate: {
            estimatedCost: perVideoCost,
            balance: estimateBalance,
            canAfford,
          },
        })
      }
      if (!canAfford) {
        showToast(`预计共消耗 ${estimatedCost} 积分，当前余额 ${estimateBalance} 积分，积分不足`, 'error')
        return
      }
      const modelName = String(modelSelection.displayName || `模型 ${modelSelection.modelVersionId}`).trim()
      const confirmed =
        (await requestConfirm(
          `本次将使用「${modelName}」${opts?.edit ? '修改' : '生成'} ${total} 个视频，当前准确报价共 ${estimatedCost} 积分，当前余额 ${estimateBalance} 积分。系统会在每个付费任务提交前按相同模型与参数重新核价；价格变化时会停止任务并要求重新确认。`,
          {
            title: opts?.edit ? '确认修改视频' : '确认生成视频',
            confirmLabel: '确认并生成',
            cancelLabel: '取消',
          },
        )) === true
      if (!confirmed) return
      if (
        Number(workspaceIdRef.current || 0) !== ws ||
        Number(projectIdRef.current || 0) !== pid ||
        videoGenSessionIdRef.current !== sessionId
      ) {
        throw new Error('项目或工作空间已变化，本次未创建视频任务')
      }
      const currentModelSelection = selectedGenerationModel(
        operationCode,
        opts?.generationModels || entryMetaRef.current?.generationModels,
      )
      const modelStillMatches =
        currentModelSelection?.modelVersionId === modelSelection.modelVersionId &&
        getLockedGenerationModelAvailabilityError({
          operationCode,
          modelVersionId: modelSelection.modelVersionId,
          modelVersion,
          catalogModels: currentModelSelection ? [currentModelSelection.source] : [],
        }) === ''
      if (!modelStillMatches) {
        throw new Error('所选模型已变化，请返回首页重新确认后再生成')
      }

      const sessionQueue = videoGenQueueRef.current
      const forceNew = total > 1 || !!vidGenRunning || isCurrentVideoDraining()
      const existing = !forceNew
        ? videoGenerationsRef.current.find((generation) => generation.status === 'processing') || null
        : null
      const newRecords: GenRecord[] = []
      let patchedExisting: GenRecord | null = null
      const batchId = total > 1 ? createVideoTaskIdempotencyKey().replace(/^task_/, 'batch_') : ''
      const jobs: VideoGenJob[] = Array.from({ length: total }, (_, index) => {
        const variationIndex = total > 1 ? index + 1 : undefined
        const variationTotal = total > 1 ? total : undefined
        const displayNote = note
          ? total > 1
            ? `${note}（${index + 1}/${total}）`
            : note
          : total > 1
            ? `生成视频 ${index + 1}/${total}`
            : ''
        const useExisting = !forceNew && index === 0 && existing
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
          checkpointState: 'pending',
          ...(batchId ? { batchId } : {}),
          note,
          variationIndex,
          variationTotal,
          opts: { edit: opts?.edit },
          context: {
            sessionId,
            workspaceId: ws,
            projectId: pid,
            projectTitle: projectName || '智能成片',
            shots: cloneGenerationSnapshot(currentShots),
            basePrompt,
            ratio,
            resolution,
            style,
            durationSec: durationValidation.seconds,
            thumbnailUrl: currentShots.find((shot) => shot.image)?.image || '',
            sourceVideo: cloneGenerationSnapshot(sourceVideo),
            sourceVideoDurationSec,
            realPersonReference: queuedRealPersonReference,
            ...(opts?.edit
              ? {
                  videoEditPrompt: buildSmartVideoEditPrompt(
                    note,
                    variationIndex,
                    variationTotal,
                    queuedRealPersonReference?.personName || '',
                  ),
                }
              : {}),
            modelVersionId: modelSelection.modelVersionId,
            modelVersion: cloneGenerationSnapshot(modelVersion),
            modelPlanCandidates: [...plans],
            operationCode,
            quotedCost: {
              operationCode,
              modelVersionId: modelSelection.modelVersionId,
              estimatedCost: perJobQuotedCosts[index] ?? 0,
              batchTotalCost: estimatedCost,
              balanceAtQuote: estimateBalance,
              batchSize: total,
              quotedAt: Date.now(),
            },
            lockedSig,
          },
        }
      })
      if (newRecords.length || patchedExisting) {
        const nextGenerations = [
          ...newRecords,
          ...videoGenerationsRef.current.map((generation) =>
            patchedExisting && generation.id === patchedExisting.id ? patchedExisting : generation,
          ),
        ]
        setVideoGenerations(nextGenerations)
      }
      immediateSaveRef.current = true
      videoGenSessionOwnersRef.current.set(sessionId, {
        sessionId,
        workspaceId: ws,
        projectId: pid,
      })
      syncVideoGenQueue([...sessionQueue, ...jobs], sessionId, sessionQueue)
      for (const job of jobs) syncSmartTask(job, 'queued')
      if (jobs.length) useTaskCenterStore.getState().setDrawerExpanded(true)
      const saved = await ensureVideoQueueCheckpoint(sessionId, sessionQueue)
      if (!saved) return
      if (isCurrentVideoSession(sessionId)) {
        resumeQueuedVideoJobs()
      } else if (sessionQueue.length && !isVideoSessionOwned(sessionId)) {
        void drainVideoGenQueue(sessionId, sessionQueue)
      }
    } catch (error: any) {
      showToast(getBusinessErrorMessage(error, error?.message || '视频生成配置确认失败，本次未创建付费任务'), 'error')
    } finally {
      videoQueuePlanningRef.current = false
      setVideoQueuePlanning(false)
    }
  }

  // 单个重生成:只允许当前整片任务空闲时触发。
  const runFullVideo = (note?: string, opts?: { edit?: boolean }, count?: number) => {
    if (videoQueuePlanningRef.current || vidGenRunning || isCurrentVideoDraining()) return
    const ws = Number(workspaceIdRef.current || workspaceId || 0)
    const pid = Number(projectIdRef.current || projectId || 0)
    if (ws > 0 && pid > 0 && isVideoGenRunning('smart', ws, pid)) {
      showToast('该项目已在另一个页面生成视频，请等待任务完成', 'info')
      return
    }
    void queueFullVideo(note, opts, normalizeVideoGenerateCount(count))
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
  const ephemeralImageBusy =
    batchGenning ||
    materialBatchPending ||
    shotGenRunning ||
    Object.values(subjectGenerating).some(Boolean) ||
    Object.values(shotGen).some(Boolean)
  const shouldLockWorkspaceSwitch =
    modelSwitching ||
    scriptLoading ||
    scriptPending ||
    marketingLoading ||
    imageBusy ||
    ephemeralImageBusy ||
    videoQueuePlanning ||
    actualVideoGenerating ||
    videoGenerations.some((g) => String(g.status || '') === 'processing')

  /**
   * 模型切换使用同步 ref 做第二道门禁；只看 React state 会留下“刚点生成但尚未重渲染”的并发窗口。
   * 已排队但尚未提交的任务同样锁定了旧模型和报价，不能在队列排空前切换。
   */
  const getGenerationModelSwitchBusyReason = (): string => {
    if (modelSwitchRecoveryRef.current && modelSwitchRecoveryRef.current.status !== 'failed') {
      return '上一次模型切换仍有待恢复的生成批次，请先完成或处理该批次'
    }
    if (
      scriptRunningRef.current ||
      scriptRequestRef.current ||
      insertTextRequestRef.current ||
      marketingRequestRef.current ||
      marketingTagRequestRef.current.size > 0 ||
      summaryRequestRef.current ||
      nameAbortRef.current ||
      scriptLoading ||
      scriptPending ||
      insertTextGenerating ||
      marketingLoading ||
      naming
    ) {
      return '脚本或文案正在生成，完成后才能切换模型'
    }
    if (
      imageGenerationLockRef.current ||
      imageQueueCheckpointBlockedRef.current ||
      imagePreparing ||
      imageMessagesRef.current.some((message) => message.role === 'assistant' && message.status === 'pending') ||
      batchRunningRef.current ||
      materialBatchPending ||
      subjectGenerationRequestsRef.current.size > 0 ||
      shotDialogGenerationRequestsRef.current.size > 0 ||
      shotGenAbortRef.current ||
      shotGenRunning ||
      Object.values(subjectGenerating).some(Boolean) ||
      Object.values(shotGen).some(Boolean)
    ) {
      return '图片正在核价、生成或恢复，完成后才能切换模型'
    }
    const activeWorkspaceId = Number(workspaceIdRef.current || 0)
    const activeProjectId = Number(projectIdRef.current || 0)
    if (
      videoQueuePlanningRef.current ||
      videoQueueCheckpointBlockedRef.current ||
      videoGenQueueRef.current.length > 0 ||
      vidGenRunning ||
      isCurrentVideoDraining() ||
      actualVideoGenerating ||
      videoGenerationsRef.current.some((generation) => generation.status === 'processing') ||
      (activeWorkspaceId > 0 && activeProjectId > 0 && isVideoGenRunning('smart', activeWorkspaceId, activeProjectId))
    ) {
      return '视频正在核价、排队、生成或恢复，完成后才能切换模型'
    }
    return ''
  }
  const generationModelSwitchLockedReason = modelSwitching
    ? '正在确认并应用模型切换'
    : getGenerationModelSwitchBusyReason()
  const generationModelSwitchLocked = Boolean(generationModelSwitchLockedReason)

  useEffect(() => {
    const source = workspaceSwitchLockSourceRef.current
    setWorkspaceSwitchLockSource(
      source,
      shouldLockWorkspaceSwitch,
      modelSwitching
        ? '正在确认并应用模型切换，暂不支持切换团队'
        : scriptLoading || scriptPending || marketingLoading
          ? '当前脚本处理中，暂不支持切换团队'
          : imageBusy || ephemeralImageBusy
            ? '当前图片处理中，暂不支持切换团队'
            : videoQueuePlanning
              ? '正在确认视频模型与费用，暂不支持切换团队'
              : '当前视频处理中，暂不支持切换团队',
    )
    return () => {
      setWorkspaceSwitchLockSource(source, false)
    }
  }, [
    imageBusy,
    ephemeralImageBusy,
    marketingLoading,
    modelSwitching,
    scriptLoading,
    scriptPending,
    setWorkspaceSwitchLockSource,
    shouldLockWorkspaceSwitch,
    videoQueuePlanning,
  ])
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
        resolution: subscribedEntryMeta?.resolution,
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
        const message = getBusinessErrorMessage(e, '视频生成失败，请重试')
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
        resolution: restoredEntryMeta?.resolution,
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
      const msg = getBusinessErrorMessage(e, '请重试')
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
    if (modelSwitchingRef.current || step !== 3 || !shots.length || vidGenRunning) return
    if (autoVidRef.current) return
    if (!selectedGenerationModel('video.generate')) return
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
  }, [step, shots, videoGenerationModelSelectionId])

  // 提交前积分预估(estimate-cost):在生成视频步、非生成中、已有分镜时估一次(整片 video.generate 口径)。
  useEffect(() => {
    if (modelSwitchingRef.current) return
    const ws = Number(workspaceId || 0)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasInflight = pid > 0 && isVideoGenRunning('smart', ws, pid)
    if (!ws || step !== 3 || videoQueuePlanningRef.current || actualVideoGenerating || hasInflight || !shots.length)
      return
    const modelSelection = selectedGenerationModel('video.generate')
    if (!modelSelection) {
      setVideoCost({ loading: false, error: '请先选择视频生成模型', estimate: null })
      return
    }
    let alive = true
    setVideoCost((s) => ({ ...s, loading: true, error: '' }))
    const timer = window.setTimeout(async () => {
      try {
        const res: any = await estimateFullVideoCost({
          workspaceId: ws,
          shots,
          ratio: entryMeta?.ratio,
          resolution: entryMeta?.resolution,
          modelVersionId: modelSelection.modelVersionId,
          modelVersion: modelSelection.source,
          modelPlanCandidates: [],
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
  }, [actualVideoGenerating, projectId, shots, step, videoQueuePlanning, workspaceId, videoGenerationModelSelectionId])

  // 「前瞻预估」:在当前步就显示「下一步生成要花多少」,让用户进下一步前先看成本。
  // 映射:分镜脚本/准备素材 → 下一步出图(image,单张);镜头编排 → 下一步生成视频(video,整片);
  // 图片模式 → 出图(image)。step3 视频由 VideoStage 单独显示;营销拆解步不预估。
  useEffect(() => {
    if (modelSwitchingRef.current) return
    const ws = Number(workspaceId || 0)
    const isImg = isImageMode && started
    // 前瞻:每步显示【下一步】要花多少。
    //   step0 分镜脚本 → 下一步「生成视频」= 整片
    //   图片模式 → 出图(单张)
    const kind = isImg ? 'frames' : step === STEP_SCRIPT ? 'video' : ''
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
    // 图片模式按本轮出图张数计费；视频按整片一次计费。
    const count = isImg ? Math.min(9, Math.max(1, Math.floor(Number(imageComposerOutputCount) || 1))) : 0
    setStepCost({ loading: true, error: '', perImage, count, estimate: null })
    const timer = window.setTimeout(async () => {
      try {
        const plans = await resolvePlanCandidates()
        if (isImg) {
          const operationCode = getImageGenerationOperationCode(imageComposerRefCount)
          const modelSelection = selectedGenerationModel(operationCode)
          if (!modelSelection) throw new Error(`请先选择${imageComposerRefCount > 0 ? '图生图' : '文生图'}模型`)
          // 图片对话按当前输入框是否带参考图，精确区分文生图/图生图；不能再固定按图生图展示费用。
          const res: any = await estimateShotImageCost({
            workspaceId: ws,
            referenceImageCount: imageComposerRefCount,
            ratio: imageComposerRatio || entryMeta?.ratio,
            modelVersionId: modelSelection.modelVersionId,
            modelVersion: modelSelection.source,
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
          const modelSelection = selectedGenerationModel('video.generate')
          if (!modelSelection) throw new Error('请先选择视频生成模型')
          const res: any = await estimateFullVideoCost({
            workspaceId: ws,
            shots,
            ratio: entryMeta?.ratio,
            resolution: entryMeta?.resolution,
            modelVersionId: modelSelection.modelVersionId,
            modelVersion: modelSelection.source,
            modelPlanCandidates: [],
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
    textToImageModelSelectionId,
    imageToImageModelSelectionId,
    videoGenerationModelSelectionId,
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
    modelSwitchRecovery: modelSwitchRecoveryRef.current || undefined,
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
      flow: draftFlow,
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
    let restoredGenerations = getPersistedVideoGenerations((d.videoGenerations as GenRecord[]) || [])
    const rawRestoredVideoQueue = Array.isArray(d.videoGenQueue)
      ? (d.videoGenQueue as any[]).map((job) => ({
          ...job,
          id: String(job?.id || ''),
          idempotencyKey: String(job?.idempotencyKey || job?.idempotency_key || '').trim(),
        }))
      : []
    const restoredQueueOwner = currentVideoQueueOwner()
    const restoredQueueResult = restoreSmartVideoQueueForOwner<VideoGenJob>(rawRestoredVideoQueue, restoredQueueOwner)
    const restoredVideoQueue = restoredQueueResult.jobs.map((job) => ({
      ...job,
      context: job.context
        ? {
            ...job.context,
            // 旧草稿可能保存过全局套餐候选；恢复后仍只允许使用已锁定的 modelVersionId。
            modelPlanCandidates: [],
          }
        : job.context,
    }))
    // 即使旧草稿声称 saved，本次页面也必须用新 session 的 pending 描述符重新写云端后才能执行。
    restoredVideoQueueRewriteRef.current = rawRestoredVideoQueue.length
      ? restoredVideoQueue.length
        ? 'checkpoint'
        : 'save'
      : ''
    if (restoredQueueResult.rejected.length) {
      const rejectedIds = new Set(restoredQueueResult.rejected.map((item) => item.id).filter(Boolean))
      const reason = '旧视频生成队列归属或恢复凭证无效，已安全停止，请重新生成'
      restoredGenerations = restoredGenerations.map((generation) =>
        rejectedIds.has(generation.id) && generation.status === 'processing'
          ? { ...generation, status: 'failed', taskId: 0, running: false, error: reason }
          : generation,
      )
    }
    const hasRestoredVideo = Boolean(
      d.fullVideoUrl || d.fullVideoAssetId || (Array.isArray(d.videoVersions) && d.videoVersions.length > 0),
    )
    const restoredStep =
      hasRestoredVideoInProgress(d, restoredGenerations, restoredVideoQueue) || hasRestoredVideo
        ? STEPS.length - 1
        : Math.min(STEPS.length - 1, Math.max(0, d.step || 0))
    // 旧草稿的 maxReached 可能是 2/3（当时有「准备素材」「镜头编排」两步）。
    // 不夹住会让进度条把不存在的步骤算成"已到达"，点上去拿到 undefined。
    const restoredMaxReached = Math.min(STEPS.length - 1, Math.max(d.maxReached || 0, restoredStep))
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
    subjectAssetsRef.current = d.subjectAssets || {}
    setSubjectAssets(subjectAssetsRef.current)
    setFields(d.fields || {})
    const restoredFullVideo = { url: d.fullVideoUrl || '', assetId: d.fullVideoAssetId || 0 }
    fullVideoRef.current = restoredFullVideo
    setFullVideo(restoredFullVideo)
    replaceVideoVersions(Array.isArray(d.videoVersions) ? d.videoVersions : [])
    setVideoGenerations(restoredGenerations)
    if (restoredVideoQueue.length)
      videoGenSessionOwnersRef.current.set(restoredQueueOwner.sessionId, restoredQueueOwner)
    else videoGenSessionOwnersRef.current.delete(restoredQueueOwner.sessionId)
    syncVideoGenQueue(restoredVideoQueue)
    setLastVideoSig(String(d.lastVideoSig || ''))
    const restoredPendingSig = String(d.pendingVideoSig || '')
    setPendingVideoSig(restoredPendingSig)
    pendingVideoSigRef.current = restoredPendingSig
    // 恢复「一键生成」进行中标记 → 进准备素材步会由 effect 自动续作未出图的素材(不被截断)
    setMaterialBatchPending(!!d.materialBatchPending)
    setScriptPending(!!d.scriptPending)
    setScriptError(String(d.scriptError || ''))
    modelSwitchRecoveryRef.current = d.modelSwitchRecovery || null
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
          // 新项目创建成功后，读节点可能短暂尚未可见。只对“本页面刚创建且拥有首次整版写入权”
          // 的项目把 404 当作可重试，旧项目/无权限项目仍立即失败，不能用重试掩盖真实越权。
          const freshProjectReadLag =
            request.allowCreativeReplace && Number((error as { status?: number } | null)?.status || 0) === 404
          if ((!freshProjectReadLag && !isRetryableDraftSaveError(error)) || attempt >= 2) return false
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
    if (draftApplicationVersion <= 0) return
    appliedRef.current = true
    const rewriteMode = restoredVideoQueueRewriteRef.current
    if (!rewriteMode) return
    restoredVideoQueueRewriteRef.current = ''
    const ws = Number(workspaceIdRef.current || 0) || 0
    const pid = Number(projectIdRef.current || 0) || 0
    if (!ws || !pid) return
    if (rewriteMode === 'checkpoint' && videoGenQueueRef.current.length) {
      void ensureVideoQueueCheckpoint(videoGenSessionIdRef.current, videoGenQueueRef.current).then((saved) => {
        if (saved) resumeQueuedVideoJobs()
      })
      return
    }
    saveSmartDraft(currentDraft(), ws)
    void putSmartDraftToBackend(ws)
    // 恢复队列只在草稿真正应用后重写，避免 applyDraft 同步阶段被 canPersist 门禁拒绝。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftApplicationVersion])

  // 把后端返回的项目数据应用到本视图:恢复草稿 / 整片兜底 / 标题回填。
  const applyLoadedProject = (proj: any, rid: number, ws: number) => {
    draftRevisionRef.current = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
    const draftJson = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
    if (isHotCopyDraft(draftJson)) {
      navigate(`/hot-copy/${rid}`, { replace: true })
      return
    }
    const parsedProjectDraft = parseDraftObject(draftJson)
    const loadedFlow = String(parsedProjectDraft?.smart?.flow || parsedProjectDraft?.flow || 'smart').toLowerCase()
    if (loadedFlow === 'real-person-video' && !isRealPersonMode) {
      navigate(`/real-person-video/${rid}`, { replace: true })
      return
    }
    if (loadedFlow !== 'real-person-video' && isRealPersonMode) {
      navigate(`/smart/${rid}`, { replace: true })
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
        navigate(flowBasePath, { replace: true })
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
      navigate(flowBasePath, { replace: true })
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
      // 真人成片与普通智能成片当前共用底层任务登记 scope，根入口不能据此跨流程抢占项目；
      // 真人流程依靠带 flow 的本地草稿或项目深链恢复，避免跳进普通智能成片项目。
      const runningProject = isRealPersonMode ? null : findRunningVideoGen('smart', Number(workspaceId || 0))
      if (
        runningProject?.meta.projectId &&
        !deniedSmartProjectKeys.has(
          smartProjectKey(Number(workspaceId || 0), Number(runningProject.meta.projectId || 0)),
        )
      ) {
        setProjectLoading(true)
        navigate(`${flowBasePath}/${runningProject.meta.projectId}`, {
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
      const inProgress = !!d?.started && pendingPid > 0 && String(d?.flow || 'smart') === draftFlow
      if (inProgress) {
        // autoResumed:标记"由本地草稿自动跳转"。若目标项目不属于当前用户(403/404),
        // loadProjectById 会据此清掉陈旧草稿并回落空白入口,而不是弹错误页且每次循环。
        setProjectLoading(true)
        navigate(`${flowBasePath}/${pendingPid}`, { replace: true, state: { autoResumed: true } })
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
    return /积分|余额|充值|支付|费用|报价|价格|模型|目录|下架|配置|网络|连接|超时|payment|unauthorized|forbidden|workspace|concurrency|network|fetch|timeout/i.test(
      message,
    )
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
            const modelLockError = getImageQueueModelLockError(message)
            if (modelLockError) throw new Error(modelLockError)
            const operationCode = message.operationCode as SmartImageGenerationOperation
            const modelVersionId = Number(request.modelVersionId || 0) || 0
            const compiledParams = compileShotImageRequestParams(request.modelVersion, request.ratio, false)
            const batchSize = Number(request.quotedCost?.batchSize || message.batchTotal || 1) || 1
            const bindingError = getSmartImageQuoteBindingError(request.quotedCost, {
              workspaceId: ws,
              operationCode,
              modelVersionId,
              modelVersion: request.modelVersion,
              params: compiledParams,
              batchSize,
            })
            if (bindingError) throw new Error(bindingError)

            // 恢复 taskId=0 的付费任务时必须查询当前工作空间目录；只校验锁定模型，不挑选替代模型。
            const catalogResponse = await listAiModels({
              workspaceId: ws,
              operationCode,
              plan: '',
            })
            const availabilityError = getLockedGenerationModelAvailabilityError({
              operationCode,
              modelVersionId,
              modelVersion: request.modelVersion,
              catalogModels: unwrapGenerationModelCatalogResponse(catalogResponse),
            })
            if (availabilityError) throw new Error(availabilityError)

            const currentEstimate: any = await estimateShotImageCost({
              workspaceId: ws,
              referenceImageCount: request.refAssetIds.length,
              ratio: request.ratio,
              modelVersionId,
              modelVersion: request.modelVersion,
              // 显式模型已冻结，禁止恢复时混入当前全局套餐候选并静默换模型。
              modelPlanCandidates: [],
            })
            const estimatedCost = Number(currentEstimate?.estimated_cost)
            const balance = Number(currentEstimate?.balance)
            const remainingCount = imageMessagesRef.current.filter(
              (item) =>
                item.role === 'assistant' &&
                item.status === 'pending' &&
                Number(item.taskId || 0) === 0 &&
                (message.batchId ? item.batchId === message.batchId : item.id === message.id),
            ).length
            const quoteError = getSmartImageQuoteValidationError(request.quotedCost, {
              workspaceId: ws,
              operationCode,
              modelVersionId,
              modelVersion: request.modelVersion,
              params: compiledParams,
              batchSize,
              estimatedCost,
              balance,
              canAfford:
                currentEstimate?.can_afford !== false &&
                Number.isFinite(estimatedCost) &&
                Number.isFinite(balance) &&
                estimatedCost <= balance,
              remainingCount,
            })
            if (quoteError) throw new Error(quoteError)

            result = await generateShotImage({
              workspaceId: ws,
              prompt: request.text || '生成一张营销广告图片',
              refAssetIds: request.refAssetIds || [],
              modelVersionId,
              modelVersion: request.modelVersion,
              modelPlanCandidates: [],
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
          if (!hasSubmittedTask && viewAliveRef.current) showToast(errorMessage, 'error')
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
    if (currentSec > maxVideoDurationSec) {
      durGuardProceedRef.current = null
      setDurGuard({ open: true, currentSec, expectedSec, overMax: true })
      return
    }
    const selectedDuration = validateVideoDurationWithin(entryMeta.duration, supportedVideoDurations)
    if (!selectedDuration.valid) {
      showToast(`当前视频时长选项无效，请选择${supportedVideoDurationLabel}`, 'error')
      return
    }
    const shotDuration = validateVideoDurationWithin(currentSec, supportedVideoDurations)
    if (!shotDuration.valid) {
      durGuardProceedRef.current = null
      showToast(unsupportedVideoDurationMessage(shotDuration.seconds, supportedVideoDurationLabel), 'error')
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
    if (ephemeralImageBusy) {
      showToast('当前素材或分镜图片正在生成，请等待完成后再离开', 'info')
      return
    }
    const path = getSidebarRoute(key)
    if (path) navigate(path)
    else openComingSoon() // 设置/视频编辑/投前预审/数据看板等未上线项:弹全局「功能待开放」弹窗
  }

  // 「制作新视频」:把整个智能成片流程初始化为全新空白页(等同切换路由再切回来)。
  // 清空本地草稿 + 所有页面状态 + 项目引用,回到入口输入页;入口页 key 自增以重挂载、清空其内部输入。
  const resetToNewVideo = (entryMode?: 'video' | 'image') => {
    if (modelSwitchingRef.current) {
      showToast('模型切换正在确认或重生成，完成后再创建新任务', 'info')
      return
    }
    if (ephemeralImageBusy) {
      showToast('当前素材或分镜图片正在生成，请等待完成后再创建新视频', 'info')
      return
    }
    if (entryMode === 'image' && imageBusy) {
      showToast('图片正在生成，请等待完成后再创建新对话', 'info')
      return
    }
    if (
      videoQueuePlanningRef.current ||
      videoQueueCheckpointRunRef.current ||
      videoGenQueueRef.current.some((job) => job.checkpointState !== 'saved')
    ) {
      showToast('生成配置正在保存，保存完成前不能创建新视频', 'info')
      return
    }
    abortEphemeralImageRequests()
    void cancelShotGeneration()
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
    videoQueuePlanningRef.current = false
    setVideoQueuePlanning(false)
    videoQueueCheckpointBlockedRef.current = false
    videoQueueCheckpointRunRef.current = null
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
    subjectAssetsRef.current = {}
    setSubjectAssets({})
    setSubjectGenerating({})
    batchRunningRef.current = false
    setBatchGenning(false)
    setMaterialBatchPending(false)
    setScriptPending(false)
    setScriptError('')
    modelSwitchRecoveryRef.current = null
    setShotGen({})
    setShotGenRunning(false)
    setFields({})
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
    navigate(flowBasePath, { state: { taskCenterNewSession: true } })
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
  const generateScript = async (
    req: string,
    meta: EntryMeta,
    options: { transactional?: boolean } = {},
  ): Promise<boolean> => {
    if (scriptRunningRef.current) return false // 已有一条在跑就忽略(marketing/regenerate/续跑多入口并发)
    const modelSelection = requireGenerationModel('responses.multimodal', meta.generationModels)
    if (!modelSelection) {
      setScriptError('请先选择脚本生成模型')
      return false
    }
    const executionWorkspaceId = Number(workspaceIdRef.current || workspaceId || 0)
    if (!executionWorkspaceId) {
      setScriptError('未选择工作空间，无法生成脚本')
      return false
    }
    const previousShots = shotsRef.current.map((shot) => ({
      ...shot,
      subjects: (shot.subjects || []).map((subject) => ({ ...subject })),
      imageVersions: (shot.imageVersions || []).map((version) => ({ ...version })),
    }))
    const previousSubjectAssets = subjectAssetsRef.current
    const runId = ++scriptRequestSequenceRef.current
    const controller = new AbortController()
    const requestContext = responseRequestContextFor(modelSelection, executionWorkspaceId)
    scriptRequestRef.current?.controller.abort()
    scriptRequestRef.current = {
      runId,
      workspaceId: executionWorkspaceId,
      routeSessionToken,
      controller,
    }
    const isCurrentRun = () => {
      const active = scriptRequestRef.current
      return (
        active?.runId === runId &&
        !controller.signal.aborted &&
        Number(workspaceIdRef.current || 0) === executionWorkspaceId &&
        active.routeSessionToken === routeSessionToken
      )
    }
    cancelInsertTextGeneration()
    scriptRunningRef.current = true
    setScriptLoading(true)
    setScriptPending(true) // 标记"脚本生成进行中",随草稿持久;中途切走再回来据此自动续跑(重生成)
    setScriptError('')
    latestDraftStateRef.current = {
      ...latestDraftStateRef.current,
      scriptPending: true,
      scriptError: '',
    }
    if (!options.transactional) {
      shotsExplicitlyClearedRef.current = false
      shotsRef.current = []
      setShots([])
      autoGenRef.current = false // 新脚本 → 进入镜头编排时重新自动生成分镜图
    }
    let got = 0
    let succeeded = false
    let pendingPartial: Shot[] | null = null
    let partialRenderTimer = 0
    const flushPendingPartial = (urgent = false) => {
      if (partialRenderTimer) {
        window.clearTimeout(partialRenderTimer)
        partialRenderTimer = 0
      }
      const next = pendingPartial
      pendingPartial = null
      if (!next || !isCurrentRun()) return
      if (options.transactional) return
      shotsRef.current = next
      if (urgent) {
        setShots(next)
        return
      }
      startTransition(() => setShots(next))
    }
    const schedulePartialRender = (partial: Shot[]) => {
      if (!isCurrentRun()) return
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
          imageAssetIds: meta.imageAssetIds,
          modelVersionId: modelSelection.modelVersionId,
          requestContext,
          signal: controller.signal,
        },
        (partial) => {
          if (!isCurrentRun()) return
          got = partial.length
          schedulePartialRender(partial)
        },
      )
      if (!isCurrentRun()) return
      pendingPartial = null
      if (partialRenderTimer) {
        window.clearTimeout(partialRenderTimer)
        partialRenderTimer = 0
      }
      if (!options.transactional) {
        shotsRef.current = result
        setShots(result)
      }
      // 兜底:对没拆出主体的镜头(弱模型常整体不给 subjects),单独聚焦提取主体后回填。
      // best-effort、并发、不阻塞主流程展示;失败的镜头保持空(可在准备素材步手动补)。
      let withSubjects = result
      const needFill = result.filter((s) => !s.subjects?.length && s.desc)
      if (needFill.length) {
        const filled = await Promise.all(
          needFill.map(async (s) => ({
            id: s.id,
            subs: await extractSubjects(s.desc, controller.signal, modelSelection.modelVersionId, requestContext).catch(
              (error) => {
                throwIfSmartRequestAborted(controller.signal)
                if ((error as any)?.name === 'AbortError') throw error
                return []
              },
            ),
          })),
        )
        if (!isCurrentRun()) return false
        const subsById = new Map(filled.filter((f) => f.subs.length).map((f) => [f.id, f.subs]))
        if (subsById.size) {
          withSubjects = result.map((s) => (subsById.has(s.id) ? { ...s, subjects: subsById.get(s.id)! } : s))
          if (!options.transactional) setShots(withSubjects)
        }
      }
      // 主推产品锚定与主体合并都已随「准备素材」步移除:两者都只为「少生成几张主体素材图」
      // 服务,而主体素材图已经不再生成——用户上传的素材直接作为参考图提交给视频模型。
      // 它们各自还要多跑一次 LLM,留着纯属给每次脚本生成加延迟。
      const finalShots = withSubjects
      // 真人身份不再注入主体:真人素材的 assetId 已经在 entryMeta.imageAssetIds 里,
      // 会和普通素材一起作为参考图提交,后端按 local_asset_id 查真人库、换成可信资产 URI
      // 并校验授权(见后端 ResolveProviderAsset)。出镜人名走提示词(见 identityConstraint)。
      if (!isCurrentRun()) return false
      if (options.transactional) {
        const committed = mergeTransactionalScriptResult({
          nextShots: finalShots,
          previousShots,
          subjectAssets: previousSubjectAssets,
        })
        shotsExplicitlyClearedRef.current = false
        shotsRef.current = committed.shots
        setShots(committed.shots)
        latestDraftStateRef.current = {
          ...latestDraftStateRef.current,
          shots: committed.shots,
        }
        autoGenRef.current = false
      } else {
        shotsRef.current = finalShots
      }
      succeeded = true
    } catch (e: any) {
      if (controller.signal.aborted || e?.name === 'AbortError' || !isCurrentRun()) return false
      // 流结束前失败时也立即呈现最后一批已收到的有效分镜，保持原有的部分恢复能力。
      flushPendingPartial(true)
      const message = scriptStreamFailureMessage(e, got)
      setScriptError(message)
      latestDraftStateRef.current = {
        ...latestDraftStateRef.current,
        scriptError: message,
      }
    } finally {
      if (partialRenderTimer) window.clearTimeout(partialRenderTimer)
      if (scriptRequestRef.current?.runId === runId) {
        scriptRequestRef.current = null
        scriptRunningRef.current = false
        setScriptLoading(false)
        setScriptPending(false) // 结束(成功/失败)清掉续跑标记,避免恢复时误续
        latestDraftStateRef.current = {
          ...latestDraftStateRef.current,
          scriptPending: false,
        }
      }
    }
    return succeeded
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
  const runSkillBreakdown = useLatestCallback(async (req: string, meta: EntryMeta) => {
    if (!meta.skill) return
    const modelSelection = requireGenerationModel('responses.multimodal', meta.generationModels)
    if (!modelSelection) {
      setMarketingError('请先选择脚本生成模型')
      return
    }
    const executionWorkspaceId = Number(workspaceIdRef.current || workspaceId || 0)
    if (!executionWorkspaceId) {
      setMarketingError('未选择工作空间，无法拆解营销思路')
      return
    }
    // 新一轮拆解会替换整张表；旧字段的“换一批”响应不得再写入相同 key。
    cancelMarketingRequests()
    const runId = ++marketingRequestSequenceRef.current
    const controller = new AbortController()
    marketingRequestRef.current = {
      runId,
      workspaceId: executionWorkspaceId,
      routeSessionToken,
      controller,
    }
    const isCurrentRun = () => {
      const active = marketingRequestRef.current
      return (
        active?.runId === runId &&
        !controller.signal.aborted &&
        Number(workspaceIdRef.current || 0) === executionWorkspaceId &&
        active.routeSessionToken === routeSessionToken
      )
    }
    setMarketingLoading(true)
    setMarketingError('')
    setMarketingText('')
    setMarketingData(null)
    try {
      // 产品信息:用户文字 + 全部上传素材(最多 9 张,与入口上限一致)一并喂入(方案 A 多模态),结构化产出
      let data: MarketingBreakdownData | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          data = await skillBreakdownStructured(
            {
              skill: meta.skill,
              requirement: req,
              images: (meta.images || []).slice(0, 9),
              modelVersionId: modelSelection.modelVersionId,
              requestContext: responseRequestContextFor(modelSelection, executionWorkspaceId),
            },
            controller.signal,
          )
          break
        } catch (error) {
          if (controller.signal.aborted || (error as any)?.name === 'AbortError' || !isCurrentRun()) return
          lastError = error
        }
      }
      if (!data) throw lastError || new Error('营销思路拆解失败，请重试')
      if (!isCurrentRun()) return
      setMarketingData(data)
      setMarketingText(marketingDataToText(data)) // 派生纯文本,供脚本生成/持久化/续接判断复用
    } catch (e: any) {
      if (controller.signal.aborted || e?.name === 'AbortError' || !isCurrentRun()) return
      setMarketingError(e?.message || '营销思路拆解失败,请重试')
    } finally {
      if (marketingRequestRef.current?.runId === runId) {
        marketingRequestRef.current = null
        setMarketingLoading(false)
      }
    }
  })

  const marketingRecoveryKeyRef = useRef('')
  useEffect(() => {
    const recoveryKey = getSmartMarketingRecoveryKey({
      applied: appliedRef.current,
      started,
      marketingOpen,
      marketingLoading,
      hasMarketingData: Boolean(marketingData),
      hasMarketingError: Boolean(marketingError),
      workspaceId: Number(workspaceIdRef.current || workspaceId || 0),
      projectId: Number(projectIdRef.current || projectId || 0),
      routeSessionToken,
      skill: entryMeta?.skill || '',
      requirement,
      imageCount: entryMeta?.images?.length || 0,
    })
    if (!recoveryKey || marketingRecoveryKeyRef.current === recoveryKey || !entryMeta) return
    marketingRecoveryKeyRef.current = recoveryKey
    void runSkillBreakdown(requirement, entryMeta)
  }, [
    entryMeta,
    marketingData,
    marketingError,
    marketingLoading,
    marketingOpen,
    projectId,
    requirement,
    routeSessionToken,
    runSkillBreakdown,
    started,
    workspaceId,
  ])

  // marketingText 始终由 marketingData 派生(供脚本生成/持久化复用)。放 effect 里,
  // 不在事件处理中手动同步,避免和「换一批」等更新方式不一致。
  useEffect(() => {
    if (marketingData) setMarketingText(marketingDataToText(marketingData))
  }, [marketingData])

  // 以下三个均用函数式 updater(与「换一批」完全一致的写法,确保拿到最新 state、可靠触发重渲染)
  // 表格内编辑某维度描述
  const updateMarketingField = (key: MarketingFieldKey, desc: string) => {
    const activeRequest = marketingTagRequestRef.current.get(key)
    if (activeRequest) {
      activeRequest.controller.abort()
      marketingTagRequestRef.current.delete(key)
      setMarketingTagBusy((busy) => ({ ...busy, [key]: false }))
    }
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
    const field = marketingFieldByKey(marketingData, key)
    if (!field) return
    const responseModel = requireGenerationModel('responses.multimodal')
    if (!responseModel) return
    const executionWorkspaceId = Number(workspaceIdRef.current || workspaceId || 0)
    if (!executionWorkspaceId) return

    const previousRequest = marketingTagRequestRef.current.get(key)
    previousRequest?.controller.abort()
    const runId = ++marketingTagRequestSequenceRef.current
    const controller = new AbortController()
    marketingTagRequestRef.current.set(key, {
      runId,
      workspaceId: executionWorkspaceId,
      routeSessionToken,
      controller,
    })
    const isCurrentRun = () => {
      const active = marketingTagRequestRef.current.get(key)
      return (
        active?.runId === runId &&
        !controller.signal.aborted &&
        Number(workspaceIdRef.current || 0) === executionWorkspaceId &&
        active.routeSessionToken === routeSessionToken
      )
    }

    const label = field.desc || field.label || key
    setMarketingTagBusy((m) => ({ ...m, [key]: true }))
    try {
      const opts = await suggestOptions(
        {
          label,
          context: [field.label, reqSummary || requirement, entryMeta?.skill].filter(Boolean).join(' / '),
          exclude: field.tags || [],
        },
        controller.signal,
        responseModel.modelVersionId,
        responseRequestContextFor(responseModel, executionWorkspaceId),
      )
      if (opts.length && isCurrentRun()) {
        setMarketingData((prev) => (prev ? patchMarketingField(prev, key, { tags: opts }) : prev))
      }
    } catch (error: any) {
      if (controller.signal.aborted || error?.name === 'AbortError' || !isCurrentRun()) return
      /* 换一批失败:静默,保留原标签 */
    } finally {
      if (marketingTagRequestRef.current.get(key)?.runId === runId) {
        marketingTagRequestRef.current.delete(key)
        setMarketingTagBusy((m) => ({ ...m, [key]: false }))
      }
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
    cancelMarketingRequests()
    cancelSummaryRequest()
    setMarketingOpen(false)
    setStarted(false)
  }

  /** 按本轮真实文生图/图生图参数预估费用，并在创建付费任务前取得用户明确确认。 */
  const confirmImageGenerationCost = async (args: {
    workspaceId: number
    referenceImageCount: number
    ratio: string
    count?: number
    modelSelection?: SelectedGenerationModel
    generationModels?: GenerationModelSelectionMap
  }): Promise<LockedSmartImageQuotedCost | null> => {
    const operationCode: SmartImageGenerationOperation =
      args.referenceImageCount > 0 ? 'image.image_to_image' : 'image.text_to_image'
    const modelSelection =
      args.modelSelection || requireGenerationModel(operationCode, args.generationModels || entryMeta?.generationModels)
    if (!modelSelection) return null
    setStepCost((previous) => ({ ...previous, loading: true, error: '' }))
    try {
      const compiledParams = compileShotImageRequestParams(modelSelection.source, args.ratio, false)
      const estimate: any = await estimateShotImageCost({
        workspaceId: args.workspaceId,
        referenceImageCount: args.referenceImageCount,
        ratio: args.ratio,
        modelVersionId: modelSelection.modelVersionId,
        modelVersion: modelSelection.source,
        // 已显式锁定模型；估价不得混入当前空间之外的套餐候选。
        modelPlanCandidates: [],
      })
      if (Number(workspaceIdRef.current || 0) !== args.workspaceId) {
        setStepCost((previous) => ({
          ...previous,
          loading: false,
          error: '工作空间已变化，请重新确认生成费用',
        }))
        showToast('工作空间已变化，本次未发起图片生成', 'info')
        return null
      }
      const count = Math.min(9, Math.max(1, Math.floor(Number(args.count) || 1)))
      const perImageCost = Number(estimate?.estimated_cost)
      const balance = Number(estimate?.balance)
      if (!Number.isFinite(perImageCost) || perImageCost < 0 || !Number.isFinite(balance) || balance < 0) {
        throw new Error('图片费用预估结果无效')
      }
      const estimatedCost = perImageCost * count
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
        return null
      }

      const operationLabel = args.referenceImageCount > 0 ? '参考图创作' : '文字生成图片'
      const confirmed =
        (await requestConfirm(
          `${operationLabel}将生成 ${count} 张图片，预计共消耗 ${estimatedCost} 积分（每张约 ${perImageCost} 积分），当前余额 ${balance} 积分。图片将按顺序逐张生成，每张对应一笔独立任务。确认后才会创建付费生成任务。`,
          {
            title: '确认生成图片',
            confirmLabel: '确认并生成',
            cancelLabel: '取消',
          },
        )) === true
      if (!confirmed) return null
      if (Number(workspaceIdRef.current || 0) !== args.workspaceId) {
        showToast('工作空间已变化，本次未发起图片生成', 'info')
        return null
      }
      return createLockedSmartImageQuote({
        workspaceId: args.workspaceId,
        operationCode,
        modelVersionId: modelSelection.modelVersionId,
        modelVersion: modelSelection.source,
        params: compiledParams,
        batchSize: count,
        perImageCost,
        balance,
      })
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
      return null
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
    options: {
      confirmedQuote?: LockedSmartImageQuotedCost
      idempotencyKey?: string
      generationModels?: GenerationModelSelectionMap
    } = {},
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
      const operationCode = getImageGenerationOperationCode(refAssetIds.length)
      const modelSelection = requireGenerationModel(
        operationCode,
        options.generationModels || entryMeta?.generationModels,
      )
      if (!modelSelection) return false
      const confirmedQuote =
        options.confirmedQuote ||
        (await confirmImageGenerationCost({
          workspaceId: ws,
          referenceImageCount: refAssetIds.length,
          ratio,
          count,
          modelSelection,
        }))
      if (!confirmedQuote) return false
      const compiledParams = compileShotImageRequestParams(modelSelection.source, ratio, false)
      const quoteBindingError = getSmartImageQuoteBindingError(confirmedQuote, {
        workspaceId: ws,
        operationCode,
        modelVersionId: modelSelection.modelVersionId,
        modelVersion: modelSelection.source,
        params: compiledParams,
        batchSize: count,
      })
      if (quoteBindingError) throw new Error(quoteBindingError)

      const uid = nextMsgId()
      const prompt = text || '生成一张营销广告图片'
      const idempotencyRoot = options.idempotencyKey || createImageChatIdempotencyKey()
      const batchId = count > 1 ? `batch_${idempotencyRoot}` : ''
      const request = {
        text: prompt,
        ratio,
        refAssetIds,
        refImages: userImages,
        outputCount: 1,
        modelVersionId: modelSelection.modelVersionId,
        modelVersion: modelSelection.source,
        quotedCost: confirmedQuote,
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
      const errorMessage =
        getBusinessErrorMessage(error, '') ||
        (error instanceof Error ? String(error.message || '').trim() : '') ||
        '图片生成准备失败，请重试'
      if (preparedMessages.length) {
        const preparedIds = new Set(preparedMessages.map((message) => message.id))
        const safeError = `${errorMessage}，未提交任何付费任务`
        commitImageMessages((messages) =>
          messages.map((message) =>
            preparedIds.has(message.id)
              ? { ...message, status: 'error', terminalFailure: true, preparationFailure: true, error: safeError }
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
  const retryImageMessage = async (message: ChatMessage): Promise<boolean> => {
    const existingTaskId = Number(message.taskId || 0) || 0
    const retryDisabledReason = getImageRetryDisabledReason(message)
    if (retryDisabledReason) {
      showToast(retryDisabledReason, 'error')
      return false
    }
    if (existingTaskId > 0 && message.terminalFailure !== true) {
      if (imageGenerationLockRef.current || imageQueueCheckpointBlockedRef.current) {
        showToast('已有图片任务正在处理，请稍后再试', 'info')
        return false
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
      return true
    }

    if (isUnsubmittedImagePreparationFailure(message)) {
      if (imageGenerationLockRef.current || imageQueueCheckpointBlockedRef.current) {
        showToast('已有图片任务正在处理，请稍后再试', 'info')
        return false
      }
      const context = {
        workspaceId: Number(workspaceIdRef.current || workspaceId || 0) || 0,
        projectId: Number(projectIdRef.current || projectId || 0) || 0,
      }
      let queued = false
      imageGenerationLockRef.current = true
      imageQueueCheckpointBlockedRef.current = true
      setImagePreparing(true)
      commitImageMessages((messages) =>
        messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                status: 'pending',
                terminalFailure: false,
                preparationFailure: false,
                error: undefined,
              }
            : item,
        ),
      )
      syncImageTask(message, 'preparing', { taskId: 0, error: '' }, context)
      try {
        const checkpointResult = await persistImageQueueBeforePaidTask(context.workspaceId)
        if (checkpointResult !== 'saved') {
          throw new Error(
            checkpointResult === 'conflict'
              ? '项目已在其他页面更新，请刷新页面载入最新项目后再重新生成'
              : '生成队列保存失败，请稍后重试',
          )
        }
        queued = true
        return true
      } catch (error) {
        const errorMessage =
          getBusinessErrorMessage(error, '') ||
          (error instanceof Error ? String(error.message || '').trim() : '') ||
          '图片生成准备失败，请重试'
        const safeError = `${errorMessage}，未提交任何付费任务`
        commitImageMessages((messages) =>
          messages.map((item) =>
            item.id === message.id
              ? {
                  ...item,
                  status: 'error',
                  terminalFailure: true,
                  preparationFailure: true,
                  error: safeError,
                }
              : item,
          ),
        )
        syncImageTask(message, 'failed', { taskId: 0, error: safeError }, context)
        saveCurrentImageDraftLocally(context.workspaceId)
        showToast(safeError, 'error')
        return false
      } finally {
        imageQueueCheckpointBlockedRef.current = false
        imageGenerationLockRef.current = false
        setImagePreparing(false)
        if (queued) {
          window.setTimeout(() => void processPendingImageQueue(context.workspaceId), 0)
        }
      }
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
        preserveResponseMediaType: true,
        resolveUrl: async () => {
          const assetId = Number(image.assetId || 0) || 0
          if (!assetId) return image.url
          return (await refreshAssetUrl(Number(workspaceIdRef.current || 0), assetId)) || image.url
        },
      })
      if (result === 'done') showToast('图片已保存', 'success')
      else if (result === 'started') {
        showToast(isWeChatBrowser() ? '已打开原图，请长按图片保存' : '已开始下载图片', 'success')
      }
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

    navigate(flowBasePath, {
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
      // 档位取自本次提交所选的视频模型，与入口下拉完全同源：
      // 界面允许选的秒数在这里必须能通过，否则用户会被自己刚选中的合法值挡住。
      const entryDurations = getGenerationModelDurationOptions(
        generationModelCatalog.pickerGroups,
        meta.generationModels || {},
        'video.generate',
        SMART_VIDEO_DURATIONS,
      )
      const durationValidation = validateCreativeDurationSelection(req, meta.duration, {
        supportedDurations: entryDurations,
      })
      if (!durationValidation.valid) {
        showToast(durationValidation.message, 'error')
        return false
      }
    }
    if (!(await requireAuth())) return false
    const reference = meta.realPersonReferences?.[0]
    const usesRealPersonMaterial = Boolean(reference?.realPersonId)
    if (isRealPersonMode || usesRealPersonMaterial) {
      if (
        meta.images?.length !== 1 ||
        Number(meta.imageAssetIds?.[0] || 0) <= 0 ||
        !reference ||
        Number(reference.localAssetId) !== Number(meta.imageAssetIds?.[0] || 0)
      ) {
        showToast('请先从真人素材库选择一张已认证真人图片', 'error')
        return false
      }
      try {
        const people = await listRealPeople({ workspaceId: Number(workspaceId || 0) })
        if (!isRealPersonReferenceStillAuthorized(reference, people)) {
          showToast('所选真人素材的认证或授权已失效，请重新选择', 'error')
          return false
        }
      } catch (error) {
        showToast(getBusinessErrorMessage(error, '真人素材授权校验失败，请稍后重试'), 'error')
        return false
      }
    }
    const entryReferenceImageCount = meta.mode === 'image' ? (meta.images || []).length : 0
    const entryHasRealPersonReference = Boolean(meta.realPersonReferences?.some((item) => item?.realPersonId))
    const entryRequiredOperations = requiredGenerationOperations(
      meta.mode,
      entryReferenceImageCount,
      entryHasRealPersonReference,
    )
    if (!areGenerationModelOperationsReady(generationModelCatalog.operationStates, entryRequiredOperations)) {
      showToast(
        generationModelCatalogMessage(meta.mode, entryReferenceImageCount, entryHasRealPersonReference),
        'error',
      )
      return false
    }
    // 与入口面板同源：只校验本次创作真正会用到的 operation。视频模式同样要过滤——
    // video.edit 已不属于智能成片流程（修改走视频生视频），入口不再收集它，
    // 这里若沿用未过滤的 pickerGroups，就会索要一个用户无从选择的模型而永远提交不了。
    const entryModelGroups = filterGenerationModelGroupsByOperations(
      generationModelCatalog.pickerGroups,
      entryRequiredOperations,
    )
    if (!isGenerationModelSelectionComplete(entryModelGroups, meta.generationModels || {})) {
      showToast(
        generationModelCatalog.loading
          ? '可用模型仍在加载，请稍后再试'
          : generationModelCatalog.error || '请先在首页完成本次创作需要的全部模型选择',
        'error',
      )
      return false
    }
    const entryConflictGroups =
      meta.mode === 'image'
        ? filterGenerationModelGroupsByOperations(entryModelGroups, [
            getImageGenerationOperationCode(entryReferenceImageCount),
          ])
        : entryModelGroups
    const entryModelConflicts = getGenerationModelSelectionConflicts(entryConflictGroups, meta.generationModels || {}, {
      ratio: meta.ratio,
      ...(meta.mode === 'video' ? { durationSec: parseDurationSeconds(meta.duration) ?? undefined } : {}),
      ...(meta.mode === 'image' ? { referenceImageCount: entryReferenceImageCount } : {}),
    })
    if (entryModelConflicts.length) {
      showToast(entryModelConflicts[0], 'error')
      return false
    }
    const initialOperation: GenerationOperationCode =
      meta.mode === 'video' ? 'responses.multimodal' : getImageGenerationOperationCode(entryReferenceImageCount)
    if (!requireGenerationModel(initialOperation, meta.generationModels)) return false
    let durableMeta = meta
    if (meta.mode === 'image') {
      const generationModels = { ...(meta.generationModels || {}) }
      for (const operationCode of ['image.text_to_image', 'image.image_to_image'] as const) {
        if (generationModels[operationCode]) continue
        const fallback = generationModelCatalog.groups
          .flatMap((group) => group.operationGroups)
          .find((group) => group.operationCode === operationCode)
          ?.models.find((model) => !model.unavailableReason)
        if (fallback) generationModels[operationCode] = fallback.modelVersionId
      }
      durableMeta = { ...meta, generationModels }
    }
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
      navigate(flowBasePath, {
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
    return startCreation(req, durableMeta)
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

    let initialImageQuote: LockedSmartImageQuotedCost | undefined
    if (meta.mode === 'image') {
      const confirmedQuote = await confirmImageGenerationCost({
        workspaceId: wsId,
        referenceImageCount: (meta.images || []).length,
        ratio: meta.ratio || '16:9',
        count: meta.outputCount || 1,
        generationModels: meta.generationModels,
      })
      if (!confirmedQuote) {
        creationStartingRef.current = false
        return false
      }
      initialImageQuote = confirmedQuote
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
      // 新项目会在本轮异步函数中立即开始生成脚本；同步更新 ref，避免流式回调读取上传前的入口素材。
      entryMetaRef.current = durableMeta

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
        navigate(`${flowBasePath}/${readyProjectId}`, {
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
          { confirmedQuote: initialImageQuote, generationModels: durableMeta.generationModels },
        )
      } else if (durableMeta.skill) {
        void runSkillBreakdown(req, durableMeta)
      } else {
        void generateScript(req, durableMeta)
      }

      const summaryModel = selectedGenerationModel('responses.multimodal', durableMeta.generationModels)
      if (req.trim().length > 90 && summaryModel) {
        cancelSummaryRequest()
        const runId = ++summaryRequestSequenceRef.current
        const controller = new AbortController()
        summaryRequestRef.current = {
          runId,
          workspaceId: wsId,
          routeSessionToken,
          controller,
        }
        const isCurrentSummary = () => {
          const active = summaryRequestRef.current
          return (
            active?.runId === runId &&
            !controller.signal.aborted &&
            active.workspaceId === Number(workspaceIdRef.current || 0) &&
            active.routeSessionToken === routeSessionToken &&
            Number(projectIdRef.current || 0) === readyProjectId
          )
        }
        summarizeRequirement(
          req,
          controller.signal,
          summaryModel.modelVersionId,
          responseRequestContextFor(summaryModel, wsId),
        )
          .then((summary) => {
            if (isCurrentSummary()) setReqSummary(summary || req)
          })
          .catch((error) => {
            if (error?.name !== 'AbortError' && isCurrentSummary()) setReqSummary(req)
          })
          .finally(() => {
            if (summaryRequestRef.current?.runId === runId) summaryRequestRef.current = null
          })
      } else {
        cancelSummaryRequest()
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
    const responseModel = selectedGenerationModel('responses.multimodal')
    const namingWorkspaceId = Number(workspaceIdRef.current || workspaceId || 0)
    const namingContext = {
      flow: 'smart' as const,
      durationSec: entryMeta?.mode === 'video' ? parseDurationSeconds(entryMeta.duration) || undefined : undefined,
      modelVersionId: responseModel?.modelVersionId,
      ...(responseModel && namingWorkspaceId
        ? { requestContext: responseRequestContextFor(responseModel, namingWorkspaceId) }
        : {}),
    }
    if (nameTouchedRef.current || naming) return
    if (!req && !images.length) return
    if (!responseModel) {
      const fallback = createProjectNameFallback({ requirement: req, ...namingContext })
      projectNameRef.current = fallback
      setProjectName(fallback)
      return
    }
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
  // 上一步:step0 → 营销拆解(用了 skill)/ 入口;镜头编排(step2)直接回到分镜脚本(step0)。
  // step1 已删除，仅保留作旧草稿兼容，不能作为用户可见的导航目标。
  const goPrev = () => {
    if (step === STEP_SCRIPT) {
      if (entryMeta?.skill) setMarketingOpen(true)
      else setStarted(false)
    } else {
      goStep(STEP_SCRIPT)
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
    const videoGenerationModelReady = Boolean(selectedGenerationModel('video.generate'))
    const activeShots = shots.filter((shot) => shot.includeInVideo !== false)
    switch (step) {
      case STEP_SCRIPT: {
        // 确认脚本后直接进入生成视频:中间不再有素材/分镜图生成环节,
        // 用户上传的素材原样作为参考图提交,产品外观不会被重画。
        return [
          {
            label: '生成视频',
            variant: 'split',
            action: () => {
              guardInsertedShotBeforeNext(() => {
                void guardDurationBeforeNext(() => {
                  videoGenSigRef.current = ''
                  autoVidRef.current = false
                  initialVideoGenerateCountRef.current = normalizeVideoGenerateCount(videoCount)
                  setPendingVideoFocusToken((v) => v + 1)
                  goStep(STEP_VIDEO)
                })
              })
            },
            disabled:
              scriptLoading ||
              insertTextGenerating ||
              Boolean(scriptError) ||
              activeShots.length === 0 ||
              !videoGenerationModelReady,
            tip: scriptError
              ? '脚本生成未完整结束，请先重新生成'
              : activeShots.length === 0
                ? '请先生成分镜脚本'
                : !videoGenerationModelReady
                  ? '请先选择视频生成模型'
                  : undefined,
            splitCount: videoCount,
            splitCountOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            onSplitCountChange: (n: number) => setVideoCount(n),
          },
        ]
      }
      case STEP_VIDEO: // 生成视频:总按钮在中间 VideoStage,这里不再渲染底部条
        return []
      default:
        return []
    }
  })()

  // 入口「下一步」:从入口回到已生成的流程,只往前一步(进入分镜脚本 / 用了 skill 则进营销拆解),不重生成。
  // 旧草稿可在首页补齐模型；恢复前再次校验并写回 entryMeta，保证后续步骤无需再出现选择器。
  const resumeFlow = (generationModels: GenerationModelSelectionMap) => {
    if (!entryMeta) {
      showToast('当前草稿缺少创作配置，请重新开始创作', 'error')
      return
    }
    const resumeReferenceImageCount = entryMeta.mode === 'image' ? imageComposerRefCount : 0
    const resumeHasRealPersonReference = Boolean(entryMeta.realPersonReferences?.some((item) => item?.realPersonId))
    const resumeRequiredOperations = requiredGenerationOperations(
      entryMeta.mode,
      resumeReferenceImageCount,
      resumeHasRealPersonReference,
    )
    if (
      workspaceId > 0 &&
      !areGenerationModelOperationsReady(generationModelCatalog.operationStates, resumeRequiredOperations)
    ) {
      showToast(
        generationModelCatalogMessage(entryMeta.mode, resumeReferenceImageCount, resumeHasRealPersonReference),
        'error',
      )
      return
    }
    // 同上：恢复既有草稿时也只校验本次流程要用的 operation，否则老项目会被卡在「补齐模型」。
    const resumeGroups = filterGenerationModelGroupsByOperations(
      generationModelCatalog.pickerGroups,
      resumeRequiredOperations,
    )
    const resumeConflictGroups =
      entryMeta.mode === 'image'
        ? filterGenerationModelGroupsByOperations(resumeGroups, [
            getImageGenerationOperationCode(resumeReferenceImageCount),
          ])
        : resumeGroups
    if (
      workspaceId > 0 &&
      (!isGenerationModelSelectionComplete(resumeGroups, generationModels) ||
        getGenerationModelSelectionConflicts(resumeConflictGroups, generationModels, {
          ratio: entryMeta.ratio,
          ...(entryMeta.mode === 'image' ? { referenceImageCount: resumeReferenceImageCount } : {}),
          ...(entryMeta.mode === 'video' ? { durationSec: parseDurationSeconds(entryMeta.duration) ?? undefined } : {}),
        }).length > 0)
    ) {
      showToast('请先在首页补齐有效的模型配置', 'error')
      return
    }
    setEntryMeta({ ...entryMeta, generationModels })
    setStarted(true)
    if (entryMeta?.skill && marketingText) setMarketingOpen(true)
  }
  // 入口是否可恢复：视频回到既有步骤；图片回到原对话，不重新提交任务。
  const canResumeFlow = entryMeta?.mode === 'image' ? imageMessages.length > 0 : shots.length > 0 || !!marketingText

  const activeImageGenerationOperation = getImageGenerationOperationCode(imageComposerRefCount)
  const activeImageGenerationModel = selectedGenerationModel(activeImageGenerationOperation)
  const activeImageModelConstraints = activeImageGenerationModel
    ? buildModelRestrictionSummary(activeImageGenerationModel.source).constraints
    : {}
  const activeImageSupportedRatios =
    activeImageModelConstraints.ratio?.options ?? activeImageModelConstraints.ratios ?? []
  // 流程内的模型面板同样只呈现本次创作用得到的 operation：
  // 视频模式不含 video.edit，否则面板里会多出一个既不参与生成、又要参与冲突校验的槽位。
  const flowGenerationModelGroups = filterGenerationModelGroupsByOperations(
    generationModelCatalog.pickerGroups,
    entryMeta?.mode === 'image' ? [activeImageGenerationOperation] : REQUIRED_GENERATION_OPERATION_CODES_BY_MODE.video,
  )
  /** 制作图片的模型面板按当前对话参数预估一次出图费用，展示口径与真正提交保持一致。 */
  const estimateImageModelSelection = useCallback(
    async ({
      operationCode,
      modelVersionId,
    }: GenerationModelEstimateRequest): Promise<GenerationModelEstimateResult> => {
      const ws = Number(workspaceIdRef.current || workspaceId || 0)
      if (!ws) throw new Error('工作空间未就绪')
      if (operationCode !== 'image.text_to_image' && operationCode !== 'image.image_to_image') {
        throw new Error('当前模型不属于图片生成')
      }
      const result: any = await estimateAiTaskCost({
        workspaceId: ws,
        modelVersionId,
        operationCode,
        prompt: imageComposerDraft.text.trim(),
        params: {
          ratio: imageComposerDraft.ratio || entryMeta?.ratio || '16:9',
          count: Math.max(1, Number(imageComposerDraft.outputCount || entryMeta?.outputCount || 1)),
        },
        inputAssets:
          operationCode === 'image.image_to_image'
            ? imageComposerDraft.images.map((reference) => Number(reference.assetId || 0)).filter((id) => id > 0)
            : [],
      })
      return {
        estimatedCost: Number(result?.estimated_cost ?? 0),
        balance: Number.isFinite(Number(result?.balance)) ? Number(result.balance) : undefined,
        canAfford: result?.can_afford,
      }
    },
    [entryMeta?.outputCount, entryMeta?.ratio, imageComposerDraft, workspaceId],
  )
  const flowGenerationModelConflicts = entryMeta
    ? getGenerationModelSelectionConflicts(flowGenerationModelGroups, entryMeta.generationModels || {}, {
        ratio: entryMeta.mode === 'image' ? imageComposerRatio || entryMeta.ratio : entryMeta.ratio,
        ...(entryMeta.mode === 'video'
          ? { durationSec: parseDurationSeconds(entryMeta.duration) ?? undefined }
          : { referenceImageCount: imageComposerRefCount }),
      })
    : []

  /**
   * 「视频修改」在本片是否不可用及原因。
   *
   * video.edit 改的是已生成的那条视频，按源视频真实时长计费执行，其时长上限可能低于生成模型
   * （例如生成支持 30 秒、修改只支持 15 秒）。这条约束在生成前无从判断，也不该拦住创作，
   * 因此不进入模型冲突（见 getGenerationModelSelectionConflicts），改为在这里按成片时长判定：
   * 超限就关掉修改入口并说明原因，其余流程照常。
   */
  /** 只比较会影响切换决策的稳定字段，确认框停留期间产物变化则整次切换作废。 */
  const generationModelSwitchArtifactFingerprint = () =>
    JSON.stringify({
      meta: {
        mode: entryMetaRef.current?.mode,
        ratio: entryMetaRef.current?.ratio,
        duration: entryMetaRef.current?.duration,
        style: entryMetaRef.current?.style,
      },
      shots: shotsRef.current.map((shot) => ({
        id: shot.id,
        duration: shot.duration,
        desc: shot.desc,
        line: shot.line,
        subtitle: shot.subtitle,
        sfx: shot.sfx,
        includeInVideo: shot.includeInVideo,
        imageAssetId: Number(shot.imageAssetId || 0),
        subjects: (shot.subjects || []).map((subject) => ({
          tag: subject.tag,
          assetId: Number(subject.assetId || 0),
        })),
      })),
      video: {
        assetId: Number(fullVideoRef.current.assetId || 0),
        versions: videoVersionsRef.current.map((version) => Number(version.assetId || 0)),
      },
      images: imageMessagesRef.current.map((message) => ({
        id: message.id,
        operationCode: message.operationCode,
        status: message.status,
        taskId: Number(message.taskId || 0),
        assets: (message.images || []).map((image) => Number(image.assetId || 0)),
      })),
    })

  const applyModelSwitchCheckpointState = (
    meta: EntryMeta,
    descriptor: SmartModelSwitchRecoveryDescriptor | null,
    patch: Partial<Pick<SmartDraft, 'scriptPending' | 'scriptError'>> = {},
  ) => {
    entryMetaRef.current = meta
    setEntryMeta(meta)
    modelSwitchRecoveryRef.current = descriptor
    latestDraftStateRef.current = {
      ...latestDraftStateRef.current,
      ...patch,
      entryMeta: meta,
      shots: shotsRef.current,
      subjectAssets: subjectAssetsRef.current,
      modelSwitchRecovery: descriptor || undefined,
    }
    if (patch.scriptPending !== undefined) setScriptPending(Boolean(patch.scriptPending))
    if (patch.scriptError !== undefined) setScriptError(String(patch.scriptError || ''))
  }

  /**
   * Fail-closed persistence boundary for model-switch regeneration.  No paid
   * responses/image call may run until this exact descriptor is in the cloud.
   */
  const persistModelSwitchCheckpoint = async (
    meta: EntryMeta,
    descriptor: SmartModelSwitchRecoveryDescriptor,
    patch: Partial<Pick<SmartDraft, 'scriptPending' | 'scriptError'>> = {},
  ): Promise<DraftWriteResult> => {
    applyModelSwitchCheckpointState(meta, descriptor, patch)
    const ws = Number(descriptor.workspaceId || 0)
    if (!ws || Number(projectIdRef.current || 0) !== descriptor.projectId) return 'error'
    saveSmartDraft(currentDraft(), ws)
    return await putSmartDraftToBackend(ws)
  }

  const failModelSwitchRecovery = (meta: EntryMeta, descriptor: SmartModelSwitchRecoveryDescriptor, error: string) => {
    const failed: SmartModelSwitchRecoveryDescriptor = {
      ...descriptor,
      status: 'failed',
      error,
      updatedAt: Date.now(),
    }
    applyModelSwitchCheckpointState(
      meta,
      failed,
      descriptor.phase === 'script' ? { scriptPending: false, scriptError: error } : {},
    )
    saveSmartDraft(currentDraft(), failed.workspaceId)
    void putSmartDraftToBackend(failed.workspaceId)
  }

  const completeModelSwitchRecovery = async (
    meta: EntryMeta,
    descriptor: SmartModelSwitchRecoveryDescriptor,
  ): Promise<boolean> => {
    applyModelSwitchCheckpointState(
      meta,
      null,
      descriptor.phase === 'script' ? { scriptPending: false, scriptError: '' } : {},
    )
    saveSmartDraft(currentDraft(), descriptor.workspaceId)
    const result = await putSmartDraftToBackend(descriptor.workspaceId)
    if (result === 'saved') return true
    failModelSwitchRecovery(meta, descriptor, '新产物已生成，但最终草稿保存失败，请勿重复生成并稍后重试保存')
    return false
  }

  /**
   * 流程内模型切换的唯一入口：先规划影响、确认，再复核空间/项目/会话/序列和产物，
   * 最后用不可变 generationModels 快照调用现有生成入口。
   */
  const switchGenerationModel = async (groupKey: string, modelId: unknown, subgroupKey?: string) => {
    const operationCode = String(subgroupKey || groupKey)
    if (!isGenerationOperationCode(operationCode)) return
    if (modelSwitchingRef.current) {
      showToast('上一项模型切换仍在处理中，请稍候', 'info')
      return
    }
    const currentMeta = entryMetaRef.current
    if (!currentMeta) {
      showToast('当前创作配置尚未就绪，无法切换模型', 'error')
      return
    }
    const busyReason = getGenerationModelSwitchBusyReason()
    const currentModelId = Number(currentMeta.generationModels?.[operationCode] || 0) || 0
    const nextModelId = Number(modelId || 0) || 0
    const nextGenerationModels: GenerationModelSelectionMap = {
      ...(currentMeta.generationModels || {}),
      [operationCode]: nextModelId,
    }
    const proposedConflicts = getGenerationModelSelectionConflicts(flowGenerationModelGroups, nextGenerationModels, {
      ratio: currentMeta.mode === 'image' ? imageComposerRatio || currentMeta.ratio : currentMeta.ratio,
      ...(currentMeta.mode === 'video'
        ? { durationSec: parseDurationSeconds(currentMeta.duration) ?? undefined }
        : { referenceImageCount: imageComposerRefCount }),
    })
    if (proposedConflicts.length) {
      showToast(proposedConflicts[0], 'error')
      return
    }
    const targetModel = selectedGenerationModel(operationCode, nextGenerationModels)
    if (!targetModel || targetModel.modelVersionId !== nextModelId) {
      showToast('目标模型已不可用，请刷新模型目录后重试', 'error')
      return
    }

    const currentVideo = fullVideoRef.current
    const currentVideoKey = Number(currentVideo.assetId || 0)
      ? `asset:${Number(currentVideo.assetId)}`
      : currentVideo.url
        ? `url:${currentVideo.url}`
        : ''
    const reusableEditNote = String(
      (currentVideoKey && videoModificationDraft.noteByVersion[currentVideoKey]) || '',
    ).trim()
    const imageHistoryCount = imageMessagesRef.current.filter(
      (message) =>
        message.role === 'assistant' &&
        message.operationCode === operationCode &&
        message.status === 'done' &&
        (message.images || []).length > 0,
    ).length
    const videoImageRegenerationPlan =
      currentMeta.mode === 'video' &&
      (operationCode === 'image.text_to_image' || operationCode === 'image.image_to_image')
        ? planSmartImageModelRegeneration({
            operationCode,
            shots: shotsRef.current,
            subjectAssets: subjectAssetsRef.current,
            subjectHasReference: (name) => {
              const reference = subjectRefOf(name)
              return Boolean(reference.url || reference.assetId || reference.assetIds?.length)
            },
            subjectIsManual: subjectManualOf,
          })
        : null
    const hasAnyEditResult =
      Object.keys(videoModificationDraft.noteByVersion).length > 0 ||
      videoGenerationsRef.current.some(
        (generation) => generation.status === 'published' && Boolean(String(generation.modificationNote || '').trim()),
      )
    const plan = planGenerationModelSwitch({
      operationCode,
      currentModelId,
      nextModelId,
      artifacts: {
        hasScript: currentMeta.mode === 'video' && shotsRef.current.length > 0,
        textShotImageCount:
          operationCode === 'image.text_to_image'
            ? currentMeta.mode === 'image'
              ? imageHistoryCount
              : videoImageRegenerationPlan?.totalTaskCount || 0
            : 0,
        referenceShotImageCount:
          operationCode === 'image.image_to_image'
            ? currentMeta.mode === 'image'
              ? imageHistoryCount
              : videoImageRegenerationPlan?.totalTaskCount || 0
            : 0,
        hasGeneratedVideo: Boolean(currentVideo.url || currentVideo.assetId || videoVersionsRef.current.length),
        hasEditedVideo: operationCode === 'video.edit' ? Boolean(reusableEditNote) : hasAnyEditResult,
      },
      runningOperations: busyReason ? [operationCode] : [],
    })
    if (plan.action === 'noop') return
    if (plan.action === 'blocked') {
      showToast(busyReason || plan.message, 'info')
      return
    }

    const sequence = ++modelSwitchSequenceRef.current
    const owner = {
      workspaceId: Number(workspaceIdRef.current || 0),
      projectId: Number(projectIdRef.current || 0),
      routeSessionToken: routeSessionTokenRef.current,
      artifactFingerprint: generationModelSwitchArtifactFingerprint(),
    }
    modelSwitchingRef.current = true
    setModelSwitching(true)
    try {
      if (plan.requiresConfirmation) {
        const confirmed = await requestConfirm(plan.message, {
          title: `确认切换${plan.operationLabel}模型`,
          confirmLabel: '确认切换',
          cancelLabel: '取消',
        })
        if (!confirmed) return
      }

      const attemptStillCurrent =
        sequence === modelSwitchSequenceRef.current &&
        owner.workspaceId === Number(workspaceIdRef.current || 0) &&
        owner.projectId === Number(projectIdRef.current || 0) &&
        owner.routeSessionToken === routeSessionTokenRef.current &&
        owner.artifactFingerprint === generationModelSwitchArtifactFingerprint() &&
        currentModelId === Number(entryMetaRef.current?.generationModels?.[operationCode] || 0) &&
        getGenerationModelSwitchBusyReason() === ''
      if (!attemptStillCurrent) {
        showToast('确认期间项目、产物或生成状态已变化，本次未切换模型', 'info')
        return
      }
      const latestTarget = selectedGenerationModel(operationCode, nextGenerationModels)
      if (!latestTarget || latestTarget.modelVersionId !== nextModelId) {
        showToast('目标模型已下架或目录已变化，本次未切换模型', 'error')
        return
      }

      const nextMeta: EntryMeta = { ...currentMeta, generationModels: nextGenerationModels }
      entryMetaRef.current = nextMeta
      setEntryMeta(nextMeta)
      window.setTimeout(() => flushDraftRef.current(), 0)

      if (plan.action === 'switch-directly') {
        showToast(
          operationCode === 'video.edit' && !reusableEditNote
            ? '修改视频模型已切换，将在下一次修改时生效'
            : '生成模型已切换',
          'success',
        )
        return
      }

      if (operationCode === 'responses.multimodal') {
        // 事务性重生成期间保留旧脚本、主体和分镜；只有新脚本完整成功后才原子替换。
        shotGenSigRef.current = ''
        videoGenSigRef.current = ''
        autoGenRef.current = false
        autoVidRef.current = true
        setMarketingOpen(false)
        setStep(0)
        setMaxReached(0)
        const now = Date.now()
        const recovery: SmartModelSwitchRecoveryDescriptor = {
          version: 1,
          id: `smart-model-switch-${now}-${sequence}`,
          operationCode,
          status: 'checkpoint',
          phase: 'script',
          workspaceId: owner.workspaceId,
          projectId: owner.projectId,
          fromModelId: currentModelId,
          toModelId: nextModelId,
          previousGenerationModels: { ...(currentMeta.generationModels || {}) },
          nextGenerationModels: { ...nextGenerationModels },
          pendingSubjectNames: [],
          pendingShotIds: [],
          completedSubjectNames: [],
          completedShotIds: [],
          createdAt: now,
          updatedAt: now,
        }
        const checkpoint = await persistModelSwitchCheckpoint(nextMeta, recovery, {
          scriptPending: true,
          scriptError: '',
        })
        if (checkpoint !== 'saved') {
          applyModelSwitchCheckpointState(currentMeta, null, { scriptPending: false })
          showToast(
            checkpoint === 'conflict' ? '云端草稿已发生变化，已取消模型切换' : '模型切换保存失败，未开始重新生成',
            'error',
          )
          return
        }
        const generated = await generateScript(marketingText || requirement, nextMeta, { transactional: true })
        if (!generated) {
          failModelSwitchRecovery(nextMeta, recovery, '新脚本生成失败，旧脚本和素材已保留')
          return
        }
        await completeModelSwitchRecovery(nextMeta, recovery)
        return
      }

      if (operationCode === 'image.text_to_image' || operationCode === 'image.image_to_image') {
        if (currentMeta.mode === 'image') {
          const lastRequest = [...imageMessagesRef.current]
            .reverse()
            .find(
              (message) =>
                message.role === 'assistant' &&
                message.operationCode === operationCode &&
                message.status === 'done' &&
                message.request,
            )?.request
          const safeToReplay =
            Boolean(lastRequest?.text || lastRequest?.ratio) &&
            (operationCode === 'image.text_to_image' ||
              Boolean(lastRequest?.refAssetIds?.length && lastRequest.refAssetIds.every((id) => Number(id) > 0)))
          if (!lastRequest || !safeToReplay) {
            showToast('模型已切换；历史图片已保留，下一次发送时使用新模型', 'success')
            return
          }
          const replayQueued = await sendImageChat(
            lastRequest.text,
            (lastRequest.refImages || []).map((image) => image.url),
            lastRequest.ratio || imageComposerRatio || currentMeta.ratio,
            lastRequest.refAssetIds || [],
            Math.max(1, Number(lastRequest.outputCount || 1)),
            { generationModels: nextGenerationModels },
          )
          if (!replayQueued) showToast('模型已切换；历史图片已保留，自动重生成未提交', 'info')
          return
        }
        // 视频模式下的图片模型已不参与智能成片:主体素材图与分镜图都不再生成,
        // 所以切换图片模型不需要重跑任何付费任务,下次用到时(如图片模式)自然生效。
        showToast('图片模型已切换，将在下一次生成时生效', 'success')
        return
      }

      if (operationCode === 'video.generate') {
        await queueFullVideo(undefined, { edit: false, generationModels: nextGenerationModels }, 1)
        return
      }
      if (operationCode === 'video.edit' && reusableEditNote) {
        await queueFullVideo(reusableEditNote, { edit: true, generationModels: nextGenerationModels }, 1)
        return
      }
      showToast('模型已切换，将在下一次生成时生效', 'success')
    } finally {
      if (sequence === modelSwitchSequenceRef.current) {
        modelSwitchingRef.current = false
        setModelSwitching(false)
      }
    }
  }

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
    const stage = !started ? (canResumeFlow ? 'reentry' : 'entry') : 'process'
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
          {/* 疑似重复主体：AI 可能给同一个产品在不同镜头起了不同名字，素材因此各生成各的，
              成片就会前后不一致。这里只提示不自动合并——万一真是两个产品，自动合并的错误更难发现。 */}
          {materialMode && duplicateSubjectGroups.length > 0 && (
            <div className="smart__subject-dup" role="note">
              <strong className="smart__subject-dup-title">
                ⚠️ 发现 {duplicateSubjectGroups.length} 组疑似重复的素材
              </strong>
              <p className="smart__subject-dup-desc">
                下面这些名称看起来指向同一个东西，但它们各自使用不同的素材，成片会前后不一致。确认是同一个的话点「统一素材」。
              </p>
              {duplicateSubjectGroups.map((group) => (
                <div className="smart__subject-dup-row" key={group.key}>
                  <span className="smart__subject-dup-names">
                    {group.names.map((name) => `「${name}」`).join(' 与 ')}
                  </span>
                  <button
                    type="button"
                    className="smart__subject-dup-merge"
                    onClick={() => mergeDuplicateSubjects(group)}
                  >
                    统一为「{group.canonical}」
                  </button>
                </div>
              ))}
            </div>
          )}

          {shots.length || (!scriptLoading && !scriptError) ? (
            <>
              <ScriptStoryboardTable
                shots={shots}
                /* 「准备素材」步已移除:主体素材不再由 AI 单独出图,这一列没有内容可展示。
                   用户上传的素材直接作为参考图提交给视频模型。 */
                showSubjects={false}
                maxTotalDurationSec={maxVideoDurationSec}
                maxShotDurationSec={maxShotDurationSec}
                onInsertShot={insertStoryboardShot}
                insertDisabled={scriptLoading || insertTextGenerating}
                shotTextGenerating={insertTextGeneratingId === null ? {} : { [String(insertTextGeneratingId)]: true }}
                onDeleteShot={deleteShot}
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
    // 生成视频(第二步):整片视频 + 时间轴选片段 + 片段/整段修改框 + 总按钮(本步不再改分镜)
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
        onEstimateEditCost={async () => {
          const ws = Number(workspaceId || 0)
          if (!ws || !fullVideo.assetId || !fullVideo.url) throw new Error('缺少可修改的视频')
          // 修改 = 带上源视频重新生成一次，用的是入口选定的视频生成模型，因此按生成口径估价，
          // 与真正提交时的 estimateFullVideoCost 完全同源，保证「预估 = 实扣」。
          const modelSelection = selectedGenerationModel('video.generate')
          if (!modelSelection) throw new Error('请先选择视频生成模型')
          const result: any = await estimateFullVideoCost({
            workspaceId: ws,
            shots,
            ratio: entryMeta?.ratio,
            resolution: entryMeta?.resolution,
            modelVersionId: modelSelection.modelVersionId,
            modelVersion: modelSelection.source,
            modelPlanCandidates: [],
          })
          return {
            estimatedCost: Number(result?.estimated_cost ?? 0),
            balance: Number(result?.balance ?? 0),
            canAfford: result?.can_afford === true,
          }
        }}
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
          void queueFullVideo(note, opts, count || videoCount)
        }}
        onDownloadVideo={handleDownloadVideo}
        onPolishText={(kind, text) => {
          const responseModel = requireInteractiveResponseModel()
          return polishText(text, {
            kind,
            modelVersionId: responseModel.modelVersionId,
            requestContext: responseRequestContextFor(responseModel),
          })
        }}
        onPrev={() => goStep(STEP_SCRIPT)}
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
  const usedSkill = !isRealPersonMode && !!entryMeta?.skill
  // 两步流程都可见（分镜脚本 / 生成视频）；不再有需要跳过的中间步。
  const visibleStepIndices = [STEP_SCRIPT, STEP_VIDEO] as const
  const allFlowSteps = isRealPersonMode ? REAL_PERSON_STEPS : STEPS
  // filter(Boolean) 是护栏：步骤数一旦再变（如又删一步），落单的索引会变成 undefined，
  // 进度条读 .label 就整页白屏。宁可少画一格，也不要让流程页崩掉。
  const visibleFlowSteps = visibleStepIndices.map((index) => allFlowSteps[index]).filter(Boolean)
  const visibleActiveStatus = isRealPersonMode ? ['策划生成中', '真人视频生成中'] : ['脚本生成中', '视频生成中']
  const currentVisibleStep = Math.max(0, visibleStepIndices.indexOf(step as (typeof visibleStepIndices)[number]))
  const maxVisibleStep = visibleStepIndices.reduce<number>(
    (max, internalStep, visibleIndex) => (internalStep <= maxReached ? visibleIndex : max),
    0,
  )

  return (
    <div className={`smart${isRealPersonMode ? ' smart--real-person' : ''}`}>
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
                  ? `您目前的视频秒数为${durGuard.currentSec}s（已超过最大限制${maxVideoDurationSec}s，无法生成视频）`
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
        activeKey={isRealPersonMode ? 'real-person-video' : 'creative'}
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
                variant={isRealPersonMode ? 'real-person' : 'smart'}
                workspaceId={Number(workspaceId || 0)}
                onSubmit={handleStart}
                restoreSessionDraft={!explicitFreshEntrySession}
                onNewVideo={resetToNewVideo}
                canResume={canResumeFlow}
                onResume={resumeFlow}
                modelGroups={generationModelCatalog.pickerGroups}
                modelOperationStates={generationModelCatalog.operationStates}
                modelLoading={generationModelCatalog.loading}
                modelError={generationModelCatalog.error}
                onReloadModels={generationModelCatalog.reload}
                requireModelSelection={workspaceId > 0 && !isCheckingSession}
                authRequired={modelEntryAuthRequired}
                onAuthRequired={requestModelEntryLogin}
                initial={{
                  mode: entryMeta?.mode ?? carriedEntry.mode,
                  text:
                    entryMeta?.mode === 'image' && imageComposerDraft.text
                      ? imageComposerDraft.text
                      : requirement || carriedEntry.text,
                  ratio: entryMeta?.ratio ?? carriedEntry.ratio,
                  duration: entryMeta?.duration,
                  resolution: entryMeta?.resolution,
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
                  realPersonReferences: entryMeta?.realPersonReferences,
                  outputCount: entryMeta?.outputCount ?? imageComposerDraft.outputCount,
                  skill: entryMeta?.skill,
                  generationModels: entryMeta?.generationModels,
                }}
              />
            </div>
          </div>
        ) : isImageMode ? (
          // 制作图片:chat 对话视图(消息流 + 沉底输入框,工具栏仅比例 + @)
          <div className="smart__entry-with-tasks">
            <TaskCenterDrawer scope="image" />
            <div className="smart__entry-content">
              <div className="smart__image-workspace">
                {showGenerationModelSelection && (
                  <div className="smart__image-modelbar">
                    <GenerationModelDropdown
                      groups={flowGenerationModelGroups}
                      selected={entryMeta?.generationModels || {}}
                      loading={generationModelCatalog.loading}
                      error={generationModelCatalog.error}
                      estimateModelCost={
                        entryMeta?.mode === 'image' && Number(workspaceId || 0) > 0
                          ? estimateImageModelSelection
                          : undefined
                      }
                      onChange={(groupKey, nextModelId, subgroupKey) =>
                        void switchGenerationModel(groupKey, nextModelId, subgroupKey)
                      }
                      onRetry={generationModelCatalog.reload}
                      context="generation"
                      locked={generationModelSwitchLocked}
                      lockedReason={generationModelSwitchLockedReason}
                      conflicts={flowGenerationModelConflicts}
                      className="smart__generation-model"
                    />
                  </div>
                )}
                <Suspense fallback={<LazyEditorFallback label="正在加载图片编辑器…" />}>
                  <ImageChat
                    messages={imageMessages}
                    initialRatio={entryMeta?.ratio || '16:9'}
                    initialOutputCount={entryMeta?.outputCount || 1}
                    initialComposerDraft={imageComposerDraft}
                    busy={imageBusy}
                    generationDisabled={!selectedGenerationModel(activeImageGenerationOperation)}
                    generationDisabledReason={`入口选择的${
                      activeImageGenerationOperation === 'image.image_to_image' ? '图生图' : '文生图'
                    }模型缺失或已失效，请返回首页重新选择`}
                    supportedRatios={activeImageSupportedRatios}
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
                    isRetryDisabled={(message) => Boolean(getImageRetryDisabledReason(message))}
                    getRetryDisabledReason={getImageRetryDisabledReason}
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
          </div>
        ) : (
          <div className="smart__entry-with-tasks">
            <TaskCenterDrawer scope="smart" />
            <div className="smart__entry-content">
              <div className="smart__flow-content">
                {/* 创建新视频:固定在流程区最右上,点击重置为全新入口、重新走一遍生成流程 */}
                <button type="button" className="smart__newvideo" onClick={() => resetToNewVideo('video')}>
                  {isRealPersonMode ? '新建真人成片' : '创建新视频'}
                </button>
                {isRealPersonMode && (
                  <section className="smart__real-flow-head" aria-label="真人成片项目">
                    <div className="smart__real-flow-mark" aria-hidden="true">
                      人
                    </div>
                    <div>
                      <span>VERIFIED PERSON PROJECT</span>
                      <strong>真人成片工作流</strong>
                      <p>人物素材来自认证真人库，成片阶段保留人物特征并持续校验授权状态。</p>
                    </div>
                  </section>
                )}
                {/* 进度条:用了 SKILL 时在最前面加一步「营销思路拆解」,索引整体后移 1 */}
                <div className="smart__progress" data-guide="smart-stepbar">
                  <StepProgress
                    steps={usedSkill ? [MARKETING_STEP, ...visibleFlowSteps] : visibleFlowSteps}
                    current={usedSkill ? (marketingOpen ? 0 : currentVisibleStep + 1) : currentVisibleStep}
                    clickableMax={usedSkill ? maxVisibleStep + 1 : maxVisibleStep}
                    statuses={(() => {
                      // 两个流程步的子状态:脚本已出分镜 / 已出整片视频。
                      const hasVideoOutput = Boolean(fullVideo.url || fullVideo.assetId || videoVersions.length)
                      // 上游新增/修改后 maxReached 会回退；旧成片不能让后续步骤继续显示为可跳转的“已完成”。
                      const done = [shots.length > 0 || hasVideoOutput, maxReached >= STEP_VIDEO && hasVideoOutput]
                      const running = [scriptLoading || insertTextGenerating, actualVideoGenerating]
                      const flow = visibleStepIndices.map((internalStep, visibleIndex) =>
                        running[internalStep]
                          ? visibleActiveStatus[visibleIndex]
                          : done[internalStep]
                            ? '已完成'
                            : !marketingOpen && internalStep === step
                              ? visibleActiveStatus[visibleIndex]
                              : '待生成',
                      )
                      if (!usedSkill) return flow
                      const mkt = marketingLoading ? '思路拆解中' : marketingText ? '已完成' : '待生成'
                      return [mkt, ...flow]
                    })()}
                    onStepClick={(i) => {
                      const visibleIndex = usedSkill ? i - 1 : i
                      const targetStep = visibleStepIndices[visibleIndex] ?? 0
                      if (insertTextRequestRef.current && targetStep !== step) {
                        showToast('请等待新增分镜的 AI 分镜词生成完成', 'error')
                        return
                      }
                      if (targetStep > maxReached) {
                        showToast('请先完成当前步骤，再进入后续流程', 'error')
                        return
                      }
                      if (!usedSkill) return goStep(targetStep)
                      if (i === 0) setMarketingOpen(true)
                      else {
                        setMarketingOpen(false)
                        goStep(targetStep)
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
                      <span
                        className="smart__name-space"
                        title={`本项目属于「${pinnedWsName}」空间,保存与计费走该空间`}
                      >
                        空间：{pinnedWsName}
                      </span>
                    )}
                    <DraftSaveIndicator status={draftSaveStatus} onRetry={() => void retrySmartCloudSave()} />
                    {showGenerationModelSelection && (
                      <GenerationModelDropdown
                        groups={flowGenerationModelGroups}
                        selected={entryMeta?.generationModels || {}}
                        loading={generationModelCatalog.loading}
                        error={generationModelCatalog.error}
                        estimateModelCost={
                          entryMeta?.mode === 'image' && Number(workspaceId || 0) > 0
                            ? estimateImageModelSelection
                            : undefined
                        }
                        onChange={(groupKey, nextModelId, subgroupKey) =>
                          void switchGenerationModel(groupKey, nextModelId, subgroupKey)
                        }
                        onRetry={generationModelCatalog.reload}
                        context="generation"
                        locked={generationModelSwitchLocked}
                        lockedReason={generationModelSwitchLockedReason}
                        conflicts={flowGenerationModelConflicts}
                        className="smart__generation-model"
                      />
                    )}
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
                  <footer className="smart__footer smart__footer--right">
                    {/* 前瞻预估:当前步显示「下一步生成」要花多少(估到价才显示) */}
                    {stepCost.estimate &&
                      (() => {
                        const insufficient =
                          stepCost.estimate.canAfford === false ||
                          stepCost.estimate.estimatedCost > stepCost.estimate.balance
                        return (
                          <div className="smart__cost">
                            <span className={insufficient ? 'smart__cost--err' : undefined}>
                              {step === STEP_SCRIPT
                                ? '下一步生成视频 · 约 '
                                : stepCost.count > 1
                                  ? `共 ${stepCost.count} 张约 `
                                  : '约 '}
                              {stepCost.estimate.estimatedCost} 积分 · 余额 {stepCost.estimate.balance} 积分
                              {stepCost.estimate.perOne != null && step !== STEP_SCRIPT && (
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
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
