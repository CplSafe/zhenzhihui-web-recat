import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/api/business', () => ({
  requestBusinessJson: mocks.request,
  getBusinessErrorMessage: (_e: unknown, text: string) => text,
}))
import CanvasUsagePanel from '@/components/billing/CanvasUsagePanel'
import WorkspaceUsageSummary from '@/components/billing/WorkspaceUsageSummary'

beforeEach(() => vi.clearAllMocks())
it('shows all team costs even when no canvas exists', async () => {
  mocks.request.mockResolvedValue({
    items: [],
    total: 0,
    total_used_credits: 0,
    workspace_total_used_credits: 13.125,
    unassigned_used_credits: 13.125,
  })
  render(<CanvasUsagePanel workspaceId={1} />)
  const summary = await screen.findByRole('region', { name: '团队消耗对账' })
  expect(within(summary).getByText('历史未分配')).toBeInTheDocument()
  expect(within(summary).getAllByText('13.125')).toHaveLength(2)
  expect(screen.getByText('暂无画布记录')).toBeInTheDocument()
})
it('does not call the assigned-only old API result a complete team total', () => {
  render(<WorkspaceUsageSummary summary={{ total_used_credits: 25 }} />)
  expect(screen.queryByRole('region', { name: '团队消耗对账' })).not.toBeInTheDocument()
})
it('keeps the team total separate from the current canvas page', async () => {
  mocks.request.mockResolvedValue({
    items: [{ canvas_id: 5, title: '画布五', used_credits: 10, members: [] }],
    total: 50,
    total_used_credits: 100,
    workspace_total_used_credits: 150,
    unassigned_used_credits: 50,
  })
  render(<CanvasUsagePanel workspaceId={1} />)
  const summary = await screen.findByRole('region', { name: '团队消耗对账' })
  expect(within(summary).getByText('150')).toBeInTheDocument()
  expect(within(summary).getByText('100')).toBeInTheDocument()
  expect(within(summary).getByText('50')).toBeInTheDocument()
  expect(screen.getByText('10 积分')).toBeInTheDocument()
})
it('clears totals on team change and ignores stale responses', async () => {
  let resolveOld!: (value: unknown) => void
  mocks.request
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      }),
    )
    .mockResolvedValue({
      items: [],
      total: 0,
      total_used_credits: 0,
      workspace_total_used_credits: 2,
      unassigned_used_credits: 2,
    })
  const view = render(<CanvasUsagePanel workspaceId={1} />)
  view.rerender(<CanvasUsagePanel workspaceId={2} />)
  await screen.findByRole('region', { name: '团队消耗对账' })
  await act(async () =>
    resolveOld({
      items: [],
      total: 0,
      total_used_credits: 999,
      workspace_total_used_credits: 999,
      unassigned_used_credits: 0,
    }),
  )
  expect(screen.queryByText('999')).not.toBeInTheDocument()
})
