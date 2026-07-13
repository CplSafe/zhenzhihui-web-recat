import { useUiStore } from '@/stores/ui'

/**
 * 整片视频生成「全局在途登记表」—— 让生成真正脱离组件,切到别的页面也继续。
 *
 * 背景:整片生成是 server 端任务,前端 await 轮询。这个 await 链卸载后并不会停(JS promise 不随组件卸载中断),
 * 但「这次生成的结果 promise」原本只被那个组件局部持有 —— 组件卸载后没人持有它,
 * 重新进来的新组件不知道「同项目已有一次生成在跑」,于是:
 *   ① 自动生成 effect 误判「没视频」→ 再发起一次(重复出片、重复计费);
 *   ② UI 也接不上正在跑的那次。
 *
 * 把这个结果 promise 按 projectId 存到模块级登记表(活在组件之外),就能:
 *   - 重新进来先查「该项目是否已在生成」→ 是则【订阅同一个 promise】拿结果,不重启;
 *   - 真正实现「切走 / 在别的页面也继续加载」。
 */
export type VideoGenResult = { url: string; assetId: number }
export type VideoGenScope = 'smart' | 'hot-copy'

export interface RunningVideoGenMeta {
  scope: VideoGenScope
  projectId: number
  workspaceId: number
  taskId: number
  generationId: string
  status: 'preparing' | 'processing' | 'reconnecting'
  startedAt: number
  updatedAt: number
}

export interface RunningVideoGenEntry {
  promise: Promise<VideoGenResult>
  meta: RunningVideoGenMeta
}

const running = new Map<string, RunningVideoGenEntry>()
const WORKSPACE_SWITCH_LOCK_REASON = '当前视频处理中，暂不支持切换团队'

function buildKey(scope: VideoGenScope, projectId: number): string {
  return `${scope}:${Number(projectId) || 0}`
}

function syncWorkspaceSwitchLock() {
  useUiStore.getState().setWorkspaceSwitchLock(running.size > 0, WORKSPACE_SWITCH_LOCK_REASON)
}

/** 该项目当前是否有在途整片生成 */
export function isVideoGenRunning(scope: VideoGenScope, projectId: number): boolean {
  return Number(projectId) > 0 && running.has(buildKey(scope, projectId))
}

/** 当前会话里是否存在任意在途整片生成 */
export function isAnyVideoGenRunning(): boolean {
  return running.size > 0
}

/** 取该项目在途生成的结果 promise(无则 null);可 await 拿 { url, assetId } */
export function getRunningVideoGen(scope: VideoGenScope, projectId: number): Promise<VideoGenResult> | null {
  return running.get(buildKey(scope, projectId))?.promise || null
}

export function getRunningVideoGenMeta(scope: VideoGenScope, projectId: number): RunningVideoGenMeta | null {
  return running.get(buildKey(scope, projectId))?.meta || null
}

/** 主动摘除一条已由页面判定为过期/作废的登记；底层 Promise 可继续收尾，但不再参与页面恢复。 */
export function removeRunningVideoGen(scope: VideoGenScope, projectId: number): void {
  const pid = Number(projectId || 0) || 0
  if (!pid) return
  running.delete(buildKey(scope, pid))
  syncWorkspaceSwitchLock()
}

/** 按流程反查最近启动的在途项目，供 /smart、/hot-copy 根路由恢复项目绑定。 */
export function findRunningVideoGen(scope: VideoGenScope, workspaceId?: number): RunningVideoGenEntry | null {
  const ws = Number(workspaceId || 0) || 0
  const matches = Array.from(running.values()).filter(
    (entry) => entry.meta.scope === scope && (!ws || !entry.meta.workspaceId || entry.meta.workspaceId === ws),
  )
  return matches.sort((a, b) => Number(b.meta.startedAt || 0) - Number(a.meta.startedAt || 0))[0] || null
}

export function updateRunningVideoGenMeta(
  scope: VideoGenScope,
  projectId: number,
  patch: Partial<Omit<RunningVideoGenMeta, 'scope' | 'projectId'>>,
): void {
  const key = buildKey(scope, projectId)
  const entry = running.get(key)
  if (!entry) return
  entry.meta = {
    ...entry.meta,
    ...patch,
    scope,
    projectId: Number(projectId) || 0,
    updatedAt: Date.now(),
  }
}

/**
 * 登记一次在途生成:把结果 promise 按 projectId 存下,完成/失败后自动摘除。
 * projectId 无效(0)时不登记,直接返回原 promise(退化为旧行为,不影响功能)。
 */
export function trackVideoGen(
  scope: VideoGenScope,
  projectId: number,
  p: Promise<VideoGenResult>,
  metadata: Partial<Omit<RunningVideoGenMeta, 'scope' | 'projectId'>> = {},
): Promise<VideoGenResult> {
  const pid = Number(projectId)
  if (!(pid > 0)) return p
  const key = buildKey(scope, pid)
  const existing = running.get(key)
  const now = Date.now()
  const meta: RunningVideoGenMeta = {
    scope,
    projectId: pid,
    workspaceId: Number(metadata.workspaceId ?? existing?.meta.workspaceId ?? 0) || 0,
    taskId: Number(metadata.taskId ?? existing?.meta.taskId ?? 0) || 0,
    generationId: String(metadata.generationId ?? existing?.meta.generationId ?? ''),
    status: metadata.status || existing?.meta.status || 'preparing',
    startedAt: Number(metadata.startedAt ?? existing?.meta.startedAt ?? now) || now,
    updatedAt: now,
  }
  if (existing?.promise === p) {
    existing.meta = meta
    syncWorkspaceSwitchLock()
    return p
  }
  running.set(key, { promise: p, meta })
  syncWorkspaceSwitchLock()
  void p
    .catch(() => {
      /* 失败也要摘除,避免卡住后续重试 */
    })
    .finally(() => {
      if (running.get(key)?.promise === p) running.delete(key)
      syncWorkspaceSwitchLock()
    })
  return p
}
