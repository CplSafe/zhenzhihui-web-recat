import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BusinessApiError } from '@/api/business'
import type { CreditRequest, CreditRequestWorkspace } from '@/api/creditRequests'
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
  activeWorkspace: vi.fn(),
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
  useCurrentWorkspace: mocks.activeWorkspace,
  useWorkspaceSessionStore: { getState: () => ({ refreshWallet: mocks.refreshWallet }) },
  deriveCurrentWorkspace: mocks.activeWorkspace,
}))

const current = { id: 1, name: '当前账号' }
const superior = { id: 2, name: '直属上级' }
const subordinate = { id: 3, name: '项目同事' }
const personal: CreditRequestWorkspace = { type: 'personal', id: 10, name: '我的空间' }
const team: CreditRequestWorkspace = { type: 'team', id: 11, name: '镜头制作组' }
const workspaces = [personal, team]
const scriptName = '《夏日来信》剧组'
const baseRequest: CreditRequest = {
  id: 123,
  applicant: current,
  superior,
  workspace: null,
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
  mocks.activeWorkspace.mockReturnValue(personal)
  mocks.context.mockResolvedValue({ superior, workspaces })
  mocks.list.mockResolvedValue({ items: [], has_more: false })
  mocks.get.mockResolvedValue(baseRequest)
  mocks.create.mockResolvedValue(baseRequest)
  mocks.confirm.mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('缺少直属上级时仍可查看申请记录，提交按钮禁用', async () => {
  mocks.context.mockResolvedValue({ superior: null, workspaces })
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
  await user.click(screen.getByRole('button', { name: '到账工作空间' }))
  await user.click(screen.getByRole('option', { name: /我的空间/ }))
  await user.type(screen.getByRole('textbox', { name: '申请积分' }), '12.125')
  await user.type(screen.getByRole('textbox', { name: /剧本名称/ }), scriptName)
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
    script_name: scriptName,
    note: '项目生成用量',
    expected_superior_id: superior.id,
    workspace_id: personal.id,
    request_key: expect.stringMatching(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/),
  })
  expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0])
  expect(mocks.get).toHaveBeenCalledWith(123, expect.any(AbortSignal))
})

it('审批人变更后显示新上级并在确认提交时换用新幂等键', async () => {
  const user = userEvent.setup()
  const replacement = { id: 4, name: '新直属上级' }
  mocks.context.mockResolvedValueOnce({ superior, workspaces }).mockResolvedValue({ superior: replacement, workspaces })
  mocks.create.mockRejectedValueOnce(new BusinessApiError('直属上级已变更，请重新申请', { status: 409 }))
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  openPage()

  await screen.findByText(superior.name)
  await user.click(screen.getByRole('button', { name: '到账工作空间' }))
  await user.click(screen.getByRole('option', { name: /我的空间/ }))
  await user.type(screen.getByRole('textbox', { name: '申请积分' }), '10')
  await user.type(screen.getByRole('textbox', { name: /剧本名称/ }), scriptName)
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

it('优先选中当前有权到账的团队空间，变更到账空间后换用新幂等键', async () => {
  const user = userEvent.setup()
  mocks.activeWorkspace.mockReturnValue(team)
  mocks.create
    .mockRejectedValueOnce(new BusinessApiError('网络请求超时，请稍后重试'))
    .mockResolvedValueOnce({ ...baseRequest, workspace: personal })
  mocks.get.mockResolvedValue({ ...baseRequest, workspace: personal })
  openPage()

  const select = await screen.findByRole('button', { name: '到账工作空间' })
  await waitFor(() => expect(select).toHaveTextContent(team.name))
  await user.type(screen.getByRole('textbox', { name: '申请积分' }), '10')
  await user.type(screen.getByRole('textbox', { name: /剧本名称/ }), scriptName)
  await user.click(screen.getByRole('button', { name: '提交申请' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('网络请求超时')
  await waitFor(() => expect(select).toBeEnabled())
  await user.click(select)
  await user.click(screen.getByRole('option', { name: /我的空间/ }))
  await user.click(screen.getByRole('button', { name: '提交申请' }))

  expect(await screen.findByRole('heading', { name: '申请详情' })).toBeInTheDocument()
  expect(await screen.findByText(personal.name, { selector: 'strong' })).toBeInTheDocument()
  const [first, second] = mocks.create.mock.calls.map(([payload]) => payload)
  expect(first.workspace_id).toBe(team.id)
  expect(second.workspace_id).toBe(personal.id)
  expect(second.request_key).not.toBe(first.request_key)
})

it('团队资格变化会清空到账选择，不会自动转为个人空间', async () => {
  const user = userEvent.setup()
  mocks.activeWorkspace.mockReturnValue(team)
  mocks.context.mockResolvedValueOnce({ superior, workspaces }).mockResolvedValue({ superior, workspaces: [personal] })
  mocks.create.mockRejectedValueOnce(new BusinessApiError('暂时无法向该团队申请积分', { status: 403 }))
  openPage()

  const select = screen.getByRole('button', { name: '到账工作空间' })
  await waitFor(() => expect(select).toHaveTextContent(team.name))
  await user.type(screen.getByRole('textbox', { name: '申请积分' }), '20')
  await user.type(screen.getByRole('textbox', { name: /剧本名称/ }), scriptName)
  await user.click(screen.getByRole('button', { name: '提交申请' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法向该团队申请积分')
  await waitFor(() => expect(select).toHaveTextContent('请选择工作空间'))
  expect(screen.getByRole('button', { name: '提交申请' })).toBeDisabled()
  expect(screen.queryByRole('option', { name: /镜头制作组/ })).not.toBeInTheDocument()
  expect(mocks.create).toHaveBeenCalledTimes(1)
})

it('校验必填剧本名称，去除外部空白，修改剧本名称后使用新幂等键', async () => {
  const user = userEvent.setup()
  mocks.activeWorkspace.mockReturnValue(team)
  mocks.create.mockRejectedValueOnce(new BusinessApiError('网络请求超时，请稍后重试'))
  mocks.get.mockResolvedValue({ ...baseRequest, script_name: scriptName })
  openPage()

  const submit = screen.getByRole('button', { name: '提交申请' })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.type(screen.getByRole('textbox', { name: '申请积分' }), '10')
  const title = screen.getByRole('textbox', { name: /剧本名称/ })
  await user.type(title, '  ')
  await user.click(submit)
  expect(await screen.findByRole('alert')).toHaveTextContent('请输入剧本名称')
  expect(mocks.create).not.toHaveBeenCalled()

  await user.type(title, '《旧名称》剧组  ')
  await user.click(submit)
  expect(await screen.findByRole('alert')).toHaveTextContent('网络请求超时')
  await waitFor(() => expect(submit).toBeEnabled())
  await user.clear(title)
  await user.type(title, `  ${scriptName}  `)
  await user.click(submit)

  expect(await screen.findByText(scriptName)).toBeVisible()
  const [first, second] = mocks.create.mock.calls.map(([payload]) => payload)
  expect(first.script_name).toBe('《旧名称》剧组')
  expect(second.script_name).toBe(scriptName)
  expect(second.request_key).not.toBe(first.request_key)
})

it('审批列表显示画布用量汇总，详情显示单个画布用量和私密画布占位', async () => {
  const user = userEvent.setup()
  const received: CreditRequest = {
    ...baseRequest,
    applicant: subordinate,
    superior: current,
    script_name: scriptName,
    canvas_usage: {
      canvas_count: 3,
      credits_used: 62.125,
      image_count: 41,
      video_count: 12,
      canvases: [
        {
          canvas_id: 14,
          canvas_name: '第 1 集分镜',
          workspace_id: team.id,
          workspace_name: team.name,
          credits_used: 29,
          image_count: 18,
          video_count: 5,
        },
        {
          canvas_id: 15,
          canvas_name: '',
          workspace_id: team.id,
          workspace_name: team.name,
          credits_used: 12,
          image_count: 4,
          video_count: 2,
        },
      ],
    },
  }
  mocks.list.mockResolvedValue({ items: [received], has_more: false })
  mocks.get.mockResolvedValue(received)
  openPage('?tab=received')

  expect(await screen.findByText(scriptName)).toBeVisible()
  expect(screen.getByRole('link', { name: '我收到的' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('heading', { name: '发起申请' })).not.toBeInTheDocument()
  expect(screen.getByText('62.125 积分')).toBeVisible()
  expect(screen.getByText('12 个')).toBeVisible()
  expect(screen.getByText('41 张')).toBeVisible()

  await user.click(screen.getByRole('link', { name: '查看详情' }))
  expect(await screen.findByText('第 1 集分镜')).toBeVisible()
  expect(screen.getByText('消耗 29 积分 · 视频 5 个 · 图片 18 张')).toBeVisible()
  expect(screen.getByText('画布 #15')).toBeVisible()
  expect(screen.getByText('显示最近 2 个画布。')).toBeVisible()
  expect(screen.getByRole('button', { name: '同意并发放' })).toBeEnabled()
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
  expect(await screen.findByText('本次申请未记录画布用量。')).toBeVisible()
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

it('审批团队申请显示实际到账团队，并刷新当前到账团队的钱包', async () => {
  const user = userEvent.setup()
  const received: CreditRequest = { ...baseRequest, applicant: subordinate, superior: current, workspace: team }
  mocks.activeWorkspace.mockReturnValue(team)
  mocks.get.mockResolvedValue(received)
  mocks.decide.mockResolvedValue({ ...received, status: 'approved', decided_at: '2026-11-19T10:00:00Z' })
  openPage('?tab=received&request_id=123')

  expect(await screen.findByText(team.name)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '同意并发放' }))
  expect(await screen.findByText('已通过')).toBeInTheDocument()
  expect(mocks.confirm).toHaveBeenCalledWith(
    '确认从你的个人工作空间可用积分中扣除 12.125 积分，发放至工作空间「镜头制作组」？',
    expect.objectContaining({ confirmLabel: '确认发放' }),
  )
  expect(mocks.refreshWallet).toHaveBeenCalledWith(team.id)
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
