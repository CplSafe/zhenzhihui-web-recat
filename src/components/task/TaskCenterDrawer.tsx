/**
 * TaskCenterDrawer — 首页侧栏任务中心列表。
 * 合并本地实时任务与后端历史项目，按智能成片/爆款复制筛选，并遵守当前用户的项目可见权限。
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { InboxOutlined, LeftOutlined, LoadingOutlined, PlayCircleOutlined, RightOutlined } from '@ant-design/icons'
import { getAssetDownloadUrl } from '@/api/business'
import { deriveProjectVideos } from '@/api/projectVideos'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { buildTaskCenterId, type TaskCenterScope, type TaskCenterTask, useTaskCenterStore } from '@/stores/taskCenter'
import { listAllCreativeProjects } from '@/utils/businessPagination'
import {
  getCreativeProjectDraft,
  isCreativeProjectRestrictedForUser,
  normalizeArray,
  toPlainObject,
} from '@/utils/creativeDraftMetadata'
import { readAiTaskProgress } from '@/utils/taskProgress'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import styles from './TaskCenterDrawer.module.less'

/** 当前任务类型页签、切换回调和布局扩展类名。 */
export interface TaskCenterDrawerProps {
  scope: TaskCenterScope
  onScopeChange?: (scope: TaskCenterScope) => void
  className?: string
}

/** 允许读取历史项目转换任务中的兼容扩展字段。 */
type TaskRecord = TaskCenterTask & Record<string, unknown>

/** 卡片视觉归类，与后端细粒度状态解耦。 */
type TaskTone = 'active' | 'queued' | 'failed' | 'completed'

/** 任务中心支持的业务页签。 */
const SCOPE_TABS: Array<{ value: TaskCenterScope; label: string }> = [
  { value: 'smart', label: '智能成片' },
  { value: 'hot-copy', label: '爆款复制' },
  { value: 'image', label: '图片' },
]

/** 历史与实时任务状态的失败/完成别名集合。 */
const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled', 'expired'])

/** 任务卡片识别已完成状态时兼容的后端别名。 */
const COMPLETED_STATUSES = new Set(['succeeded', 'success', 'completed', 'published', 'done'])

/** 智能成片和爆款复制各自最多在任务抽屉中展示的视频数量。 */
const MAX_VISIBLE_VIDEO_TASKS = 20

/** 过滤空值后拼接 CSS 类名。 */
const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/** 按字段优先级读取任务中的首个非空值。 */
function readValue(task: TaskRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = task[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/** 读取兼容字段并规范化为去空白文本。 */
function readText(task: TaskRecord, ...keys: string[]) {
  const value = readValue(task, ...keys)
  return value === undefined ? '' : String(value).trim()
}

/** 把历史数据中的制作类型别名归一化为任务中心页签值。 */
function normalizeScope(value: unknown): TaskCenterScope | '' {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
  if (normalized === 'smart' || normalized === 'smart-video') return 'smart'
  if (normalized === 'hot-copy' || normalized === 'hotcopy' || normalized === 'replicate') return 'hot-copy'
  if (
    normalized === 'image' ||
    normalized === 'smart-image' ||
    normalized === 'image-generation' ||
    normalized === 'text-to-image' ||
    normalized === 'image-to-image'
  ) {
    return 'image'
  }
  return ''
}

/** 综合 scope、模式与 operation_code 识别旧任务，避免图片任务被误归到视频页签。 */
function getTaskScope(task: TaskRecord): TaskCenterScope | '' {
  const operationCode = readText(task, 'operationCode', 'operation_code').toLowerCase()
  if (
    operationCode.startsWith('image.') ||
    operationCode.includes('text_to_image') ||
    operationCode.includes('image_to_image')
  ) {
    return 'image'
  }
  const mode = normalizeScope(readValue(task, 'mode', 'mediaType', 'media_type', 'taskType', 'task_type'))
  if (mode === 'image') return mode
  return normalizeScope(readValue(task, 'scope', 'flow'))
}

/** 返回当前页签的用户可读名称。 */
function getScopeLabel(scope: TaskCenterScope): string {
  if (scope === 'hot-copy') return '爆款复制'
  if (scope === 'image') return '图片'
  return '智能成片'
}

/** 读取并小写化任务状态。 */
function normalizeStatus(task: TaskRecord) {
  return readText(task, 'status', 'taskStatus', 'task_status').toLowerCase()
}

/** 统一识别当前任务与旧草稿中的失败状态别名。 */
function isFailedStatus(status: string): boolean {
  return FAILED_STATUSES.has(status) || status.includes('fail') || status.includes('error') || status.includes('失败')
}

/** 将多版本后端状态归并为四种卡片视觉状态。 */
function getTaskTone(task: TaskRecord): TaskTone {
  const status = normalizeStatus(task)
  if (isFailedStatus(status)) return 'failed'
  if (
    COMPLETED_STATUSES.has(status) ||
    status.includes('success') ||
    status.includes('complete') ||
    status.includes('完成')
  ) {
    return 'completed'
  }
  if (status.includes('queue') || status === 'pending' || status.includes('排队')) return 'queued'
  return 'active'
}

/** 图片页不展示生成失败记录；用户主动取消的任务仍保留，避免混淆两种终态。 */
function shouldHideFailedImageTask(task: TaskRecord): boolean {
  if (getTaskScope(task) !== 'image' || getTaskTone(task) !== 'failed') return false
  const status = normalizeStatus(task)
  return !status.includes('cancel') && !status.includes('取消')
}

/** 根据归一化状态生成用户可读的任务进度文案。 */
function getStatusLabel(task: TaskRecord, tone: TaskTone) {
  const status = normalizeStatus(task)
  if (tone === 'failed') return status.includes('cancel') || status.includes('取消') ? '已取消' : '生成失败'
  if (tone === 'completed') return '已生成'
  if (status.includes('queue') || status === 'pending' || status.includes('排队')) return '排队中'
  if (status.includes('prepar') || status.includes('准备')) return '准备中'
  if (status.includes('reconnect') || status.includes('重连')) return '正在恢复'
  return getTaskScope(task) === 'image' ? '图片生成中' : '视频生成中'
}

/** 读取真实后端百分比；未返回时保持不确定进度，不伪造固定数值。 */
function getProgress(task: TaskRecord, tone: TaskTone): number | undefined {
  if (tone === 'completed') return 100
  const progress = readAiTaskProgress(task)
  if (progress !== undefined) return progress
  if (tone === 'failed') return 0
  return undefined
}

/** 格式化百分比并去掉无意义的末尾零。 */
function formatProgress(progress: number): string {
  return `${Number(progress.toFixed(2))}%`
}

/** 从任务记录读取秒数或现成文案，缺失时明确显示“时长待定”。 */
function getDuration(task: TaskRecord) {
  const value = readValue(
    task,
    'durationLabel',
    'duration_label',
    'duration',
    'durationSec',
    'durationSeconds',
    'duration_seconds',
  )
  if (value === undefined) return '时长待定'
  if (typeof value === 'string' && /[^\d.]/.test(value.trim())) return value.trim()
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '时长待定'
  if (seconds < 60) return `${Math.round(seconds)}S`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return remainder ? `${minutes}分${remainder}秒` : `${minutes}分钟`
}

/** 将视频元数据秒数格式化为任务卡片时长。 */
function formatDurationSeconds(seconds: number): string {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  if (!value) return '时长待定'
  if (value < 60) return `${value}S`
  const minutes = Math.floor(value / 60)
  const remainder = value % 60
  return remainder ? `${minutes}分${remainder}秒` : `${minutes}分钟`
}

/** 从视频真实尺寸推断常用画幅，超出容差时保留原始宽高。 */
function ratioFromDimensions(width: number, height: number): string {
  if (!(width > 0) || !(height > 0)) return ''
  const value = width / height
  const common = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['1:1', 1],
  ] as const
  const nearest = common.reduce((best, item) => (Math.abs(item[1] - value) < Math.abs(best[1] - value) ? item : best))
  return Math.abs(nearest[1] - value) / nearest[1] <= 0.04 ? nearest[0] : `${width}:${height}`
}

/** 读取任务最近更新时间，用于实时任务和历史记录合并排序。 */
function getUpdatedAt(task: TaskRecord) {
  const value = readValue(task, 'updatedAt', 'updated_at', 'completedAt', 'completed_at', 'createdAt', 'created_at')
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const timestamp = Date.parse(String(value || ''))
  return Number.isFinite(timestamp) ? timestamp : 0
}

/** 兼容归档布尔值、时间和状态字段，判断任务是否已隐藏。 */
function isArchived(task: TaskRecord) {
  const archived = readValue(task, 'archived', 'isArchived', 'is_archived')
  if (archived === true || archived === 1 || archived === '1') return true
  if (readValue(task, 'archivedAt', 'archived_at')) return true
  return normalizeStatus(task) === 'archived'
}

/** 把历史项目时间转换为毫秒；缺失时用当前时间维持可排序性。 */
function historyTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()
}

/** 过滤当前用户无权查看的历史项目，成员仅看到自身或被授权项目。 */
export function filterTaskCenterHistoricalProjects(projects: unknown, currentUserId: unknown): any[] {
  const items = Array.isArray(projects) ? projects : []
  return items.filter((project) => !isCreativeProjectRestrictedForUser(project, currentUserId))
}

/** 收集当前用户受限的项目 ID，供本地实时任务二次权限过滤。 */
export function getRestrictedTaskCenterProjectIds(projects: unknown, currentUserId: unknown): Set<number> {
  const items = Array.isArray(projects) ? projects : []
  const ids = new Set<number>()
  items.forEach((project) => {
    if (!isCreativeProjectRestrictedForUser(project, currentUserId)) return
    const projectId = Number(project?.id ?? project?.project_id ?? project?.projectId ?? project?.data?.id ?? 0) || 0
    if (projectId > 0) ids.add(projectId)
  })
  return ids
}

/** 收集当前用户可访问项目 ID，采用白名单语义避免接口失败时误展示。 */
export function getAccessibleTaskCenterProjectIds(projects: unknown, currentUserId: unknown): Set<number> {
  const ids = new Set<number>()
  filterTaskCenterHistoricalProjects(projects, currentUserId).forEach((project) => {
    const projectId = Number(project?.id ?? project?.project_id ?? project?.projectId ?? project?.data?.id ?? 0) || 0
    if (projectId > 0) ids.add(projectId)
  })
  return ids
}

/** 判断任务是否属于受限项目；权限尚未加载时对有关联项目的任务从严隐藏。 */
export function isTaskCenterTaskRestricted(
  task: TaskCenterTask | Record<string, unknown>,
  restrictedProjectIds: ReadonlySet<number>,
  projectPermissionsLoaded = true,
): boolean {
  const record = task as TaskRecord
  const projectId = Number(readValue(record, 'projectId', 'project_id') || 0) || 0
  if (projectId <= 0) return false
  return !projectPermissionsLoaded || restrictedProjectIds.has(projectId)
}

/** 判断任务项目是否在已加载的可访问白名单内。 */
export function isTaskCenterTaskAccessible(
  task: TaskCenterTask | Record<string, unknown>,
  accessibleProjectIds: ReadonlySet<number>,
  projectPermissionsLoaded = true,
): boolean {
  const record = task as TaskRecord
  const projectId = Number(readValue(record, 'projectId', 'project_id') || 0) || 0
  if (projectId <= 0) return true
  return projectPermissionsLoaded && accessibleProjectIds.has(projectId)
}

/** 从图片消息兼容字段中读取可展示地址和持久资产 ID。 */
function readMessageImage(value: unknown): { url: string; assetId: number } {
  if (typeof value === 'string') return { url: value.trim(), assetId: 0 }
  const image = toPlainObject(value)
  if (!image) return { url: '', assetId: 0 }
  return {
    url: String(
      image.url || image.src || image.image || image.imageUrl || image.image_url || image.downloadUrl || '',
    ).trim(),
    assetId: Number(image.assetId || image.asset_id || image.imageAssetId || image.image_asset_id || 0) || 0,
  }
}

/** 图片项目由明确的入口模式或已保存的图片对话识别。 */
function readImageProjectState(project: any): { smart: any; messages: any[]; imageMode: boolean } {
  const draft = getCreativeProjectDraft(project)
  const smart = toPlainObject(draft?.smart) || draft || {}
  const messages = normalizeArray(smart?.imageMessages ?? draft?.imageMessages)
  const mode = String(smart?.entryMeta?.mode || draft?.entryMeta?.mode || smart?.mode || draft?.mode || '')
    .trim()
    .toLowerCase()
  return { smart, messages, imageMode: mode === 'image' || messages.length > 0 }
}

/** 将项目草稿里已成功保存的图片结果转换为历史任务，不额外请求后端接口。 */
function deriveHistoricalImageTasks(project: any, workspaceId: number, ownerUserId: number): TaskCenterTask[] {
  const { smart, messages, imageMode } = readImageProjectState(project)
  if (!imageMode) return []
  const projectId = Number(project?.id ?? project?.project_id ?? project?.projectId ?? 0) || 0
  if (!projectId) return []
  const projectTitle = String(project?.title || project?.name || '历史图片').trim() || '历史图片'
  const entryRatio = String(smart?.entryMeta?.ratio || '').trim()
  const projectUpdatedAt = historyTimestamp(
    project?.updated_at || project?.updatedAt || project?.last_saved_at || project?.created_at || project?.createdAt,
  )
  let latestPrompt = ''
  let resultIndex = 0
  const tasks: TaskCenterTask[] = []

  messages.forEach((message, messageIndex) => {
    const role = String(message?.role || '').toLowerCase()
    if (role === 'user') {
      latestPrompt = String(message?.text || '').trim()
      return
    }
    if (role !== 'assistant') return
    const status = String(message?.status || '').toLowerCase()
    if (status === 'pending' || isFailedStatus(status)) return
    const images = normalizeArray(message?.images)
      .map(readMessageImage)
      .filter((image) => image.url || image.assetId)
    images.forEach((image, imageIndex) => {
      resultIndex += 1
      const messageId = String(message?.id || `message-${messageIndex + 1}`)
      const generationId = `history:image:${messageId}:${imageIndex + 1}`
      const messageTimestamp = message?.updatedAt || message?.updated_at || message?.createdAt || message?.created_at
      const updatedAt = messageTimestamp ? historyTimestamp(messageTimestamp) : projectUpdatedAt
      const operationCode = String(message?.operationCode || message?.operation_code || '').trim()
      tasks.push({
        id: buildTaskCenterId('image', workspaceId, projectId, generationId),
        scope: 'image',
        workspaceId,
        projectId,
        generationId,
        taskId: Number(message?.taskId || message?.task_id || 0) || 0,
        status: 'succeeded',
        title: latestPrompt || `${projectTitle} · 图片 ${resultIndex}`,
        ratio: String(message?.ratio || message?.request?.ratio || entryRatio),
        durationSec: 0,
        thumbnailUrl: image.url,
        ...(image.assetId ? { thumbnailAssetId: image.assetId } : {}),
        operationCode,
        startedAt: updatedAt || projectUpdatedAt,
        updatedAt: updatedAt || projectUpdatedAt,
        progress: 100,
        ...(image.url ? { resultUrl: image.url } : {}),
        ...(image.assetId ? { resultAssetId: image.assetId } : {}),
        ownerUserId,
      })
    })
  })
  return tasks
}

/** 将当前空间已发布视频及图片项目中已保存的成功结果转换为任务中心历史卡片。 */
async function loadHistoricalTasks(
  workspaceId: number,
  ownerUserId: number,
  isCurrent: () => boolean,
): Promise<{ tasks: TaskCenterTask[]; accessibleProjectIds: Set<number> }> {
  const projects = await listAllCreativeProjects({ workspaceId, isCurrent })
  const accessibleProjectIds = getAccessibleTaskCenterProjectIds(projects, ownerUserId)

  const tasks = filterTaskCenterHistoricalProjects(projects, ownerUserId).flatMap((project) => {
    const videoTasks = deriveProjectVideos({ project, workspaceId })
      .filter((video) => video.status === 'published' && Boolean(video.videoUrl) && !video.manual)
      .map((video) => {
        const scope: TaskCenterScope = String(video.flow || '').toLowerCase() === 'hot-copy' ? 'hot-copy' : 'smart'
        const projectId = Number(video.projectId || project?.id || 0) || 0
        const generationId = `history:${video.id}`
        const updatedAt = historyTimestamp(video.updatedAt || video.createdAt)
        return {
          id: buildTaskCenterId(scope, workspaceId, projectId, generationId),
          scope,
          workspaceId,
          projectId,
          generationId,
          taskId: 0,
          status: 'succeeded' as const,
          title: String(video.title || project?.title || project?.name || '历史视频'),
          ratio: String(video.ratio || ''),
          durationSec: Number(video.durationSeconds || 0) || 0,
          thumbnailUrl: String(video.coverUrl || ''),
          operationCode: scope === 'hot-copy' ? 'video.replicate' : 'video.generate',
          startedAt: historyTimestamp(video.createdAt || video.updatedAt),
          updatedAt,
          progress: 100,
          resultUrl: String(video.videoUrl || ''),
          ...(video.videoAssetId ? { resultAssetId: video.videoAssetId } : {}),
          ownerUserId,
        }
      })
    return [...videoTasks, ...deriveHistoricalImageTasks(project, workspaceId, ownerUserId)]
  })

  return { tasks, accessibleProjectIds }
}

/** 优先展示已有视频/封面，地址失效时按资产 ID 重新取签名地址并读取真实媒体元数据。 */
function TaskThumbnail({
  imageSrc,
  videoSrc,
  active,
  workspaceId,
  fallbackAssetId,
  fallbackAssetIsVideo,
  onVideoMetadata,
}: {
  imageSrc: string
  videoSrc: string
  active: boolean
  workspaceId: number
  fallbackAssetId: number
  fallbackAssetIsVideo: boolean
  onVideoMetadata?: (metadata: { duration: number; width: number; height: number }) => void
}) {
  const [failedImageSrc, setFailedImageSrc] = useState('')
  const [failedVideoSrc, setFailedVideoSrc] = useState('')
  const [assetUrl, setAssetUrl] = useState('')

  useEffect(() => {
    let disposed = false
    setAssetUrl('')
    const hasUsableImage = Boolean(imageSrc && failedImageSrc !== imageSrc)
    const hasUsableVideo = Boolean(videoSrc && failedVideoSrc !== videoSrc)
    if (hasUsableImage || hasUsableVideo || !workspaceId || !fallbackAssetId) return () => undefined
    void getAssetDownloadUrl({ workspaceId, assetId: fallbackAssetId })
      .then((url: string) => {
        if (!disposed) setAssetUrl(String(url || ''))
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [failedImageSrc, failedVideoSrc, fallbackAssetId, imageSrc, videoSrc, workspaceId])

  const resolvedVideoSrc = videoSrc || (fallbackAssetIsVideo ? assetUrl : '')
  const resolvedImageSrc = imageSrc || (!fallbackAssetIsVideo ? assetUrl : '')

  return (
    <span className={styles.thumbnail} aria-hidden="true">
      <span className={styles.thumbnailPlaceholder}>
        {active ? (
          <LoadingOutlined className={styles.thumbnailSpinner} spin />
        ) : (
          <PlayCircleOutlined className={styles.thumbnailPlay} />
        )}
      </span>
      {resolvedVideoSrc && failedVideoSrc !== resolvedVideoSrc && (
        <video
          key={resolvedVideoSrc}
          className={styles.thumbnailImage}
          src={resolvedVideoSrc}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            onVideoMetadata?.({ duration: video.duration, width: video.videoWidth, height: video.videoHeight })
          }}
          onError={() => setFailedVideoSrc(resolvedVideoSrc)}
        />
      )}
      {(!resolvedVideoSrc || failedVideoSrc === resolvedVideoSrc) &&
        resolvedImageSrc &&
        failedImageSrc !== resolvedImageSrc && (
          <img
            key={resolvedImageSrc}
            className={styles.thumbnailImage}
            src={resolvedImageSrc}
            alt=""
            onError={() => setFailedImageSrc(resolvedImageSrc)}
          />
        )}
    </span>
  )
}

/** 展示一条任务的真实状态、百分比、比例和秒数，并提供播放/进入项目及隐藏操作。 */
function TaskCard({ task, onOpen, onArchive }: { task: TaskCenterTask; onOpen: () => void; onArchive: () => void }) {
  const [videoMetadata, setVideoMetadata] = useState({ duration: 0, width: 0, height: 0 })
  const record = task as TaskRecord
  const tone = getTaskTone(record)
  const progress = getProgress(record, tone)
  const taskScope = getTaskScope(record) || 'smart'
  const title =
    readText(record, 'title', 'name', 'projectName', 'project_name') ||
    (taskScope === 'image' ? '图片生成任务' : `${getScopeLabel(taskScope)}视频任务`)
  const ratio =
    readText(record, 'ratio', 'aspectRatio', 'aspect_ratio') ||
    ratioFromDimensions(videoMetadata.width, videoMetadata.height) ||
    '比例待定'
  const recordedDuration = Number(
    readValue(record, 'durationSec', 'durationSeconds', 'duration_seconds', 'duration') || 0,
  )
  const durationLabel = recordedDuration > 0 ? getDuration(record) : formatDurationSeconds(videoMetadata.duration)
  const thumbnail = readText(
    record,
    'thumbnailUrl',
    'thumbnail_url',
    'coverUrl',
    'cover_url',
    'thumb',
    'posterUrl',
    'poster_url',
  )
  const resultMedia = tone === 'completed' ? readText(record, 'resultUrl', 'result_url') : ''
  const resultVideo = taskScope === 'image' ? '' : resultMedia
  const resultImage = taskScope === 'image' ? resultMedia : ''
  const resultAssetId = Number(readValue(record, 'resultAssetId', 'result_asset_id') || 0) || 0
  const thumbnailAssetId = Number(readValue(record, 'thumbnailAssetId', 'thumbnail_asset_id') || 0) || 0
  const fallbackAssetId = tone === 'completed' && resultAssetId ? resultAssetId : thumbnailAssetId
  const fallbackAssetIsVideo =
    taskScope !== 'image' && Boolean((tone === 'completed' && resultAssetId) || taskScope === 'hot-copy')
  const errorMessage = readText(record, 'errorMessage', 'error_message', 'error', 'message')
  const hasDestination = Boolean(readValue(record, 'projectId', 'project_id'))
  const canPlay = taskScope !== 'image' && tone === 'completed' && Boolean(resultVideo || resultAssetId)
  const operationCode = readText(record, 'operationCode', 'operation_code').toLowerCase()
  const mediaLabel =
    taskScope === 'image'
      ? operationCode.includes('image_to_image')
        ? '参考图生成'
        : operationCode.includes('text_to_image')
          ? '文生图'
          : '图片'
      : durationLabel

  return (
    <article className={cx(styles.taskCard, styles[tone])}>
      <button
        type="button"
        className={cx(styles.taskMain, !hasDestination && styles.taskMainDisabled)}
        onClick={onOpen}
        disabled={!hasDestination}
        aria-label={
          hasDestination
            ? `${title}，${getStatusLabel(record, tone)}，${canPlay ? '播放视频' : '打开项目'}`
            : `${title}，暂时无法打开项目`
        }
      >
        <TaskThumbnail
          imageSrc={thumbnail || resultImage}
          videoSrc={resultVideo}
          active={tone === 'active' || tone === 'queued'}
          workspaceId={Number(task.workspaceId || 0) || 0}
          fallbackAssetId={fallbackAssetId}
          fallbackAssetIsVideo={fallbackAssetIsVideo}
          onVideoMetadata={taskScope !== 'image' && tone === 'completed' ? setVideoMetadata : undefined}
        />
        <span className={styles.taskContent}>
          <span className={styles.statusLine}>
            <span className={styles.statusText}>{getStatusLabel(record, tone)}</span>
          </span>
          <span className={styles.taskTitle} title={title}>
            {title}
          </span>
          <span className={styles.taskMeta}>
            <span>{ratio}</span>
            <span className={styles.metaDivider} aria-hidden="true" />
            <span>{mediaLabel}</span>
          </span>
          {(tone === 'active' || tone === 'queued') && (
            <span className={styles.progressRow}>
              <span
                className={styles.progressTrack}
                role="progressbar"
                aria-label={`${title}生成进度`}
                aria-valuemin={0}
                aria-valuemax={100}
                {...(progress === undefined ? { 'aria-valuetext': '等待后端返回进度' } : { 'aria-valuenow': progress })}
              >
                <span
                  className={cx(styles.progressValue, progress === undefined && styles.progressIndeterminate)}
                  style={progress === undefined ? undefined : { width: `${progress}%` }}
                />
              </span>
              {progress !== undefined && <span className={styles.progressText}>{formatProgress(progress)}</span>}
            </span>
          )}
          {tone === 'failed' && errorMessage && (
            <span className={styles.errorMessage} title={errorMessage}>
              {errorMessage}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className={styles.archiveButton}
        onClick={onArchive}
        aria-label={`从任务管理中隐藏${title}`}
        title="隐藏任务"
      >
        <InboxOutlined aria-hidden="true" />
      </button>
    </article>
  )
}

/** 合并当前会话实时任务与后端历史记录，处理权限过滤、分页、预览和项目导航。 */
export default function TaskCenterDrawer({ scope, onScopeChange, className }: TaskCenterDrawerProps) {
  const navigate = useNavigate()
  const drawerRef = useRef<HTMLElement | null>(null)
  const collapseButtonRef = useRef<HTMLButtonElement | null>(null)
  const scopeTabRefs = useRef<Partial<Record<TaskCenterScope, HTMLButtonElement | null>>>({})
  const [activeScope, setActiveScope] = useState(scope)
  const [playingUrl, setPlayingUrl] = useState('')
  const [historicalTasks, setHistoricalTasks] = useState<TaskCenterTask[]>([])
  const [accessibleProjectIds, setAccessibleProjectIds] = useState<Set<number>>(() => new Set())
  const [projectPermissionsLoaded, setProjectPermissionsLoaded] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hiddenHistoryIds, setHiddenHistoryIds] = useState<Set<string>>(() => new Set())
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches)
  const workspaceId = useWorkspaceId()
  const currentUser = useCurrentUser() as any
  const currentUserId =
    Number(
      currentUser?.id ??
        currentUser?.user_id ??
        currentUser?.userId ??
        currentUser?.account_id ??
        currentUser?.uid ??
        0,
    ) || 0
  const playbackContext = `${Number(workspaceId || 0)}:${currentUserId}`
  const playbackContextRef = useRef(playbackContext)
  const playbackRequestRef = useRef(0)
  playbackContextRef.current = playbackContext
  const tasks = useTaskCenterStore((state) => state.tasks)
  const expanded = useTaskCenterStore((state) => state.drawerExpanded)
  const setDrawerExpanded = useTaskCenterStore((state) => state.setDrawerExpanded)
  const archiveTask = useTaskCenterStore((state) => state.archiveTask)

  useEffect(() => {
    playbackRequestRef.current += 1
    setPlayingUrl('')
  }, [currentUserId, workspaceId])

  useEffect(() => {
    setHistoricalTasks([])
    setAccessibleProjectIds(new Set())
    setProjectPermissionsLoaded(false)
    setHiddenHistoryIds(new Set())
    if (!expanded || !workspaceId || !currentUserId) {
      setHistoryLoading(false)
      return
    }
    let disposed = false
    setHistoryLoading(true)
    void loadHistoricalTasks(Number(workspaceId), currentUserId, () => !disposed)
      .then((result) => {
        if (!disposed) {
          setHistoricalTasks(result.tasks)
          setAccessibleProjectIds(result.accessibleProjectIds)
          setProjectPermissionsLoaded(true)
        }
      })
      .catch(() => {
        if (!disposed) {
          setHistoricalTasks([])
          setAccessibleProjectIds(new Set())
          setProjectPermissionsLoaded(false)
        }
      })
      .finally(() => {
        if (!disposed) setHistoryLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [currentUserId, expanded, workspaceId])

  useEffect(() => setActiveScope(scope), [scope])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)')
    const onChange = () => setIsNarrow(media.matches)
    onChange()
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])
  useEffect(() => {
    if (!expanded || !isNarrow) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => collapseButtonRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus()
        else document.querySelector<HTMLButtonElement>('[aria-label="展开任务管理"]')?.focus()
      })
    }
  }, [expanded, isNarrow])
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerExpanded(false)
        return
      }
      if (event.key !== 'Tab' || !isNarrow || !drawerRef.current) return
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
      if (!focusable.length) {
        event.preventDefault()
        collapseButtonRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded, isNarrow, setDrawerExpanded])

  const visibleTasks = useMemo(() => {
    const activeWorkspaceId = String(workspaceId ?? '')
    const liveTasks = tasks.filter((task) => {
      const record = task as TaskRecord
      const taskWorkspaceId = String(readValue(record, 'workspaceId', 'workspace_id') ?? '')
      return (
        taskWorkspaceId === activeWorkspaceId &&
        Number(record.ownerUserId || 0) === currentUserId &&
        getTaskScope(record) === activeScope &&
        !shouldHideFailedImageTask(record) &&
        isTaskCenterTaskAccessible(task, accessibleProjectIds, projectPermissionsLoaded) &&
        !isArchived(record)
      )
    })
    const liveMediaKeys = new Set<string>()
    liveTasks.forEach((task) => {
      if (task.resultAssetId) liveMediaKeys.add(`asset:${task.resultAssetId}`)
      if (task.resultUrl) liveMediaKeys.add(`url:${task.resultUrl}`)
    })
    const history = historicalTasks.filter((task) => {
      const record = task as TaskRecord
      if (getTaskScope(record) !== activeScope || shouldHideFailedImageTask(record) || hiddenHistoryIds.has(task.id)) {
        return false
      }
      if (task.resultAssetId && liveMediaKeys.has(`asset:${task.resultAssetId}`)) return false
      if (task.resultUrl && liveMediaKeys.has(`url:${task.resultUrl}`)) return false
      return true
    })
    return [...liveTasks, ...history].sort((left, right) => {
      const leftRecord = left as TaskRecord
      const rightRecord = right as TaskRecord
      const rank: Record<TaskTone, number> = { active: 0, queued: 1, failed: 2, completed: 3 }
      return (
        rank[getTaskTone(leftRecord)] - rank[getTaskTone(rightRecord)] ||
        getUpdatedAt(rightRecord) - getUpdatedAt(leftRecord)
      )
    })
  }, [
    activeScope,
    currentUserId,
    hiddenHistoryIds,
    historicalTasks,
    projectPermissionsLoaded,
    accessibleProjectIds,
    tasks,
    workspaceId,
  ])
  const displayedTasks = activeScope === 'image' ? visibleTasks : visibleTasks.slice(0, MAX_VISIBLE_VIDEO_TASKS)
  const hiddenVideoCount = activeScope === 'image' ? 0 : Math.max(0, visibleTasks.length - displayedTasks.length)

  if (!workspaceId || !currentUserId) return null

  if (!expanded) {
    return (
      <aside className={cx(styles.drawer, styles.collapsed, className)} aria-label="任务管理（已收起）">
        <button
          type="button"
          className={styles.railButton}
          onClick={() => setDrawerExpanded(true)}
          aria-label="展开任务管理"
          title="展开任务管理"
        >
          <RightOutlined aria-hidden="true" />
        </button>
      </aside>
    )
  }

  return (
    <Fragment>
      <button
        type="button"
        className={styles.mobileBackdrop}
        onClick={() => setDrawerExpanded(false)}
        aria-label="关闭任务管理"
        tabIndex={-1}
      />
      <aside
        ref={drawerRef}
        className={cx(styles.drawer, className)}
        aria-label="任务管理"
        role={isNarrow ? 'dialog' : undefined}
        aria-modal={isNarrow || undefined}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>任务管理</h2>
          <button
            type="button"
            ref={collapseButtonRef}
            className={styles.collapseButton}
            onClick={() => setDrawerExpanded(false)}
            aria-label="收起任务管理"
            title="收起任务管理"
          >
            <LeftOutlined aria-hidden="true" />
          </button>
        </header>

        <div className={styles.tabs} role="tablist" aria-label="任务类型">
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab.value}
              ref={(element) => {
                scopeTabRefs.current[tab.value] = element
              }}
              type="button"
              role="tab"
              className={cx(styles.tab, activeScope === tab.value && styles.tabActive)}
              aria-selected={activeScope === tab.value}
              tabIndex={activeScope === tab.value ? 0 : -1}
              onClick={() => {
                setActiveScope(tab.value)
                onScopeChange?.(tab.value)
              }}
              onKeyDown={(event) => {
                const currentIndex = SCOPE_TABS.findIndex((candidate) => candidate.value === tab.value)
                let nextIndex = currentIndex
                if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SCOPE_TABS.length
                else if (event.key === 'ArrowLeft')
                  nextIndex = (currentIndex - 1 + SCOPE_TABS.length) % SCOPE_TABS.length
                else if (event.key === 'Home') nextIndex = 0
                else if (event.key === 'End') nextIndex = SCOPE_TABS.length - 1
                else return
                event.preventDefault()
                const nextScope = SCOPE_TABS[nextIndex].value
                setActiveScope(nextScope)
                onScopeChange?.(nextScope)
                scopeTabRefs.current[nextScope]?.focus()
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.body} role="tabpanel" aria-label={`${getScopeLabel(activeScope)}任务`}>
          {visibleTasks.length ? (
            <div className={styles.taskList}>
              {displayedTasks.map((task) => {
                const record = task as TaskRecord
                const taskId = String(readValue(record, 'id', 'taskId', 'task_id') ?? '')
                const taskScope = getTaskScope(record) || activeScope
                const projectId = readValue(record, 'projectId', 'project_id')
                return (
                  <TaskCard
                    key={taskId}
                    task={task}
                    onOpen={() => {
                      if (!projectId) return
                      const tone = getTaskTone(record)
                      const resultUrl = readText(record, 'resultUrl', 'result_url')
                      const resultAssetId = Number(readValue(record, 'resultAssetId', 'result_asset_id') || 0) || 0
                      if (taskScope === 'image') {
                        navigate(`/smart/${projectId}`)
                        return
                      }
                      if (tone === 'completed' && (resultUrl || resultAssetId)) {
                        if (resultUrl) {
                          playbackRequestRef.current += 1
                          setPlayingUrl(resultUrl)
                        } else {
                          const requestId = ++playbackRequestRef.current
                          const requestContext = playbackContextRef.current
                          void getAssetDownloadUrl({
                            workspaceId: Number(task.workspaceId || 0),
                            assetId: resultAssetId,
                          })
                            .then((url: string) => {
                              if (
                                playbackRequestRef.current === requestId &&
                                playbackContextRef.current === requestContext
                              ) {
                                setPlayingUrl(String(url || ''))
                              }
                            })
                            .catch(() => undefined)
                        }
                        return
                      }
                      navigate(`/${taskScope === 'hot-copy' ? 'hot-copy' : 'smart'}/${projectId}`)
                    }}
                    onArchive={() => {
                      if (tasks.some((storedTask) => storedTask.id === taskId)) archiveTask(taskId)
                      else setHiddenHistoryIds((previous) => new Set(previous).add(taskId))
                    }}
                  />
                )
              })}
            </div>
          ) : historyLoading ? (
            <div className={styles.empty} role="status">
              <LoadingOutlined className={styles.emptySpinner} spin aria-hidden="true" />
              <span className={styles.emptyTitle}>正在加载历史{activeScope === 'image' ? '图片' : '视频'}</span>
            </div>
          ) : (
            <div className={styles.empty} role="status">
              <InboxOutlined className={styles.emptyIcon} aria-hidden="true" />
              <span className={styles.emptyTitle}>暂无任务</span>
              <span className={styles.emptyText}>开始生成后，任务进度会显示在这里</span>
            </div>
          )}
        </div>
        {hiddenVideoCount > 0 && (
          <div className={styles.viewAllFooter}>
            <button
              type="button"
              className={styles.viewAllButton}
              onClick={() => navigate('/projects')}
              aria-label="前往项目管理查看全部视频"
              title={`还有 ${hiddenVideoCount} 条视频，请前往项目管理查看`}
            >
              <span>查看全部视频</span>
              <RightOutlined aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
      <VideoPreviewModal
        src={playingUrl}
        onClose={() => {
          playbackRequestRef.current += 1
          setPlayingUrl('')
        }}
      />
    </Fragment>
  )
}
