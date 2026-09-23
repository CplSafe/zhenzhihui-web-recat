import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listCanvases: vi.fn(),
  patchCanvas: vi.fn(),
  duplicateCanvas: vi.fn(),
  fetchAllCanvasElements: vi.fn(),
  showToast: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/canvas', state: null }),
  useNavigate: () => mocks.navigate,
}))
vi.mock('antd', () => ({ Pagination: () => null }))
vi.mock('@/components/home/AppSidebar', () => ({ default: () => null }))
vi.mock('@/components/layout/AppTopbar', () => ({ default: () => null }))
vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => ({ id: 7 }),
  useWorkspaceId: () => 21,
}))
vi.mock('@/composables/useSidebarNavigate', () => ({ useSidebarNavigate: () => vi.fn() }))
vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: vi.fn() }),
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('@/api/canvasApi', () => ({
  createCanvas: vi.fn(),
  deleteCanvas: vi.fn(),
  duplicateCanvas: mocks.duplicateCanvas,
  fetchAllCanvasElements: mocks.fetchAllCanvasElements,
  listCanvases: mocks.listCanvases,
  patchCanvas: mocks.patchCanvas,
}))

import CanvasListView from '@/views/CanvasListView'

async function openMenu(title: string) {
  const card = await screen.findByRole('button', { name: `打开画布 ${title}` })
  fireEvent.click(card.querySelector('.cl-menu-btn') as HTMLElement)
}

describe('CanvasListView 重命名权限', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchAllCanvasElements.mockResolvedValue({ elements: [] })
    mocks.listCanvases.mockResolvedValue([
      { id: 1, title: '我的画布', userId: 7 },
      { id: 2, title: '同事画布', userId: 8 },
    ])
  })

  it('他人画布点「重命名」只提示，不打开弹窗', async () => {
    render(<CanvasListView />)
    await openMenu('同事画布')
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    expect(mocks.showToast).toHaveBeenCalledWith('这是其他人的画布，无法重命名', 'info')
    expect(screen.queryByRole('dialog', { name: '重命名画布' })).not.toBeInTheDocument()
  })

  it('自己的画布可以重命名', async () => {
    mocks.patchCanvas.mockResolvedValue(null)
    render(<CanvasListView />)
    await openMenu('我的画布')
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    const dialog = screen.getByRole('dialog', { name: '重命名画布' })
    fireEvent.change(dialog.querySelector('input') as HTMLInputElement, { target: { value: '新名字' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await vi.waitFor(() =>
      expect(mocks.patchCanvas).toHaveBeenCalledWith({ workspaceId: 21, canvasId: 1, title: '新名字' }),
    )
  })

  it('菜单里不再有「编辑画布」', async () => {
    render(<CanvasListView />)
    await openMenu('我的画布')

    expect(screen.getByRole('button', { name: '重命名' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建副本' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑画布' })).not.toBeInTheDocument()
  })
})
