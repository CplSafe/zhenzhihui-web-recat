import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  preflightHd: vi.fn(),
  quoteHd: vi.fn(),
  submitHd: vi.fn(),
  listHdTasks: vi.fn(),
  cancelHdTask: vi.fn(),
  showToast: vi.fn(),
}))
vi.mock('@/api/canvasHd', async (original) => ({ ...(await original<typeof import('@/api/canvasHd')>()), ...mocks }))
vi.mock('@/stores/ui', () => ({
  showToast: mocks.showToast,
  openMemberCenterTab: vi.fn(),
  requestConfirm: vi.fn().mockResolvedValue(true),
}))
import CanvasHdWorkspace from '@/components/canvas/CanvasHdWorkspace'

const source = { node_id: 'video', asset_id: 10, kind: 'video', name: '开场.mp4' }
const item = {
  ...source,
  eligible: true,
  source_spec: '480P · 24fps',
  resolutions: ['720P', '1080P'],
  frame_rates: [60],
}
const quote = {
  quote_id: 'q1',
  expires_at: '2099-01-01',
  items: [{ node_id: 'video', asset_id: 10, credits: 12 }],
  total_credits: 12,
  balance: 100,
  can_afford: true,
}
const nodes = [{ id: 'video', position: { x: 0, y: 0 }, data: { kind: 'video', assetId: 10, title: '开场.mp4' } }]
function mount() {
  return render(
    <CanvasHdWorkspace
      workspaceId={21}
      canvasId={3}
      nodes={nodes}
      request={{ ids: ['video'], key: 1 }}
      onCloseRequest={vi.fn()}
      onTasks={vi.fn()}
      onModalChange={vi.fn()}
    />,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.preflightHd.mockResolvedValue({ items: [item] })
  mocks.quoteHd.mockResolvedValue(quote)
  mocks.submitHd.mockResolvedValue({ tasks: [{ id: 'HD-1' }] })
  mocks.listHdTasks.mockResolvedValue({
    items: [],
    total: 0,
    stats: { total: 0, active: 0, completed: 0, failed: 0, refunded_credits: 0 },
    canvases: [],
  })
})
describe('CanvasHdWorkspace', () => {
  it('blocks undeployed services without quoting or submitting', async () => {
    mocks.preflightHd.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
    mount()
    expect(await screen.findByText('高清处理服务暂未接入，请联系管理员开通后重试')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认并开始（扣积分）' })).toBeDisabled()
    expect(mocks.quoteHd).not.toHaveBeenCalled()
    expect(mocks.submitHd).not.toHaveBeenCalled()
  })
  it('shows the authoritative quote and blocks insufficient balance', async () => {
    mocks.quoteHd.mockResolvedValue({ ...quote, balance: 5, can_afford: false })
    mount()
    expect(await screen.findByText(/积分余额不足，预估费用约0.24元，当前余额 5 积分/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认并开始（扣积分）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '去充值' })).toBeEnabled()
  })
  it('submits a single atomic batch and preserves its idempotency key after a lost response', async () => {
    const user = userEvent.setup()
    mocks.submitHd.mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce({ tasks: [{ id: 'HD-1' }] })
    mount()
    const submit = screen.getByRole('button', { name: '确认并开始（扣积分）' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    expect(await screen.findByText(/提交结果尚未确认/)).toBeInTheDocument()
    await user.click(submit)
    await waitFor(() => expect(mocks.submitHd).toHaveBeenCalledTimes(2))
    expect(mocks.submitHd.mock.calls[0]).toEqual(mocks.submitHd.mock.calls[1])
    expect(mocks.submitHd).toHaveBeenCalledWith(21, 3, 'q1', expect.any(String))
    expect(await screen.findByText('已创建 1 个高清任务，选区已保留').catch(() => null)).toBeNull()
    expect(mocks.showToast).toHaveBeenCalledWith('已创建 1 个高清任务，选区已保留', 'success')
  })
  it('does not keep an old quote enabled when target resolution changes', async () => {
    const user = userEvent.setup()
    mount()
    const submit = screen.getByRole('button', { name: '确认并开始（扣积分）' })
    await waitFor(() => expect(submit).toBeEnabled())
    mocks.quoteHd.mockImplementation(() => new Promise(() => {}))
    await user.click(screen.getByRole('radio', { name: '1080P' }).closest('label')!)
    expect(submit).toBeDisabled()
    expect(mocks.submitHd).not.toHaveBeenCalled()
  })
  it('keeps mixed image and video selection separate', async () => {
    const user = userEvent.setup()
    render(
      <CanvasHdWorkspace
        workspaceId={21}
        canvasId={3}
        nodes={[...nodes, { id: 'image', position: { x: 400, y: 0 }, data: { kind: 'image', assetId: 11 } }]}
        request={{ ids: ['video', 'image'], key: 1 }}
        onCloseRequest={vi.fn()}
        onTasks={vi.fn()}
        onModalChange={vi.fn()}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: '选择高清处理类型' })
    expect(within(dialog).getByRole('button', { name: '图片超清（1）' })).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: '视频超分（1）' }))
    await waitFor(() => expect(mocks.preflightHd).toHaveBeenCalledWith(21, 3, [source], expect.any(AbortSignal)))
  })
})
