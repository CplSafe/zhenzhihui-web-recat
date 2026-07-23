import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateItem } from '@/api/templates'

const mocks = vi.hoisted(() => ({
  workspace: { id: 21 },
  currentUser: { id: 7 },
  loadTemplateCatalog: vi.fn(),
  resolveProjectPath: vi.fn(),
  navigate: vi.fn(),
  loadFavoriteKeys: vi.fn(),
  toggleFavorite: vi.fn(),
  requireAuth: vi.fn(),
  downloadToDisk: vi.fn(),
  buildDownloadName: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/components/home/AppSidebar', () => ({
  default: () => <nav aria-label="应用侧边栏" />,
}))

vi.mock('@/components/common/VideoPreviewModal', () => ({
  default: ({ src, poster, onClose }: { src: string; poster?: string; onClose: () => void }) =>
    src ? (
      <div role="dialog" aria-label="视频预览" data-poster={poster || ''}>
        <span>{src}</span>
        <button type="button" onClick={onClose}>
          关闭预览
        </button>
      </div>
    ) : null,
}))

vi.mock('@/utils/templateCatalog', () => ({
  loadTemplateCatalog: mocks.loadTemplateCatalog,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => mocks.currentUser,
  useWorkspaceId: () => mocks.workspace.id,
}))

vi.mock('@/utils/projectRoute', () => ({
  resolveProjectPath: mocks.resolveProjectPath,
}))

vi.mock('@/utils/favoriteVideos', () => ({
  favoriteKeyOf: (assetId: number, url: string) => (assetId ? `asset:${assetId}` : `url:${url}`),
  loadFavoriteKeys: mocks.loadFavoriteKeys,
  toggleFavorite: mocks.toggleFavorite,
}))

vi.mock('@/composables/useRequireAuth', () => ({
  useRequireAuth: () => (action: () => void) => mocks.requireAuth(action),
}))

vi.mock('@/composables/useSidebarNavigate', () => ({
  useSidebarNavigate: () => vi.fn(),
}))

vi.mock('@/utils/downloadToDisk', () => ({
  downloadToDisk: mocks.downloadToDisk,
  buildDownloadName: mocks.buildDownloadName,
}))

import TemplatesView from '@/views/TemplatesView'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function template(id: number, title: string, ratio = '9 / 16', overrides: Partial<TemplateItem> = {}): TemplateItem {
  return {
    id,
    title,
    thumbnailUrl: `/covers/${id}.jpg`,
    videoUrl: `/videos/${id}.mp4`,
    videoAssetId: 900 + id,
    ratio,
    duration: 6,
    style: '写实',
    useCount: 0,
    createdAt: '2026-07-21T00:00:00.000Z',
    grad: 'linear-gradient(#fff, #eee)',
    ...overrides,
  }
}

function catalog(items: TemplateItem[], source: 'backend' | 'builtin' = 'backend', notice = '') {
  return { items, source, notice }
}

function templateCard(title: string): HTMLElement {
  const card = screen
    .getAllByText(title)
    .map((element) => element.closest<HTMLElement>('[role="button"]'))
    .find(Boolean)
  if (!card) throw new Error(`找不到模板卡片：${title}`)
  return card
}

describe('TemplatesView', () => {
  beforeEach(() => {
    mocks.workspace.id = 21
    mocks.currentUser.id = 7
    mocks.loadTemplateCatalog.mockReset()
    mocks.resolveProjectPath.mockReset()
    mocks.navigate.mockReset()
    mocks.loadFavoriteKeys.mockReset()
    mocks.toggleFavorite.mockReset()
    mocks.requireAuth.mockReset()
    mocks.downloadToDisk.mockReset()
    mocks.buildDownloadName.mockReset()

    mocks.loadFavoriteKeys.mockReturnValue(new Set())
    mocks.toggleFavorite.mockReturnValue(true)
    mocks.requireAuth.mockImplementation((action: () => void) => action())
    mocks.downloadToDisk.mockResolvedValue(undefined)
    mocks.buildDownloadName.mockReturnValue('模板视频.mp4')
    mocks.resolveProjectPath.mockResolvedValue('/smart/1')
  })

  it('显示加载态，完成后渲染在线模板和准确数量', async () => {
    const pending = deferred<ReturnType<typeof catalog>>()
    mocks.loadTemplateCatalog.mockReturnValue(pending.promise)

    render(<TemplatesView />)

    expect(screen.getByText('加载中…')).toBeInTheDocument()

    await act(async () => {
      pending.resolve(catalog([template(1, '在线案例一'), template(2, '在线案例二', '16 / 9')]))
    })

    expect(await screen.findByText('共 2 个模板')).toBeInTheDocument()
    expect(screen.getByText('在线模板')).toBeInTheDocument()
    expect(screen.getAllByText('在线案例一')).not.toHaveLength(0)
    expect(screen.queryByText('加载中…')).not.toBeInTheDocument()
  })

  it('目录为空时显示空态且不残留内置模板', async () => {
    mocks.loadTemplateCatalog.mockResolvedValue(catalog([]))

    render(<TemplatesView />)

    expect(await screen.findByText('暂无案例数据')).toBeInTheDocument()
    expect(screen.getByText('共 0 个模板')).toBeInTheDocument()
  })

  it('目录异常时显示错误并允许重试成功', async () => {
    const first = deferred<ReturnType<typeof catalog>>()
    mocks.loadTemplateCatalog
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(catalog([template(3, '重试后的案例')]))

    render(<TemplatesView />)

    await act(async () => {
      first.reject(new Error('catalog unavailable'))
    })

    expect(await screen.findByText('案例加载失败')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findAllByText('重试后的案例')).not.toHaveLength(0)
    expect(mocks.loadTemplateCatalog).toHaveBeenCalledTimes(2)
  })

  it('组合搜索和比例筛选，只显示同时匹配且有视频的模板', async () => {
    const vertical = template(1, '竖屏口红广告')
    const horizontal = template(2, '横屏汽车广告', '16 / 9')
    const noVideo = template(3, '横屏无视频', '16 / 9', { videoUrl: '', videoAssetId: undefined })
    mocks.loadTemplateCatalog.mockResolvedValue(catalog([vertical, horizontal, noVideo]))
    const user = userEvent.setup()

    render(<TemplatesView />)
    expect(await screen.findAllByText(vertical.title)).not.toHaveLength(0)

    const search = screen.getByPlaceholderText('搜索案例...')
    await user.type(search, '口红')
    expect(screen.getAllByText(vertical.title)).not.toHaveLength(0)
    expect(screen.queryAllByText(horizontal.title)).toHaveLength(0)

    await user.clear(search)
    await user.click(screen.getByRole('button', { name: '16:9' }))
    expect(screen.getAllByText(horizontal.title)).not.toHaveLength(0)
    expect(screen.queryAllByText(vertical.title)).toHaveLength(0)
    expect(screen.queryAllByText(noVideo.title)).toHaveLength(0)
  })

  it('模板卡片获得焦点后可按 Enter 解析当前空间项目并进入', async () => {
    mocks.loadTemplateCatalog.mockResolvedValue(catalog([template(11, '键盘案例')]))
    mocks.resolveProjectPath.mockResolvedValue('/hot-copy/11')
    const user = userEvent.setup()

    render(<TemplatesView />)
    await screen.findAllByText('键盘案例')
    const card = templateCard('键盘案例')
    card.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/hot-copy/11'))
    expect(mocks.resolveProjectPath).toHaveBeenCalledWith(11, 21)
  })

  it('播放、收藏、下载和做同款不会冒泡触发卡片进入', async () => {
    const item = template(12, '交互案例', '4 / 5', { thumbnailUrl: '/poster.jpg' })
    mocks.loadTemplateCatalog.mockResolvedValue(catalog([item]))
    mocks.loadFavoriteKeys.mockReturnValue(new Set(['asset:912']))
    mocks.toggleFavorite.mockReturnValue(false)
    const user = userEvent.setup()

    render(<TemplatesView />)
    expect(await screen.findAllByText(item.title)).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '播放' }))
    const dialog = screen.getByRole('dialog', { name: '视频预览' })
    expect(dialog).toHaveTextContent('/videos/12.mp4')
    expect(dialog).toHaveAttribute('data-poster', '/poster.jpg')
    await user.click(screen.getByRole('button', { name: '关闭预览' }))

    const favorite = screen.getByRole('button', { name: '收藏' })
    expect(favorite).toHaveClass('is-on')
    await user.click(favorite)
    expect(mocks.toggleFavorite).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ key: 'asset:912', title: item.title, videoUrl: item.videoUrl, ratio: '4 / 5' }),
    )
    expect(favorite).not.toHaveClass('is-on')

    await user.click(screen.getByRole('button', { name: '下载' }))
    await waitFor(() => expect(mocks.downloadToDisk).toHaveBeenCalledOnce())
    const downloadArgs = mocks.downloadToDisk.mock.calls[0][0]
    expect(downloadArgs.fileName).toBe('模板视频.mp4')
    expect(downloadArgs.resolveUrl()).toBe(item.videoUrl)

    await user.click(screen.getByRole('button', { name: '做同款' }))
    expect(mocks.requireAuth).toHaveBeenCalledOnce()
    expect(mocks.navigate).toHaveBeenCalledWith('/hot-copy', {
      state: { carryVideo: { url: item.videoUrl, assetId: item.videoAssetId } },
    })
    expect(mocks.resolveProjectPath).not.toHaveBeenCalled()
  })

  it('快速重复打开同一卡片时只解析和导航一次', async () => {
    const route = deferred<string>()
    mocks.loadTemplateCatalog.mockResolvedValue(catalog([template(13, '防重复案例')]))
    mocks.resolveProjectPath.mockReturnValue(route.promise)
    const user = userEvent.setup()

    render(<TemplatesView />)
    await screen.findAllByText('防重复案例')
    const card = templateCard('防重复案例')
    await user.dblClick(card)

    expect(mocks.resolveProjectPath).toHaveBeenCalledTimes(1)
    await act(async () => route.resolve('/smart/13'))
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
  })

  it('快速重复下载只启动一次，完成后允许再次下载', async () => {
    const firstDownload = deferred<void>()
    mocks.loadTemplateCatalog.mockResolvedValue(catalog([template(14, '防重复下载')]))
    mocks.downloadToDisk.mockReturnValueOnce(firstDownload.promise).mockResolvedValueOnce(undefined)
    const user = userEvent.setup()

    render(<TemplatesView />)
    expect(await screen.findAllByText('防重复下载')).not.toHaveLength(0)
    const download = screen.getByRole('button', { name: '下载' })

    await user.dblClick(download)
    expect(mocks.downloadToDisk).toHaveBeenCalledTimes(1)

    await act(async () => firstDownload.resolve())
    await user.click(download)
    expect(mocks.downloadToDisk).toHaveBeenCalledTimes(2)
  })

  it('忽略 workspace A 的迟到路由响应，并允许 workspace B 正常进入', async () => {
    const workspaceA = deferred<string>()
    mocks.loadTemplateCatalog.mockResolvedValue(catalog([template(15, '空间隔离案例')]))
    mocks.resolveProjectPath.mockImplementation((_projectId: number, workspaceId: number) =>
      workspaceId === 21 ? workspaceA.promise : Promise.resolve('/smart/15'),
    )
    const user = userEvent.setup()

    const { rerender } = render(<TemplatesView />)
    await screen.findAllByText('空间隔离案例')
    const card = templateCard('空间隔离案例')
    await user.click(card)
    expect(mocks.resolveProjectPath).toHaveBeenCalledWith(15, 21)

    mocks.workspace.id = 22
    rerender(<TemplatesView />)
    await act(async () => workspaceA.resolve('/hot-copy/15'))
    expect(mocks.navigate).not.toHaveBeenCalled()

    await user.click(templateCard('空间隔离案例'))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/smart/15'))
    expect(mocks.resolveProjectPath).toHaveBeenLastCalledWith(15, 22)
  })
})
