import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BusinessApiError } from '@/api/business'
import type { CreditRequest } from '@/api/creditRequests'
import CreditRequestsView from '@/views/CreditRequestsView'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  decide: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  refreshWallet: vi.fn(),
}))

vi.mock('@/api/creditRequests', () => ({
  getCreditRequestContext: mocks.context,
  listCreditRequests: mocks.list,
  getCreditRequest: mocks.get,
  createCreditRequest: mocks.create,
  decideCreditRequest: mocks.decide,
}))
vi.mock('@/components/home/AppSidebar', () => ({ default: () => null }))
vi.mock('@/components/layout/AppTopbar', () => ({ default: () => null }))
vi.mock('@/composables/useSidebarNavigate', () => ({ useSidebarNavigate: () => vi.fn() }))
vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.confirm }),
  useToast: () => ({ showToast: mocks.toast }),
}))
vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => ({ id: 1 }),
  useWorkspaceSessionStore: { getState: () => ({ refreshWallet: mocks.refreshWallet }) },
  deriveCurrentWorkspace: () => ({ type: 'personal', id: 10 }),
}))

const current = { id: 1, name: '当前账号' }
const superior = { id: 2, name: '直属上级' }
const subordinate = { id: 3, name: '项目同事' }
const baseRequest: CreditRequest = {
  id: 123,
  applicant: current,
  superior,
  amount: 12.125,
  note: '项目生成用量',
  status: 'pending',
  created_at: '2026-11-19T09:00:00Z',
  decided_at: null,
}

function openPage(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/settings/credit-requests${query}`]}>
      <CreditRequestsView />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ superior })
  mocks.list.mockResolvedValue({ items: [], has_more: false })
  mocks.get.mockResolvedValue(baseRequest)
  mocks.create.mockResolvedValue(baseRequest)
  mocks.confirm.mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('缺少直属上级时仍可查看申请记录，提交按钮禁用', async () => {
  mocks.context.mockResolvedValue({ superior: null })
  openPage()

  expect(await screen.findByText('当前账号未设置直属上级，无法提交积分申请。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '提交申请' })).toBeDisabled()
  expect(await screen.findByText('暂无发起的积分申请。')).toBeInTheDocument()
})

it('提交失败后用相同幂等键重试，成功后打开申请详情', async () => {
  const user = userEvent.setup()
  mocks.create.mockRejectedValueOnce(new BusinessApiError('网络请求超时，请稍后重试'))
  openPage()

  await screen.findByText(superior.name)
  await user.type(screen.getByRole('textbox', { name: '申请积分' }), '12.125')
  await user.type(screen.getByRole('textbox', { name: /申请说明/ }), '项目生成用量')
  await user.click(screen.getByRole('button', { name: '提交申请' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('网络请求超时')
  await waitFor(() => expect(screen.getByRole('button', { name: '提交申请' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '提交申请' }))

  expect(await screen.findByRole('heading', { name: '申请详情' })).toBeInTheDocument()
  expect(await screen.findByText('待审批')).toBeInTheDocument()
  expect(mocks.create).toHaveBeenCalledTimes(2)
  expect(mocks.create.mock.calls[0][0]).toEqual({
    amount: 12.125,
    note: '项目生成用量',
    expected_superior_id: superior.id,
    request_key: expect.stringMatching(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/),
  })
  expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0])
  expect(mocks.get).toHaveBeenCalledWith(123, expect.any(AbortSignal))
})

it('审批人变更后显示新上级并在确认提交时换用新幂等键', async () => {
  const user = userEvent.setup()
  const replacement = { id: 4, name: '新直属上级' }
  mocks.context.mockResolvedValueOnce({ superior }).mockResolvedValue({ superior: replacement })
  mocks.create.mockRejectedValueOnce(new BusinessApiError('直属上级已变更，请重新申请', { status: 409 }))
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  openPage()

  await screen.findByText(superior.name)
  await user.type(screen.getByRole('textbox', { name: '申请积分' }), '10')
  await user.click(screen.getByRole('button', { name: '提交申请' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('直属上级已变更')
  await screen.findByText(replacement.name)
  await user.click(screen.getByRole('button', { name: '提交申请' }))

  expect(await screen.findByRole('heading', { name: '申请详情' })).toBeInTheDocument()
  const [first, second] = mocks.create.mock.calls.map(([payload]) => payload)
  expect(first.expected_superior_id).toBe(superior.id)
  expect(second.expected_superior_id).toBe(replacement.id)
  expect(second.request_key).not.toBe(first.request_key)
  expect(second.request_key).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
})

it('从通知打开申请，余额不足时保留待审批，审批通过后刷新个人钱包', async () => {
  const user = userEvent.setup()
  const received: CreditRequest = { ...baseRequest, applicant: subordinate, superior: current }
  mocks.get.mockResolvedValue(received)
  mocks.decide
    .mockRejectedValueOnce(new BusinessApiError('个人工作空间可用积分不足', { status: 409 }))
    .mockResolvedValueOnce({ ...received, status: 'approved', decided_at: '2026-11-19T10:00:00Z' })
  openPage('?tab=received&request_id=123')

  expect(screen.queryByRole('button', { name: '提交申请' })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: '同意并发放' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('个人工作空间可用积分不足')
  expect(await screen.findByText('待审批')).toBeInTheDocument()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.decide).toHaveBeenCalledWith(123, 'approve', expect.any(AbortSignal))
  expect(mocks.refreshWallet).not.toHaveBeenCalled()
  expect(mocks.confirm).toHaveBeenCalledWith(
    '确认从你的个人工作空间可用积分中扣除 12.125 积分，发放至「项目同事」的个人工作空间？',
    expect.objectContaining({ confirmLabel: '确认发放' }),
  )

  await user.click(screen.getByRole('button', { name: '同意并发放' }))
  expect(await screen.findByText('已通过')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '同意并发放' })).not.toBeInTheDocument()
  expect(mocks.refreshWallet).toHaveBeenCalledWith(10)
})

it('通过上一页和下一页浏览历史申请', async () => {
  const user = userEvent.setup()
  mocks.list
    .mockResolvedValueOnce({ items: [baseRequest], has_more: true })
    .mockResolvedValueOnce({ items: [{ ...baseRequest, id: 122, amount: 20 }], has_more: false })
    .mockResolvedValueOnce({ items: [baseRequest], has_more: true })
  openPage()

  await user.click(await screen.findByRole('button', { name: '下一页' }))
  expect(await screen.findByRole('heading', { name: '20 积分' })).toBeInTheDocument()
  expect(mocks.list).toHaveBeenLastCalledWith('sent', 123, expect.any(AbortSignal))
  await user.click(screen.getByRole('button', { name: '上一页' }))
  expect(await screen.findByRole('heading', { name: '12.125 积分' })).toBeInTheDocument()
  expect(mocks.list).toHaveBeenLastCalledWith('sent', 0, expect.any(AbortSignal))
})
