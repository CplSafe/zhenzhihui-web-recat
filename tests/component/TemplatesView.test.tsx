import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  categories: vi.fn(),
  detail: vi.fn(),
  navigate: vi.fn(),
  auth: { isAuthenticated: true, isCheckingSession: false },
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/auth/useAuth', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/components/home/AppSidebar', () => ({ default: () => <nav aria-label="应用侧边栏" /> }))
vi.mock('@/composables/useSidebarNavigate', () => ({ useSidebarNavigate: () => vi.fn() }))
vi.mock('@/api/templateLibrary', () => ({
  listLibraryTemplates: mocks.list,
  listLibraryCategories: mocks.categories,
  getLibraryTemplate: mocks.detail,
}))
import TemplatesView from '@/views/TemplatesView'
const template = {
  id: 11,
  categoryId: 7,
  title: '产品展示',
  description: '介绍',
  mediaType: 'image',
  coverUrl: '/cover.png',
  mediaUrl: '/image.png',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth = { isAuthenticated: true, isCheckingSession: false }
  mocks.categories.mockResolvedValue([{ id: 7, name: '产品', position: 1 }])
  mocks.list.mockResolvedValue({ items: [template], nextCursor: '', hasMore: false })
  mocks.detail.mockResolvedValue({ ...template, description: '详情说明' })
})

it('按分类查询并从模板详情接口读取详情', async () => {
  const user = userEvent.setup()
  render(<TemplatesView />)
  await user.click(await screen.findByRole('button', { name: /产品展示/ }))
  expect(await screen.findByText('详情说明')).toBeInTheDocument()
  expect(mocks.detail).toHaveBeenCalledWith(11)
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(await screen.findByRole('button', { name: /^产品$/ }))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(7, '', expect.any(AbortSignal)))
})

it('游客显示登录入口且不请求模板', () => {
  mocks.auth.isAuthenticated = false
  render(<TemplatesView />)
  expect(screen.getByText('登录后查看模板库')).toBeInTheDocument()
  expect(mocks.list).not.toHaveBeenCalled()
})

it('接口失败可重试，空结果不展示演示模板', async () => {
  mocks.list
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({ items: [], nextCursor: '', hasMore: false })
  const user = userEvent.setup()
  render(<TemplatesView />)
  expect(await screen.findByRole('alert')).toHaveTextContent('模板加载失败')
  await user.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('暂无模板')).toBeInTheDocument()
})
