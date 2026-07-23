/**
 * 页面效果：根据一条参考视频和 1～9 张替换素材，生成结构相近的「爆款复制」视频。
 *
 * 页面包含素材上传与视频生成两个阶段。它不经过智能成片的脚本和分镜管线，
 * 而是把参考视频与替换素材提交给 video.replicate；生成结果可预览、下载、
 * 重新生成或按整片/片段意见继续修改。项目草稿、任务编号、生成进度和历史版本
 * 会持久化，确保刷新或切页后能够恢复正在运行的任务及已经完成的结果。
 *
 * 本文件负责流程编排、任务恢复和草稿保存，具体入口与成片界面由 hotcopy/smart 组件负责。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import DraftSaveIndicator from '@/components/common/DraftSaveIndicator'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import type { HotCopyEntryPayload, HotCopyProduct } from '@/components/hotcopy/HotCopyEntry'
import TaskCenterDrawer from '@/components/task/TaskCenterDrawer'
import iconProjectEdit from '@/assets/icons/project-edit.svg'
import {
  replicateHotVideo,
  uploadHotCopyAsset,
  awaitHotVideoResult,
  estimateReplicateCost,
  preloadHotCopyVideoModel,
} from '@/api/hotCopy'
import { editFullVideo, estimateVideoEditCost } from '@/api/smartVideo'
import { blurFacesOnAsset, isNoFaceDetectedError } from '@/api/smartFaceBlur'
import { readVideoDurationSec } from '@/utils/videoDuration'
import {
  saveHotCopyDraft,
  loadHotCopyDraft,
  clearHotCopyDraft,
  sanitizeHotCopyEntryInitial,
  type HotCopyDraft,
  type HotCopyGenRecord,
} from '@/utils/hotCopyDraft'
import {
  bindVideoModificationNote,
  createEmptyVideoModificationDraft,
  mergeVideoModificationDraft,
  parseVideoModificationDraft,
  type VideoModificationDraft,
} from '@/utils/videoModificationDraft'
import {
  HOT_COPY_PENDING_TASK_GRACE_MS,
  resolveHotCopyActiveGenerationState,
  resolveHotCopyPendingRecovery,
  type HotCopyPendingRecoveryAction,
} from '@/utils/hotCopyGenerationState'
import {
  inspectHotCopyProjectDraft,
  isAcceptedHotCopyProjectDraft,
  resolveHotCopyRestoredStarted,
  resolveHotCopySubmissionProjectId,
} from '@/utils/hotCopyProjectDraft'
import {
  isUnnamedProjectTitle as isUnnamedTitle,
  resolveCreativeProjectTitleWrite,
} from '@/utils/creativeProjectTitlePersistence'
import { resolveCreativeProjectId as resolveProjectId } from '@/utils/projectAssetAccess'
import { useLatestCallback } from '@/composables/useLatestCallback'
import { refreshAssetUrl } from '@/api/smartShotImage'
import { createProjectNameFallback, generateProjectName, validateProjectName } from '@/api/aiPolish'
import {
  createCreativeProject,
  updateCreativeProjectDraft,
  getCreativeProject,
  patchCreativeProject,
  isAbortedTaskError,
} from '@/api/business'
import { getModelParamOptions } from '@/utils/videoOptions'
import {
  useWorkspaceId,
  useCurrentUser,
  useModelPlanCandidates,
  useWorkspaceSessionStore,
  deriveModelPlanCandidates,
} from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import { openComingSoon, useUiStore } from '@/stores/ui'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useAuth } from '@/auth/AuthContext'
import { buildDownloadName, downloadToDisk } from '@/utils/downloadToDisk'
import {
  detachRunningVideoGen,
  findRunningVideoGen,
  getRunningVideoGen,
  getRunningVideoGenMeta,
  isVideoGenRunning,
  trackVideoGen,
  updateRunningVideoGenMeta,
  type VideoGenResult,
} from '@/utils/videoGenRegistry'
import { enqueueCreativeProjectDraftSave, waitForCreativeProjectDraftSaves } from '@/utils/creativeDraftSaveQueue'
import {
  getCreativeProjectDraft,
  isCreativeProjectRestrictedForUser,
  mergeLatestProjectMetadata,
  resolveUserId,
} from '@/utils/creativeDraftMetadata'
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
import { persistHotCopyResultToBackend, persistHotCopyTerminalStateToBackend } from '@/utils/persistHotCopyResult'
import { buildTaskCenterId, isTaskCenterTerminalStatus, useTaskCenterStore } from '@/stores/taskCenter'
import { sanitizeHotCopyPersistentDraft } from '@/utils/hotCopyPersistentDraft'
import { sanitizePersistentMediaUrl, sanitizePersistentProjectVideoStore } from '@/utils/persistentMediaUrl'
import { sanitizeTelemetryText } from '@/utils/observabilitySanitizer'
import { validateCreativeDurationSelection } from '@/utils/creativeDurationPolicy'
import { SMART_VIDEO_DURATIONS, parseDurationSeconds } from '@/utils/videoDurationValue'
import './SmartCreateView.css'

/** 按需加载爆款复制素材入口。 */
const HotCopyEntry = lazy(() => import('@/components/hotcopy/HotCopyEntry'))
/** 按需加载共用成片预览与修改区。 */
const VideoStage = lazy(() => import('@/components/smart/VideoStage'))

/** 懒加载入口或成片编辑器时显示的无障碍占位。 */
function LazyHotCopyFallback({ label = '正在加载编辑器…' }: { label?: string }) {
  return (
    <div className="smart__placeholder smart__placeholder--sm" role="status" aria-live="polite">
      <span className="smart__project-loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

// 两步:上传爆款视频(入口)/ 生成视频
const STEPS: StepItem[] = [
  { key: 'upload', label: '上传爆款视频' },
  { key: 'video', label: '生成视频' },
]

/** 侧边栏导航键与页面路径映射。 */
const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

// 默认尺寸/时长与智能成片一致:16:9、10s
const DEFAULT_RATIO = '16:9'
/** 源视频时长尚未读取时的默认生成秒数。 */
const DEFAULT_DURATION_SEC = 10
/** 模型套餐查询不得无限阻塞用户提交的超时时间。 */
const HOT_COPY_PLAN_LOOKUP_TIMEOUT_MS = 6000

/** 修复历史草稿中缺少流程/秒数约束的旧项目名称。 */
function repairLegacyHotCopyProjectName(args: {
  title: string
  requirement: string
  durationSec: number
  nameTouched: boolean
}): string {
  const title = String(args.title || '').trim()
  if (!title || args.nameTouched) return title

  const context = { flow: 'hot-copy' as const, durationSec: args.durationSec }
  if (validateProjectName(title, context).valid) return title
  return createProjectNameFallback({
    requirement: String(args.requirement || title),
    ...context,
  })
}

/** 当前会话已确认无权访问的项目键，避免恢复链重复尝试。 */
const deniedHotCopyProjectKeys = new Set<string>()
/** 组合工作空间与项目 id，作为权限拒绝和草稿基线缓存键。 */
const hotCopyProjectKey = (workspaceId: number, projectId: number) =>
  `${Math.floor(Number(workspaceId) || 0)}:${Math.floor(Number(projectId) || 0)}`
// 同一个 provider task 可能同时被原生成链和路由恢复链消费；跨组件重挂载也只允许落库一次。
const hotCopyCompletionPromises = new Map<string, Promise<void>>()

/** 爆款复制页面可能提交的两类视频任务。 */
type HotCopyTaskOperation = 'video.replicate' | 'video.edit'

/** 一次生成启动时冻结的项目、素材、提示词和草稿并发上下文。 */
interface HotCopyJobContext {
  epoch: number
  workspaceId: number
  projectId: number
  generationId: string
  generationNote: string
  generationModificationNote: string
  createdAt: number
  taskCenterId: string
  title: string
  prompt: string
  ratio: string
  durationSec: number
  operationCode: HotCopyTaskOperation
  entryInitial?: Partial<HotCopyEntryPayload>
  allowFlowReplace?: boolean
  /** 生成会话启动时捕获的创作内容基线。 */
  contentBaseFingerprint?: string
  /** 队列真正执行保存时读取本编辑器最近一次成功基线。 */
  resolveContentBaseFingerprint?: () => string
  /** 只有新项目或显式重启流程才允许初始化/替换创作内容。 */
  allowCreativeReplace?: boolean
}

/** 后台任务进行中需要增量写入草稿的恢复字段。 */
interface HotCopyJobProgress {
  status: 'preparing' | 'processing' | 'reconnecting' | 'failed' | 'cancelled'
  started?: boolean
  taskId?: number
  error?: string
  sourceVideo?: { assetId: number; url: string }
  sourceVideoDurationSec?: number
  originalProductAssetIds?: number[]
  productAssetIds?: number[]
  entryInitial?: Partial<HotCopyEntryPayload>
}

/** 任务进度写入后的最新草稿及内容冲突结果。 */
interface HotCopyJobProgressResult {
  draft: Record<string, unknown> | null
  creativeConflict: boolean
}

/** 页面内部使用的爆款复制生成记录别名。 */
type GenRecord = HotCopyGenRecord
/** 成片历史版本的可访问地址与资产主键。 */
type VideoVersion = { url: string; assetId: number }
/** 提交任务前预留的生成批次基础信息。 */
type ReservedGen = Pick<GenRecord, 'id' | 'note' | 'modificationNote' | 'createdAt'>

/** 把未知历史状态收敛为爆款复制支持的生成状态。 */
function normalizeGenStatus(value: any): GenRecord['status'] {
  const status = String(value || '').trim()
  if (status === 'processing' || status === 'failed' || status === 'published' || status === 'cancelled') {
    return status
  }
  return 'processing'
}

/** 过滤无 id 记录并规范化一组历史生成记录。 */
function normalizeGenRecords(list: any): GenRecord[] {
  if (!Array.isArray(list)) return []
  return list
    .map((generation: any) => {
      const id = String(generation?.id || '').trim()
      if (!id) return null
      return {
        id,
        status: normalizeGenStatus(generation?.status),
        taskId: Number(generation?.taskId || 0) || 0,
        note: String(generation?.note || ''),
        modificationNote: String(generation?.modificationNote || ''),
        error: String(generation?.error || ''),
        createdAt: Number(generation?.createdAt || 0) || Date.now(),
      } as GenRecord
    })
    .filter(Boolean) as GenRecord[]
}

/** 按生成 id 去重合并多份记录，保留已有任务号和创建时间。 */
function mergeGenRecords(...groups: any[]): GenRecord[] {
  const out: GenRecord[] = []
  const indexes = new Map<string, number>()
  const add = (item: any) => {
    if (Array.isArray(item)) {
      normalizeGenRecords(item).forEach(add)
      return
    }
    const id = String(item?.id || '').trim()
    if (!id) return
    const existingIndex = indexes.get(id)
    if (existingIndex != null) {
      const existing = out[existingIndex]
      out[existingIndex] = {
        ...item,
        ...existing,
        taskId: Number(existing.taskId || item?.taskId || 0) || 0,
        createdAt: Number(existing.createdAt || item?.createdAt || 0) || Date.now(),
      }
      return
    }
    indexes.set(id, out.length)
    out.push(item as GenRecord)
  }
  groups.forEach(add)
  return out
}

/** 移除所有仍处于 processing 的旧记录。 */
function dropProcessingGenerations(...groups: any[]): GenRecord[] {
  return mergeGenRecords(...groups).filter((generation) => String(generation?.status || '') !== 'processing')
}

/** 按生成 id 或 taskId 移除刚刚完成的 processing 记录。 */
function dropCompletedGeneration(...groups: any[]): GenRecord[] {
  const flatGroups = groups.slice(0, -1)
  const opts = (groups[groups.length - 1] || {}) as { genId?: string | null; taskId?: number }
  const genId = String(opts.genId || '').trim()
  const taskId = Number(opts.taskId || 0) || 0
  const records = mergeGenRecords(...flatGroups)
  const processing = records.filter((generation) => String(generation?.status || '') === 'processing')
  const fallbackGenId = !genId && processing.length === 1 ? processing[0].id : ''
  return records.filter((generation) => {
    if (String(generation?.status || '') !== 'processing') return true
    if (genId && generation.id === genId) return false
    if (taskId > 0 && Number(generation.taskId || 0) === taskId) return false
    if (fallbackGenId && generation.id === fallbackGenId) return false
    return true
  })
}

/** 页面恢复时根据是否已有结果/在途任务修正遗留的 processing 状态。 */
function restoreGenerationRecords(list: any, hasResult: boolean, isGenerating: boolean): GenRecord[] {
  const records = normalizeGenRecords(list)
  if (isGenerating) return records
  if (hasResult) return records.filter((generation) => String(generation?.status || '') !== 'processing')
  return records.map((generation) =>
    generation.status === 'processing'
      ? {
          ...generation,
          status: 'failed' as const,
          taskId: 0,
          error: generation.error || '生成请求未创建成功，请重新生成',
        }
      : generation,
  )
}

/** 判断是否存在仍在“创建服务商任务”保护期内的轻量启动记录。 */
function hasRecentPreparingGeneration(list: any): boolean {
  return normalizeGenRecords(list).some(
    (generation) =>
      generation.status === 'processing' &&
      Number(generation.taskId || 0) === 0 &&
      Date.now() - Number(generation.createdAt || 0) < HOT_COPY_PENDING_TASK_GRACE_MS,
  )
}

/** 递归判断当前视频或历史版本中是否已有 URL/assetId 结果。 */
function hasVideoResult(...items: any[]): boolean {
  return items.some((item) => {
    if (Array.isArray(item)) return item.some((value) => hasVideoResult(value))
    return Boolean(item?.url || item?.assetId)
  })
}

/** 按 assetId 或 URL 去重合并多组视频历史版本。 */
function mergeVideoVersions(...groups: any[]): VideoVersion[] {
  const out: VideoVersion[] = []
  const seen = new Set<string>()
  const add = (item: any) => {
    if (Array.isArray(item)) {
      item.forEach(add)
      return
    }
    const url = String(item?.url || '')
    const assetId = Number(item?.assetId || 0) || 0
    if (!url && !assetId) return
    const key = assetId > 0 ? `asset:${assetId}` : `url:${url}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ url, assetId })
  }
  groups.forEach(add)
  return out
}

/** 判断任务错误是否明确表示用户/服务端取消。 */
function isTaskCancelled(error: any): boolean {
  return String(error?.code || '').toUpperCase() === 'TASK_CANCELLED'
}

/** 区分可恢复的断网/限流/5xx 与不可重试的安全审核失败。 */
function isTransientTaskRecoveryError(error: any): boolean {
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

/** 最多等待指定时长收口 Promise，超时仅停止等待而不取消后台任务。 */
async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer = 0
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

/** 从当前草稿和恢复来源中读取与源视频资产匹配的真实时长。 */
function resolveStoredSourceDuration(sourceAssetId: number, ...sources: any[]): number {
  const targetAssetId = Number(sourceAssetId || 0) || 0
  if (!targetAssetId) return 0
  for (const source of sources) {
    const storedAssetId = Number(source?.sourceVideoDurationAssetId || 0) || 0
    const seconds = Number(source?.sourceVideoDurationSec || 0) || 0
    if (storedAssetId === targetAssetId && seconds > 0) return seconds
  }
  return 0
}

// 据 Tab + 文案构造 replicate 提示词
function buildBasePrompt(tab: 'remake' | 'replica', text: string): string {
  const intent =
    tab === 'replica'
      ? '精准复刻:尽量 1:1 还原原视频的画面、运镜与节奏'
      : '同款翻拍:保留原视频镜头节奏与爆点结构,把主体替换为提供的替换素材产品'
  return [text.trim(), intent].filter(Boolean).join(';') || '做同款-爆款复制'
}

/** 生成可持久化的入口素材快照，剥离仅当前页面需要的临时字段。 */
function buildEntrySnapshot(payload?: Partial<HotCopyEntryPayload> | null): Partial<HotCopyEntryPayload> | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const products = Array.isArray(payload.products)
    ? payload.products
        .map((p: any) => ({
          url: String(p?.url || ''),
          file: null,
          isVideo: Boolean(p?.isVideo),
          assetId: Number(p?.assetId || 0) || undefined,
          submitAssetId: Number(p?.submitAssetId || 0) || undefined,
          faceCheckStatus:
            p?.faceCheckStatus === 'blurred' || p?.faceCheckStatus === 'no_face' ? p.faceCheckStatus : undefined,
          faceCheckedAssetId: Number(p?.faceCheckedAssetId || 0) || undefined,
        }))
        .filter((p: any) => p.url)
    : []
  const libraryVideo =
    payload.libraryVideo && (payload.libraryVideo.src || payload.libraryVideo.assetId)
      ? {
          assetId: Number(payload.libraryVideo.assetId || 0) || 0,
          src: String(payload.libraryVideo.src || ''),
        }
      : null
  const snapshot: Partial<HotCopyEntryPayload> = {
    tab: (payload.tab as any) || 'remake',
    videoSource: (payload.videoSource as any) || '',
    videoFile: null,
    libraryVideo,
    videoFileName: String(payload.videoFileName || ''),
    videoPreview: String(payload.videoPreview || libraryVideo?.src || ''),
    products,
    text: String(payload.text || ''),
    ratio: String(payload.ratio || DEFAULT_RATIO),
    duration: String(payload.duration || `${DEFAULT_DURATION_SEC}s`),
  }
  return snapshot
}

/** 从入口、草稿和恢复数据中选择可继续使用的源视频。 */
function resolveHotCopySourceVideo(
  sourceVideo?: { assetId?: number; url?: string } | null,
  entry?: Partial<HotCopyEntryPayload> | null,
): { assetId: number; url: string } {
  const libraryVideo = entry?.libraryVideo
  return {
    assetId: Number(sourceVideo?.assetId || libraryVideo?.assetId || 0) || 0,
    url: String(sourceVideo?.url || libraryVideo?.src || entry?.videoPreview || ''),
  }
}

/** 合并并规范化当前替换商品图的资产 id。 */
function resolveHotCopyProductAssetIds(
  productAssetIds?: number[] | null,
  entry?: Partial<HotCopyEntryPayload> | null,
): number[] {
  const current = (Array.isArray(productAssetIds) ? productAssetIds : [])
    .map((id) => Number(id) || 0)
    .filter((id) => id > 0)
  const fromEntry = (Array.isArray(entry?.products) ? entry.products : [])
    .filter((product) => !product?.isVideo)
    .map((product) => Number(product?.submitAssetId || product?.assetId || 0) || 0)
    .filter((id) => id > 0)
  return Array.from(new Set(current.length ? current : fromEntry))
}

/** 提取未经人脸处理的用户原图资产 id，供封面和后续恢复使用。 */
function resolveHotCopyOriginalProductAssetIds(
  entry?: Partial<HotCopyEntryPayload> | null,
  savedIds?: number[] | null,
): number[] {
  const fromEntry = (Array.isArray(entry?.products) ? entry.products : [])
    .filter((product) => !product?.isVideo)
    .map((product) => Number(product?.assetId || 0) || 0)
    .filter((id) => id > 0)
  const saved = (Array.isArray(savedIds) ? savedIds : []).map((id) => Number(id) || 0).filter((id) => id > 0)
  return Array.from(new Set(fromEntry.length ? fromEntry : saved))
}

/** 把多来源解析出的源视频和商品资产回填到入口快照。 */
function withResolvedHotCopyAssets(
  entry: Partial<HotCopyEntryPayload> | undefined,
  sourceVideo: { assetId: number; url: string },
  productAssetIds: number[],
): Partial<HotCopyEntryPayload> | undefined {
  if (!entry) return undefined
  let productIndex = 0
  const products = (Array.isArray(entry.products) ? entry.products : []).map((product) => {
    if (product?.isVideo) return product
    const submitAssetId = Number(product?.submitAssetId || productAssetIds[productIndex] || 0) || undefined
    productIndex += 1
    return { ...product, submitAssetId }
  })
  return {
    ...entry,
    ...(sourceVideo.assetId
      ? {
          videoSource: 'library' as const,
          libraryVideo: { assetId: sourceVideo.assetId, src: sourceVideo.url },
          videoPreview: sourceVideo.url || entry.videoPreview || '',
        }
      : {}),
    products,
  }
}

// 从后端 draft_json 还原爆款复制草稿(我们把字段存在 .smart 块里;兼容字符串/对象)
function parseHotCopyDraft(draftJson: any): { obj: any; smart: any } | null {
  const inspection = inspectHotCopyProjectDraft(draftJson)
  if (!isAcceptedHotCopyProjectDraft(inspection)) return null
  return { obj: inspection.obj, smart: inspection.smart }
}

/** 用冻结的生成上下文创建或更新任务中心记录。 */
function upsertHotCopyTaskCenter(
  context: HotCopyJobContext,
  status: HotCopyJobProgress['status'] | 'succeeded',
  patch: Record<string, any> = {},
): void {
  const store = useTaskCenterStore.getState()
  const existing = store.tasks.find((task) => task.id === context.taskCenterId)
  if (existing && isTaskCenterTerminalStatus(existing.status) && status !== existing.status && status !== 'succeeded') {
    return
  }
  store.upsertTask({
    id: context.taskCenterId,
    scope: 'hot-copy',
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    generationId: context.generationId,
    taskId: Number(patch.taskId || 0) || 0,
    status,
    title: context.title,
    ratio: context.ratio,
    durationSec: context.durationSec,
    thumbnailUrl: String(context.entryInitial?.videoPreview || context.entryInitial?.libraryVideo?.src || ''),
    thumbnailAssetId: Number(context.entryInitial?.libraryVideo?.assetId || 0) || 0,
    operationCode: context.operationCode,
    startedAt: context.createdAt,
    updatedAt: Date.now(),
    ...patch,
  })
  if (status === 'preparing') store.setDrawerExpanded(true)
}

/** 增量更新任务中心，同时阻止晚到回调让终态倒退。 */
function patchHotCopyTaskCenter(context: HotCopyJobContext, patch: Record<string, any>): void {
  const store = useTaskCenterStore.getState()
  const existing = store.tasks.find((task) => task.id === context.taskCenterId)
  const nextStatus = String(patch.status || '')
  if (
    existing &&
    nextStatus &&
    isTaskCenterTerminalStatus(existing.status) &&
    nextStatus !== existing.status &&
    nextStatus !== 'succeeded'
  ) {
    return
  }
  store.patchTask(context.taskCenterId, patch)
}

/**
 * 用一次生成锁定的 project/workspace 写任务进度，避免页面 reset 后旧异步回调读取新的 projectIdRef。
 * 每次都先取最新 revision 并只合并 hot-copy 字段；与页面自动保存共用串行队列。
 */
async function persistHotCopyJobProgress(
  context: HotCopyJobContext,
  progress: HotCopyJobProgress,
): Promise<HotCopyJobProgressResult> {
  if (!context.projectId || !context.workspaceId) return { draft: null, creativeConflict: false }
  return enqueueCreativeProjectDraftSave({
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    task: async () => {
      const latestOwnedBaseline = context.resolveContentBaseFingerprint?.()
      if (latestOwnedBaseline) context.contentBaseFingerprint = latestOwnedBaseline
      const save = async () => {
        const proj: any = await getCreativeProject({
          projectId: context.projectId,
          workspaceId: context.workspaceId,
        })
        const revision = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
        const latestDraftValue = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
        const draftInspection = inspectHotCopyProjectDraft(latestDraftValue)
        if (draftInspection.kind === 'foreign' && !context.allowFlowReplace) {
          return { draft: null, creativeConflict: false }
        }
        const parsed = isAcceptedHotCopyProjectDraft(draftInspection)
          ? { obj: draftInspection.obj, smart: draftInspection.smart }
          : null
        const hasUnreadableDraft = latestDraftValue != null && latestDraftValue !== '' && !parsed
        if (hasUnreadableDraft && !context.allowCreativeReplace) {
          return { draft: null, creativeConflict: true }
        }
        const draft: any = parsed?.obj && typeof parsed.obj === 'object' ? { ...parsed.obj } : {}
        const currentFlow = String(draft?.flow || draft?.smart?.flow || '').toLowerCase()
        if (currentFlow && currentFlow !== 'hot-copy' && !context.allowFlowReplace) {
          return { draft: null, creativeConflict: false }
        }

        let creativeConflict = !context.contentBaseFingerprint && !context.allowCreativeReplace
        if (context.contentBaseFingerprint && !context.allowCreativeReplace) {
          try {
            assertCreativeDraftContentUnchanged(context.contentBaseFingerprint, latestDraftValue)
          } catch (error) {
            if (!isCreativeDraftContentConflictError(error)) throw error
            creativeConflict = true
          }
        }

        const smart: any = parsed?.smart && typeof parsed.smart === 'object' ? { ...parsed.smart } : {}
        const active =
          progress.status === 'preparing' || progress.status === 'processing' || progress.status === 'reconnecting'
        const generationStatus = active ? 'processing' : progress.status
        const taskId = active ? Number(progress.taskId || smart.vidGenTaskId || 0) || 0 : 0
        const existingGenerations = Array.isArray(smart.videoGenerations) ? smart.videoGenerations.slice() : []
        const generationIndex = existingGenerations.findIndex((item: any) => item?.id === context.generationId)
        const generation = {
          ...(generationIndex >= 0 ? existingGenerations[generationIndex] : {}),
          id: context.generationId,
          note: context.generationNote,
          modificationNote: context.generationModificationNote,
          createdAt: context.createdAt,
          status: generationStatus,
          taskId,
          error: progress.status === 'failed' ? String(progress.error || '生成失败，请重试') : '',
        }
        if (generationIndex >= 0) existingGenerations[generationIndex] = generation
        else existingGenerations.unshift(generation)

        const nextEntryInitial = progress.entryInitial || smart.entryInitial || context.entryInitial
        const nextSourceVideo = progress.sourceVideo || smart.sourceVideo || { assetId: 0, url: '' }
        const nextOriginalProductAssetIds = Array.isArray(progress.originalProductAssetIds)
          ? progress.originalProductAssetIds
          : Array.isArray(smart.originalProductAssetIds)
            ? smart.originalProductAssetIds
            : []
        const nextProductAssetIds = Array.isArray(progress.productAssetIds)
          ? progress.productAssetIds
          : Array.isArray(smart.productAssetIds)
            ? smart.productAssetIds
            : []
        const nextStarted =
          typeof progress.started === 'boolean'
            ? progress.started
            : typeof smart.started === 'boolean'
              ? smart.started
              : true

        // 其他编辑器已经改过创作内容时，旧生成任务仍可补写恢复凭证和任务元数据，
        // 但不能再用旧任务锁定的提示词、源视频或商品选择覆盖较新的草稿。
        if (!creativeConflict) {
          Object.assign(smart, {
            flow: 'hot-copy',
            started: nextStarted,
            entryInitial: nextEntryInitial,
            projectName: context.title,
            basePrompt: context.prompt,
            sourceVideo: nextSourceVideo,
            sourceVideoDurationSec: Number(progress.sourceVideoDurationSec ?? smart.sourceVideoDurationSec ?? 0) || 0,
            sourceVideoDurationAssetId:
              Number(progress.sourceVideoDurationSec ?? smart.sourceVideoDurationSec ?? 0) > 0
                ? Number(nextSourceVideo?.assetId || 0) || 0
                : Number(smart.sourceVideoDurationAssetId || 0) || 0,
            originalProductAssetIds: nextOriginalProductAssetIds,
            productAssetIds: nextProductAssetIds,
            genRatio: context.ratio,
            genDurationSec: context.durationSec,
            step: 1,
            maxReached: 1,
          })
        }
        const activeGenerationState = resolveHotCopyActiveGenerationState(existingGenerations)
        Object.assign(smart, {
          videoGenerating: activeGenerationState.videoGenerating,
          vidGenTaskId: activeGenerationState.vidGenTaskId,
          videoGenerations: existingGenerations,
        })
        if (!creativeConflict) {
          Object.assign(draft, {
            flow: 'hot-copy',
            title: context.title,
            currentStep: nextStarted ? 'video' : 'entry',
            description: context.prompt,
          })
        }
        draft.smart = smart
        const persistentDraft = sanitizeHotCopyPersistentDraft(draft, context.workspaceId)

        await updateCreativeProjectDraft({
          projectId: context.projectId,
          workspaceId: context.workspaceId,
          draft: persistentDraft,
          draftRevision: revision,
          coverAssetId: creativeConflict ? 0 : Number(nextOriginalProductAssetIds[0] || 0) || 0,
        })
        if (!creativeConflict) {
          context.contentBaseFingerprint = createCreativeDraftContentFingerprint(persistentDraft)
          context.allowCreativeReplace = false
          context.allowFlowReplace = false
        }
        return { draft: persistentDraft, creativeConflict }
      }

      try {
        return await save()
      } catch (error: any) {
        if (Number(error?.status || 0) === 409) return save()
        throw error
      }
    },
  })
}

/** 把服务商成功结果按任务启动时锁定的项目落库，并同步任务中心终态。 */
async function persistHotCopyJobResult(
  context: HotCopyJobContext,
  video: { url: string; assetId: number },
  taskId = 0,
): Promise<boolean> {
  if (!context.projectId || !context.workspaceId || (!video.url && !video.assetId)) return false
  // persistHotCopyResultToBackend 已经进入同项目保存队列；此处禁止再套一层相同队列，否则会自等待死锁。
  return persistHotCopyResultToBackend({
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    url: video.url,
    assetId: video.assetId,
    taskId,
    generationId: context.generationId,
    modificationNote: context.generationModificationNote,
  })
}

/** 编排爆款复制入口、任务提交/恢复、草稿保存和成片修改。 */
export default function HotCopyCreateView() {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const routeId = Number(params.id || 0)
  const initialNavigationRef = useRef({ state: location.state as any, routeId })
  const { showToast } = useToast()
  const requireAuth = useRequireAuth()
  const { isAuthenticated, isCheckingSession } = useAuth()
  const currentUser = useCurrentUser() as any
  const currentUserId = resolveUserId(currentUser)
  const workspaceId = useWorkspaceId()
  const workspaceIdRef = useRef(0)
  workspaceIdRef.current = Number(workspaceId || 0)
  const modelPlanCandidates = useModelPlanCandidates() as string[]
  const modelPlanCandidatesRef = useRef(modelPlanCandidates)
  modelPlanCandidatesRef.current = modelPlanCandidates
  const ensureModelPlanCandidatesLoaded = useWorkspaceSessionStore((s) => s.ensureModelPlanCandidatesLoaded)

  const resolvePlanCandidates = useLatestCallback(async (): Promise<string[]> => {
    try {
      // 套餐仅用于模型候选，不能无限阻塞正式任务；超时后使用当前已加载候选走原模型查询。
      await settleWithin(ensureModelPlanCandidatesLoaded(), HOT_COPY_PLAN_LOOKUP_TIMEOUT_MS)
    } catch {
      /* 失败用兜底候选 */
    }
    return (
      (deriveModelPlanCandidates(useWorkspaceSessionStore.getState()) as string[]) || modelPlanCandidatesRef.current
    )
  })

  const [started, setStarted] = useState(false) // false=入口(上传步), true=生成视频步
  const [entryKey, setEntryKey] = useState(0) // 「创建新视频」自增 → 重挂载入口页,清空其内部输入状态
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)

  // 入口回填(返回上一步用)
  // 从「项目管理 → 新建视频」携带的上传素材,需在【首帧】就绪(HotCopyEntry 内部状态只初始化一次),
  // 故用 useState 初始化器同步读 location.state(而非挂载后 setState)。
  const [entryInitial, setEntryInitial] = useState<Partial<HotCopyEntryPayload> | undefined>(() => {
    const st = (location.state as any) || {}
    const imgs = (Array.isArray(st.carryImages) ? st.carryImages : []).filter((m: any) => m && m.url)
    const vid = st.carryVideo && (st.carryVideo.url || st.carryVideo.assetId) ? st.carryVideo : null
    if (!imgs.length && !vid) return undefined
    return {
      tab: 'remake',
      products: imgs.map((m: any) => ({
        url: m.url,
        file: null,
        isVideo: false,
        assetId: Number(m.assetId || 0) || undefined,
        submitAssetId: Number(m.submitAssetId || 0) || undefined,
      })),
      ...(vid
        ? {
            videoSource: 'library' as const,
            videoPreview: vid.url || '',
            libraryVideo: { assetId: Number(vid.assetId || 0), src: vid.url || '' },
          }
        : {}),
    } as any
  })
  const [basePrompt, setBasePrompt] = useState('')

  // replicate 输入:源视频 + 替换素材(asset_id)
  const [sourceVideo, setSourceVideo] = useState<{ assetId: number; url: string }>({ assetId: 0, url: '' })
  const [productAssetIds, setProductAssetIds] = useState<number[]>([])

  // 项目名(v1 仅本地)
  const [projectName, setProjectName] = useState('未命名项目')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const nameTouchedRef = useRef(false)
  const [naming, setNaming] = useState(false)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const nameAbortRef = useRef<AbortController | null>(null)
  const autoNameResumeKeyRef = useRef('')
  nameTouchedRef.current = nameTouched

  // 整片视频(replicate 产物)
  const [fullVideo, setFullVideo] = useState<{ url: string; assetId: number }>({ url: '', assetId: 0 })
  const [videoVersions, setVideoVersions] = useState<{ url: string; assetId: number }[]>([])
  const [videoModificationDraft, setVideoModificationDraft] = useState<VideoModificationDraft>(
    createEmptyVideoModificationDraft,
  )
  const [vidGenRunning, setVidGenRunning] = useState(false)
  const [genTriggerBusy, setGenTriggerBusy] = useState(false)
  const [videoStageKey, setVideoStageKey] = useState(0)
  // 在途生成任务 id(>0=有任务在跑):持久化后,刷新/切换页面回来用它续轮询,不丢生成结果
  const [vidGenTaskId, setVidGenTaskId] = useState(0)
  const [hotCopyPhase, setHotCopyPhase] = useState('')
  const [projectLoading, setProjectLoading] = useState(true)
  const [projectLoadError, setProjectLoadError] = useState('')
  const [projectLoadRetry, setProjectLoadRetry] = useState(0)
  const vidGenAbortRef = useRef<AbortController | null>(null)
  const aliveRef = useRef(true)
  const vidGenPendingTimerRef = useRef<number>(0)
  const resumeRetryTimerRef = useRef<number>(0)
  const staleGenTimerRef = useRef<number>(0)
  const genTriggerLockRef = useRef(false)
  const completedTaskIdsRef = useRef<Set<number>>(new Set())
  const isActiveProcessingGen = useCallback((generation: any): boolean => {
    if (String(generation?.status || '') !== 'processing') return false
    const taskId = Number(generation?.taskId || 0) || 0
    return !(taskId > 0 && completedTaskIdsRef.current.has(taskId))
  }, [])
  const completedJobUiKeysRef = useRef<Set<string>>(new Set())
  const terminalJobStatusRef = useRef<Map<string, 'succeeded' | 'failed' | 'cancelled'>>(new Map())
  const terminalJobPersistenceRef = useRef<Map<string, Promise<boolean>>>(new Map())
  const terminalJobResultsRef = useRef<
    Map<number, { url: string; assetId: number; generationId: string; taskId: number }>
  >(new Map())
  const recoveryCredentialWritesRef = useRef<Map<string, Promise<void>>>(new Map())
  // 每次进入一条全新爆款流程递增。旧任务仍可在后台完成，但不得再修改新页面的 state/ref/local 草稿。
  const sessionEpochRef = useRef(1)

  // 每次生成的独立记录(对齐智能成片):processing=生成中、failed=失败(可重试)、published=已并入成片。
  // 作用:① 项目管理里把「生成中/失败」显示成可重试的「草稿」(失败不再让项目凭空消失);
  //       ② 进行中那条的 createdAt 作为加载进度锚点 → 切页面/刷新回来续算,不从头爬。
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
  const immediateSaveRef = useRef(false) // 生成记录变化时请求立即落后端,草稿/失败态即时出现在项目里(不等防抖)

  // 源视频真实时长(秒):video.replicate/edit 按它计费;前端读上传视频 HTML5 元数据得到
  const [sourceVideoDurSec, setSourceVideoDurSec] = useState(0)
  const [sourceVideoDurAssetId, setSourceVideoDurAssetId] = useState(0)
  const boundSourceVideoDurSec = sourceVideoDurAssetId === Number(sourceVideo.assetId || 0) ? sourceVideoDurSec : 0
  const sourceDurationReadRef = useRef<{ key: string; promise: Promise<number> } | null>(null)
  const readSourceVideoDuration = useCallback((assetId: number, url: string): Promise<number> => {
    const key = `${Number(assetId || 0) || 0}:${String(url || '')}`
    if (sourceDurationReadRef.current?.key === key) return sourceDurationReadRef.current.promise
    const promise = readVideoDurationSec(url).finally(() => {
      if (sourceDurationReadRef.current?.promise === promise) sourceDurationReadRef.current = null
    })
    sourceDurationReadRef.current = { key, promise }
    return promise
  }, [])
  const acquireGenTriggerLock = (): boolean => {
    if (genTriggerLockRef.current || vidGenRunning) return false
    genTriggerLockRef.current = true
    setGenTriggerBusy(true)
    return true
  }
  const releaseGenTriggerLock = (expectedEpoch?: number) => {
    if (expectedEpoch != null && sessionEpochRef.current !== expectedEpoch) return
    genTriggerLockRef.current = false
    setGenTriggerBusy(false)
  }
  const refreshVideoStage = () => setVideoStageKey((key) => key + 1)
  const clearStaleGenTimer = useCallback(() => {
    if (staleGenTimerRef.current) {
      window.clearTimeout(staleGenTimerRef.current)
      staleGenTimerRef.current = 0
    }
  }, [])
  // 命令式立即落盘:在关键节点(开始生成 / 拿到 task id / 拿到源素材)直接写 localStorage,
  // 不依赖 effect 时机 —— 防止「刚点生成就切走、setState 还没触发保存就卸载」导致 task id 丢失。
  const persistNow = useLatestCallback((partial: Partial<HotCopyDraft>) => {
    const ws = Number(workspaceId || 0)
    if (!ws) return
    const base: HotCopyDraft = loadCurrentHotCopyDraft(ws) || {
      entryInitial,
      projectId: projectIdRef.current || projectId,
      started,
      step,
      maxReached,
      basePrompt,
      projectName,
      nameTouched,
      sourceVideo,
      sourceVideoDurationSec: sourceVideoDurSec,
      sourceVideoDurationAssetId: sourceVideoDurAssetId,
      originalProductAssetIds: resolveHotCopyOriginalProductAssetIds(entryInitial),
      productAssetIds,
      fullVideo,
      videoVersions,
      videoModificationDraft,
      videoGenerating: vidGenRunning,
      vidGenTaskId,
      videoGenerations,
      genRatio,
      genDurationSec,
    }
    saveHotCopyDraft(ws, { ...base, ...partial })
  })

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      genTriggerLockRef.current = false
      if (vidGenPendingTimerRef.current) {
        window.clearInterval(vidGenPendingTimerRef.current)
        vidGenPendingTimerRef.current = 0
      }
      if (resumeRetryTimerRef.current) {
        window.clearTimeout(resumeRetryTimerRef.current)
        resumeRetryTimerRef.current = 0
      }
      clearStaleGenTimer()
    }
  }, [clearStaleGenTimer])
  // 用户在入口选择的成片尺寸(画面比例)与时长(秒);默认与智能成片一致 16:9、10s。
  const [genRatio, setGenRatio] = useState(DEFAULT_RATIO)
  const [genDurationSec, setGenDurationSec] = useState(DEFAULT_DURATION_SEC)
  // replicate 模型支持的比例选项(取自模型 params_schema 的 ratio 字段);供入口下拉只放模型真做得了的比例。
  const [ratioOptions, setRatioOptions] = useState<string[]>([])
  // 提交前积分预估(estimate-cost)
  const [videoCost, setVideoCost] = useState<{
    loading: boolean
    error: string
    estimate: { estimatedCost: number; balance: number; canAfford: boolean } | null
  }>({ loading: false, error: '', estimate: null })
  const setWorkspaceSwitchLockSource = useUiStore((s) => s.setWorkspaceSwitchLockSource)
  const workspaceSwitchLockSourceRef = useRef(Symbol('hot-copy-workspace-switch-lock'))
  const shouldLockWorkspaceSwitch = genTriggerBusy || vidGenRunning || videoGenerations.some(isActiveProcessingGen)

  useEffect(() => {
    const source = workspaceSwitchLockSourceRef.current
    setWorkspaceSwitchLockSource(source, shouldLockWorkspaceSwitch, '当前视频处理中，暂不支持切换团队')
    return () => {
      setWorkspaceSwitchLockSource(source, false)
    }
  }, [setWorkspaceSwitchLockSource, shouldLockWorkspaceSwitch])

  const reserveGen = (note?: string, modificationNote?: string): ReservedGen => ({
    id: `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    note: note || '',
    modificationNote: modificationNote || '',
    createdAt: Date.now(),
  })

  // taskId 返回前也保存一条轻量启动记录。它不是后端任务凭证，只用于切路由/刷新后立即恢复“准备中”反馈；
  // 真正失败会由 catch 清理，异常中断则由下方启动保护超时收口，不会永久伪装成在途任务。
  const [pendingUiGeneration, setPendingUiGenerationState] = useState<ReservedGen | null>(null)
  const pendingUiGenerationRef = useRef<ReservedGen | null>(null)
  const beginPendingUiGeneration = (generation: ReservedGen) => {
    pendingUiGenerationRef.current = generation
    if (aliveRef.current) setPendingUiGenerationState(generation)
    const record: GenRecord = { ...generation, status: 'processing', taskId: 0 }
    immediateSaveRef.current = true
    setVideoGenerations((prev) => [record, ...prev.filter((item) => item.id !== generation.id)])
    persistNow({
      started: true,
      step: 1,
      maxReached: 1,
      videoGenerating: true,
      vidGenTaskId: 0,
      videoGenerations: [record, ...videoGenerationsRef.current.filter((item) => item.id !== generation.id)],
    })
  }
  const clearPendingUiGeneration = useCallback((generationId?: string | null) => {
    const current = pendingUiGenerationRef.current
    if (!current || (generationId && current.id !== generationId)) return
    pendingUiGenerationRef.current = null
    if (aliveRef.current) setPendingUiGenerationState(null)
  }, [])

  // 只有后端真正返回 taskId 后才创建 processing 记录，避免模型/套餐查询中断留下“假生成中”。
  const activateGen = (reserved: ReservedGen, taskId: number) => {
    const id = Number(taskId || 0) || 0
    if (!id) return
    const rec: GenRecord = { ...reserved, status: 'processing', taskId: id }
    const ws = Number(workspaceId || 0)
    const localDraft = ws ? loadCurrentHotCopyDraft(ws) : null
    const current = mergeGenRecords(videoGenerationsRef.current, localDraft?.videoGenerations).filter(
      (item) => item.id !== reserved.id,
    )
    const persisted = [rec, ...current]
    immediateSaveRef.current = true
    persistNow({
      started: true,
      step: 1,
      maxReached: 1,
      videoGenerating: true,
      vidGenTaskId: id,
      videoGenerations: persisted,
    })
    setVideoGenerations((prev) => [rec, ...prev.filter((item) => item.id !== reserved.id)])
  }

  // 结束一条生成记录:成功 published(从草稿列表消失)、失败 failed(留作可重试草稿)。
  const markGen = (
    id: string | null,
    status: 'failed' | 'published' | 'cancelled',
    error = '',
    fallback?: ReservedGen,
  ) => {
    immediateSaveRef.current = true
    setVideoGenerations((prev) => {
      let matched = false
      const next = prev.map((g) => {
        if (!(g.id === id || (id == null && g.status === 'processing'))) return g
        matched = true
        return {
          ...g,
          status,
          taskId: 0,
          error: status === 'failed' ? error || g.error || '生成失败，请重试' : '',
        }
      })
      if (!matched && fallback && status === 'failed') {
        next.unshift({
          ...fallback,
          status: 'failed',
          taskId: 0,
          error: error || '生成失败，请重试',
        })
      }
      if (!next.some((g) => g.status === 'processing')) {
        persistNow({ videoGenerating: false, vidGenTaskId: 0, videoGenerations: next })
      } else {
        persistNow({ videoGenerations: next })
      }
      return next
    })
  }

  const rememberCompletedTask = (taskId: number) => {
    const id = Number(taskId || 0) || 0
    if (id > 0) completedTaskIdsRef.current.add(id)
  }

  const failStaleGenerations = useLatestCallback((reason = '生成请求已停止，请重新生成') => {
    let changed = false
    const ws = Number(workspaceId || 0) || 0
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const staleGenerationIds = videoGenerationsRef.current
      .filter((generation) => generation.status === 'processing' && Number(generation.taskId || 0) <= 0)
      .map((generation) => generation.id)
    immediateSaveRef.current = true
    setVideoGenerations((prev) => {
      const next: GenRecord[] = prev.map((g) => {
        if (g.status !== 'processing') return g
        changed = true
        return { ...g, status: 'failed' as const, taskId: 0, error: reason }
      })
      persistNow({ videoGenerating: false, vidGenTaskId: 0, videoGenerations: next })
      return next
    })
    const taskCenter = useTaskCenterStore.getState()
    staleGenerationIds.forEach((generationId) => {
      taskCenter.patchTask(buildTaskCenterId('hot-copy', ws, pid, generationId), {
        status: 'failed',
        taskId: 0,
        error: reason,
      })
    })
    clearPendingUiGeneration()
    releaseGenTriggerLock()
    if (vidGenPendingTimerRef.current) {
      window.clearInterval(vidGenPendingTimerRef.current)
      vidGenPendingTimerRef.current = 0
    }
    clearStaleGenTimer()
    if (aliveRef.current) {
      setVidGenRunning(false)
      setVidGenTaskId(0)
      setHotCopyPhase('')
      if (changed) showToast(`视频生成失败:${reason}`, 'error')
    }
  })

  // ── 后端项目(对齐智能成片:建项目 + 草稿落库 → 出现在项目管理 + 视频列表;/hot-copy/:id 可恢复)──
  const [projectId, setProjectId] = useState(0)
  const projectIdRef = useRef(0)
  const draftRevisionRef = useRef(0) // 后端草稿版本号(防 409)
  const draftRevisionByProjectRef = useRef<Map<string, number>>(new Map())
  const runningVideoPromiseRef = useRef<Promise<VideoGenResult> | null>(null)
  // 新项目创建后会绑定到带项目 id 的正式地址；路由 replace 重新渲染时不能重置正在运行的生成会话。
  const routeBindingProjectIdRef = useRef(0)
  // 项目「视频清单」存档(待分类归类记录,随草稿存云端)。本编辑器不维护它,加载时原样存下、
  // 保存时原样写回,避免整盘重建 draft_json 时被覆盖丢失。
  const projectVideoStoreRef = useRef<any>(null)
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>('idle')
  const draftSaveStatusRef = useRef<DraftSaveStatus>('idle')
  const draftSaveSequenceRef = useRef(0)
  const lastSavedDraftFingerprintRef = useRef('')
  const baseDraftContentFingerprintByProjectRef = useRef<Map<string, string>>(new Map())
  const draftContentConflictNotifiedRef = useRef<Set<string>>(new Set())
  const queuedDraftSaveRef = useRef<{
    projectId: number
    workspaceId: number
    fingerprint: string
    contentFingerprint: string
    promise: Promise<DraftWriteResult>
  } | null>(null)
  const blockRestrictedProjectRef = useRef<(project: any, projectId: number, workspaceId: number) => boolean>(
    () => false,
  )
  const serverTitleRef = useRef('') // 已同步到后端的标题(去重)
  const pendingAutoTitleRef = useRef('')
  const pendingTitleSaveRef = useRef('')
  const titleSaveFailedRef = useRef(false)

  const markDraftSaveError = () => {
    if (draftSaveStatusRef.current === 'conflict') return
    draftSaveStatusRef.current = 'error'
    setDraftSaveStatus('error')
  }

  const markDraftContentConflict = useLatestCallback((id: number, ws: number) => {
    if (
      Number(projectIdRef.current || 0) !== Number(id || 0) ||
      Number(workspaceIdRef.current || 0) !== Number(ws || 0)
    ) {
      return
    }
    const projectKey = hotCopyProjectKey(ws, id)
    draftSaveStatusRef.current = 'conflict'
    setDraftSaveStatus('conflict')
    if (!draftContentConflictNotifiedRef.current.has(projectKey)) {
      draftContentConflictNotifiedRef.current.add(projectKey)
      showToast('检测到其他页面修改了项目，已停止云端保存，当前页面内容不会覆盖对方修改', 'error')
    }
  })

  useEffect(() => {
    const isInPlaceRouteBinding =
      routeId > 0 &&
      routeBindingProjectIdRef.current === routeId &&
      Number(projectIdRef.current || 0) === routeId &&
      Number(workspaceIdRef.current || 0) === Number(workspaceId || 0)
    if (isInPlaceRouteBinding) return
    draftSaveStatusRef.current = 'idle'
    setDraftSaveStatus('idle')
    lastSavedDraftFingerprintRef.current = ''
    baseDraftContentFingerprintByProjectRef.current.clear()
    draftContentConflictNotifiedRef.current.clear()
    queuedDraftSaveRef.current = null
    pendingTitleSaveRef.current = ''
    titleSaveFailedRef.current = false
    draftSaveSequenceRef.current += 1
  }, [routeId, workspaceId])

  const blockRestrictedProject = (project: any, expectedProjectId: number, expectedWorkspaceId: number): boolean => {
    const key = hotCopyProjectKey(expectedWorkspaceId, expectedProjectId)
    if (!isCreativeProjectRestrictedForUser(project, currentUserId)) {
      deniedHotCopyProjectKeys.delete(key)
      return false
    }
    deniedHotCopyProjectKeys.add(key)
    const localDraft = loadHotCopyDraft(expectedWorkspaceId)
    if (Number(localDraft?.projectId || 0) === Number(expectedProjectId || 0)) clearHotCopyDraft(expectedWorkspaceId)
    detachRunningVideoGen('hot-copy', expectedWorkspaceId, expectedProjectId)
    // projectId 不能单独标识当前页面：不同工作区可能出现相同 id，旧权限响应不能重置当前页面。
    if (
      Number(projectIdRef.current || 0) !== Number(expectedProjectId || 0) ||
      Number(workspaceIdRef.current || 0) !== Number(expectedWorkspaceId || 0)
    ) {
      return true
    }
    projectIdRef.current = 0
    setProjectId(0)
    hydratedRef.current = false
    showToast('您没有权限访问该项目', 'error')
    navigate('/projects', { replace: true })
    return true
  }
  blockRestrictedProjectRef.current = blockRestrictedProject

  const isJobUiActive = (context: HotCopyJobContext): boolean =>
    aliveRef.current &&
    sessionEpochRef.current === context.epoch &&
    Number(projectIdRef.current || 0) === context.projectId &&
    Number(workspaceIdRef.current || 0) === context.workspaceId

  const createJobContext = (args: {
    epoch: number
    workspaceId: number
    projectId: number
    generation: ReservedGen
    title?: string
    prompt?: string
    ratio?: string
    durationSec?: number
    operationCode: HotCopyTaskOperation
    entryInitial?: Partial<HotCopyEntryPayload>
    allowFlowReplace?: boolean
    allowCreativeReplace?: boolean
  }): HotCopyJobContext => ({
    epoch: args.epoch,
    workspaceId: Number(args.workspaceId || 0) || 0,
    projectId: Number(args.projectId || 0) || 0,
    generationId: args.generation.id,
    generationNote: args.generation.note,
    generationModificationNote: String(args.generation.modificationNote || ''),
    createdAt: args.generation.createdAt,
    taskCenterId: buildTaskCenterId('hot-copy', args.workspaceId, args.projectId, args.generation.id),
    title: String(args.title || projectName || '爆款复制项目'),
    prompt: String(args.prompt ?? basePrompt ?? ''),
    ratio: String(args.ratio || genRatio || DEFAULT_RATIO),
    durationSec: Number(args.durationSec || genDurationSec || DEFAULT_DURATION_SEC) || DEFAULT_DURATION_SEC,
    operationCode: args.operationCode,
    entryInitial: args.entryInitial,
    allowFlowReplace: args.allowFlowReplace,
    contentBaseFingerprint:
      baseDraftContentFingerprintByProjectRef.current.get(hotCopyProjectKey(args.workspaceId, args.projectId)) || '',
    resolveContentBaseFingerprint: () =>
      baseDraftContentFingerprintByProjectRef.current.get(hotCopyProjectKey(args.workspaceId, args.projectId)) || '',
    allowCreativeReplace: args.allowCreativeReplace === true,
  })

  const persistTrackedHotCopyJobProgress = useLatestCallback(
    async (context: HotCopyJobContext, progress: HotCopyJobProgress): Promise<void> => {
      const result = await persistHotCopyJobProgress(context, progress)
      if (result.creativeConflict) {
        if (isJobUiActive(context)) markDraftContentConflict(context.projectId, context.workspaceId)
        return
      }
      if (!result.draft || !isJobUiActive(context)) return
      baseDraftContentFingerprintByProjectRef.current.set(
        hotCopyProjectKey(context.workspaceId, context.projectId),
        createCreativeDraftContentFingerprint(result.draft),
      )
      draftContentConflictNotifiedRef.current.delete(hotCopyProjectKey(context.workspaceId, context.projectId))
    },
  )

  const setJobPhase = (context: HotCopyJobContext | undefined, phase: string) => {
    if (!context || isJobUiActive(context)) setHotCopyPhase(phase)
  }

  const createRecoveryJobContext = (
    ws: number,
    pid: number,
    taskId: number,
    operationCode?: HotCopyTaskOperation,
    generationId = '',
  ): HotCopyJobContext => {
    const draft = ws ? loadCurrentHotCopyDraft(ws) : null
    const record = mergeGenRecords(videoGenerationsRef.current, draft?.videoGenerations).find(
      (item) =>
        (generationId && item.id === generationId) ||
        (taskId > 0 && Number(item.taskId || 0) === Number(taskId || 0)) ||
        item.status === 'processing',
    )
    const generation: ReservedGen = record
      ? {
          id: record.id,
          note: record.note,
          modificationNote: record.modificationNote,
          createdAt: record.createdAt,
        }
      : {
          id: generationId || (taskId > 0 ? `task-${taskId}` : `resume-${pid}`),
          note: '恢复生成',
          modificationNote: '',
          createdAt: Date.now(),
        }
    const storedTask = useTaskCenterStore
      .getState()
      .tasks.find(
        (task) =>
          task.scope === 'hot-copy' &&
          task.workspaceId === ws &&
          task.projectId === pid &&
          ((taskId > 0 && task.taskId === taskId) || (generation.id && task.generationId === generation.id)),
      )
    const resolvedOperationCode: HotCopyTaskOperation =
      operationCode || (storedTask?.operationCode === 'video.edit' ? 'video.edit' : 'video.replicate')
    return createJobContext({
      epoch: sessionEpochRef.current,
      workspaceId: ws,
      projectId: pid,
      generation,
      operationCode: resolvedOperationCode,
      entryInitial: draft?.entryInitial || entryInitial,
    })
  }

  const persistRecoveryCredential = (context: HotCopyJobContext, progress: HotCopyJobProgress): Promise<void> => {
    const previous = recoveryCredentialWritesRef.current.get(context.taskCenterId) || Promise.resolve()
    const write = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          await persistTrackedHotCopyJobProgress(context, progress)
        } catch {
          // taskId 是刷新后的唯一恢复凭证。短暂网络失败时再写一次，且后续终态保存会等待该写入收口。
          await new Promise<void>((resolve) => window.setTimeout(resolve, 350))
          await persistTrackedHotCopyJobProgress(context, progress)
        }
      })
    recoveryCredentialWritesRef.current.set(context.taskCenterId, write)
    const clearTrackedWrite = () => {
      if (recoveryCredentialWritesRef.current.get(context.taskCenterId) === write) {
        recoveryCredentialWritesRef.current.delete(context.taskCenterId)
      }
    }
    void write.then(clearTrackedWrite, clearTrackedWrite)
    return write
  }

  const completeHotCopyJob = (
    context: HotCopyJobContext,
    video: { url: string; assetId: number },
    taskId = 0,
  ): Promise<void> => {
    const safeVideo = {
      url: String(video?.url || ''),
      assetId: Number(video?.assetId || 0) || 0,
    }
    const safeTaskId = Number(taskId || 0) || 0
    const completionKey =
      safeTaskId > 0 ? `hot-copy:${context.workspaceId}:${context.projectId}:task:${safeTaskId}` : context.taskCenterId
    // 先登记终态屏障，再排结果 PUT。这样随后触发的卸载 flush 也只能写入该结果，不能用旧 processing 快照覆盖。
    terminalJobResultsRef.current.set(context.projectId, {
      ...safeVideo,
      generationId: context.generationId,
      taskId: safeTaskId,
    })

    let completion = hotCopyCompletionPromises.get(completionKey)
    if (!completion) {
      completion = (async () => {
        const pendingCredential = recoveryCredentialWritesRef.current.get(context.taskCenterId)
        if (pendingCredential) await pendingCredential.catch(() => undefined)
        const persisted = await persistHotCopyJobResult(context, safeVideo, safeTaskId)
        if (!persisted) throw new Error('生成结果未能写入当前爆款项目，请重新进入项目后重试')
      })()
      hotCopyCompletionPromises.set(completionKey, completion)
      void completion.catch(() => {
        if (hotCopyCompletionPromises.get(completionKey) === completion) {
          hotCopyCompletionPromises.delete(completionKey)
        }
      })
    }
    return completion.then(
      async () => {
        // 结果落库除任务/视频元数据外也可能更新修改意见；先接纳这次成功写入再触发自动保存，
        // 否则页面会把自己的完成回调误判为其他编辑器产生的内容冲突。
        await fetchRevision(context.projectId, context.workspaceId, { acceptCreativeContent: true })
        terminalJobStatusRef.current.set(context.taskCenterId, 'succeeded')
        patchHotCopyTaskCenter(context, {
          status: 'succeeded',
          taskId: safeTaskId,
          progress: 100,
          resultUrl: safeVideo.url,
          resultAssetId: safeVideo.assetId,
          error: '',
        })
        const uiCommitKey = `${context.taskCenterId}:${context.epoch}`
        if (isJobUiActive(context) && !completedJobUiKeysRef.current.has(uiCommitKey)) {
          completedJobUiKeysRef.current.add(uiCommitKey)
          commitGeneratedVideo(context.workspaceId, safeVideo, safeTaskId, context.generationId, context)
        }
      },
      () => {
        // Provider 视频已经完成，只是项目草稿暂未写入。保持任务为 active，让全局 Coordinator
        // 按同一个 taskId 继续重试；不能把一条已成功的视频误标为“生成失败”。
        patchHotCopyTaskCenter(context, {
          status: 'reconnecting',
          taskId: safeTaskId,
          progress: 99,
          resultUrl: safeVideo.url,
          resultAssetId: safeVideo.assetId,
          error: '视频已生成，正在后台保存到项目',
        })
        const uiCommitKey = `${context.taskCenterId}:${context.epoch}`
        if (isJobUiActive(context) && !completedJobUiKeysRef.current.has(uiCommitKey)) {
          completedJobUiKeysRef.current.add(uiCommitKey)
          commitGeneratedVideo(context.workspaceId, safeVideo, safeTaskId, context.generationId, context)
          showToast('视频已生成，正在后台保存到项目', 'info')
        }
      },
    )
  }

  const failHotCopyJob = async (
    context: HotCopyJobContext,
    status: 'failed' | 'cancelled' | 'reconnecting',
    error = '',
    taskId = 0,
  ): Promise<boolean> => {
    const safeTaskId = Number(taskId || 0) || 0
    const hasSucceeded = (): boolean => {
      const terminalStatus = terminalJobStatusRef.current.get(context.taskCenterId)
      const task = useTaskCenterStore.getState().tasks.find((item) => item.id === context.taskCenterId)
      const completedResult = terminalJobResultsRef.current.get(context.projectId)
      return Boolean(
        terminalStatus === 'succeeded' ||
        task?.status === 'succeeded' ||
        (completedResult &&
          completedResult.generationId === context.generationId &&
          (!safeTaskId || !completedResult.taskId || completedResult.taskId === safeTaskId)),
      )
    }
    if (hasSucceeded()) return false

    if (status === 'reconnecting') {
      patchHotCopyTaskCenter(context, { status, taskId: safeTaskId, error })
      const progress = { status, taskId: safeTaskId, error } as HotCopyJobProgress
      try {
        if (safeTaskId > 0) await persistRecoveryCredential(context, progress)
        else await persistTrackedHotCopyJobProgress(context, progress)
        return true
      } catch {
        return false
      }
    }

    const terminalStatus = terminalJobStatusRef.current.get(context.taskCenterId)
    if (terminalStatus === status) return true
    if (hasSucceeded()) return false

    // 先保留 active 状态。只有锁定项目的终态草稿真正写成功后，任务中心才可显示失败/取消。
    patchHotCopyTaskCenter(context, {
      status: 'reconnecting',
      taskId: safeTaskId,
      error: error || '任务终态正在同步',
    })

    const existingPersistence = terminalJobPersistenceRef.current.get(context.taskCenterId)
    if (existingPersistence) return existingPersistence

    const persistence = (async (): Promise<boolean> => {
      const pendingCredential = recoveryCredentialWritesRef.current.get(context.taskCenterId)
      if (pendingCredential) await pendingCredential.catch(() => undefined)
      // 恢复凭证等待写入期间任务可能已经成功，成功终态优先，不再补写失败状态。
      if (hasSucceeded()) return false
      const persisted = await persistHotCopyTerminalStateToBackend({
        projectId: context.projectId,
        workspaceId: context.workspaceId,
        taskId: safeTaskId,
        generationId: context.generationId,
        status,
        error,
      }).catch(() => false)
      if (!persisted) return false

      // Provider 成功结果/Coordinator 可能与晚到的 catch 竞争；成功终态永远优先。
      const latestTask = useTaskCenterStore.getState().tasks.find((task) => task.id === context.taskCenterId)
      const latestResult = terminalJobResultsRef.current.get(context.projectId)
      if (
        latestTask?.status === 'succeeded' ||
        (latestResult &&
          latestResult.generationId === context.generationId &&
          (!safeTaskId || !latestResult.taskId || latestResult.taskId === safeTaskId))
      ) {
        return false
      }

      terminalJobStatusRef.current.set(context.taskCenterId, status)
      patchHotCopyTaskCenter(context, { status, taskId: 0, error })
      return true
    })()
    terminalJobPersistenceRef.current.set(context.taskCenterId, persistence)
    try {
      return await persistence
    } finally {
      if (terminalJobPersistenceRef.current.get(context.taskCenterId) === persistence) {
        terminalJobPersistenceRef.current.delete(context.taskCenterId)
      }
    }
  }

  const loadCurrentHotCopyDraft = useLatestCallback((ws: number): HotCopyDraft | null => {
    const draft = loadHotCopyDraft(ws)
    if (!draft) return null
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    if (pid <= 0) return draft
    return Number(draft.projectId || 0) === pid ? draft : null
  })

  const bindRunningVideoPromise = (
    p: Promise<VideoGenResult>,
    metadata: {
      taskId?: number
      generationId?: string
      status?: 'preparing' | 'processing' | 'reconnecting'
      context?: HotCopyJobContext
    } = {},
  ) => {
    const context = metadata.context
    if (!context || isJobUiActive(context)) runningVideoPromiseRef.current = p
    const pid = Number(context?.projectId || projectIdRef.current || 0) || 0
    const tracked =
      pid > 0
        ? trackVideoGen('hot-copy', Number(context?.workspaceId || workspaceId || 0) || 0, pid, p, {
            taskId: Number(metadata.taskId || 0) || 0,
            generationId: String(metadata.generationId || context?.generationId || ''),
            status: metadata.status || 'preparing',
          })
        : p
    const clearTrackedPromise = () => {
      if (runningVideoPromiseRef.current === tracked || runningVideoPromiseRef.current === p) {
        runningVideoPromiseRef.current = null
      }
    }
    void tracked.then(clearTrackedPromise, clearTrackedPromise)
    return tracked
  }

  const subscribeRunningVideo = useLatestCallback((projectId: number, restoredTaskId = 0): boolean => {
    const pid = Number(projectId || 0) || 0
    const ws = Number(workspaceId || 0) || 0
    const inflight = pid > 0 ? getRunningVideoGen('hot-copy', ws, pid) : null
    if (!inflight) return false
    const draft = ws ? loadCurrentHotCopyDraft(ws) : null
    const registryMeta = getRunningVideoGenMeta('hot-copy', ws, pid)
    const registryTaskId = Number(registryMeta?.taskId || 0) || 0
    const taskId = Number(registryTaskId || restoredTaskId || draft?.vidGenTaskId || vidGenTaskId || 0) || 0
    const context = createRecoveryJobContext(ws, pid, taskId, undefined, String(registryMeta?.generationId || ''))
    upsertHotCopyTaskCenter(context, 'processing', { taskId })
    runningVideoPromiseRef.current = inflight
    setVidGenRunning(true)
    setVidGenTaskId(taskId)
    persistNow({ videoGenerating: true, vidGenTaskId: taskId })
    let keepPending = false
    inflight
      .then(({ url, assetId }) => completeHotCopyJob(context, { url, assetId }, taskId))
      .catch(async (e: any) => {
        if (isAbortedTaskError(e)) {
          keepPending = true
          void failHotCopyJob(context, 'reconnecting', e?.message || '任务等待已中断，正在恢复', taskId)
          if (isJobUiActive(context) && ws && taskId) scheduleResumeVideoTask(ws, taskId)
          return
        }
        if (isJobUiActive(context) && keepVideoTaskForReconnect(e, ws, taskId)) {
          keepPending = true
          void failHotCopyJob(context, 'reconnecting', e?.message || '任务状态查询异常', taskId)
          return
        }
        const cancelled = isTaskCancelled(e)
        const terminalPersisted = await failHotCopyJob(
          context,
          cancelled ? 'cancelled' : 'failed',
          e?.message || '请重试',
          taskId,
        )
        keepPending = !terminalPersisted
        if (terminalPersisted && isJobUiActive(context)) {
          persistNow({ videoGenerating: false })
          if (isTaskCancelled(e)) {
            markGen(null, 'cancelled')
            showToast('视频生成已中断', 'info')
          } else {
            markGen(null, 'failed')
            showToast(`视频生成失败:${e?.message || '请重试'}`, 'error')
          }
        }
      })
      .finally(() => {
        if (runningVideoPromiseRef.current === inflight) runningVideoPromiseRef.current = null
        if (keepPending) return
        if (isJobUiActive(context)) {
          persistNow({ videoGenerating: false, vidGenTaskId: 0 })
          setVidGenRunning(false)
          setVidGenTaskId(0)
        }
      })
    return true
  })

  // 从「项目管理 → 新建视频」进入:沿用原项目名 + 携带上传素材(源视频/替换素材)+ 绑定同一项目(不新建重复项目)。
  // 全新流程:不恢复旧草稿,仅把素材预填入口;生成保存到同一 projectId(覆盖其草稿)。
  useEffect(() => {
    const { state: st, routeId: initialRouteId } = initialNavigationRef.current
    if (!st || initialRouteId > 0) return // /hot-copy/:id 走恢复;此分支仅用于无 id 的全新流程
    if (typeof st.newProjectName === 'string' && st.newProjectName.trim()) {
      setProjectName(st.newProjectName.trim())
      nameTouchedRef.current = true
      setNameTouched(true)
    }
    // 上传素材已在 entryInitial 初始化器同步读入(见上),此处不再 setEntryInitial
    if (Number(st.restartProjectId)) {
      projectIdRef.current = Number(st.restartProjectId)
      setProjectId(Number(st.restartProjectId))
      serverTitleRef.current = ''
    }
    // 仅 mount 注入一次；路由首帧值已冻结在 initialNavigationRef，后续 history.state 变化不重复注入。
  }, [])

  // 续等在途视频任务并回填(本地恢复 / 后端恢复共用)
  const resumeVideoTask = useLatestCallback((ws: number, taskId: number) => {
    if (!ws || !taskId) return
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const existing = pid > 0 ? getRunningVideoGen('hot-copy', ws, pid) : null
    if (existing) {
      if (existing !== runningVideoPromiseRef.current) subscribeRunningVideo(pid)
      return
    }
    const context = createRecoveryJobContext(ws, pid, taskId)
    upsertHotCopyTaskCenter(context, 'reconnecting', { taskId })
    setVidGenTaskId(taskId)
    setVidGenRunning(true)
    setHotCopyPhase('正在恢复生成任务…')
    persistNow({ videoGenerating: true, vidGenTaskId: taskId })
    const ctrl = new AbortController()
    vidGenAbortRef.current = ctrl
    let keepPending = false
    const inflight = bindRunningVideoPromise(
      awaitHotVideoResult({
        workspaceId: ws,
        taskId,
        signal: ctrl.signal,
        onProgress: (progress) => patchHotCopyTaskCenter(context, { status: 'processing', progress, error: '' }),
      }),
      {
        taskId,
        status: 'reconnecting',
        context,
      },
    )
    inflight
      .then(({ url, assetId }) => completeHotCopyJob(context, { url, assetId }, taskId))
      .catch(async (e: any) => {
        if (isAbortedTaskError(e)) {
          keepPending = true
          void failHotCopyJob(context, 'reconnecting', e?.message || '任务等待已中断，正在恢复', taskId)
          if (isJobUiActive(context)) scheduleResumeVideoTask(ws, taskId)
          return
        }
        if (isJobUiActive(context) && keepVideoTaskForReconnect(e, ws, taskId)) {
          keepPending = true
          void failHotCopyJob(context, 'reconnecting', e?.message || '任务状态查询异常', taskId)
          return
        }
        const cancelled = isTaskCancelled(e)
        const message = e?.message || '请重试'
        const terminalPersisted = await failHotCopyJob(context, cancelled ? 'cancelled' : 'failed', message, taskId)
        keepPending = !terminalPersisted
        if (!terminalPersisted || !isJobUiActive(context)) return
        persistNow({ videoGenerating: false, vidGenTaskId: 0 })
        if (cancelled) {
          markGen(null, 'cancelled')
          showToast('视频生成已中断', 'info')
        } else {
          markGen(null, 'failed')
          showToast(`视频生成失败:${message}`, 'error')
        }
      })
      .finally(() => {
        if (!keepPending && isJobUiActive(context)) {
          persistNow({ videoGenerating: false, vidGenTaskId: 0 })
          setVidGenRunning(false)
          setVidGenTaskId(0)
        }
      })
  })

  const scheduleResumeVideoTask = useLatestCallback((ws: number, taskId: number) => {
    const id = Number(taskId || 0) || 0
    if (!ws || !id || !aliveRef.current) return
    if (resumeRetryTimerRef.current) return
    resumeRetryTimerRef.current = window.setTimeout(() => {
      resumeRetryTimerRef.current = 0
      if (!aliveRef.current || runningVideoPromiseRef.current) return
      const draft = loadCurrentHotCopyDraft(ws)
      const draftTaskId = Number(draft?.vidGenTaskId || 0) || 0
      if (draftTaskId === id) resumeVideoTask(ws, id)
    }, 1200)
  })

  // task 已创建后，轮询链路的临时 5xx/断网不能把后端仍在运行的任务标成失败。
  // 仅在确实拿到 taskId 时保留生成态；建任务前的失败仍按普通错误处理，避免制造假任务。
  const keepVideoTaskForReconnect = useLatestCallback((error: any, ws: number, fallbackTaskId = 0): boolean => {
    if (!isTransientTaskRecoveryError(error)) return false
    const taskId = Number(loadCurrentHotCopyDraft(ws)?.vidGenTaskId || fallbackTaskId || vidGenTaskId || 0) || 0
    if (!taskId) return false
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    updateRunningVideoGenMeta('hot-copy', ws, pid, { taskId, status: 'reconnecting' })
    persistNow({ videoGenerating: true, vidGenTaskId: taskId })
    if (aliveRef.current) {
      setVidGenRunning(true)
      setVidGenTaskId(taskId)
      setHotCopyPhase('任务状态查询异常，正在重新连接…')
    }
    scheduleResumeVideoTask(ws, taskId)
    return true
  })

  const stopPendingTaskIdPolling = useCallback(() => {
    if (!vidGenPendingTimerRef.current) return
    window.clearInterval(vidGenPendingTimerRef.current)
    vidGenPendingTimerRef.current = 0
  }, [])

  const reconcilePendingTaskId = useLatestCallback((ws: number): HotCopyPendingRecoveryAction => {
    if (!ws || !aliveRef.current) return 'stop'
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    if (pid > 0 && subscribeRunningVideo(pid)) return 'stop'

    const draft = loadCurrentHotCopyDraft(ws)
    // 其他标签页或后台回调写入终态快照后，其中已清理的生成列表必须优先于当前渲染的旧 processing 状态，
    // 否则结果恢复分支会一直被旧状态挡住。
    const generations = Array.isArray((draft as any)?.videoGenerations)
      ? normalizeGenRecords((draft as any).videoGenerations)
      : videoGenerationsRef.current
    const hasResult = hasVideoResult(draft?.fullVideo, draft?.videoVersions)
    const decision = resolveHotCopyPendingRecovery({
      generations,
      taskId: Number(draft?.vidGenTaskId || vidGenTaskId || 0) || 0,
      videoGenerating: Boolean(draft?.videoGenerating || vidGenRunning),
      hasResult,
    })

    if (decision.action === 'wait') return 'wait'

    if (decision.action === 'recover-result') {
      const recovered =
        draft?.fullVideo && hasVideoResult(draft.fullVideo)
          ? draft.fullVideo
          : Array.isArray(draft?.videoVersions)
            ? draft.videoVersions[draft.videoVersions.length - 1]
            : null
      if (recovered && hasVideoResult(recovered)) {
        commitGeneratedVideo(
          ws,
          { url: String(recovered.url || ''), assetId: Number(recovered.assetId || 0) || 0 },
          decision.taskId,
        )
      } else {
        setVidGenRunning(false)
        setVidGenTaskId(0)
        setHotCopyPhase('')
      }
      return 'recover-result'
    }

    if (decision.action === 'resume-task') {
      resumeVideoTask(ws, decision.taskId)
      return 'resume-task'
    }

    if (decision.action === 'fail') {
      failStaleGenerations('生成请求未创建成功，请重新生成')
      return 'fail'
    }

    setVideoGenerations(normalizeGenRecords((draft as any)?.videoGenerations))
    setVidGenRunning(false)
    setVidGenTaskId(0)
    setHotCopyPhase('')
    return 'stop'
  })

  const ensurePendingTaskId = useLatestCallback((ws: number) => {
    if (!ws) return
    const action = reconcilePendingTaskId(ws)
    if (action !== 'wait') {
      stopPendingTaskIdPolling()
      return
    }
    if (vidGenPendingTimerRef.current) return
    vidGenPendingTimerRef.current = window.setInterval(() => {
      if (reconcilePendingTaskId(ws) !== 'wait') stopPendingTaskIdPolling()
    }, 800)
  })

  // ── 进入恢复(对齐智能成片) ──
  // A) /hot-copy/:id → 从后端项目草稿恢复(权威,进项目管理后重开走这条);
  // B) /hot-copy(无 id):本地草稿若是「在制项目」→ 跳回 /hot-copy/:id;否则按本地会话恢复(不回入口)。
  const hydratedRef = useRef(false)
  const hydrationTargetRef = useRef('')
  const hydrationRequestRef = useRef(0)
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const hydrationTarget = `${ws}:${routeId}:${projectLoadRetry}`
    const isInPlaceRouteBinding =
      routeId > 0 &&
      routeBindingProjectIdRef.current === routeId &&
      Number(projectIdRef.current || 0) === routeId &&
      Number(workspaceIdRef.current || 0) === ws &&
      hydratedRef.current
    if (isInPlaceRouteBinding) {
      hydrationTargetRef.current = hydrationTarget
      routeBindingProjectIdRef.current = 0
      return
    }
    if (hydrationTargetRef.current !== hydrationTarget) {
      hydrationTargetRef.current = hydrationTarget
      hydrationRequestRef.current += 1
      hydratedRef.current = false
      sessionEpochRef.current += 1
      runningVideoPromiseRef.current = null
      vidGenAbortRef.current = null
      nameAbortRef.current?.abort()
      nameAbortRef.current = null
      setNaming(false)
      pendingAutoTitleRef.current = ''
      pendingTitleSaveRef.current = ''
      titleSaveFailedRef.current = false
      autoNameResumeKeyRef.current = ''
      if (vidGenPendingTimerRef.current) {
        window.clearInterval(vidGenPendingTimerRef.current)
        vidGenPendingTimerRef.current = 0
      }
      if (resumeRetryTimerRef.current) {
        window.clearTimeout(resumeRetryTimerRef.current)
        resumeRetryTimerRef.current = 0
      }
      clearStaleGenTimer()
      genTriggerLockRef.current = false
      setGenTriggerBusy(false)
      setVidGenRunning(false)
      setVidGenTaskId(0)
      clearPendingUiGeneration()
    }
    const hydrationRequest = hydrationRequestRef.current
    const hydrationEpoch = sessionEpochRef.current
    const isHydrationCurrent = () =>
      aliveRef.current &&
      hydrationTargetRef.current === hydrationTarget &&
      hydrationRequestRef.current === hydrationRequest &&
      sessionEpochRef.current === hydrationEpoch
    if (hydratedRef.current) return
    if (isCheckingSession) return
    if (!ws) {
      if (!isAuthenticated && routeId === 0) {
        hydratedRef.current = true
        setProjectLoading(false)
      }
      return
    }

    // 全新流程,不恢复本地在制草稿、不跳回旧进度(清掉旧本地草稿,避免把页面带回上次未完成的步骤):
    //   ① 项目管理 → 新建视频(restartProjectId);② 主页/模板「做同款」(carryVideo / carryImages)。
    // 绑定项目 + 携带素材由 初始化器 / 上面的注入 effect 处理。
    const navSt = (location.state as any) || {}
    if (routeId === 0 && !Number(navSt.restartProjectId)) {
      projectIdRef.current = 0
      draftRevisionRef.current = 0
      setProjectId(0)
    }
    // 「创建新视频」只是让当前页面脱离旧任务；旧任务仍在任务中心继续跑。
    // 因此进入空白 /hot-copy 时，不能再被 running registry 自动带回旧项目。
    if (navSt.taskCenterNewSession) {
      clearHotCopyDraft(ws)
      setVideoModificationDraft(createEmptyVideoModificationDraft())
      hydratedRef.current = true
      setProjectLoading(false)
      return
    }
    if (navSt.workspaceSwitchReset) {
      setVideoModificationDraft(createEmptyVideoModificationDraft())
      hydratedRef.current = true
      setProjectLoading(false)
      navigate('/hot-copy', { replace: true })
      return
    }
    const hasCarry =
      (navSt.carryVideo && (navSt.carryVideo.url || navSt.carryVideo.assetId)) ||
      (Array.isArray(navSt.carryImages) && navSt.carryImages.length > 0)
    const restartProjectId = Number(navSt.restartProjectId || 0) || 0
    if (routeId === 0 && restartProjectId > 0) {
      clearHotCopyDraft(ws)
      setVideoModificationDraft(createEmptyVideoModificationDraft())
      projectIdRef.current = restartProjectId
      setProjectId(restartProjectId)
      setProjectLoading(true)
      setProjectLoadError('')
      waitForCreativeProjectDraftSaves({ projectId: restartProjectId, workspaceId: ws })
        .then(() => getCreativeProject({ projectId: restartProjectId, workspaceId: ws }))
        .then((project: any) => {
          if (!isHydrationCurrent()) return
          if (blockRestrictedProject(project, restartProjectId, ws)) return
          const projectKey = hotCopyProjectKey(ws, restartProjectId)
          const projectDraft = project?.draft_json ?? project?.data?.draft_json ?? project?.draft
          const revision = Number(project?.draft_revision ?? project?.data?.draft_revision ?? 0) || 0
          rememberProjectRevision(restartProjectId, ws, revision)
          baseDraftContentFingerprintByProjectRef.current.set(
            projectKey,
            createCreativeDraftContentFingerprint(projectDraft),
          )
          draftContentConflictNotifiedRef.current.delete(projectKey)
          const parsedProjectDraft = getCreativeProjectDraft(project)
          projectVideoStoreRef.current = parsedProjectDraft?.projectVideoStore ?? null
          const serverTitle = String(project?.title || project?.name || '').trim()
          serverTitleRef.current = serverTitle
          if (!String(navSt.newProjectName || '').trim() && serverTitle) setProjectName(serverTitle)
          hydratedRef.current = true
          setProjectLoading(false)
          routeBindingProjectIdRef.current = restartProjectId
          navigate(`/hot-copy/${restartProjectId}`, {
            replace: true,
            state: { hotCopyProjectBound: true },
          })
        })
        .catch((error: any) => {
          if (!isHydrationCurrent()) return
          const message = error?.message || '项目加载失败'
          setProjectLoadError(message)
          setProjectLoading(false)
          showToast(message, 'error')
        })
      return
    }
    if (routeId === 0 && hasCarry) {
      clearHotCopyDraft(ws)
      setVideoModificationDraft(createEmptyVideoModificationDraft())
      hydratedRef.current = true
      setProjectLoading(false)
      return
    }

    if (routeId > 0) {
      hydratedRef.current = false
      projectIdRef.current = routeId
      setProjectLoading(true)
      setProjectLoadError('')
      waitForCreativeProjectDraftSaves({ projectId: routeId, workspaceId: ws })
        .then(() => getCreativeProject({ projectId: routeId, workspaceId: ws }))
        .then((proj: any) => {
          if (!isHydrationCurrent()) return
          if (blockRestrictedProject(proj, routeId, ws)) return
          const restoredDraftValue = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
          const draftInspection = inspectHotCopyProjectDraft(restoredDraftValue)
          if (!isAcceptedHotCopyProjectDraft(draftInspection)) {
            // 不加载、也不自动保存属于其他创作流程的项目；同时解除可变项目绑定，
            // 防止卸载补写和已排队回调误写这个项目。
            hydratedRef.current = false
            projectIdRef.current = 0
            draftRevisionRef.current = 0
            setProjectId(0)
            detachRunningVideoGen('hot-copy', ws, routeId)
            const localCandidate = loadHotCopyDraft(ws)
            if (Number(localCandidate?.projectId || 0) === routeId) clearHotCopyDraft(ws)

            if (draftInspection.kind === 'foreign' && draftInspection.flow === 'smart') {
              setProjectLoading(false)
              showToast('该项目属于智能成片，已为你切换到对应编辑器', 'info')
              navigate(`/smart/${routeId}`, { replace: true })
              return
            }

            const message =
              draftInspection.kind === 'invalid'
                ? '项目草稿格式无效，为避免覆盖原内容，已停止加载'
                : draftInspection.flow
                  ? `该项目流程“${draftInspection.flow}”不属于爆款复制，请从项目管理打开正确的编辑器`
                  : '无法确认该项目属于爆款复制，为避免覆盖原内容，已停止加载'
            setProjectLoadError(message)
            setProjectLoading(false)
            return
          }

          setProjectId(routeId)
          setVideoModificationDraft(createEmptyVideoModificationDraft())
          const restoredRevision = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
          draftRevisionRef.current = restoredRevision
          const projectKey = hotCopyProjectKey(ws, routeId)
          draftRevisionByProjectRef.current.set(projectKey, restoredRevision)
          baseDraftContentFingerprintByProjectRef.current.set(
            projectKey,
            createCreativeDraftContentFingerprint(restoredDraftValue),
          )
          draftContentConflictNotifiedRef.current.delete(projectKey)
          const smart = draftInspection.smart
          const obj = draftInspection.obj
          const localCandidate = loadHotCopyDraft(ws)
          const localDraft =
            Number(localCandidate?.projectId || 0) === routeId ? (localCandidate as HotCopyDraft) : null
          const localFallback = draftInspection.kind === 'empty' ? localDraft : null
          const localProcessing = normalizeGenRecords((localDraft as any)?.videoGenerations).filter(
            (g) => g.status === 'processing',
          )
          const rawEntryInitial =
            smart.entryInitial && typeof smart.entryInitial === 'object'
              ? (smart.entryInitial as Partial<HotCopyEntryPayload>)
              : localDraft?.entryInitial
          const backendSourceVideo =
            smart.sourceVideo && typeof smart.sourceVideo === 'object' ? smart.sourceVideo : null
          const sourceSeed = {
            assetId: Number(backendSourceVideo?.assetId || localDraft?.sourceVideo?.assetId || 0) || 0,
            url: String(backendSourceVideo?.url || localDraft?.sourceVideo?.url || ''),
          }
          let restoredSourceVideo = resolveHotCopySourceVideo(sourceSeed, rawEntryInitial)
          if (!restoredSourceVideo.assetId && localDraft?.entryInitial) {
            restoredSourceVideo = resolveHotCopySourceVideo(restoredSourceVideo, localDraft.entryInitial)
          }
          let restoredProductAssetIds = resolveHotCopyProductAssetIds(
            Array.isArray(smart.productAssetIds) ? smart.productAssetIds : localDraft?.productAssetIds,
            rawEntryInitial,
          )
          if (!restoredProductAssetIds.length && localDraft?.entryInitial) {
            restoredProductAssetIds = resolveHotCopyProductAssetIds(localDraft.productAssetIds, localDraft.entryInitial)
          }
          const restoredEntryInitial = withResolvedHotCopyAssets(
            rawEntryInitial,
            restoredSourceVideo,
            restoredProductAssetIds,
          )
          const restoredBasePrompt = String(smart.basePrompt || obj.description || localFallback?.basePrompt || '')
          const restoredNameTouched = Boolean(smart.nameTouched || localFallback?.nameTouched)
          const restoredGenDurationSec =
            parseDurationSeconds(smart.genDurationSec || localFallback?.genDurationSec) || DEFAULT_DURATION_SEC
          const restoredSourceDuration = resolveStoredSourceDuration(restoredSourceVideo.assetId, smart, localDraft)
          // 留存项目视频清单存档(归类记录),保存时原样写回,避免被本编辑器的草稿快照覆盖
          projectVideoStoreRef.current = obj && typeof obj === 'object' ? obj.projectVideoStore || null : null
          const restoredStarted = resolveHotCopyRestoredStarted(smart, obj)
          const restoredStep = restoredStarted ? Math.max(1, Number(smart.step || 1) || 1) : 0
          const restoredMaxReached = Math.max(Number(smart.maxReached || 0) || 0, restoredStarted ? restoredStep : 0)
          setStarted(restoredStarted)
          setStep(restoredStep)
          setMaxReached(restoredMaxReached)
          setBasePrompt(restoredBasePrompt)
          nameTouchedRef.current = restoredNameTouched
          setNameTouched(nameTouchedRef.current)
          setSourceVideo(restoredSourceVideo)
          setSourceVideoDurSec(restoredSourceDuration)
          setSourceVideoDurAssetId(restoredSourceDuration ? restoredSourceVideo.assetId : 0)
          setProductAssetIds(restoredProductAssetIds)
          const fv = {
            url: String(smart.fullVideoUrl || obj.generatedVideoUrl || localFallback?.fullVideo?.url || ''),
            assetId:
              Number(smart.fullVideoAssetId || obj.generatedVideoAssetId || localFallback?.fullVideo?.assetId || 0) ||
              0,
          }
          setFullVideo(fv)
          const rawVers =
            Array.isArray(smart.videoVersions) && smart.videoVersions.length
              ? smart.videoVersions
              : Array.isArray(obj.videoHistoryList)
                ? obj.videoHistoryList
                : Array.isArray(localFallback?.videoVersions)
                  ? localFallback.videoVersions
                  : []
          const restoredVersions = mergeVideoVersions(rawVers, fv)
          const restoredVideoModificationDraft = parseVideoModificationDraft(
            smart.videoModificationDraft ?? localDraft?.videoModificationDraft,
          )
          const restoredHasResult = hasVideoResult(restoredVersions, fv)
          const restoredBackendTaskId = Number(smart.vidGenTaskId || 0) || 0
          const restoredLocalTaskId = Number(localDraft?.vidGenTaskId || 0) || 0
          const restoredGenerationSeed = mergeGenRecords((smart as any)?.videoGenerations, localProcessing)
          const restoredRecordTaskId =
            Number(
              restoredGenerationSeed.find((g) => g.status === 'processing' && Number(g.taskId || 0) > 0)?.taskId,
            ) || 0
          const restoredTaskId = restoredBackendTaskId || restoredLocalTaskId || restoredRecordTaskId
          const restoredIsGenerating = Boolean(
            restoredTaskId > 0 ||
            getRunningVideoGen('hot-copy', ws, routeId) ||
            ((smart.videoGenerating || localDraft?.videoGenerating) &&
              hasRecentPreparingGeneration(restoredGenerationSeed)),
          )
          const restoredGenerations = restoreGenerationRecords(
            restoredGenerationSeed,
            restoredHasResult,
            restoredIsGenerating,
          )
          setVideoVersions(restoredVersions)
          setVideoModificationDraft(restoredVideoModificationDraft)
          setVideoGenerations(restoredGenerations)
          setVidGenRunning(restoredIsGenerating)
          setVidGenTaskId(restoredIsGenerating ? restoredTaskId : 0)
          if (restoredIsGenerating && !restoredTaskId) setHotCopyPhase('素材准备中…')
          if (smart.genRatio || localFallback?.genRatio) setGenRatio(String(smart.genRatio || localFallback?.genRatio))
          setGenDurationSec(restoredGenDurationSec)
          const t = String(proj?.title || proj?.name || '').trim()
          const restoredTitle = t || String(smart.projectName || localFallback?.projectName || '').trim()
          const restoredProjectName = repairLegacyHotCopyProjectName({
            title: restoredTitle,
            requirement: String(restoredEntryInitial?.text || restoredBasePrompt || restoredTitle),
            durationSec: restoredGenDurationSec,
            nameTouched: restoredNameTouched,
          })
          if (restoredProjectName) {
            setProjectName(restoredProjectName)
            if (restoredProjectName !== restoredTitle) pendingAutoTitleRef.current = restoredProjectName
          }
          serverTitleRef.current = t
          // 项目内容以后端草稿为权威；本地只在后端没有草稿或缺少在途任务凭证时兜底。
          if (restoredEntryInitial) setEntryInitial(restoredEntryInitial)
          const pendingTask = restoredIsGenerating ? restoredTaskId : 0
          hydratedRef.current = true
          // 直接用本次 GET 的恢复值重建本地草稿，不能调用捕获上一项目 render state 的 persistNow。
          saveHotCopyDraft(ws, {
            entryInitial: restoredEntryInitial,
            projectId: routeId,
            started: restoredStarted,
            step: restoredStep,
            maxReached: restoredMaxReached,
            basePrompt: restoredBasePrompt,
            projectName: restoredProjectName || '未命名项目',
            nameTouched: restoredNameTouched,
            sourceVideo: restoredSourceVideo,
            sourceVideoDurationSec: restoredSourceDuration,
            sourceVideoDurationAssetId: restoredSourceDuration ? restoredSourceVideo.assetId : 0,
            originalProductAssetIds: resolveHotCopyOriginalProductAssetIds(
              restoredEntryInitial,
              smart.originalProductAssetIds || localDraft?.originalProductAssetIds,
            ),
            productAssetIds: restoredProductAssetIds,
            fullVideo: fv,
            videoVersions: restoredVersions,
            videoModificationDraft: restoredVideoModificationDraft,
            videoGenerating: restoredIsGenerating,
            vidGenTaskId: pendingTask,
            videoGenerations: restoredGenerations,
            genRatio: String(smart.genRatio || localFallback?.genRatio || DEFAULT_RATIO),
            genDurationSec: restoredGenDurationSec,
          })
          if (restoredVersions.some((item) => Number(item.assetId || 0) > 0)) {
            void (async () => {
              const refreshCache = new Map<number, Promise<string>>()
              const refreshVersion = async (item: VideoVersion): Promise<VideoVersion> => {
                const assetId = Number(item.assetId || 0) || 0
                if (!assetId) return item
                let pending = refreshCache.get(assetId)
                if (!pending) {
                  pending = refreshAssetUrl(ws, assetId).catch(() => '')
                  refreshCache.set(assetId, pending)
                }
                const freshUrl = await pending
                return freshUrl ? { ...item, url: freshUrl } : item
              }
              const refreshedVersions = await Promise.all(restoredVersions.map(refreshVersion))
              if (!isHydrationCurrent()) return
              const refreshedFull =
                refreshedVersions.find((item) => Number(item.assetId || 0) === Number(fv.assetId || 0)) ||
                refreshedVersions[refreshedVersions.length - 1] ||
                fv
              setFullVideo(refreshedFull)
              setVideoVersions(refreshedVersions)
              const currentLocalDraft = loadCurrentHotCopyDraft(ws)
              if (currentLocalDraft && Number(currentLocalDraft.projectId || 0) === routeId) {
                saveHotCopyDraft(ws, {
                  ...currentLocalDraft,
                  fullVideo: refreshedFull,
                  videoVersions: refreshedVersions,
                })
              }
            })()
          }
          const subscribed = subscribeRunningVideo(routeId, pendingTask)
          if (!subscribed && pendingTask > 0) {
            resumeVideoTask(ws, pendingTask)
          } else if (!subscribed && restoredIsGenerating) {
            ensurePendingTaskId(ws)
          }
        })
        .catch((e: any) => {
          if (!isHydrationCurrent()) return
          const status = Number(e?.status || 0)
          if (((location.state as any)?.autoResumed || false) && (status === 403 || status === 404)) {
            clearHotCopyDraft(ws)
            setProjectLoading(false)
            navigate('/hot-copy', { replace: true })
            return
          }
          const message = e?.message || '项目加载失败'
          setProjectLoadError(message)
          showToast(message, 'error')
        })
        .finally(() => {
          if (isHydrationCurrent()) setProjectLoading(false)
        })
      return
    }

    // B) 无 id:同浏览器在制会话 → 直接用本地草稿恢复并续轮询(【不重定向、不重挂载】,
    //    避免打断/丢失正在进行的生成)。后端项目句柄(projectId)也一并恢复,保存继续写后端,
    //    项目管理照样可见。跨设备/全新浏览器的恢复走「项目管理→进入编辑」的 /hot-copy/:id(A 分支)。
    const runningProject = findRunningVideoGen('hot-copy', ws)
    if (
      runningProject?.meta.projectId &&
      !deniedHotCopyProjectKeys.has(hotCopyProjectKey(ws, Number(runningProject.meta.projectId || 0)))
    ) {
      setProjectLoading(true)
      navigate(`/hot-copy/${runningProject.meta.projectId}`, {
        replace: true,
        state: { registryResumed: true },
      })
      return
    }
    const d = loadHotCopyDraft(ws)
    const restoredSourceVideo = resolveHotCopySourceVideo(d?.sourceVideo, d?.entryInitial)
    const restoredProductAssetIds = resolveHotCopyProductAssetIds(d?.productAssetIds, d?.entryInitial)
    const restoredEntryInitial = withResolvedHotCopyAssets(
      d?.entryInitial,
      restoredSourceVideo,
      restoredProductAssetIds,
    )
    const restoredSourceDuration = resolveStoredSourceDuration(restoredSourceVideo.assetId, d)
    if (restoredEntryInitial) setEntryInitial(restoredEntryInitial)
    const restoredLocalGenerations = normalizeGenRecords((d as any)?.videoGenerations)
    const hasProcessing = restoredLocalGenerations.some((g) => g.status === 'processing')
    const hasGeneratingFlag = Boolean(d?.videoGenerating)
    const recordTaskId =
      Number(restoredLocalGenerations.find((g) => g.status === 'processing' && Number(g.taskId || 0) > 0)?.taskId) || 0
    const pendingTaskId = Number(d?.vidGenTaskId || recordTaskId || 0) || 0
    if (d?.started || hasProcessing || pendingTaskId > 0 || hasGeneratingFlag) {
      const pid = Number(d.projectId || 0) || 0
      if (pid) {
        setProjectLoading(true)
        navigate(`/hot-copy/${pid}`, { replace: true, state: { autoResumed: true } })
        return
      }
      hydratedRef.current = true
      setStarted(true)
      setStep(d.step || 1)
      setMaxReached(d.maxReached || 1)
      setBasePrompt(d.basePrompt || '')
      const restoredNameTouched = !!d.nameTouched
      const restoredGenDurationSec = parseDurationSeconds(d.genDurationSec) || DEFAULT_DURATION_SEC
      const restoredProjectName = repairLegacyHotCopyProjectName({
        title: String(d.projectName || ''),
        requirement: String(d.entryInitial?.text || d.basePrompt || d.projectName || ''),
        durationSec: restoredGenDurationSec,
        nameTouched: restoredNameTouched,
      })
      if (restoredProjectName) setProjectName(restoredProjectName)
      if (restoredProjectName && restoredProjectName !== d.projectName) {
        saveHotCopyDraft(ws, { ...d, projectName: restoredProjectName })
      }
      nameTouchedRef.current = restoredNameTouched
      setNameTouched(nameTouchedRef.current)
      setSourceVideo(restoredSourceVideo)
      setSourceVideoDurSec(restoredSourceDuration)
      setSourceVideoDurAssetId(restoredSourceDuration ? restoredSourceVideo.assetId : 0)
      setProductAssetIds(restoredProductAssetIds)
      const restoredFullVideo = d.fullVideo || { url: '', assetId: 0 }
      const restoredVersions = mergeVideoVersions(d.videoVersions, restoredFullVideo)
      const restoredHasResult = hasVideoResult(restoredVersions, restoredFullVideo)
      const restoredIsGenerating = Boolean(
        pendingTaskId > 0 ||
        (pid > 0 && getRunningVideoGen('hot-copy', ws, pid)) ||
        (hasGeneratingFlag && hasRecentPreparingGeneration(restoredLocalGenerations)),
      )
      setFullVideo(restoredFullVideo)
      setVideoVersions(restoredVersions)
      setVideoModificationDraft(parseVideoModificationDraft(d.videoModificationDraft))
      setVideoGenerations(
        restoreGenerationRecords((d as any)?.videoGenerations, restoredHasResult, restoredIsGenerating),
      )
      setVidGenRunning(restoredIsGenerating)
      setVidGenTaskId(restoredIsGenerating ? pendingTaskId : 0)
      if (restoredIsGenerating && !pendingTaskId) {
        setHotCopyPhase('素材准备中…')
        ensurePendingTaskId(ws)
      }
      if (d.genRatio) setGenRatio(String(d.genRatio))
      setGenDurationSec(restoredGenDurationSec)
      // 同会话切回时优先订阅原 Promise；只有登记表不存在时才凭 taskId 恢复，避免同一任务重复轮询。
      const subscribed = pid > 0 && subscribeRunningVideo(pid, pendingTaskId)
      if (!subscribed && pendingTaskId > 0 && restoredIsGenerating) resumeVideoTask(ws, pendingTaskId)
      setProjectLoading(false)
      return
    }
    setVideoModificationDraft(createEmptyVideoModificationDraft())
    hydratedRef.current = true
    setProjectLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, isAuthenticated, isCheckingSession, projectLoadRetry, routeId, workspaceId])

  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && isVideoGenRunning('hot-copy', ws, pid))
    const draft = ws ? loadCurrentHotCopyDraft(ws) : null
    const recoverTaskId =
      Number(vidGenTaskId || videoGenerations.find(isActiveProcessingGen)?.taskId || draft?.vidGenTaskId || 0) || 0
    if (!hasProcessing) {
      clearStaleGenTimer()
      return
    }
    if (hasInflight) {
      clearStaleGenTimer()
      return
    }
    if (recoverTaskId > 0) {
      if (staleGenTimerRef.current) return
      staleGenTimerRef.current = window.setTimeout(() => {
        staleGenTimerRef.current = 0
        if (!aliveRef.current) return
        const latestPid = Number(projectIdRef.current || projectId || 0) || 0
        const latestInflight =
          Boolean(runningVideoPromiseRef.current) ||
          Boolean(latestPid > 0 && isVideoGenRunning('hot-copy', ws, latestPid))
        if (!latestInflight) resumeVideoTask(ws, recoverTaskId)
      }, 3000)
      return clearStaleGenTimer
    }

    const pendingDecision = resolveHotCopyPendingRecovery({
      generations: mergeGenRecords(videoGenerations, (draft as any)?.videoGenerations),
      taskId: recoverTaskId,
      videoGenerating: Boolean(vidGenRunning || draft?.videoGenerating),
      hasResult: hasVideoResult(draft?.fullVideo, draft?.videoVersions, fullVideo, videoVersions),
    })
    if (staleGenTimerRef.current) return
    staleGenTimerRef.current = window.setTimeout(
      () => {
        staleGenTimerRef.current = 0
        if (!aliveRef.current) return
        ensurePendingTaskId(ws)
      },
      Math.max(1, pendingDecision.action === 'wait' ? pendingDecision.delayMs : 1),
    )
    return clearStaleGenTimer
  }, [
    clearStaleGenTimer,
    ensurePendingTaskId,
    fullVideo,
    isActiveProcessingGen,
    loadCurrentHotCopyDraft,
    projectId,
    resumeVideoTask,
    vidGenTaskId,
    vidGenRunning,
    videoGenerations,
    videoVersions,
    workspaceId,
  ])

  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && isVideoGenRunning('hot-copy', ws, pid))
    if (!(vidGenRunning || genTriggerBusy)) return
    // 首次「去制作」在拿到 taskId 前还要上传素材、做人脸脱敏；这段时间由内存态 pending 兜住。
    // 不能把它当成已停止的生成，否则页面会短暂退回「请重新生成视频」并提前解锁操作。
    if (pendingUiGenerationRef.current || hasProcessing || vidGenTaskId > 0 || hasInflight) return
    releaseGenTriggerLock()
    setVidGenRunning(false)
    persistNow({
      videoGenerating: false,
      vidGenTaskId: 0,
      videoGenerations: dropProcessingGenerations(videoGenerations),
    })
  }, [
    genTriggerBusy,
    isActiveProcessingGen,
    persistNow,
    projectId,
    vidGenRunning,
    vidGenTaskId,
    videoGenerations,
    workspaceId,
  ])

  // 状态变更即写回草稿(仅在已水合且已进入流程后,避免用初始空态覆盖已存草稿)
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws || !hydratedRef.current) return
    const hasEntry =
      Boolean(entryInitial?.videoPreview) ||
      Boolean(entryInitial?.text?.trim?.()) ||
      Boolean(entryInitial?.libraryVideo?.assetId || entryInitial?.libraryVideo?.src) ||
      Boolean(entryInitial?.products?.length)
    if (!started && !hasEntry) return
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && isVideoGenRunning('hot-copy', ws, pid))
    const rawTaskId = Number(vidGenTaskId || 0) || 0
    const draftTaskId = rawTaskId > 0 && completedTaskIdsRef.current.has(rawTaskId) ? 0 : rawTaskId
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const hasActiveGeneration = hasProcessing && (draftTaskId > 0 || hasInflight)
    const draftVideoGenerations =
      hasActiveGeneration || !fullVideo.url ? videoGenerations : dropProcessingGenerations(videoGenerations)
    const localDraft = loadCurrentHotCopyDraft(ws)
    const draftVideoVersions = mergeVideoVersions(
      localDraft?.videoVersions,
      videoVersions,
      localDraft?.fullVideo,
      fullVideo,
    )
    const originalProductAssetIds = resolveHotCopyOriginalProductAssetIds(
      entryInitial || localDraft?.entryInitial,
      localDraft?.originalProductAssetIds,
    )
    saveHotCopyDraft(ws, {
      entryInitial,
      projectId: projectIdRef.current || projectId,
      started,
      step,
      maxReached,
      basePrompt,
      projectName,
      nameTouched,
      sourceVideo,
      sourceVideoDurationSec: sourceVideoDurSec,
      sourceVideoDurationAssetId: sourceVideoDurAssetId,
      originalProductAssetIds,
      productAssetIds,
      fullVideo,
      videoVersions: draftVideoVersions,
      videoModificationDraft,
      videoGenerating: hasActiveGeneration,
      vidGenTaskId: hasActiveGeneration ? draftTaskId : 0,
      videoGenerations: draftVideoGenerations,
      genRatio,
      genDurationSec,
    })
  }, [
    isActiveProcessingGen,
    loadCurrentHotCopyDraft,
    workspaceId,
    entryInitial,
    projectId,
    started,
    step,
    maxReached,
    basePrompt,
    projectName,
    nameTouched,
    sourceVideo,
    sourceVideoDurSec,
    sourceVideoDurAssetId,
    productAssetIds,
    fullVideo,
    videoVersions,
    videoModificationDraft,
    genTriggerBusy,
    vidGenRunning,
    vidGenTaskId,
    videoGenerations,
    genRatio,
    genDurationSec,
  ])

  // 素材恢复后在后台预读真实时长。生成按钮点击时优先命中该缓存；失败仍保留原来的点击时读取兜底。
  useEffect(() => {
    const assetId = Number(sourceVideo.assetId || 0) || 0
    const url = String(sourceVideo.url || '')
    if (!assetId || !url) return
    if (sourceVideoDurAssetId === assetId && sourceVideoDurSec > 0) return
    let active = true
    void readSourceVideoDuration(assetId, url).then((seconds) => {
      if (!active || !(seconds > 0)) return
      setSourceVideoDurSec(seconds)
      setSourceVideoDurAssetId(assetId)
      persistNow({ sourceVideoDurationSec: seconds, sourceVideoDurationAssetId: assetId })
    })
    return () => {
      active = false
    }
  }, [
    persistNow,
    readSourceVideoDuration,
    sourceVideo.assetId,
    sourceVideo.url,
    sourceVideoDurAssetId,
    sourceVideoDurSec,
  ])

  const commitGeneratedVideo = (
    ws: number,
    video: { url: string; assetId: number },
    completedTaskId?: number,
    completedGenId?: string | null,
    context?: HotCopyJobContext,
  ): { versions: VideoVersion[]; generations: GenRecord[] } => {
    const safeVideo = {
      url: String(video?.url || ''),
      assetId: Number(video?.assetId || 0) || 0,
    }
    if (!safeVideo.url && !safeVideo.assetId) return { versions: videoVersions, generations: videoGenerations }
    // 带任务上下文的后台完成只能回填它发起时所属的页面会话；reset 后结果仅落原项目/任务中心。
    if (context && !isJobUiActive(context)) return { versions: videoVersions, generations: videoGenerations }
    rememberCompletedTask(Number(completedTaskId || 0) || 0)
    clearPendingUiGeneration(completedGenId)
    runningVideoPromiseRef.current = null
    const draft = ws ? loadCurrentHotCopyDraft(ws) : null
    const nextVersions = mergeVideoVersions(draft?.videoVersions, videoVersions, draft?.fullVideo, fullVideo, safeVideo)
    const matchingGeneration = mergeGenRecords(videoGenerationsRef.current, draft?.videoGenerations).find(
      (generation) =>
        (completedGenId && generation.id === completedGenId) ||
        (completedTaskId && Number(generation.taskId || 0) === Number(completedTaskId)),
    )
    const nextVideoModificationDraft = bindVideoModificationNote(
      draft?.videoModificationDraft ?? videoModificationDraft,
      safeVideo,
      context?.generationModificationNote ?? matchingGeneration?.modificationNote ?? '',
    )
    // 爆款复制由生成锁保证同一项目仅有一个在途任务。结果已落成品后，草稿里其余 processing
    // 都是旧状态；一起清理，避免本地/后端草稿合并后短暂把“生成中”重新显示出来。
    const nextGenerations = dropProcessingGenerations(
      dropCompletedGeneration(videoGenerationsRef.current, draft?.videoGenerations, {
        genId: completedGenId,
        taskId: completedTaskId,
      }),
    )
    immediateSaveRef.current = true
    persistNow({
      fullVideo: safeVideo,
      videoVersions: nextVersions,
      videoGenerating: false,
      vidGenTaskId: 0,
      videoGenerations: nextGenerations,
      videoModificationDraft: nextVideoModificationDraft,
    })
    // 带 context 的结果已经由 persistHotCopyJobResult 按锁定 projectId 落库，禁止再读可变 projectIdRef。
    if (!context && projectIdRef.current) void putHotCopyDraftToBackend(ws)
    if (aliveRef.current) {
      setFullVideo(safeVideo)
      setVideoVersions((prev) => mergeVideoVersions(draft?.videoVersions, prev, draft?.fullVideo, fullVideo, safeVideo))
      setVideoGenerations(nextGenerations)
      setVideoModificationDraft(nextVideoModificationDraft)
      setVidGenRunning(false)
      setVidGenTaskId(0)
      refreshVideoStage()
    }
    return { versions: nextVersions, generations: nextGenerations }
  }

  // ── 后端草稿快照 + 落库(对齐智能成片 buildSmartSnapshot/doPutDraft:顶层供项目管理读取 + smart 块供精确回填) ──
  const buildHotCopySnapshot = (): any => {
    const ws = Number(workspaceId || 0)
    const localDraft = ws ? loadCurrentHotCopyDraft(ws) : null
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const terminalResult = terminalJobResultsRef.current.get(pid)
    const stateVersions = mergeVideoVersions(videoVersions, fullVideo, terminalResult)
    const localVersions = mergeVideoVersions(localDraft?.videoVersions, localDraft?.fullVideo, terminalResult)
    const stateHasResult = hasVideoResult(stateVersions, fullVideo)
    const localHasNewerResult =
      Boolean(localDraft) &&
      (localVersions.length > stateVersions.length || (!stateHasResult && hasVideoResult(localVersions)))
    const versions = localHasNewerResult
      ? mergeVideoVersions(stateVersions, localVersions, localDraft?.fullVideo)
      : stateVersions
    const persistentVersions = versions
      .map((version) => {
        const assetId = Number(version?.assetId || 0) || 0
        return {
          ...version,
          assetId,
          url: sanitizePersistentMediaUrl(version?.url, { assetId, workspaceId: ws }),
        }
      })
      .filter((version) => version.assetId > 0 || Boolean(version.url))
    const currentVideo = terminalResult
      ? { url: terminalResult.url, assetId: terminalResult.assetId }
      : localHasNewerResult
        ? localDraft?.fullVideo || versions[versions.length - 1] || { url: '', assetId: 0 }
        : fullVideo.url || fullVideo.assetId
          ? fullVideo
          : versions[versions.length - 1] || { url: '', assetId: 0 }
    const fvId = Number(currentVideo.assetId || 0) || 0
    const fvUrl = sanitizePersistentMediaUrl(currentVideo.url, { assetId: fvId, workspaceId: ws })
    const snapshotHasResult = hasVideoResult(versions, currentVideo)
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && isVideoGenRunning('hot-copy', ws, pid))
    const localProcessing = normalizeGenRecords((localDraft as any)?.videoGenerations).filter(isActiveProcessingGen)
    const mergedGenerations = mergeGenRecords(videoGenerations, localProcessing)
    const effectiveGenerations = terminalResult
      ? dropProcessingGenerations(
          dropCompletedGeneration(mergedGenerations, {
            genId: terminalResult.generationId,
            taskId: terminalResult.taskId,
          }),
        )
      : mergedGenerations
    const effectiveTaskId = terminalResult ? 0 : Number(vidGenTaskId || localDraft?.vidGenTaskId || 0) || 0
    const effectiveEntryBase = entryInitial || localDraft?.entryInitial
    const effectiveSourceVideo = resolveHotCopySourceVideo(
      {
        assetId: Number(sourceVideo.assetId || localDraft?.sourceVideo?.assetId || 0) || 0,
        url: String(sourceVideo.url || localDraft?.sourceVideo?.url || ''),
      },
      effectiveEntryBase,
    )
    const effectiveProductAssetIds = resolveHotCopyProductAssetIds(
      productAssetIds.length ? productAssetIds : localDraft?.productAssetIds,
      effectiveEntryBase,
    )
    const persistentSourceVideo = {
      ...effectiveSourceVideo,
      url: sanitizePersistentMediaUrl(effectiveSourceVideo.url, {
        assetId: effectiveSourceVideo.assetId,
        workspaceId: ws,
      }),
    }
    const effectiveEntryInitial = sanitizeHotCopyEntryInitial(
      withResolvedHotCopyAssets(effectiveEntryBase, persistentSourceVideo, effectiveProductAssetIds),
      ws,
    )
    const effectiveOriginalProductAssetIds = resolveHotCopyOriginalProductAssetIds(
      effectiveEntryInitial,
      localDraft?.originalProductAssetIds,
    )
    const effectiveSourceDuration =
      sourceVideoDurAssetId === effectiveSourceVideo.assetId && sourceVideoDurSec > 0
        ? sourceVideoDurSec
        : resolveStoredSourceDuration(effectiveSourceVideo.assetId, localDraft)
    const hasProcessing = effectiveGenerations.some(isActiveProcessingGen)
    const snapshotGenerating =
      !terminalResult &&
      hasProcessing &&
      (effectiveTaskId > 0 || hasInflight || hasRecentPreparingGeneration(effectiveGenerations))
    const snapshotTaskId = snapshotGenerating ? effectiveTaskId : 0
    const snapshotGenerations = restoreGenerationRecords(
      effectiveGenerations,
      snapshotHasResult,
      snapshotGenerating,
    ).map((generation) => ({
      ...generation,
      ...(generation?.error
        ? { error: sanitizeTelemetryText(String(generation.error)).slice(0, 500) }
        : { error: undefined }),
    }))
    return {
      flow: 'hot-copy',
      title: projectName || '',
      currentStep: started ? 'video' : 'entry',
      description: basePrompt || '',
      generatedVideoUrl: fvUrl,
      generatedVideoAssetId: fvId,
      videoHistoryList: persistentVersions.length
        ? persistentVersions
        : fvUrl || fvId
          ? [{ url: fvUrl, assetId: fvId }]
          : [],
      // 原样保留项目视频清单存档(归类记录),避免整盘重建草稿时丢失(本编辑器不维护它)
      ...(projectVideoStoreRef.current
        ? { projectVideoStore: sanitizePersistentProjectVideoStore(projectVideoStoreRef.current, ws) }
        : {}),
      smart: {
        flow: 'hot-copy',
        started,
        entryInitial: effectiveEntryInitial,
        projectName,
        nameTouched,
        basePrompt,
        sourceVideo: persistentSourceVideo,
        sourceVideoDurationSec: effectiveSourceDuration,
        sourceVideoDurationAssetId: effectiveSourceDuration ? persistentSourceVideo.assetId : 0,
        originalProductAssetIds: effectiveOriginalProductAssetIds,
        productAssetIds: effectiveProductAssetIds,
        fullVideoUrl: fvUrl,
        fullVideoAssetId: fvId,
        videoVersions: persistentVersions,
        videoModificationDraft,
        videoGenerating: snapshotGenerating,
        vidGenTaskId: snapshotTaskId,
        videoGenerations: snapshotGenerations,
        genRatio,
        genDurationSec,
        step,
        maxReached,
      },
    }
  }

  // 从任意返回体/错误体取 draft_revision(下划线/驼峰/嵌套 data 多种写法)
  const normRev = (p: any): number => {
    const v = Number(p?.draft_revision ?? p?.draftRevision ?? p?.data?.draft_revision ?? p?.data?.draftRevision ?? NaN)
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : NaN
  }
  const rememberProjectRevision = (id: number, ws: number, revision: number) => {
    if (!id || !ws || !Number.isFinite(revision)) return
    draftRevisionByProjectRef.current.set(hotCopyProjectKey(ws, id), revision)
    if (Number(projectIdRef.current || 0) === id && Number(workspaceIdRef.current || 0) === ws) {
      draftRevisionRef.current = revision
    }
  }
  const fetchRevision = async (
    id: number,
    ws: number,
    options: { acceptCreativeContent?: boolean } = {},
  ): Promise<number> => {
    try {
      const proj: any = await getCreativeProject({ projectId: id, workspaceId: ws })
      const r = normRev(proj)
      if (Number.isFinite(r)) rememberProjectRevision(id, ws, r)
      if (options.acceptCreativeContent) {
        const draftValue = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
        const projectKey = hotCopyProjectKey(ws, id)
        baseDraftContentFingerprintByProjectRef.current.set(
          projectKey,
          createCreativeDraftContentFingerprint(draftValue),
        )
        draftContentConflictNotifiedRef.current.delete(projectKey)
      }
      return r
    } catch {
      return NaN
    }
  }
  type HotCopyDraftSaveRequest = {
    projectId: number
    workspaceId: number
    snapshot: any
    initialRevision: number
    baseContentFingerprint: string
    allowCreativeReplace: boolean
  }

  const doPutHotCopyDraft = async (request: HotCopyDraftSaveRequest): Promise<DraftWriteResult> => {
    const id = request.projectId
    const ws = request.workspaceId
    if (!id || !ws) return 'error'
    let snapshot = request.snapshot
    let revision = request.initialRevision
    let expectedContentFingerprint = request.baseContentFingerprint
    let allowCreativeReplace = request.allowCreativeReplace
    const intendedContentFingerprint = createCreativeDraftContentFingerprint(request.snapshot)
    const mergeLatestProjectDraft = (project: any, acceptIntendedContent = false) => {
      const nextRevision = normRev(project)
      if (Number.isFinite(nextRevision)) {
        revision = nextRevision
        rememberProjectRevision(id, ws, nextRevision)
      }
      const latestDraftValue = project?.draft_json ?? project?.data?.draft_json ?? project?.draft
      if (allowCreativeReplace) {
        expectedContentFingerprint = createCreativeDraftContentFingerprint(latestDraftValue)
        allowCreativeReplace = false
      } else {
        const latestContentFingerprint = assertCreativeDraftWriteStillOwned({
          baseFingerprint: expectedContentFingerprint,
          intendedFingerprint: intendedContentFingerprint,
          latestDraft: latestDraftValue,
          acceptIntendedContent,
        })
        if (acceptIntendedContent && latestContentFingerprint === intendedContentFingerprint) {
          // PUT 可能已在服务端成功，只是响应超时/中断。此时把自己的已落库内容作为新基线，
          // 再按最新 revision 重试元数据合并，不能误报成“其他标签页修改”。
          expectedContentFingerprint = latestContentFingerprint
        } else expectedContentFingerprint = latestContentFingerprint
      }
      snapshot = mergeLatestProjectMetadata(snapshot, project)
      const parsedLatest = parseHotCopyDraft(latestDraftValue)
      const latestFlow = String(parsedLatest?.obj?.flow || parsedLatest?.smart?.flow || '').toLowerCase()
      if (latestFlow === 'hot-copy' && snapshot?.smart && typeof snapshot.smart === 'object') {
        const currentSmart = { ...snapshot.smart }
        const latestSmart = parsedLatest?.smart || {}
        const latestVersions = mergeVideoVersions(latestSmart.videoVersions, parsedLatest?.obj?.videoHistoryList)
        const currentFull = {
          url: String(currentSmart.fullVideoUrl || snapshot.generatedVideoUrl || '').trim(),
          assetId: Number(currentSmart.fullVideoAssetId || snapshot.generatedVideoAssetId || 0) || 0,
        }
        const currentVersions = mergeVideoVersions(currentSmart.videoVersions, snapshot.videoHistoryList, currentFull)
        const mergedVersions = mergeVideoVersions(currentVersions, latestVersions)
        const latestFull = {
          url: String(latestSmart.fullVideoUrl || parsedLatest?.obj?.generatedVideoUrl || '').trim(),
          assetId: Number(latestSmart.fullVideoAssetId || parsedLatest?.obj?.generatedVideoAssetId || 0) || 0,
        }
        currentSmart.videoVersions = mergedVersions
        snapshot.videoHistoryList = mergedVersions

        const currentGenerations = normalizeGenRecords(currentSmart.videoGenerations)
        const latestGenerations = normalizeGenRecords(latestSmart.videoGenerations)
        const currentActiveIds = new Set(
          currentGenerations
            .filter((generation) => generation.status === 'processing')
            .map((generation) => generation.id),
        )
        const latestCompletedCurrentGeneration = latestGenerations.some(
          (generation) => currentActiveIds.has(generation.id) && generation.status !== 'processing',
        )
        currentSmart.videoModificationDraft = mergeVideoModificationDraft(
          currentSmart.videoModificationDraft,
          latestSmart.videoModificationDraft,
          { preferLatestPending: latestCompletedCurrentGeneration },
        )
        const terminalResult = terminalJobResultsRef.current.get(id)
        const currentMatchesTerminal = Boolean(
          terminalResult &&
          ((terminalResult.assetId > 0 && currentFull.assetId === terminalResult.assetId) ||
            (terminalResult.url && currentFull.url === terminalResult.url)),
        )
        const latestFullIsNewToCurrent =
          hasVideoResult(latestFull) &&
          !currentVersions.some(
            (version) =>
              (latestFull.assetId > 0 && version.assetId === latestFull.assetId) ||
              (latestFull.url && version.url === latestFull.url),
          )
        const useLatestFull =
          !hasVideoResult(currentFull) ||
          latestCompletedCurrentGeneration ||
          (latestFullIsNewToCurrent && !currentMatchesTerminal)
        if (useLatestFull && hasVideoResult(latestFull)) {
          currentSmart.fullVideoUrl = latestFull.url
          currentSmart.fullVideoAssetId = latestFull.assetId
          snapshot.generatedVideoUrl = latestFull.url
          snapshot.generatedVideoAssetId = latestFull.assetId
        }

        let mergedGenerations = mergeGenRecords(latestGenerations, currentGenerations)
        if (terminalResult) {
          mergedGenerations = mergedGenerations.filter(
            (generation) =>
              !(
                generation.status === 'processing' &&
                ((terminalResult.generationId && generation.id === terminalResult.generationId) ||
                  (terminalResult.taskId > 0 && Number(generation.taskId || 0) === terminalResult.taskId))
              ),
          )
        }
        currentSmart.videoGenerations = mergedGenerations
        const currentTaskId = Number(currentSmart.vidGenTaskId || 0) || 0
        if (terminalResult) {
          currentSmart.videoGenerating = false
          currentSmart.vidGenTaskId = 0
        } else if (
          !currentTaskId ||
          latestCompletedCurrentGeneration ||
          (currentTaskId > 0 && Number(latestSmart.vidGenTaskId || 0) === currentTaskId)
        ) {
          currentSmart.videoGenerating = Boolean(latestSmart.videoGenerating)
          currentSmart.vidGenTaskId = Number(latestSmart.vidGenTaskId || 0) || 0
        }
        snapshot.smart = currentSmart
      }
      const latestDraft = getCreativeProjectDraft(project)
      if (
        Number(projectIdRef.current || 0) === id &&
        latestDraft &&
        Object.prototype.hasOwnProperty.call(latestDraft, 'projectVideoStore')
      ) {
        projectVideoStoreRef.current = latestDraft.projectVideoStore ?? null
      }
    }
    const writeDraft = async () => {
      // 合并最新项目草稿时可能带入并发回调或旧草稿中的媒体地址，PUT 前必须再次清理持久化内容。
      snapshot = sanitizeHotCopyPersistentDraft(snapshot, ws)
      const originalProductAssetIds = resolveHotCopyOriginalProductAssetIds(
        snapshot?.smart?.entryInitial,
        snapshot?.smart?.originalProductAssetIds,
      )
      return updateCreativeProjectDraft({
        projectId: id,
        workspaceId: ws,
        draft: snapshot,
        draftRevision: Number(revision || 0) || 0,
        // 项目封面必须使用用户上传的原图；脱敏图只用于模型提交。
        coverAssetId: Number(originalProductAssetIds[0] || 0) || 0,
      })
    }

    const refreshLatestProjectDraft = async (acceptIntendedContent = false): Promise<boolean> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const latestProject: any = await getCreativeProject({ projectId: id, workspaceId: ws })
          if (blockRestrictedProject(latestProject, id, ws)) return false
          mergeLatestProjectDraft(latestProject, acceptIntendedContent)
          return true
        } catch (error) {
          if (isCreativeDraftContentConflictError(error)) throw error
          if (!isRetryableDraftSaveError(error) || attempt >= 2) return false
          await waitForDraftSaveRetry(attempt)
        }
      }
      return false
    }
    const refreshForSave = async (acceptIntendedContent = false): Promise<'ok' | 'conflict' | 'error'> => {
      try {
        return (await refreshLatestProjectDraft(acceptIntendedContent)) ? 'ok' : 'error'
      } catch (error) {
        return isCreativeDraftContentConflictError(error) ? 'conflict' : 'error'
      }
    }

    // 该请求可能排在同一页面的任务进度/结果写入之后；采用前一写入执行时记录的新基线，
    // 外部编辑器无法修改这份页面内存映射。
    const latestOwnedBaseline = baseDraftContentFingerprintByProjectRef.current.get(hotCopyProjectKey(ws, id))
    if (latestOwnedBaseline) expectedContentFingerprint = latestOwnedBaseline

    // 整盘 PUT 前必须读到最新草稿；否则可能用旧标签页快照清空权限或项目视频清单。
    const initialRefresh = await refreshForSave()
    if (initialRefresh !== 'ok') return initialRefresh

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const payload: any = await writeDraft()
        const next = normRev(payload)
        if (Number.isFinite(next)) rememberProjectRevision(id, ws, next)
        else await fetchRevision(id, ws)
        baseDraftContentFingerprintByProjectRef.current.set(
          hotCopyProjectKey(ws, id),
          createCreativeDraftContentFingerprint(snapshot),
        )
        draftContentConflictNotifiedRef.current.delete(hotCopyProjectKey(ws, id))
        return 'saved'
      } catch (error: any) {
        const conflict = isDraftConflictError(error)
        const retryable = isRetryableDraftSaveError(error)
        if ((!conflict && !retryable) || attempt >= 2) return 'error'
        if (retryable && !conflict) await waitForDraftSaveRetry(attempt)

        const fromError = normRev(error?.response)
        if (Number.isFinite(fromError)) {
          revision = fromError
          rememberProjectRevision(id, ws, fromError)
        }
        const refreshed = await refreshForSave(true)
        if (refreshed !== 'ok') return refreshed
      }
    }
    return 'error'
  }
  // 串行化后端保存(防并发 PUT 用同 revision 互相 409)
  const putHotCopyDraftToBackend = useLatestCallback((workspaceIdOverride?: number): Promise<DraftWriteResult> => {
    const id = Number(projectIdRef.current || 0) || 0
    const ws = Number(workspaceIdOverride || workspaceId || 0)
    if (!id || !ws || !hydratedRef.current) return Promise.resolve('error')
    if (draftSaveStatusRef.current === 'conflict') return Promise.resolve('conflict')
    // 快照和 projectId 在入队时一起冻结，避免切换路由后旧队列读取新项目的 state/revision。
    const draft = buildHotCopySnapshot()
    const fingerprint = createDraftFingerprint(draft)
    const contentFingerprint = createCreativeDraftContentFingerprint(draft)
    const queuedSave =
      queuedDraftSaveRef.current?.projectId === id && queuedDraftSaveRef.current?.workspaceId === ws
        ? queuedDraftSaveRef.current
        : null
    if (fingerprint && queuedSave?.fingerprint === fingerprint) {
      const adoptedSequence = ++draftSaveSequenceRef.current
      draftSaveStatusRef.current = 'saving'
      if (aliveRef.current && Number(projectIdRef.current || 0) === id) setDraftSaveStatus('saving')
      return queuedSave.promise.then((result) => {
        if (
          aliveRef.current &&
          Number(projectIdRef.current || 0) === id &&
          Number(workspaceIdRef.current || 0) === ws &&
          draftSaveSequenceRef.current === adoptedSequence
        ) {
          if (result === 'saved') lastSavedDraftFingerprintRef.current = fingerprint
          if (result === 'conflict') markDraftContentConflict(id, ws)
          else if (result === 'error') markDraftSaveError()
          else {
            const nextStatus: DraftSaveStatus =
              draftSaveStatusRef.current === 'conflict'
                ? 'conflict'
                : titleSaveFailedRef.current
                  ? 'error'
                  : pendingTitleSaveRef.current
                    ? 'saving'
                    : 'saved'
            draftSaveStatusRef.current = nextStatus
            setDraftSaveStatus(nextStatus)
          }
        }
        return result
      })
    }
    const previousQueuedSave = queuedSave
    const projectKey = hotCopyProjectKey(ws, id)
    const baseContentFingerprint =
      previousQueuedSave?.contentFingerprint || baseDraftContentFingerprintByProjectRef.current.get(projectKey) || ''
    const saveSequence = ++draftSaveSequenceRef.current
    draftSaveStatusRef.current = 'saving'
    if (aliveRef.current && Number(projectIdRef.current || 0) === id) setDraftSaveStatus('saving')
    const request: HotCopyDraftSaveRequest = {
      projectId: id,
      workspaceId: ws,
      snapshot: draft,
      initialRevision:
        Number(draftRevisionByProjectRef.current.get(projectKey)) ||
        (Number(projectIdRef.current || 0) === id ? Number(draftRevisionRef.current || 0) : 0),
      baseContentFingerprint,
      allowCreativeReplace: false,
    }
    const savePromise = enqueueCreativeProjectDraftSave({
      projectId: id,
      workspaceId: ws,
      task: async () => {
        if (previousQueuedSave) {
          const previousResult = await previousQueuedSave.promise
          if (previousResult !== 'saved') return previousResult
        }
        return doPutHotCopyDraft(request)
      },
    })
      .then(
        (result) => {
          if (
            result === 'saved' &&
            fingerprint &&
            Number(projectIdRef.current || 0) === id &&
            Number(workspaceIdRef.current || 0) === ws &&
            draftSaveSequenceRef.current === saveSequence
          ) {
            lastSavedDraftFingerprintRef.current = fingerprint
          }
          if (
            aliveRef.current &&
            Number(projectIdRef.current || 0) === id &&
            draftSaveSequenceRef.current === saveSequence
          ) {
            if (result === 'conflict') markDraftContentConflict(id, ws)
            else if (result === 'error') markDraftSaveError()
            else {
              const nextStatus: DraftSaveStatus =
                draftSaveStatusRef.current === 'conflict'
                  ? 'conflict'
                  : titleSaveFailedRef.current
                    ? 'error'
                    : pendingTitleSaveRef.current
                      ? 'saving'
                      : 'saved'
              draftSaveStatusRef.current = nextStatus
              setDraftSaveStatus(nextStatus)
            }
          }
          return result
        },
        () => {
          if (
            aliveRef.current &&
            Number(projectIdRef.current || 0) === id &&
            draftSaveSequenceRef.current === saveSequence
          ) {
            markDraftSaveError()
          }
          return 'error' as DraftWriteResult
        },
      )
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

  // 标题 PATCH 与草稿 PUT 共用服务端 draft_revision:必须走同一条串行链,否则两条写入路径
  // 会用同一个 revision 互相 409。PATCH 成功后同步本地 revision(响应没带就重拉),避免下次草稿保存过期。
  const doPatchHotCopyTitle = async (
    id: number,
    title: string,
    ws: number,
    expectedTitle: string,
    expectedContentFingerprint: string,
  ): Promise<DraftWriteResult> => {
    const t = String(title || '').trim()
    if (!id || !ws || !t) return 'error'
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const latestProject: any = await getCreativeProject({ projectId: id, workspaceId: ws })
        if (blockRestrictedProjectRef.current(latestProject, id, ws)) return 'error'
        const latestRevision = normRev(latestProject)
        if (Number.isFinite(latestRevision)) rememberProjectRevision(id, ws, latestRevision)
        const latestDraftValue = latestProject?.draft_json ?? latestProject?.data?.draft_json ?? latestProject?.draft
        if (!expectedContentFingerprint) return 'conflict'
        assertCreativeDraftContentUnchanged(expectedContentFingerprint, latestDraftValue)
        const latestTitle = String(latestProject?.title || latestProject?.name || '').trim()
        const titleDecision = resolveCreativeProjectTitleWrite(expectedTitle, t, latestTitle)
        if (titleDecision === 'already-saved') return 'saved'
        if (titleDecision === 'conflict') return 'conflict'
        const payload: any = await patchCreativeProject({ projectId: id, workspaceId: ws, title: t, name: t })
        const next = normRev(payload)
        if (Number.isFinite(next)) rememberProjectRevision(id, ws, next)
        else await fetchRevision(id, ws)
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
  }
  const patchHotCopyTitleToBackend = useLatestCallback(
    (title: string, workspaceIdOverride?: number): Promise<DraftWriteResult> => {
      const id = Number(projectIdRef.current || 0) || 0
      const ws = Number(workspaceIdOverride || workspaceId || 0)
      if (!id || !ws) return Promise.resolve('error')
      const expectedTitle = serverTitleRef.current
      const expectedContentFingerprint =
        baseDraftContentFingerprintByProjectRef.current.get(hotCopyProjectKey(ws, id)) || ''
      return enqueueCreativeProjectDraftSave({
        projectId: id,
        workspaceId: ws,
        task: () => doPatchHotCopyTitle(id, title, ws, expectedTitle, expectedContentFingerprint),
      })
    },
  )

  const retryHotCopyCloudSave = async () => {
    const id = Number(projectIdRef.current || 0)
    const ws = Number(workspaceId || 0)
    if (!id || !ws) return
    const pendingTitle = pendingTitleSaveRef.current
    draftSaveStatusRef.current = 'saving'
    setDraftSaveStatus('saving')
    const draftResult = await putHotCopyDraftToBackend(ws)
    if (
      Number(projectIdRef.current || 0) !== id ||
      Number(workspaceIdRef.current || 0) !== ws ||
      draftResult !== 'saved'
    ) {
      return
    }
    if (pendingTitle) {
      const titleResult = await patchHotCopyTitleToBackend(pendingTitle, ws)
      if (
        pendingTitleSaveRef.current !== pendingTitle ||
        Number(projectIdRef.current || 0) !== id ||
        Number(workspaceIdRef.current || 0) !== ws
      ) {
        return
      }
      if (titleResult === 'conflict') {
        markDraftContentConflict(id, ws)
        return
      }
      if (titleResult !== 'saved') {
        titleSaveFailedRef.current = true
        markDraftSaveError()
        return
      }
      titleSaveFailedRef.current = false
      serverTitleRef.current = pendingTitle
      if (pendingTitleSaveRef.current === pendingTitle) pendingTitleSaveRef.current = ''
    }
    draftSaveStatusRef.current = 'saved'
    setDraftSaveStatus('saved')
  }

  const flushHotCopyDraft = useLatestCallback((workspaceIdOverride?: number) => {
    const ws = Number(workspaceIdOverride || workspaceId || 0)
    if (!ws || !hydratedRef.current) return
    const hasEntry =
      Boolean(entryInitial?.videoPreview) ||
      Boolean(entryInitial?.text?.trim?.()) ||
      Boolean(entryInitial?.libraryVideo?.assetId || entryInitial?.libraryVideo?.src) ||
      Boolean(entryInitial?.products?.length)
    if (!started && !hasEntry) return
    const localDraft = loadCurrentHotCopyDraft(ws)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const terminalResult = terminalJobResultsRef.current.get(pid)
    const draftVideoVersions = mergeVideoVersions(
      localDraft?.videoVersions,
      videoVersions,
      localDraft?.fullVideo,
      fullVideo,
      terminalResult,
    )
    const draftFullVideo = terminalResult
      ? { url: terminalResult.url, assetId: terminalResult.assetId }
      : draftVideoVersions[draftVideoVersions.length - 1] || fullVideo || localDraft?.fullVideo
    const draftHasResult = hasVideoResult(draftVideoVersions, draftFullVideo)
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && isVideoGenRunning('hot-copy', ws, pid))
    const mergedGenerations = mergeGenRecords(videoGenerations, localDraft?.videoGenerations)
    const effectiveGenerations = terminalResult
      ? dropProcessingGenerations(
          dropCompletedGeneration(mergedGenerations, {
            genId: terminalResult.generationId,
            taskId: terminalResult.taskId,
          }),
        )
      : mergedGenerations
    const effectiveTaskId = terminalResult ? 0 : Number(vidGenTaskId || localDraft?.vidGenTaskId || 0) || 0
    const hasProcessing = effectiveGenerations.some(isActiveProcessingGen)
    const draftHasActiveGeneration = !terminalResult && hasProcessing && (effectiveTaskId > 0 || hasInflight)
    const draftVideoGenerations = restoreGenerationRecords(
      effectiveGenerations,
      draftHasResult,
      draftHasActiveGeneration,
    )
    const draftSourceVideo = hasVideoResult(sourceVideo) ? sourceVideo : localDraft?.sourceVideo || sourceVideo
    const draftSourceDuration =
      sourceVideoDurAssetId === draftSourceVideo.assetId && sourceVideoDurSec > 0
        ? sourceVideoDurSec
        : resolveStoredSourceDuration(draftSourceVideo.assetId, localDraft)
    const draftEntryInitial = entryInitial || localDraft?.entryInitial
    saveHotCopyDraft(ws, {
      entryInitial: draftEntryInitial,
      projectId: pid,
      started,
      step,
      maxReached,
      basePrompt,
      projectName,
      nameTouched,
      sourceVideo: draftSourceVideo,
      sourceVideoDurationSec: draftSourceDuration,
      sourceVideoDurationAssetId: draftSourceDuration ? draftSourceVideo.assetId : 0,
      originalProductAssetIds: resolveHotCopyOriginalProductAssetIds(
        draftEntryInitial,
        localDraft?.originalProductAssetIds,
      ),
      productAssetIds: productAssetIds.length ? productAssetIds : localDraft?.productAssetIds || [],
      fullVideo: draftFullVideo,
      videoVersions: draftVideoVersions,
      videoModificationDraft,
      videoGenerating: draftHasActiveGeneration,
      vidGenTaskId: draftHasActiveGeneration ? effectiveTaskId : 0,
      videoGenerations: draftVideoGenerations,
      genRatio,
      genDurationSec,
    })
    if (projectIdRef.current) void putHotCopyDraftToBackend(ws)
  })

  // 后端草稿自动保存(1.5s 防抖;已水合且已建项目才存)
  useEffect(() => {
    if (!hydratedRef.current || !projectIdRef.current) return
    const hasEntry =
      Boolean(entryInitial?.videoPreview) ||
      Boolean(entryInitial?.text?.trim?.()) ||
      Boolean(entryInitial?.libraryVideo?.assetId || entryInitial?.libraryVideo?.src) ||
      Boolean(entryInitial?.products?.length)
    if (!started && !hasEntry) return
    if (draftSaveStatusRef.current === 'saved' || draftSaveStatusRef.current === 'saving') {
      draftSaveSequenceRef.current += 1
      draftSaveStatusRef.current = 'dirty'
      setDraftSaveStatus('dirty')
    }
    const t = window.setTimeout(() => void putHotCopyDraftToBackend(), 1500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    started,
    step,
    maxReached,
    entryInitial,
    basePrompt,
    projectName,
    nameTouched,
    sourceVideo,
    sourceVideoDurSec,
    sourceVideoDurAssetId,
    productAssetIds,
    fullVideo,
    videoVersions,
    videoModificationDraft,
    vidGenTaskId,
    videoGenerations,
    genRatio,
    genDurationSec,
  ])

  // 生成记录(生成中/失败)变化 → 立即落后端,不等防抖:草稿/失败态即时出现在项目管理里。
  useEffect(() => {
    if (!hydratedRef.current || !projectIdRef.current || !immediateSaveRef.current) return
    immediateSaveRef.current = false
    void putHotCopyDraftToBackend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoGenerations])

  const flushHotCopyDraftRef = useRef<() => void>(() => {})
  flushHotCopyDraftRef.current = () => flushHotCopyDraft(Number(workspaceId || 0))
  useEffect(
    () => () => {
      flushHotCopyDraftRef.current()
    },
    [],
  )

  // 项目名变化回写后端标题(防抖;默认/未命名标题不回写,避免 PATCH 撞草稿 revision → 409;与已同步标题相同也跳过)
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    if (!projectId || !wsId) return
    const t = projectName.trim()
    if (!t || isUnnamedTitle(t) || t === serverTitleRef.current) return
    const timer = window.setTimeout(() => {
      pendingTitleSaveRef.current = t
      titleSaveFailedRef.current = false
      // 先让包含新标题的草稿通过内容 CAS；只有该写入成功的标签页才有资格同步项目标题。
      void putHotCopyDraftToBackend(wsId).then(async (draftResult) => {
        if (
          pendingTitleSaveRef.current !== t ||
          Number(projectIdRef.current || 0) !== projectId ||
          Number(workspaceIdRef.current || 0) !== wsId
        ) {
          return
        }
        if (draftResult !== 'saved') return
        const titleResult = await patchHotCopyTitleToBackend(t, wsId)
        if (
          pendingTitleSaveRef.current !== t ||
          Number(projectIdRef.current || 0) !== projectId ||
          Number(workspaceIdRef.current || 0) !== wsId
        ) {
          return
        }
        if (titleResult === 'saved') {
          serverTitleRef.current = t
          titleSaveFailedRef.current = false
          pendingTitleSaveRef.current = ''
          draftSaveStatusRef.current = 'saved'
          setDraftSaveStatus('saved')
          return
        }
        if (titleResult === 'conflict') {
          markDraftContentConflict(projectId, wsId)
          return
        }
        titleSaveFailedRef.current = true
        markDraftSaveError()
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [
    markDraftContentConflict,
    patchHotCopyTitleToBackend,
    projectId,
    projectName,
    putHotCopyDraftToBackend,
    workspaceId,
  ])

  // 拉 replicate 模型,取其 ratio 字段支持的比例选项 → 入口下拉只放模型真做得了的比例(避免选了被悄悄回退)。
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws) return
    let alive = true
    ;(async () => {
      try {
        void resolvePlanCandidates()
        const derivedPlans = (deriveModelPlanCandidates(useWorkspaceSessionStore.getState()) as string[]) || []
        const plans = derivedPlans.length ? derivedPlans : modelPlanCandidates
        const model: any = await preloadHotCopyVideoModel({ workspaceId: ws, modelPlanCandidates: plans })
        const opts = (getModelParamOptions(model, 'ratio') || []).map(String).filter(Boolean)
        if (!alive || !opts.length) return
        setRatioOptions(opts)
        // 默认比例收敛到模型支持范围内(不在则取第一个支持项)
        setGenRatio((r) => (opts.includes(r) ? r : opts[0]))
      } catch {
        /* 拿不到模型 options 就用默认下拉 */
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // 提交前积分预估(estimate-cost):进入生成视频步、有源视频且非生成中时估一次(口径同「重新生成」replicate)。
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid && isVideoGenRunning('hot-copy', ws, pid))
    if (!ws || !started || vidGenRunning || vidGenTaskId > 0 || hasProcessing || hasInflight || !sourceVideo.assetId)
      return
    let alive = true
    setVideoCost((s) => ({ ...s, loading: true, error: '' }))
    const timer = window.setTimeout(async () => {
      try {
        const plans = await resolvePlanCandidates()
        const res: any = await estimateReplicateCost({
          workspaceId: ws,
          sourceVideoDurationSec: boundSourceVideoDurSec,
          ratio: genRatio,
          durationSec: genDurationSec,
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
  }, [
    workspaceId,
    started,
    vidGenRunning,
    vidGenTaskId,
    videoGenerations,
    projectId,
    sourceVideo.assetId,
    boundSourceVideoDurSec,
    genRatio,
    genDurationSec,
  ])

  // 据需求自动命名项目(用户已手动改名 / 需求为空则跳过)
  const autoNameProject = async (req: string, durationSec = genDurationSec) => {
    if (nameTouchedRef.current || !req.trim()) return
    setNaming(true)
    let ctrl: AbortController | null = null
    try {
      nameAbortRef.current?.abort()
      ctrl = new AbortController()
      nameAbortRef.current = ctrl
      const namingContext = { requirement: req, flow: 'hot-copy' as const, durationSec }
      const name = await generateProjectName(namingContext, ctrl.signal)
      if (ctrl !== nameAbortRef.current || nameTouchedRef.current) return
      if (name) {
        const next = String(name).trim()
        if (next) {
          pendingAutoTitleRef.current = next
          setProjectName(next)
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError' && nameAbortRef.current === ctrl && !nameTouchedRef.current) {
        const fallback = createProjectNameFallback({
          requirement: req,
          flow: 'hot-copy',
          durationSec,
        })
        pendingAutoTitleRef.current = fallback
        setProjectName(fallback)
      }
    } finally {
      if (nameAbortRef.current === ctrl) {
        nameAbortRef.current = null
        setNaming(false)
      }
    }
  }

  // 恢复历史未命名草稿时继续自动命名；同一项目和提示词只发起一次，避免失败后渲染循环。
  useEffect(() => {
    const id = Number(projectId || 0)
    const prompt = basePrompt.trim()
    if (!id || !hydratedRef.current || nameTouched || naming || !isUnnamedTitle(projectName) || !prompt) return
    const key = `${id}:${prompt}`
    if (autoNameResumeKeyRef.current === key) return
    autoNameResumeKeyRef.current = key
    void autoNameProject(prompt)
    // autoNameProject 通过 ref 读取上方守卫后的最新状态，依赖项无需重复展开。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePrompt, nameTouched, naming, projectId, projectName])

  // 低层:调 video.replicate 出片,写回当前整片 + 版本库。srcDurSec=源视频真实时长(按它计费)
  const doReplicate = async (
    ws: number,
    videoAssetId: number,
    productIds: number[],
    prompt: string,
    srcDurSec?: number,
    generation?: ReservedGen,
    context?: HotCopyJobContext,
  ): Promise<VideoGenResult> => {
    const validProductIds = (Array.isArray(productIds) ? productIds : []).filter((id) => Number(id) > 0)
    if (!validProductIds.length) {
      throw new Error('未获取到替换素材,请返回上一步重新选择图片')
    }
    const derivedPlans = (deriveModelPlanCandidates(useWorkspaceSessionStore.getState()) as string[]) || []
    const plans = derivedPlans.length ? derivedPlans : modelPlanCandidates
    const model = await preloadHotCopyVideoModel({ workspaceId: ws, modelPlanCandidates: plans })
    const ctrl = new AbortController()
    if (!context || isJobUiActive(context)) vidGenAbortRef.current = ctrl
    let activeTaskId = 0
    const tracked = bindRunningVideoPromise(
      replicateHotVideo({
        workspaceId: ws,
        videoAssetId,
        productAssetIds: validProductIds,
        prompt,
        ratio: context?.ratio || genRatio,
        durationSec: context?.durationSec || genDurationSec,
        sourceVideoDurationSec: srcDurSec || (sourceVideoDurAssetId === videoAssetId ? sourceVideoDurSec : 0) || 0,
        modelPlanCandidates: plans,
        modelVersion: model,
        idempotencyKey: context?.taskCenterId,
        signal: ctrl.signal,
        onTask: (id) => {
          activeTaskId = Number(id || 0) || 0
          if (context) {
            patchHotCopyTaskCenter(context, { status: 'processing', taskId: activeTaskId, error: '' })
            void persistRecoveryCredential(context, {
              status: 'processing',
              taskId: activeTaskId,
              sourceVideo: { assetId: videoAssetId, url: String(context.entryInitial?.videoPreview || '') },
              productAssetIds: validProductIds,
              sourceVideoDurationSec: Number(srcDurSec || 0) || 0,
            }).catch(() => undefined)
          }
          const boundProjectId = Number(context?.projectId || projectIdRef.current || 0) || 0
          if (boundProjectId && activeTaskId > 0) {
            updateRunningVideoGenMeta('hot-copy', Number(context?.workspaceId || ws || 0), boundProjectId, {
              taskId: activeTaskId,
              generationId: generation?.id || context?.generationId || '',
              status: 'processing',
            })
          }
          if (!context || isJobUiActive(context)) {
            setVidGenTaskId(id)
            if (generation && activeTaskId > 0) {
              activateGen(generation, activeTaskId)
              clearPendingUiGeneration(generation.id)
            } else if (!generation) {
              persistNow({ videoGenerating: true, vidGenTaskId: id })
            }
            if (!context && projectIdRef.current) void putHotCopyDraftToBackend(ws)
          }
        },
        onProgress: (progress) => {
          if (context) patchHotCopyTaskCenter(context, { status: 'processing', progress, error: '' })
        },
      }),
      { generationId: generation?.id || context?.generationId || '', status: 'preparing', context },
    )
    try {
      const { url, assetId } = await tracked
      const completedTaskId =
        Number(
          activeTaskId || (context && isJobUiActive(context) ? loadCurrentHotCopyDraft(ws)?.vidGenTaskId : 0) || 0,
        ) || 0
      if (context) await completeHotCopyJob(context, { url, assetId }, completedTaskId)
      else commitGeneratedVideo(ws, { url, assetId }, completedTaskId, generation?.id)
      return { url, assetId }
    } catch (error: any) {
      if (error && typeof error === 'object') error.hotCopyTaskId = activeTaskId
      throw error
    }
  }

  const prepareProductForReplicate = async (
    ws: number,
    product: HotCopyProduct,
    index: number,
    total: number,
    context?: HotCopyJobContext,
  ): Promise<{ product: HotCopyProduct; submitAssetId: number; failed: boolean; error?: string }> => {
    const existingSubmitId = Number(product.submitAssetId || 0) || 0
    let sourceAssetId = Number(product.assetId || 0) || 0
    const hasFaceCheckMetadata =
      Number(product.faceCheckedAssetId || 0) > 0 &&
      (product.faceCheckStatus === 'blurred' || product.faceCheckStatus === 'no_face')
    const faceResultMatchesSource =
      existingSubmitId > 0 &&
      sourceAssetId > 0 &&
      Number(product.faceCheckedAssetId || 0) === sourceAssetId &&
      (product.faceCheckStatus === 'blurred' || product.faceCheckStatus === 'no_face')
    const reusableLegacySubmitId =
      existingSubmitId > 0 && !hasFaceCheckMetadata && (!sourceAssetId || existingSubmitId !== sourceAssetId)
    if (faceResultMatchesSource || reusableLegacySubmitId) {
      return {
        product: { ...product, file: null, submitAssetId: existingSubmitId },
        submitAssetId: existingSubmitId,
        failed: false,
      }
    }

    if (!sourceAssetId && product.file) {
      setJobPhase(context, `替换素材上传 ${index}/${total}…`)
      sourceAssetId = await uploadHotCopyAsset(ws, product.file)
    }
    if (!sourceAssetId) {
      return {
        product: { ...product, file: null },
        submitAssetId: 0,
        failed: true,
        error: '图片上传后未返回可用的资源 ID',
      }
    }

    setJobPhase(context, `替换素材人脸检测 ${index}/${total}…`)
    const face = await blurFacesOnAsset({ workspaceId: ws, assetId: sourceAssetId })
    if (!face.ok && isNoFaceDetectedError(face.debug?.error)) {
      return {
        product: {
          ...product,
          file: null,
          assetId: sourceAssetId,
          submitAssetId: sourceAssetId,
          faceCheckStatus: 'no_face',
          faceCheckedAssetId: sourceAssetId,
        },
        submitAssetId: sourceAssetId,
        failed: false,
      }
    }
    if (!face.ok || !face.assetId) {
      return {
        product: {
          ...product,
          file: null,
          assetId: sourceAssetId,
          submitAssetId: 0,
        },
        submitAssetId: 0,
        failed: true,
        error: face.debug?.error || '人脸脱敏任务未返回可用素材',
      }
    }

    const submitAssetId = face.assetId
    return {
      product: {
        ...product,
        file: null,
        assetId: sourceAssetId,
        submitAssetId,
        faceCheckStatus: 'blurred',
        faceCheckedAssetId: sourceAssetId,
      },
      submitAssetId,
      failed: false,
    }
  }

  const prepareProductsForReplicate = async (ws: number, products: HotCopyProduct[], context?: HotCopyJobContext) => {
    const productIds: number[] = []
    const preparedProducts: HotCopyProduct[] = []
    const failures: string[] = []
    const totalProductImages = products.filter((product) => !product.isVideo).length
    let productIndex = 0

    for (const product of products) {
      if (product.isVideo) {
        preparedProducts.push({ ...product, file: null })
        continue
      }
      productIndex += 1
      try {
        const prepared = await prepareProductForReplicate(ws, product, productIndex, totalProductImages, context)
        preparedProducts.push(prepared.product)
        if (prepared.submitAssetId) {
          productIds.push(prepared.submitAssetId)
        } else if (prepared.failed) {
          failures.push(`第 ${productIndex} 张：${prepared.error || '素材处理失败'}`)
        }
      } catch (error: any) {
        preparedProducts.push({ ...product, file: null })
        failures.push(`第 ${productIndex} 张：${error?.message || '素材处理失败'}`)
      }
    }

    if (failures.length) {
      throw new Error(`替换素材人脸脱敏失败，已停止视频生成。${failures.join('；')}`)
    }
    if (!productIds.length) {
      throw new Error('未获取到替换素材,请至少上传一张图片')
    }

    return { productIds, preparedProducts }
  }

  // 入口提交:上传本地素材取 asset_id → 直接 video.replicate 出片
  const prepareAndGenerate = async (
    payload: HotCopyEntryPayload,
    prompt: string,
    context: HotCopyJobContext,
    generation: ReservedGen,
  ) => {
    const ws = context.workspaceId
    if (!ws) {
      if (isJobUiActive(context)) showToast('未选择工作空间,无法生成视频', 'error')
      void failHotCopyJob(context, 'failed', '未选择工作空间,无法生成视频')
      releaseGenTriggerLock(context.epoch)
      return
    }
    if (isJobUiActive(context)) setVidGenRunning(true)
    setJobPhase(context, '素材准备中…')
    // 元数据读取与素材上传/人脸检测并行，避免所有前置步骤结束后再额外等待最多 8 秒。
    const durationUrl = String(payload.videoPreview || payload.libraryVideo?.src || '')
    const durationSeedAssetId = Number(payload.libraryVideo?.assetId || 0) || 0
    const sourceDurationPromise = readSourceVideoDuration(durationSeedAssetId, durationUrl)
    let aborted = false
    try {
      // ① 源视频 asset_id(素材库已有;本地现传)
      let videoAssetId = 0
      let videoUrl = ''
      if (payload.videoSource === 'library' && payload.libraryVideo) {
        videoAssetId = payload.libraryVideo.assetId
        videoUrl = payload.libraryVideo.src
      } else if (payload.videoSource === 'local' && payload.videoFile) {
        setJobPhase(context, '爆款视频上传中…')
        videoAssetId = await uploadHotCopyAsset(ws, payload.videoFile)
        videoUrl = payload.videoPreview
      }
      if (!videoAssetId) throw new Error('爆款视频上传失败,请重试')
      if (sourceDurationReadRef.current?.key === `0:${videoUrl}`) {
        sourceDurationReadRef.current.key = `${videoAssetId}:${videoUrl}`
      }

      // ② 替换素材图必须先完成人脸脱敏；任意一张失败都停止提交，不能回退原图绕过审核。
      const { productIds, preparedProducts } = await prepareProductsForReplicate(ws, payload.products, context)
      const nextEntryInitial = buildEntrySnapshot({
        ...payload,
        videoSource: 'library',
        videoFile: null,
        libraryVideo: { assetId: videoAssetId, src: videoUrl },
        videoPreview: videoUrl,
        products: preparedProducts,
      })
      const cachedSourceDuration = isJobUiActive(context)
        ? resolveStoredSourceDuration(videoAssetId, loadCurrentHotCopyDraft(ws))
        : 0
      const originalProductAssetIds = resolveHotCopyOriginalProductAssetIds(nextEntryInitial)
      if (isJobUiActive(context)) {
        setSourceVideo({ assetId: videoAssetId, url: videoUrl })
        setProductAssetIds(productIds)
        setEntryInitial(nextEntryInitial)
        persistNow({
          sourceVideo: { assetId: videoAssetId, url: videoUrl },
          originalProductAssetIds,
          productAssetIds: productIds,
          entryInitial: nextEntryInitial,
        })
      }
      await persistTrackedHotCopyJobProgress(context, {
        status: 'preparing',
        sourceVideo: { assetId: videoAssetId, url: videoUrl },
        originalProductAssetIds,
        productAssetIds: productIds,
        entryInitial: nextEntryInitial,
      })

      // 读源视频真实时长(秒),按它计费(source_video_duration);读不到回退默认 duration
      const srcDur = cachedSourceDuration || (await sourceDurationPromise)
      if (srcDur) {
        if (isJobUiActive(context)) {
          setSourceVideoDurSec(srcDur)
          setSourceVideoDurAssetId(videoAssetId)
          persistNow({ sourceVideoDurationSec: srcDur, sourceVideoDurationAssetId: videoAssetId })
        }
      }

      // ③ 出片
      setJobPhase(context, '正在提交视频任务…')
      await doReplicate(ws, videoAssetId, productIds, prompt, srcDur, generation, context)
      if (isJobUiActive(context)) markGen(generation.id, 'published')
    } catch (e: any) {
      const taskId =
        Number(e?.hotCopyTaskId || (isJobUiActive(context) ? loadCurrentHotCopyDraft(ws)?.vidGenTaskId : 0) || 0) || 0
      if (isAbortedTaskError(e)) {
        aborted = true
        void failHotCopyJob(context, 'reconnecting', e?.message || '任务等待已中断，正在恢复', taskId)
        if (isJobUiActive(context)) {
          setHotCopyPhase('')
          if (taskId) scheduleResumeVideoTask(ws, taskId)
        }
        return
      }
      if (taskId > 0 && isTransientTaskRecoveryError(e)) {
        aborted = true
        void failHotCopyJob(context, 'reconnecting', e?.message || '任务状态查询异常', taskId)
        if (isJobUiActive(context)) keepVideoTaskForReconnect(e, ws, taskId)
        return
      }
      const cancelled = isTaskCancelled(e)
      const message = e?.message || '请重试'
      const terminalPersisted = await failHotCopyJob(context, cancelled ? 'cancelled' : 'failed', message, taskId)
      aborted = !terminalPersisted
      if (terminalPersisted && isJobUiActive(context)) {
        persistNow({ videoGenerating: false, vidGenTaskId: 0 })
        if (cancelled) {
          markGen(generation.id, 'cancelled')
          showToast('视频生成已中断', 'info')
        } else {
          markGen(generation.id, 'failed', message, generation)
          showToast(`视频生成失败:${message}`, 'error')
        }
      }
    } finally {
      if (isJobUiActive(context)) clearPendingUiGeneration(generation.id)
      releaseGenTriggerLock(context.epoch)
      if (!aborted && isJobUiActive(context)) {
        persistNow({ videoGenerating: false, vidGenTaskId: 0 })
        setVidGenRunning(false)
        setVidGenTaskId(0)
        setHotCopyPhase('')
      }
    }
  }

  // VideoStage「重新生成 / 确认修改」:
  //  - opts.edit=true(「确认修改」)且已有整片时:走视频编辑(video.edit,模型 happyhorse-1.0-video-edit),
  //    在已生成的整片基础上按修改意见微调(与智能成片一致),不再用 video.replicate 从源视频重做同款。
  //  - 否则(「重新生成」):基于已上传的源视频 + 替换素材重跑 replicate。
  const withPreviousVideoHint = (message: string) =>
    hasVideoResult(fullVideo, videoVersions) ? `${message}；当前播放的是上一版成功视频` : message

  const regenerate = async (note?: string, opts?: { edit?: boolean }) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成视频', 'error')
      return
    }
    if (!acquireGenTriggerLock()) return
    const epoch = sessionEpochRef.current
    const lockedProjectId = Number(projectIdRef.current || projectId || 0) || 0
    if (!lockedProjectId) {
      showToast('项目尚未建立，请返回入口重新发起生成', 'error')
      releaseGenTriggerLock(epoch)
      return
    }
    if (isVideoGenRunning('hot-copy', ws, lockedProjectId)) {
      showToast('该项目已在另一个页面生成视频，请等待任务完成', 'info')
      releaseGenTriggerLock(epoch)
      return
    }
    terminalJobResultsRef.current.delete(lockedProjectId)

    // 「确认修改」:把当前整片当 video 输入,按修改提示在原视频基础上改
    if (opts?.edit && fullVideo.assetId) {
      setVidGenRunning(true)
      setHotCopyPhase('视频修改生成中…')
      const generation = reserveGen('确认修改', note || '')
      const context = createJobContext({
        epoch,
        workspaceId: ws,
        projectId: lockedProjectId,
        generation,
        title: projectName,
        prompt: note || basePrompt,
        ratio: genRatio,
        durationSec: genDurationSec,
        operationCode: 'video.edit',
        entryInitial,
      })
      upsertHotCopyTaskCenter(context, 'preparing', { taskId: 0 })
      beginPendingUiGeneration(generation)
      void persistTrackedHotCopyJobProgress(context, { status: 'preparing', taskId: 0, entryInitial }).catch(
        () => undefined,
      )
      let keepPending = false
      let activeEditTaskId = 0
      try {
        const plans = await resolvePlanCandidates()
        const editPrompt = [
          '请在保留原视频镜头内容、顺序与节奏的前提下,按以下修改要求调整画面(只改提到的部分,其余保持不变):',
          note || '',
        ]
          .filter(Boolean)
          .join('\n')
        const editSrcDur = (await readVideoDurationSec(fullVideo.url)) || boundSourceVideoDurSec || 0
        const trackedEdit = bindRunningVideoPromise(
          editFullVideo({
            workspaceId: ws,
            videoAssetId: fullVideo.assetId,
            prompt: editPrompt,
            ratio: genRatio,
            durationSec: genDurationSec,
            sourceVideoDurationSec: editSrcDur,
            modelPlanCandidates: plans,
            idempotencyKey: context.taskCenterId,
            onTask: (id) => {
              activeEditTaskId = Number(id || 0) || 0
              patchHotCopyTaskCenter(context, { status: 'processing', taskId: activeEditTaskId, error: '' })
              void persistRecoveryCredential(context, {
                status: 'processing',
                taskId: activeEditTaskId,
                sourceVideo: { assetId: fullVideo.assetId, url: fullVideo.url },
                sourceVideoDurationSec: editSrcDur,
              }).catch(() => undefined)
              if (lockedProjectId && activeEditTaskId > 0) {
                updateRunningVideoGenMeta('hot-copy', context.workspaceId, lockedProjectId, {
                  taskId: activeEditTaskId,
                  generationId: generation.id,
                  status: 'processing',
                })
              }
              if (isJobUiActive(context)) {
                setVidGenTaskId(id)
                if (activeEditTaskId > 0) {
                  activateGen(generation, activeEditTaskId)
                  clearPendingUiGeneration(generation.id)
                }
              }
            },
            onProgress: (progress) => patchHotCopyTaskCenter(context, { status: 'processing', progress, error: '' }),
          }),
          { generationId: generation.id, status: 'preparing', context },
        )
        const { url, assetId } = await trackedEdit
        await completeHotCopyJob(context, { url, assetId }, activeEditTaskId)
        if (isJobUiActive(context)) markGen(generation.id, 'published')
      } catch (e: any) {
        if (activeEditTaskId > 0 && isTransientTaskRecoveryError(e)) {
          keepPending = true
          void failHotCopyJob(context, 'reconnecting', e?.message || '任务状态查询异常', activeEditTaskId)
          if (isJobUiActive(context)) keepVideoTaskForReconnect(e, ws, activeEditTaskId)
          return
        }
        const message = withPreviousVideoHint(e?.message || '请重试')
        const cancelled = isTaskCancelled(e)
        const terminalPersisted = await failHotCopyJob(
          context,
          cancelled ? 'cancelled' : 'failed',
          message,
          activeEditTaskId,
        )
        keepPending = !terminalPersisted
        if (terminalPersisted && isJobUiActive(context)) {
          markGen(generation.id, cancelled ? 'cancelled' : 'failed', message, generation)
          showToast(cancelled ? '视频生成已中断' : `视频修改失败:${message}`, cancelled ? 'info' : 'error')
        }
      } finally {
        if (isJobUiActive(context)) clearPendingUiGeneration(generation.id)
        releaseGenTriggerLock(context.epoch)
        if (!keepPending && isJobUiActive(context)) {
          persistNow({ videoGenerating: false, vidGenTaskId: 0 })
          setVidGenRunning(false)
          setVidGenTaskId(0)
          setHotCopyPhase('')
        }
      }
      return
    }

    // 「重新生成」:基于已上传的源视频 + 替换素材重跑 replicate(note=片段/整段修改意见)。
    // 旧草稿可能只把预览保存在 entryInitial,却没有同步 sourceVideo/productAssetIds；提交前统一恢复并回写，
    // 避免“上一页能看到素材，重新生成却提示未上传”的双状态问题。
    const localDraft = loadCurrentHotCopyDraft(ws)
    const entryBase = entryInitial || localDraft?.entryInitial
    let recoveredSourceVideo = resolveHotCopySourceVideo(
      {
        assetId: Number(sourceVideo.assetId || localDraft?.sourceVideo?.assetId || 0) || 0,
        url: String(sourceVideo.url || localDraft?.sourceVideo?.url || ''),
      },
      entryBase,
    )
    if (!recoveredSourceVideo.assetId && localDraft?.entryInitial && localDraft.entryInitial !== entryBase) {
      recoveredSourceVideo = resolveHotCopySourceVideo(recoveredSourceVideo, localDraft.entryInitial)
    }
    let recoveredProductAssetIds = resolveHotCopyProductAssetIds(
      productAssetIds.length ? productAssetIds : localDraft?.productAssetIds,
      entryBase,
    )
    if (!recoveredProductAssetIds.length && localDraft?.entryInitial && localDraft.entryInitial !== entryBase) {
      recoveredProductAssetIds = resolveHotCopyProductAssetIds(localDraft.productAssetIds, localDraft.entryInitial)
    }
    const recoveredEntryInitial = withResolvedHotCopyAssets(
      entryBase || localDraft?.entryInitial,
      recoveredSourceVideo,
      recoveredProductAssetIds,
    )

    if (!recoveredSourceVideo.assetId) {
      showToast(
        recoveredSourceVideo.url
          ? '源视频预览仍在，但缺少可用于生成的资源 ID，请返回上一步重新选择视频'
          : '请先上传爆款视频',
        'error',
      )
      releaseGenTriggerLock()
      return
    }
    if (!recoveredProductAssetIds.length) {
      const hasProductPreview = [entryBase, localDraft?.entryInitial].some((entry) =>
        (Array.isArray(entry?.products) ? entry.products : []).some((product) => !product?.isVideo && product?.url),
      )
      showToast(
        hasProductPreview
          ? '替换素材预览仍在，但缺少可用于生成的资源 ID，请返回上一步重新选择图片'
          : '请至少上传一张替换素材图片',
        'error',
      )
      releaseGenTriggerLock()
      return
    }

    setSourceVideo(recoveredSourceVideo)
    setProductAssetIds(recoveredProductAssetIds)
    if (recoveredEntryInitial) setEntryInitial(recoveredEntryInitial)
    persistNow({
      sourceVideo: recoveredSourceVideo,
      originalProductAssetIds: resolveHotCopyOriginalProductAssetIds(
        recoveredEntryInitial,
        localDraft?.originalProductAssetIds,
      ),
      productAssetIds: recoveredProductAssetIds,
      ...(recoveredEntryInitial ? { entryInitial: recoveredEntryInitial } : {}),
    })
    if (projectIdRef.current) void putHotCopyDraftToBackend(ws)

    const generation = reserveGen('重新生成', note || '')
    const replicatePrompt = [basePrompt, note && `修改要求:${note}`].filter(Boolean).join('\n')
    const context = createJobContext({
      epoch,
      workspaceId: ws,
      projectId: lockedProjectId,
      generation,
      title: projectName,
      prompt: replicatePrompt,
      ratio: genRatio,
      durationSec: genDurationSec,
      operationCode: 'video.replicate',
      entryInitial: recoveredEntryInitial,
    })
    upsertHotCopyTaskCenter(context, 'preparing', { taskId: 0 })
    beginPendingUiGeneration(generation)
    setVidGenRunning(true)
    setHotCopyPhase('准备视频任务中…')
    void persistTrackedHotCopyJobProgress(context, {
      status: 'preparing',
      taskId: 0,
      sourceVideo: recoveredSourceVideo,
      originalProductAssetIds: resolveHotCopyOriginalProductAssetIds(
        recoveredEntryInitial,
        localDraft?.originalProductAssetIds,
      ),
      productAssetIds: recoveredProductAssetIds,
      entryInitial: recoveredEntryInitial,
    }).catch(() => undefined)
    let keepPending = false
    try {
      let safeProductAssetIds = recoveredProductAssetIds
      let safeEntryInitial = recoveredEntryInitial
      const recoveredProducts = Array.isArray(recoveredEntryInitial?.products)
        ? (recoveredEntryInitial.products as HotCopyProduct[])
        : []
      if (recoveredProducts.some((product) => !product.isVideo)) {
        const prepared = await prepareProductsForReplicate(ws, recoveredProducts, context)
        safeProductAssetIds = prepared.productIds
        safeEntryInitial = {
          ...recoveredEntryInitial,
          products: prepared.preparedProducts,
        }
        const originalProductAssetIds = resolveHotCopyOriginalProductAssetIds(
          safeEntryInitial,
          localDraft?.originalProductAssetIds,
        )
        if (isJobUiActive(context)) {
          setProductAssetIds(safeProductAssetIds)
          setEntryInitial(safeEntryInitial)
          persistNow({
            originalProductAssetIds,
            productAssetIds: safeProductAssetIds,
            entryInitial: safeEntryInitial,
          })
        }
        await persistTrackedHotCopyJobProgress(context, {
          status: 'preparing',
          sourceVideo: recoveredSourceVideo,
          originalProductAssetIds,
          productAssetIds: safeProductAssetIds,
          entryInitial: safeEntryInitial,
        })
      }
      let reSrcDur =
        sourceVideoDurAssetId === recoveredSourceVideo.assetId && sourceVideoDurSec > 0
          ? sourceVideoDurSec
          : resolveStoredSourceDuration(recoveredSourceVideo.assetId, localDraft)
      if (!reSrcDur) {
        reSrcDur = (await readSourceVideoDuration(recoveredSourceVideo.assetId, recoveredSourceVideo.url)) || 0
      }
      if (reSrcDur > 0) {
        if (isJobUiActive(context)) {
          setSourceVideoDurSec(reSrcDur)
          setSourceVideoDurAssetId(recoveredSourceVideo.assetId)
          persistNow({
            sourceVideoDurationSec: reSrcDur,
            sourceVideoDurationAssetId: recoveredSourceVideo.assetId,
          })
        }
      }
      setJobPhase(context, '正在提交视频任务…')
      await doReplicate(
        ws,
        recoveredSourceVideo.assetId,
        safeProductAssetIds,
        replicatePrompt,
        reSrcDur,
        generation,
        context,
      )
      if (isJobUiActive(context)) markGen(generation.id, 'published')
    } catch (e: any) {
      const taskId =
        Number(e?.hotCopyTaskId || (isJobUiActive(context) ? loadCurrentHotCopyDraft(ws)?.vidGenTaskId : 0) || 0) || 0
      if (taskId > 0 && isTransientTaskRecoveryError(e)) {
        keepPending = true
        void failHotCopyJob(context, 'reconnecting', e?.message || '任务状态查询异常', taskId)
        if (isJobUiActive(context)) keepVideoTaskForReconnect(e, ws, taskId)
        return
      }
      const cancelled = isTaskCancelled(e)
      const message = withPreviousVideoHint(e?.message || '请重试')
      const terminalPersisted = await failHotCopyJob(context, cancelled ? 'cancelled' : 'failed', message, taskId)
      keepPending = !terminalPersisted
      if (terminalPersisted && isJobUiActive(context)) {
        if (cancelled) {
          markGen(generation.id, 'cancelled')
          showToast('视频生成已中断', 'info')
        } else {
          markGen(generation.id, 'failed', message, generation)
          showToast(`视频生成失败:${message}`, 'error')
        }
      }
    } finally {
      if (isJobUiActive(context)) clearPendingUiGeneration(generation.id)
      releaseGenTriggerLock(context.epoch)
      if (!keepPending && isJobUiActive(context)) {
        setVidGenRunning(false)
        setVidGenTaskId(0)
        setHotCopyPhase('')
      }
    }
  }

  // 下载视频:弹「另存为」让用户自选保存位置(不支持的浏览器回退自动下载)。
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
      showToast(e?.message || '视频下载失败,请稍后重试', 'error')
    }
  }

  const handleEntryDraftChange = useLatestCallback((payload: HotCopyEntryPayload) => {
    const nextEntry = buildEntrySnapshot(payload)
    const nextSourceVideo = resolveHotCopySourceVideo(undefined, nextEntry)
    const nextProductAssetIds = resolveHotCopyProductAssetIds(undefined, nextEntry)
    const nextDurationSec = parseDurationSeconds(payload.duration) || DEFAULT_DURATION_SEC
    const nextRatio = String(payload.ratio || DEFAULT_RATIO)
    const sourceChanged =
      Number(nextSourceVideo.assetId || 0) !== Number(sourceVideo.assetId || 0) ||
      String(nextSourceVideo.url || '') !== String(sourceVideo.url || '')

    setEntryInitial(nextEntry)
    setBasePrompt(buildBasePrompt(payload.tab, payload.text))
    setSourceVideo(nextSourceVideo)
    setProductAssetIds(nextProductAssetIds)
    setGenRatio(nextRatio)
    setGenDurationSec(nextDurationSec)
    if (sourceChanged) {
      setSourceVideoDurSec(0)
      setSourceVideoDurAssetId(0)
      sourceDurationReadRef.current = null
    }
  })

  // 入口提交「做同款/生成视频」→ 需登录(免登录可进页面/上传,但生成需登录)
  const handleStart = (payload: HotCopyEntryPayload) => {
    const durationValidation = validateCreativeDurationSelection(payload.text, payload.duration, {
      supportedDurations: SMART_VIDEO_DURATIONS,
      supportedDurationLabel: '1至15秒内的整数',
    })
    if (!durationValidation.valid) {
      showToast(durationValidation.message, 'error')
      return
    }
    const ws = Number(workspaceId || 0)
    const d = ws ? loadCurrentHotCopyDraft(ws) : null
    const pendingTask = Number(d?.vidGenTaskId || 0) || 0
    const hasResult = hasVideoResult(d?.fullVideo, d?.videoVersions)
    if (ws && pendingTask > 0 && !hasResult) {
      void requireAuth(async () => {
        const recoveredSourceVideo = resolveHotCopySourceVideo(d?.sourceVideo, d?.entryInitial)
        const recoveredProductAssetIds = resolveHotCopyProductAssetIds(d?.productAssetIds, d?.entryInitial)
        setStarted(true)
        setStep(1)
        setMaxReached(1)
        setBasePrompt(String(d?.basePrompt || ''))
        setProjectName(String(d?.projectName || projectName))
        nameTouchedRef.current = Boolean(d?.nameTouched)
        setNameTouched(nameTouchedRef.current)
        setSourceVideo(recoveredSourceVideo)
        const recoveredSourceDuration = resolveStoredSourceDuration(recoveredSourceVideo.assetId, d)
        setSourceVideoDurSec(recoveredSourceDuration)
        setSourceVideoDurAssetId(recoveredSourceDuration ? recoveredSourceVideo.assetId : 0)
        setProductAssetIds(recoveredProductAssetIds)
        setFullVideo(d?.fullVideo && typeof d.fullVideo === 'object' ? d.fullVideo : { url: '', assetId: 0 })
        setVideoVersions(Array.isArray(d?.videoVersions) ? d.videoVersions : [])
        setVideoModificationDraft(parseVideoModificationDraft(d?.videoModificationDraft))
        setVideoGenerations(normalizeGenRecords((d as any)?.videoGenerations))
        if (d?.genRatio) setGenRatio(String(d.genRatio))
        if (Number(d?.genDurationSec) > 0) setGenDurationSec(Number(d.genDurationSec))
        showToast('检测到视频正在生成，已为你恢复进度', 'info')
        resumeVideoTask(ws, pendingTask)
      })
      return
    }
    void requireAuth(() => {
      if (!acquireGenTriggerLock()) return
      startGenerate(payload)
    })
  }
  const startGenerate = (payload: HotCopyEntryPayload) => {
    if (!genTriggerLockRef.current) {
      if (!acquireGenTriggerLock()) return
    }
    const epoch = sessionEpochRef.current + 1
    sessionEpochRef.current = epoch
    const navigationRestartProjectId = routeId === 0 ? Number((location.state as any)?.restartProjectId || 0) || 0 : 0
    const targetProjectId = resolveHotCopySubmissionProjectId({
      routeProjectId: routeId,
      restartProjectId: navigationRestartProjectId,
      boundProjectId: projectIdRef.current,
    })
    if (targetProjectId) terminalJobResultsRef.current.delete(targetProjectId)
    const prompt = buildBasePrompt(payload.tab, payload.text)
    const nextEntryInitial = buildEntrySnapshot(payload)
    // 先显式置为生成中,再切到视频页,避免首帧短暂落到「暂无视频」占位态。
    setVidGenRunning(true)
    setVidGenTaskId(0)
    setEntryInitial(nextEntryInitial)
    setBasePrompt(prompt)
    // 采用用户在入口选择的成片尺寸/时长(默认 16:9、10s)
    const pickedRatio = payload.ratio || DEFAULT_RATIO
    const pickedDurSec = parseDurationSeconds(payload.duration) || DEFAULT_DURATION_SEC
    const initialProjectTitle = (() => {
      const current = String(projectName || '').trim()
      if (current && !isUnnamedTitle(current)) return current
      const firstPrompt = String(prompt || '')
        .split(/[;\n]/)
        .map((s) => s.trim())
        .find(Boolean)
      return (firstPrompt || '爆款复制项目').slice(0, 32)
    })()
    setGenRatio(pickedRatio)
    setGenDurationSec(pickedDurSec)
    setStarted(true)
    setStep(1)
    setMaxReached(1)
    setFullVideo({ url: '', assetId: 0 })
    setVideoVersions([])
    setVideoModificationDraft(createEmptyVideoModificationDraft())
    setSourceVideo({ assetId: 0, url: '' })
    setSourceVideoDurSec(0)
    setSourceVideoDurAssetId(0)
    setProductAssetIds([])
    setVideoGenerations([])
    if (!nameTouched && isUnnamedTitle(projectName)) setProjectName(initialProjectTitle)
    immediateSaveRef.current = false
    // 项目管理「新建视频」明确要求覆盖同一项目；普通入口才创建新项目。
    projectIdRef.current = targetProjectId
    draftRevisionRef.current = 0
    serverTitleRef.current = ''
    pendingTitleSaveRef.current = ''
    titleSaveFailedRef.current = false
    setProjectId(targetProjectId)
    // 立即落一份干净草稿(重置上一次结果),防止刚开始生成就切走时恢复到旧视频
    const ws = Number(workspaceId || 0)
    const generation = reserveGen('生成')
    if (ws) {
      saveHotCopyDraft(ws, {
        entryInitial: nextEntryInitial,
        projectId: targetProjectId,
        started: true,
        step: 1,
        maxReached: 1,
        basePrompt: prompt,
        projectName: initialProjectTitle,
        nameTouched,
        sourceVideo: { assetId: 0, url: '' },
        sourceVideoDurationSec: 0,
        sourceVideoDurationAssetId: 0,
        originalProductAssetIds: [],
        productAssetIds: [],
        fullVideo: { url: '', assetId: 0 },
        videoVersions: [],
        videoModificationDraft: createEmptyVideoModificationDraft(),
        videoGenerating: true,
        vidGenTaskId: 0,
        videoGenerations: [],
        genRatio: pickedRatio, // 用本地刚算出的值(setState 异步,此刻 state 还没更新)
        genDurationSec: pickedDurSec,
      })
    }
    beginPendingUiGeneration(generation)

    // 项目先于素材准备/AI task 建立。后续所有异步回调只使用这里捕获的 immutable context，
    // 即使用户点击「创建新视频」，旧任务也只回写旧项目，不会覆盖新页面的 projectIdRef。
    void (async () => {
      let jobContext: HotCopyJobContext | null = null
      if (!ws) {
        const message = '未选择工作空间,无法生成视频'
        if (aliveRef.current && sessionEpochRef.current === epoch) {
          markGen(generation.id, 'failed', message, generation)
          showToast(message, 'error')
          setVidGenRunning(false)
        }
        releaseGenTriggerLock(epoch)
        return
      }
      try {
        const project: any = targetProjectId
          ? await waitForCreativeProjectDraftSaves({ projectId: targetProjectId, workspaceId: ws }).then(() =>
              getCreativeProject({ projectId: targetProjectId, workspaceId: ws }),
            )
          : await createCreativeProject({
              workspace_id: ws,
              title: initialProjectTitle,
              name: initialProjectTitle,
            })
        const id = targetProjectId || resolveProjectId(project)
        if (!id) throw new Error('项目创建失败，请重试')
        const projectKey = hotCopyProjectKey(ws, id)
        if (!targetProjectId) baseDraftContentFingerprintByProjectRef.current.delete(projectKey)
        draftContentConflictNotifiedRef.current.delete(projectKey)
        const context = createJobContext({
          epoch,
          workspaceId: ws,
          projectId: id,
          generation,
          title: initialProjectTitle,
          prompt,
          ratio: pickedRatio,
          durationSec: pickedDurSec,
          operationCode: 'video.replicate',
          entryInitial: nextEntryInitial,
          allowFlowReplace: targetProjectId > 0,
          allowCreativeReplace: true,
        })
        jobContext = context
        upsertHotCopyTaskCenter(context, 'preparing', { taskId: 0 })
        await persistTrackedHotCopyJobProgress(context, {
          status: 'preparing',
          started: true,
          taskId: 0,
          sourceVideo: { assetId: 0, url: '' },
          originalProductAssetIds: [],
          productAssetIds: [],
          entryInitial: nextEntryInitial,
        })
        const latestRevision = await fetchRevision(id, ws, { acceptCreativeContent: true })

        if (aliveRef.current && sessionEpochRef.current === epoch) {
          projectIdRef.current = id
          const projectRevision = Number(project?.draft_revision ?? project?.data?.draft_revision ?? 0) || 0
          const revision = Number.isFinite(latestRevision) ? latestRevision : projectRevision
          draftRevisionRef.current = revision
          draftRevisionByProjectRef.current.set(projectKey, revision)
          serverTitleRef.current = initialProjectTitle
          setProjectId(id)
          const localDraft = loadHotCopyDraft(ws)
          if (localDraft) saveHotCopyDraft(ws, { ...localDraft, projectId: id })
          if (!targetProjectId) {
            routeBindingProjectIdRef.current = id
            navigate(`/hot-copy/${id}`, { replace: true, state: { hotCopyProjectBound: true } })
          }
          void autoNameProject(prompt, pickedDurSec)
        }
        await prepareAndGenerate(payload, prompt, context, generation)
      } catch (error: any) {
        const message = error?.message || '项目创建失败，请重试'
        const terminalPersisted = jobContext ? await failHotCopyJob(jobContext, 'failed', message) : true
        if (terminalPersisted && aliveRef.current && sessionEpochRef.current === epoch) {
          markGen(generation.id, 'failed', message, generation)
          showToast(message, 'error')
          setVidGenRunning(false)
          setHotCopyPhase('')
          clearPendingUiGeneration(generation.id)
        }
        releaseGenTriggerLock(epoch)
      }
    })()
  }

  const activeVideoGenerations = videoGenerations.filter(isActiveProcessingGen)
  const visiblePendingGenerations = [
    ...(pendingUiGeneration ? [pendingUiGeneration] : []),
    ...activeVideoGenerations.filter((generation) => generation.id !== pendingUiGeneration?.id),
  ].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
  const hasCommittedVideo = hasVideoResult(fullVideo, videoVersions)
  const hotCopyVideoGenerating =
    visiblePendingGenerations.length > 0 || vidGenRunning || (genTriggerBusy && !hasCommittedVideo)
  const hotCopyStepGenerating =
    vidGenRunning || visiblePendingGenerations.length > 0 || (genTriggerBusy && !hasCommittedVideo)

  const canResumeFlow = Boolean(
    entryInitial?.videoPreview ||
    entryInitial?.libraryVideo?.src ||
    (Array.isArray(entryInitial?.products) && entryInitial.products.length > 0) ||
    sourceVideo.url ||
    sourceVideo.assetId ||
    productAssetIds.length > 0 ||
    fullVideo.url ||
    fullVideo.assetId ||
    videoVersions.length > 0 ||
    vidGenRunning ||
    vidGenTaskId > 0 ||
    videoGenerations.length > 0,
  )

  const resumeFlow = () => {
    setStarted(true)
    setStep(1)
    setMaxReached((m) => Math.max(m, 1))
  }

  const resetToNewVideo = () => {
    const ws = Number(workspaceId || 0)
    // 仅解绑当前页面。后端 task / 全局登记表继续运行，完成后按其 immutable context 回写旧项目。
    sessionEpochRef.current += 1
    runningVideoPromiseRef.current = null
    vidGenAbortRef.current = null
    nameAbortRef.current?.abort()
    nameAbortRef.current = null
    setNaming(false)
    autoNameResumeKeyRef.current = ''
    if (vidGenPendingTimerRef.current) {
      window.clearInterval(vidGenPendingTimerRef.current)
      vidGenPendingTimerRef.current = 0
    }
    if (resumeRetryTimerRef.current) {
      window.clearTimeout(resumeRetryTimerRef.current)
      resumeRetryTimerRef.current = 0
    }
    clearStaleGenTimer()
    releaseGenTriggerLock()
    setStarted(false)
    setStep(0)
    setMaxReached(0)
    setBasePrompt('')
    setEntryInitial(undefined)
    setSourceVideo({ assetId: 0, url: '' })
    setSourceVideoDurSec(0)
    setSourceVideoDurAssetId(0)
    sourceDurationReadRef.current = null
    setProductAssetIds([])
    setFullVideo({ url: '', assetId: 0 })
    setVideoVersions([])
    setVideoModificationDraft(createEmptyVideoModificationDraft())
    setVidGenRunning(false)
    setGenTriggerBusy(false)
    setVidGenTaskId(0)
    setVideoGenerations([])
    clearPendingUiGeneration()
    const previousProjectId = Number(projectIdRef.current || 0)
    if (previousProjectId) {
      const previousProjectKey = hotCopyProjectKey(ws, previousProjectId)
      baseDraftContentFingerprintByProjectRef.current.delete(previousProjectKey)
      draftContentConflictNotifiedRef.current.delete(previousProjectKey)
    }
    projectIdRef.current = 0
    draftRevisionRef.current = 0
    projectVideoStoreRef.current = null
    pendingTitleSaveRef.current = ''
    titleSaveFailedRef.current = false
    draftSaveSequenceRef.current += 1
    lastSavedDraftFingerprintRef.current = ''
    queuedDraftSaveRef.current = null
    draftSaveStatusRef.current = 'idle'
    setDraftSaveStatus('idle')
    serverTitleRef.current = ''
    setProjectId(0)
    setProjectName('未命名项目')
    nameTouchedRef.current = false
    setNameTouched(false)
    if (ws) clearHotCopyDraft(ws)
    setEntryKey((k) => k + 1)
    navigate('/hot-copy', { state: { taskCenterNewSession: true } })
  }

  const goStep = (i: number) => {
    if (i <= 0) {
      setStarted(false)
      setStep(0)
      return
    }
    const next = Math.min(STEPS.length - 1, i)
    setStarted(true)
    setStep(next)
    setMaxReached((m) => Math.max(m, next))
  }

  const onNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
    else openComingSoon() // 设置/视频编辑/投前预审/数据看板等未上线项:弹全局「功能待开放」弹窗
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
      nameTouchedRef.current = true
      setProjectName(v)
      setNameTouched(true)
      setNaming(false)
    }
    setEditingName(false)
  }

  const retryLoadProject = () => {
    hydratedRef.current = false
    setProjectLoadError('')
    setProjectLoading(true)
    setProjectLoadRetry((value) => value + 1)
  }

  return (
    <div className="smart">
      <AppSidebar
        activeKey="hot-copy"
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
        ) : projectLoadError ? (
          <div className="smart__loaderr" role="alert">
            <div className="smart__loaderr-icon" aria-hidden="true">
              !
            </div>
            <div className="smart__loaderr-title">项目加载失败</div>
            <div className="smart__loaderr-msg">{projectLoadError}</div>
            <div className="smart__loaderr-actions">
              <button type="button" className="smart__btn smart__btn--primary" onClick={retryLoadProject}>
                重试
              </button>
              <button type="button" className="smart__btn" onClick={() => navigate('/projects')}>
                返回项目管理
              </button>
            </div>
          </div>
        ) : !started ? (
          <div className="smart__entry-with-tasks">
            <TaskCenterDrawer scope="hot-copy" />
            <div className="smart__entry-content">
              <Suspense fallback={<LazyHotCopyFallback label="正在加载爆款复制…" />}>
                <HotCopyEntry
                  key={entryKey}
                  onSubmit={handleStart}
                  onDraftChange={handleEntryDraftChange}
                  onNewVideo={resetToNewVideo}
                  busy={genTriggerBusy || vidGenRunning}
                  canResume={canResumeFlow}
                  onResume={resumeFlow}
                  initial={entryInitial}
                  ratioOptions={ratioOptions}
                />
              </Suspense>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="smart__newvideo" onClick={resetToNewVideo}>
              创建新视频
            </button>
            <div className="smart__progress">
              <StepProgress
                steps={STEPS}
                current={step}
                statuses={[
                  '已完成',
                  hotCopyStepGenerating ? hotCopyPhase || '视频生成中' : fullVideo.url ? '已完成' : '待生成',
                ]}
                onStepClick={(i) => goStep(i)}
              />
            </div>

            <div className="smart__projbar">
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
                <button type="button" className="smart__name" onClick={startRename} title="点击修改项目名">
                  <span className="smart__name-label">项目</span>
                  <span className="smart__name-text">/{projectName}</span>
                  {naming && <span className="smart__name-naming">AI 命名中…</span>}
                  <img className="smart__name-edit" src={iconProjectEdit} alt="" width={20} height={20} />
                </button>
              )}
              <DraftSaveIndicator status={draftSaveStatus} onRetry={() => void retryHotCopyCloudSave()} />
            </div>

            <div className="smart__body">
              <Suspense fallback={<LazyHotCopyFallback label="正在加载视频编辑器…" />}>
                <VideoStage
                  key={`hot-copy-video-stage-${videoStageKey}`}
                  shots={[]}
                  videoUrl={fullVideo.url}
                  videoAssetId={fullVideo.assetId}
                  videoGenerating={hotCopyVideoGenerating}
                  videoStatusText={hotCopyVideoGenerating ? hotCopyPhase || '爆款复制生成中…' : undefined}
                  loadingTitle="爆款复制生成中"
                  videoStartedAt={visiblePendingGenerations[0]?.createdAt || 0}
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
                    const sourceVideoDurationSec =
                      (await readVideoDurationSec(fullVideo.url)) || boundSourceVideoDurSec || 0
                    const result: any = await estimateVideoEditCost({
                      workspaceId: ws,
                      prompt: editPrompt,
                      ratio: genRatio,
                      durationSec: genDurationSec,
                      sourceVideoDurationSec,
                      modelPlanCandidates: plans,
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
                  pendingGenerations={visiblePendingGenerations.map((g) => ({
                    id: g.id,
                    createdAt: g.createdAt,
                    // 爆款复制不支持多任务排队；processing 历史统一按「生成中」展示，避免误导成排队态。
                    running: true,
                  }))}
                  pendingVideoCount={visiblePendingGenerations.length}
                  modificationDraft={videoModificationDraft}
                  onModificationDraftChange={setVideoModificationDraft}
                  onSwitchVideo={(v) => setFullVideo({ url: v.url, assetId: v.assetId })}
                  onRegenerateVideo={(note, opts) => regenerate(note, opts)}
                  onDownloadVideo={handleDownloadVideo}
                  onPrev={() => goStep(0)}
                />
              </Suspense>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
