/**
 * 路由页面代码预加载。
 *
 * 页面都是 lazy() 按需加载的：以前要等点了侧边栏才开始下载那一页的 chunk，
 * 无限画布、爆款成片这种大页面第一次打开会先卡一下加载态。这里把「下载 chunk」提前：
 * - 鼠标悬停 / 键盘聚焦到侧边栏入口时预取该页（用户大概率马上会点）；
 * - 登录后浏览器空闲时顺手预取几个最常用的页面。
 *
 * router 的 lazy() 与这里共用同一批 importer：import() 对同一模块只下载一次，
 * 预取过的页面点进去直接渲染。只下载代码、不执行页面逻辑，不会提前发业务请求。
 */

export const routeImporters = {
  hotCopy: () => import('../views/HotCopyCreateView'),
  smart: () => import('../views/SmartCreateView'),
  studio: () => import('../views/StudioCreateView'),
  audio: () => import('../views/AudioCreateView'),
  canvasList: () => import('../views/CanvasListView'),
  canvas: () => import('../views/CanvasView'),
  projects: () => import('../views/ProjectManagementView'),
  projectVideos: () => import('../views/ProjectVideoListView'),
  resources: () => import('../views/ResourceManagementView'),
  market: () => import('../views/MarketView'),
  templates: () => import('../views/TemplatesView'),
  team: () => import('../views/SpaceDashboardView'),
  collaborations: () => import('../views/MyCollaborationsView'),
} as const

type RouteImporterKey = keyof typeof routeImporters

/** 路径前缀 → 要预取的页面；列表页顺带预取它最常跳去的详情页。 */
const PATH_PREFETCH: Array<[prefix: string, keys: RouteImporterKey[]]> = [
  ['/hot-copy', ['hotCopy']],
  ['/smart', ['smart']],
  ['/real-person-video', ['smart']],
  ['/studio', ['studio']],
  ['/audio', ['audio']],
  ['/canvas', ['canvasList', 'canvas']],
  ['/projects', ['projects', 'projectVideos']],
  ['/resources', ['resources']],
  ['/market', ['market']],
  ['/templates', ['templates']],
  ['/team', ['team']],
  ['/collaborations', ['collaborations']],
]

/** 登录后空闲时预取的常用页面（按使用频率排序，逐个下载不抢带宽） */
const IDLE_PREFETCH_KEYS: RouteImporterKey[] = ['hotCopy', 'smart', 'canvasList', 'projects', 'canvas']

const started = new Set<RouteImporterKey>()

/** 省流量模式 / 2G 网络下不做预取，免得替用户花流量 */
function shouldSkipPrefetch(): boolean {
  const connection = (navigator as any)?.connection
  if (!connection) return false
  return Boolean(connection.saveData) || /(^|-)2g$/.test(String(connection.effectiveType || ''))
}

function prefetchKey(key: RouteImporterKey): Promise<unknown> {
  if (started.has(key)) return Promise.resolve()
  started.add(key)
  return routeImporters[key]().catch(() => {
    // 失败（离线、部署后旧 chunk 失效）允许下次再试；真正进入页面时由 RouteErrorBoundary 兜底
    started.delete(key)
  })
}

/** 预取某个路径对应的页面代码；未知路径忽略。 */
export function prefetchRoute(path: string | undefined): void {
  if (!path || shouldSkipPrefetch()) return
  const pathname = path.split('?')[0]
  const matched = PATH_PREFETCH.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  matched?.[1].forEach((key) => void prefetchKey(key))
}

/** 浏览器空闲时依次预取常用页面；返回取消函数（组件卸载时调用）。 */
export function prefetchCommonRoutesWhenIdle(): () => void {
  if (shouldSkipPrefetch()) return () => {}
  let cancelled = false
  let handle: number | null = null
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, options?: { timeout: number }) => number)
    | undefined
  const cic = (window as any).cancelIdleCallback as ((id: number) => void) | undefined
  const useIdle = Boolean(ric && cic)
  const schedule = (callback: () => void) => {
    handle = useIdle ? ric!(callback, { timeout: 4000 }) : window.setTimeout(callback, 1500)
  }
  const queue = [...IDLE_PREFETCH_KEYS]
  const next = () => {
    if (cancelled) return
    const key = queue.shift()
    if (!key) return
    void prefetchKey(key).then(() => schedule(next))
  }
  schedule(next)
  return () => {
    cancelled = true
    if (handle === null) return
    if (useIdle) cic!(handle)
    else window.clearTimeout(handle)
  }
}
