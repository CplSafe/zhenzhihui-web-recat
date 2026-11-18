import { act, render, screen } from '@testing-library/react'
import { beforeEach, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), workspace: 1, user: 2 }))
vi.mock('@/api/canvasApi', () => ({ getCanvasStatistics: mocks.get }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: '76' }) }))
vi.mock('@/stores/workspaceSession', () => ({
  useWorkspaceId: () => mocks.workspace,
  useCurrentUser: () => ({ id: mocks.user }),
}))
import CanvasStatisticsView from '@/views/CanvasStatisticsView'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.workspace = 1
  mocks.user = 2
})
it('shows all charged actors and retains deleted-node usage', async () => {
  mocks.get.mockResolvedValue({
    total: 1,
    total_used_credits: 3.75,
    items: [
      {
        node_id: 'n',
        title: '镜头1',
        deleted: true,
        used_credits: 3.75,
        members: [
          { user_id: 2, display_name: '甲', used_credits: 1.25 },
          { user_id: 3, display_name: '乙', used_credits: 2.5 },
        ],
      },
    ],
  })
  render(<CanvasStatisticsView />)
  expect(await screen.findByText('已删除')).toBeInTheDocument()
  expect(screen.getByText('1.25 积分')).toBeInTheDocument()
  expect(screen.getByText('2.5 积分')).toBeInTheDocument()
})
it('does not display old workspace totals after a switch or stale result', async () => {
  let resolve!: (value: unknown) => void
  mocks.get
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )
    .mockResolvedValue({ total: 0, total_used_credits: 0, items: [] })
  const view = render(<CanvasStatisticsView />)
  mocks.workspace = 2
  view.rerender(<CanvasStatisticsView />)
  await screen.findByText('0 积分')
  await act(async () => resolve({ total: 0, total_used_credits: 999, items: [] }))
  expect(screen.queryByText('999 积分')).not.toBeInTheDocument()
})
it('shows permission failure without leaking cached totals', async () => {
  mocks.get.mockRejectedValue(new Error('仅画布创建者或空间管理者可查看画布统计'))
  render(<CanvasStatisticsView />)
  expect(await screen.findByRole('alert')).toHaveTextContent('画布')
  expect(screen.queryByLabelText('画布累计消耗')).not.toBeInTheDocument()
})
