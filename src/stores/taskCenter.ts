/**
 * 全局任务中心 Store：统一保存智能成片、爆款复制与图片生成任务的状态、真实百分比、结果和失败信息。
 * 持久化时按账号隔离并剥离临时签名媒体地址，刷新后再由项目数据重新解析。
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { normalizeProgressPercent } from '@/utils/taskProgress'

/** 任务所属的创作流程。 */
export type TaskCenterScope = 'smart' | 'hot-copy' | 'image'

/** 前端任务中心统一使用的生命周期状态。 */
export type TaskCenterStatus =
  | 'preparing'
  | 'queued'
  | 'processing'
  | 'reconnecting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** 一条可在任务抽屉中展示和恢复的生成任务。 */
export interface TaskCenterTask {
  id: string
  scope: TaskCenterScope
  workspaceId: number
  projectId: number
  generationId: string
  taskId: number
  status: TaskCenterStatus
  title: string
  ratio: string
  durationSec: number
  thumbnailUrl: string
  thumbnailAssetId?: number
  operationCode: string
  startedAt: number
  updatedAt: number
  /** 后端真实任务百分比，统一规范到 0～100。 */
  progress?: number
  resultUrl?: string
  resultAssetId?: number
  error?: string
  archived?: boolean
  notifiedAt?: number
  /** 本地缓存所属账号；仅用于阻止同一浏览器切换账号时串任务。 */
  ownerUserId?: number
}

/** 兼容旧记录：scope 尚未分流时，也可由真实图片 operation_code 识别任务类型。 */
export function isTaskCenterImageTask(task: Partial<TaskCenterTask> | Record<string, unknown>): boolean {
  const record = task as Partial<TaskCenterTask> & Record<string, unknown>
  if (record.scope === 'image') return true
  const operationCode = String(record.operationCode || record.operation_code || '')
    .trim()
    .toLowerCase()
  return (
    operationCode.startsWith('image.') ||
    operationCode.includes('text_to_image') ||
    operationCode.includes('image_to_image')
  )
}

/** 任务中心状态及其更新动作。 */
export interface TaskCenterState {
  tasks: TaskCenterTask[]
  drawerExpanded: boolean
  ownerUserId: number
  upsertTask: (task: TaskCenterTask) => void
  patchTask: (id: string, patch: Partial<TaskCenterTask>) => void
  archiveTask: (id: string, archived?: boolean) => void
  setDrawerExpanded: (expanded: boolean) => void
  setOwnerUserId: (ownerUserId: number) => void
  pruneExpiredTasks: () => void
}

/** localStorage 中的任务中心缓存键。 */
export const TASK_CENTER_STORAGE_KEY = 'zzh_task_center_v1'
/** 已完成任务最多保留 30 天。 */
export const TASK_CENTER_COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** 已完成历史最多保留 100 条，避免缓存无限增长。 */
export const TASK_CENTER_COMPLETED_LIMIT = 100
/** 尚未拿到服务商 taskId 的准备态最长等待时间。 */
export const TASK_CENTER_PREPARING_TIMEOUT_MS = 30 * 60 * 1000
/** 已创建任务但长期无更新时的过期上限。 */
export const TASK_CENTER_ACTIVE_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** 当前任务中心持久化结构版本。 */
const TASK_CENTER_STORAGE_VERSION = 1
/** 仍需要全局协调器跟进的状态集合。 */
const ACTIVE_STATUSES = new Set<TaskCenterStatus>(['preparing', 'queued', 'processing', 'reconnecting'])
/** 从本地缓存恢复时允许接受的全部状态。 */
const VALID_STATUSES = new Set<TaskCenterStatus>([
  'preparing',
  'queued',
  'processing',
  'reconnecting',
  'succeeded',
  'failed',
  'cancelled',
])

/** 用流程、空间、项目和生成批次组成稳定且跨刷新可复用的任务主键。 */
export function buildTaskCenterId(
  scope: TaskCenterScope,
  workspaceId: number | string,
  projectId: number | string,
  generationId: number | string,
): string {
  const normalizedScope: TaskCenterScope = scope === 'hot-copy' ? 'hot-copy' : scope === 'image' ? 'image' : 'smart'
  const normalizedWorkspaceId = Math.max(0, Math.floor(Number(workspaceId) || 0))
  const normalizedProjectId = Math.max(0, Math.floor(Number(projectId) || 0))
  const normalizedGenerationId = String(generationId || '').trim() || 'default'
  return `${normalizedScope}:${normalizedWorkspaceId}:${normalizedProjectId}:${normalizedGenerationId}`
}

/** 判断任务是否仍需要轮询或恢复。 */
export function isTaskCenterActiveStatus(status: TaskCenterStatus | string): boolean {
  return ACTIVE_STATUSES.has(status as TaskCenterStatus)
}

/** 判断任务是否已经进入不可回退的终态。 */
export function isTaskCenterTerminalStatus(status: TaskCenterStatus | string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

/** 根据最后更新时间判断任务是否异常中断，并返回用户可读原因。 */
export function getTaskCenterExpirationReason(task: TaskCenterTask, now = Date.now()): string {
  if (!isTaskCenterActiveStatus(task.status)) return ''
  const inactiveFor = Math.max(0, now - (task.updatedAt || task.startedAt))
  if (!task.taskId && task.status === 'preparing' && inactiveFor > TASK_CENTER_PREPARING_TIMEOUT_MS) {
    return '任务在提交前中断，请重新发起生成'
  }
  if (inactiveFor > TASK_CENTER_ACTIVE_TIMEOUT_MS) return '任务长时间未更新，请进入项目确认'
  return ''
}

/** 把不可信缓存值收敛为正整数，无效值回退为 0。 */
function positiveInteger(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/** 把不可信缓存值收敛为有限数值。 */
function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 把可选文本去除空白，空内容不写入持久化对象。 */
function optionalText(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}

/** 兼容旧缓存和部分字段输入，规范化为完整的任务中心记录。 */
function normalizeTask(raw: Partial<TaskCenterTask>, now = Date.now(), fallbackOwnerUserId = 0): TaskCenterTask {
  const scope: TaskCenterScope = isTaskCenterImageTask(raw) ? 'image' : raw.scope === 'hot-copy' ? 'hot-copy' : 'smart'
  const projectId = positiveInteger(raw.projectId)
  const generationId = String(raw.generationId || '').trim()
  const workspaceId = positiveInteger(raw.workspaceId)
  const startedAt = positiveInteger(raw.startedAt) || now
  const status = VALID_STATUSES.has(raw.status as TaskCenterStatus) ? (raw.status as TaskCenterStatus) : 'preparing'
  const id = buildTaskCenterId(scope, workspaceId, projectId, generationId)
  const progress = status === 'succeeded' ? 100 : normalizeProgressPercent(raw.progress)
  const resultAssetId = positiveInteger(raw.resultAssetId)
  const notifiedAt = positiveInteger(raw.notifiedAt)
  const resultUrl = optionalText(raw.resultUrl)
  const error = optionalText(raw.error)

  return {
    id,
    scope,
    workspaceId,
    projectId,
    generationId,
    taskId: positiveInteger(raw.taskId),
    status,
    title: String(raw.title || '').trim() || (scope === 'image' ? '图片生成任务' : '视频生成任务'),
    ratio: String(raw.ratio || '').trim(),
    durationSec: Math.max(0, finiteNumber(raw.durationSec)),
    thumbnailUrl: String(raw.thumbnailUrl || '').trim(),
    thumbnailAssetId: positiveInteger(raw.thumbnailAssetId) || undefined,
    operationCode: String(raw.operationCode || '').trim(),
    startedAt,
    updatedAt: positiveInteger(raw.updatedAt) || startedAt,
    ...(progress === undefined ? {} : { progress }),
    ...(resultUrl ? { resultUrl } : {}),
    ...(resultAssetId ? { resultAssetId } : {}),
    ...(error ? { error } : {}),
    ...(raw.archived === undefined ? {} : { archived: Boolean(raw.archived) }),
    ...(notifiedAt ? { notifiedAt } : {}),
    ownerUserId: positiveInteger(raw.ownerUserId) || positiveInteger(fallbackOwnerUserId),
  }
}

/** 去重、排序并裁剪过期任务，控制本地任务历史的体积。 */
function pruneTasks(tasks: TaskCenterTask[], now = Date.now()): TaskCenterTask[] {
  const byId = new Map<string, TaskCenterTask>()
  ;(Array.isArray(tasks) ? tasks : []).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return
    const task = normalizeTask(raw, now)
    const previous = byId.get(task.id)
    if (!previous || task.updatedAt >= previous.updatedAt) byId.set(task.id, task)
  })

  const active: TaskCenterTask[] = []
  const completed: TaskCenterTask[] = []
  byId.forEach((task) => {
    if (isTaskCenterActiveStatus(task.status)) {
      active.push(task)
      return
    }
    const terminalAt = task.updatedAt || task.startedAt
    if (now - terminalAt <= TASK_CENTER_COMPLETED_RETENTION_MS) completed.push(task)
  })

  active.sort((a, b) => b.updatedAt - a.updatedAt)
  completed.sort((a, b) => b.updatedAt - a.updatedAt)
  return [...active, ...completed.slice(0, TASK_CENTER_COMPLETED_LIMIT)]
}

/**
 * 任务中心全局 Store。任务重启时会清掉上一轮进度/结果，账号切换时会清空旧账号任务。
 */
export const useTaskCenterStore = create<TaskCenterState>()(
  persist(
    (set) => ({
      tasks: [],
      drawerExpanded: false,
      ownerUserId: 0,

      upsertTask: (incoming) =>
        set((state) => {
          const now = Date.now()
          const shouldClearError =
            Object.prototype.hasOwnProperty.call(incoming, 'error') && !String(incoming.error || '').trim()
          const input = normalizeTask(
            { ...incoming, ownerUserId: positiveInteger(incoming.ownerUserId) || state.ownerUserId },
            now,
            state.ownerUserId,
          )
          const previous = state.tasks.find((task) => task.id === input.id)
          const restarted = Boolean(
            previous && !isTaskCenterActiveStatus(previous.status) && isTaskCenterActiveStatus(input.status),
          )
          const restartBase = restarted
            ? {
                ...previous,
                taskId: 0,
                progress: undefined,
                resultUrl: undefined,
                resultAssetId: undefined,
                error: undefined,
              }
            : previous
          const merged = normalizeTask(
            {
              ...restartBase,
              ...input,
              startedAt: input.startedAt || previous?.startedAt || now,
              updatedAt: input.updatedAt || now,
              archived: input.archived ?? (restarted ? false : previous?.archived),
              notifiedAt: input.notifiedAt ?? (restarted ? undefined : previous?.notifiedAt),
              error: shouldClearError || restarted ? undefined : input.error || previous?.error,
            },
            now,
            state.ownerUserId,
          )
          return {
            tasks: pruneTasks([...state.tasks.filter((task) => task.id !== merged.id), merged], now),
          }
        }),

      patchTask: (id, patch) =>
        set((state) => {
          const taskId = String(id || '').trim()
          const previous = state.tasks.find((task) => task.id === taskId)
          if (!previous) return state

          const now = Date.now()
          const restarted = Boolean(
            patch.status && !isTaskCenterActiveStatus(previous.status) && isTaskCenterActiveStatus(patch.status),
          )
          const restartBase = restarted
            ? {
                ...previous,
                taskId: 0,
                progress: undefined,
                resultUrl: undefined,
                resultAssetId: undefined,
                error: undefined,
              }
            : previous
          const merged = normalizeTask(
            {
              ...restartBase,
              ...patch,
              id: previous.id,
              updatedAt: patch.updatedAt || now,
              archived: patch.archived ?? (restarted ? false : previous.archived),
              notifiedAt: patch.notifiedAt ?? (restarted ? undefined : previous.notifiedAt),
            },
            now,
            state.ownerUserId,
          )
          return {
            tasks: pruneTasks([...state.tasks.filter((task) => task.id !== taskId), merged], now),
          }
        }),

      archiveTask: (id, archived = true) =>
        set((state) => {
          const taskId = String(id || '').trim()
          const previous = state.tasks.find((task) => task.id === taskId)
          if (!previous || previous.archived === Boolean(archived)) return state
          const next = { ...previous, archived: Boolean(archived) }
          return {
            tasks: pruneTasks([...state.tasks.filter((task) => task.id !== taskId), next]),
          }
        }),

      setDrawerExpanded: (expanded) => set({ drawerExpanded: Boolean(expanded) }),

      setOwnerUserId: (ownerUserId) =>
        set((state) => {
          const nextOwnerUserId = positiveInteger(ownerUserId)
          if (state.ownerUserId === nextOwnerUserId) return state
          return {
            ownerUserId: nextOwnerUserId,
            // 账号切换时立即清掉旧账号的媒体与任务凭证，避免同浏览器串台。
            tasks: [],
          }
        }),

      pruneExpiredTasks: () =>
        set((state) => {
          const tasks = pruneTasks(state.tasks)
          const changed =
            tasks.length !== state.tasks.length ||
            tasks.some((task, index) => {
              const previous = state.tasks[index]
              return (
                !previous ||
                task.id !== previous.id ||
                task.status !== previous.status ||
                task.error !== previous.error ||
                task.updatedAt !== previous.updatedAt
              )
            })
          return changed ? { tasks } : state
        }),
    }),
    {
      name: TASK_CENTER_STORAGE_KEY,
      version: TASK_CENTER_STORAGE_VERSION,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        // 签名媒体地址等价于临时访问凭证，不写入长期 localStorage；刷新后由项目/任务重新解析。
        tasks: pruneTasks(state.tasks).map((task) => ({
          ...task,
          thumbnailUrl: '',
          resultUrl: undefined,
          error: undefined,
        })),
        drawerExpanded: state.drawerExpanded,
        ownerUserId: state.ownerUserId,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<TaskCenterState>
        return {
          ...currentState,
          drawerExpanded: Boolean(persisted.drawerExpanded),
          ownerUserId: positiveInteger(persisted.ownerUserId),
          tasks: pruneTasks(Array.isArray(persisted.tasks) ? persisted.tasks : []).filter(
            (task) => !persisted.ownerUserId || task.ownerUserId === positiveInteger(persisted.ownerUserId),
          ),
        }
      },
    },
  ),
)
