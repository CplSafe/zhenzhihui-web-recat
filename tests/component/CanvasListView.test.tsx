/**
 * 画布列表页：封面按可见性拉取。
 *
 * 列表一页最多 50 张画布，封面又只能靠「拉全量元素」拼出来。之前开页就把整页
 * 排进队列，等于为几张缩略图对元素接口打出几十个 limit=500 的请求。这里锁死
 * 「只有进入过视口的卡片才请求封面」这一条，防止哪天又退回全量预取。
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCanvas: vi.fn(),
  deleteCanvas: vi.fn(),
  fetchAllCanvasElements: vi.fn(),
  listCanvases: vi.fn(),
  patchCanvas: vi.fn(),
  navigate: vi.fn(),
  showToast: vi.fn(),
  requestConfirm: vi.fn(),
  workspaceId: 21,
}))

/** 手动驱动的 IntersectionObserver：测试自行决定哪张卡片「进入视口」。 */
const observers: {
  callback: IntersectionObserverCallback
  targets: Set<Element>
  instance: IntersectionObserver
}[] = []

class IntersectionObserverMock implements IntersectionObserver {
  readonly root = null
  readonly rootMargin: string
  readonly thresholds = [0]
  private entry: { callback: IntersectionObserverCallback; targets: Set<Element>; instance: IntersectionObserver }

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.rootMargin = String(options?.rootMargin || '')
    this.entry = { callback, targets: new Set<Element>(), instance: this }
    observers.push(this.entry)
  }

  observe(target: Element) {
    this.entry.targets.add(target)
  }

  unobserve(target: Element) {
    this.entry.targets.delete(target)
  }

  disconnect() {
    this.entry.targets.clear()
    const index = observers.indexOf(this.entry)
    if (index >= 0) observers.splice(index, 1)
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

/** 让指定 canvasId 的卡片「进入视口」，触发对应回调。 */
async function intersect(...canvasIds: number[]) {
  const wanted = new Set(canvasIds.map(String))
  for (const observer of [...observers]) {
    const hits = [...observer.targets].filter((el) => wanted.has(String((el as HTMLElement).dataset.canvasId || '')))
    if (!hits.length) continue
    await act(async () => {
      observer.callback(
        hits.map((target) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry),
        observer.instance,
      )
    })
  }
}

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate, useLocation: () => ({ pathname: '/canvas', state: null }) }
})

vi.mock('@/components/home/AppSidebar', () => ({ default: () => <nav aria-label="应用侧边栏" /> }))
vi.mock('@/components/layout/AppTopbar', () => ({ default: () => <header aria-label="应用顶栏" /> }))

vi.mock('@/composables/useSidebarNavigate', () => ({ useSidebarNavigate: () => vi.fn() }))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
}))

vi.mock('@/stores/workspaceSession', () => ({ useWorkspaceId: () => mocks.workspaceId }))

vi.mock('@/api/business', () => ({
  getBusinessErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
}))

vi.mock('@/api/canvasApi', () => ({
  createCanvas: mocks.createCanvas,
  deleteCanvas: mocks.deleteCanvas,
  fetchAllCanvasElements: mocks.fetchAllCanvasElements,
  listCanvases: mocks.listCanvases,
  patchCanvas: mocks.patchCanvas,
}))

import CanvasListView from '@/views/CanvasListView'

function canvas(id: number, title: string) {
  return { id, title, status: 'active', revision: 1, updated_at: '2026-08-17T07:00:00.000Z' }
}

/** 取本次所有封面请求命中的 canvasId（升序，便于与期望数组比对）。 */
function requestedCanvasIds(): number[] {
  return mocks.fetchAllCanvasElements.mock.calls.map((call) => Number(call[0]?.canvasId || 0)).sort((a, b) => a - b)
}

/**
 * waitFor 的默认预算是 1000ms，全量套件并行跑时这里会不够
 * （「进入视口 → setState → 副作用 → mock fetch settle」这条链在负载下会超）。
 * 放宽到 5s：这是等一条异步链，不是等一个可能永远不来的结果。
 *
 * findBy* 必须显式传第三个参数才吃这份预算——它不读 waitFor 的调用点配置，
 * 而是走 Testing Library 自己的 asyncUtilTimeout（同样是 1000ms）。
 * 漏传这一处会让「列表首次渲染」在满负载下偶发超时，表现为随机红。
 */
const WAIT = { timeout: 5_000 } as const

describe('CanvasListView 封面加载', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    observers.length = 0
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
    mocks.listCanvases.mockResolvedValue([canvas(101, '甲'), canvas(102, '乙'), canvas(103, '丙')])
    mocks.fetchAllCanvasElements.mockResolvedValue({ elements: [], sync_revision: 1 })
  })

  it('列表渲染后不预取任何封面，只有进入视口的卡片才请求', async () => {
    render(<CanvasListView />)
    await screen.findByLabelText('打开画布 甲', undefined, WAIT)

    // 三张卡片都在 DOM 里，但一张封面都不该请求
    expect(screen.getByLabelText('打开画布 乙')).toBeInTheDocument()
    expect(requestedCanvasIds()).toEqual([])

    await intersect(102)
    await waitFor(() => expect(requestedCanvasIds()).toEqual([102]), WAIT)

    // 其余两张仍未进入视口，不该被顺带拉上
    expect(requestedCanvasIds()).not.toContain(101)
    expect(requestedCanvasIds()).not.toContain(103)
  })

  it('滚动后进入视口的卡片各自补齐，且同一张不重复请求', async () => {
    render(<CanvasListView />)
    await screen.findByLabelText('打开画布 甲', undefined, WAIT)

    await intersect(101)
    await waitFor(() => expect(requestedCanvasIds()).toEqual([101]), WAIT)

    await intersect(103)
    await waitFor(() => expect(requestedCanvasIds()).toEqual([101, 103]), WAIT)

    // 再次「进入视口」不产生新请求（revision 未变 → 命中缓存）
    await intersect(101, 103)
    expect(requestedCanvasIds()).toEqual([101, 103])
  })

  it('环境不支持 IntersectionObserver 时退回全量预取，封面不至于永远不显示', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<CanvasListView />)
    await screen.findByLabelText('打开画布 甲', undefined, WAIT)

    await waitFor(() => expect(requestedCanvasIds()).toEqual([101, 102, 103]), WAIT)
  })
})
