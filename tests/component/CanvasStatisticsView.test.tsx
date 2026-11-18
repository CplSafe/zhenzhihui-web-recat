import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

it('queries charts and rows together only after applying filters', async () => {
  mocks.get.mockResolvedValue({
    total: 0,
    total_used_credits: 0,
    items: [],
    member_choices: [{ user_id: 3, display_name: '乙', used_credits: 0 }],
    member_totals: [],
    trend: [{ date: '2026-11-18', used_credits: 2 }],
    top_nodes: [],
  })
  render(<CanvasStatisticsView />)
  expect(await screen.findByRole('img', { name: '按结算日期统计的积分消耗趋势' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('节点名称 / ID'), { target: { value: '镜头' } })
  fireEvent.change(screen.getByLabelText('使用成员'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-11-18' } })
  expect(mocks.get).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('查询'))
  await waitFor(() =>
    expect(mocks.get).toHaveBeenLastCalledWith(1, 76, 1, { query: '镜头', user_id: '3', date_from: '2026-11-18' }),
  )
  expect(await screen.findByText('筛选结果消耗')).toBeInTheDocument()
  fireEvent.click(screen.getByText('重置'))
  await waitFor(() => expect(mocks.get).toHaveBeenLastCalledWith(1, 76, 1, {}))
})

it('labels historical shares separately from actual detailed charges', async () => {
  mocks.get.mockResolvedValue({
    total: 1,
    total_used_credits: 10.002,
    historical_allocated_credits: 10.002,
    items: [
      {
        node_id: '',
        title: '未关联节点',
        deleted: false,
        used_credits: 10.002,
        members: [{ user_id: 3, display_name: '历史成员', used_credits: 3.334, historical_allocated_credits: 3.334 }],
      },
    ],
  })
  render(<CanvasStatisticsView />)
  expect(await screen.findByText(/不代表个人实际操作金额/)).toBeInTheDocument()
  expect(screen.getByText('（含历史分摊 3.334）')).toBeInTheDocument()
  expect(screen.getByLabelText('画布累计消耗')).toHaveTextContent('10.002 积分')
})
