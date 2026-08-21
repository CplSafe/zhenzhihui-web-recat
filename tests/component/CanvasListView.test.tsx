/**
 * 画布列表页：封面按可见性拉取。
 *
 * 列表一页最多 50 张画布，封面又只能靠「拉全量元素」拼出来。之前开页就把整页
 * 排进队列，等于为几张缩略图对元素接口打出几十个 limit=500 的请求。这里锁死
 * 「只有进入过视口的卡片才请求封面」这一条，防止哪天又退回全量预取。
 */
import { act, render, screen } from '@testing-library/react'
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

/**
 * 让指定 canvasId 的卡片「进入视口」，并把由此引发的异步链路彻底跑完。
 *
 * 链路是：回调 → setState → 副作用 → 取封面的 async worker（内部多个 await）→ setCovers。
 * 这里刻意不使用 waitFor：它靠墙钟轮询，机器一忙就得靠调大超时续命，
 * 而超时多少算够永远说不准（这条用例已经因此挂过两次）。
 * 改成显式把微任务队列抽干——次数是确定的，与机器快慢无关，跑完直接同步断言。
 */
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
  await flushAsync()
}

/** 抽干微任务队列：足够让「setState → 副作用 → async worker 的多层 await」全部结算。 */
async function flushAsync() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await Promise.resolve()
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
 * 只剩「等首次渲染」还需要墙钟预算：列表要等 listCanvases 这个真异步回来。
 * findBy* 必须显式传第三个参数才吃这份预算——它不读 waitFor 的调用点配置，
 * 而是走 Testing Library 自己的 asyncUtilTimeout（默认 1000ms），
 * 满负载下漏传这一处会表现为随机红。
 * 其余断言一律走 flushAsync + 同步断言，不依赖机器快慢。
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

    // intersect 内部已把异步链抽干，这里直接同步断言，不再靠墙钟等待
    await intersect(102)
    expect(requestedCanvasIds()).toEqual([102])

    // 其余两张仍未进入视口，不该被顺带拉上
    expect(requestedCanvasIds()).not.toContain(101)
    expect(requestedCanvasIds()).not.toContain(103)
  })

  it('滚动后进入视口的卡片各自补齐，且同一张不重复请求', async () => {
    render(<CanvasListView />)
    await screen.findByLabelText('打开画布 甲', undefined, WAIT)

    await intersect(101)
    expect(requestedCanvasIds()).toEqual([101])

    await intersect(103)
    expect(requestedCanvasIds()).toEqual([101, 103])

    // 再次「进入视口」不产生新请求（revision 未变 → 命中缓存）
    await intersect(101, 103)
    expect(requestedCanvasIds()).toEqual([101, 103])
  })

  it('环境不支持 IntersectionObserver 时退回全量预取，封面不至于永远不显示', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<CanvasListView />)
    await screen.findByLabelText('打开画布 甲', undefined, WAIT)

    await flushAsync()
    expect(requestedCanvasIds()).toEqual([101, 102, 103])
  })
})
