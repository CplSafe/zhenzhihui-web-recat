import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'

const mocks = vi.hoisted(() => ({
  actualCreateSubscriptionOrder: undefined as undefined | ((params: any) => Promise<any>),
  cancelSubscription: vi.fn(),
  clearPendingNewTeamOrder: vi.fn(),
  createRechargeOrder: vi.fn(),
  createSubscriptionOrder: vi.fn(),
  disableSubscriptionAutoRenew: vi.fn(),
  getSubscription: vi.fn(),
  getWallet: vi.fn(),
  listBillingPlans: vi.fn(),
  listCreditPackages: vi.fn(),
  listPaymentOrders: vi.fn(),
  loadPendingNewTeamOrder: vi.fn(),
  loadPendingNewTeamOrders: vi.fn(),
  reconcilePaymentOrder: vi.fn(),
  requestConfirm: vi.fn(),
  savePendingNewTeamOrder: vi.fn(),
  showToast: vi.fn(),
  switchWorkspaceSafely: vi.fn(),
  workspace: {
    all: [
      { id: 21, name: '个人空间', type: 'personal', owner_user_id: 7 },
      { id: 30, name: '测试用户的团队', type: 'team', owner_user_id: 7 },
    ],
    current: { id: 21, name: '个人空间', type: 'personal', owner_user_id: 7 },
    id: 21,
    member: { user_id: 7, workspace_id: 21, role: 'owner' },
    user: { id: 7, nickname: '测试用户' },
  },
  loadSubscriptionLabel: vi.fn(),
  loadWorkspaces: vi.fn(),
  renameTeam: vi.fn(),
}))

vi.mock('@/api/business', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/business')>()
  mocks.actualCreateSubscriptionOrder = actual.createSubscriptionOrder
  return {
    ...actual,
    cancelSubscription: mocks.cancelSubscription,
    createRechargeOrder: mocks.createRechargeOrder,
    createSubscriptionOrder: mocks.createSubscriptionOrder,
    disableSubscriptionAutoRenew: mocks.disableSubscriptionAutoRenew,
    getBusinessErrorMessage: (error: any, fallback: string) => error?.message || fallback,
    getSubscription: mocks.getSubscription,
    getWallet: mocks.getWallet,
    listBillingPlans: mocks.listBillingPlans,
    listCreditPackages: mocks.listCreditPackages,
    listPaymentOrders: mocks.listPaymentOrders,
    reconcilePaymentOrder: mocks.reconcilePaymentOrder,
  }
})

vi.mock('@/stores/workspaceSession', () => {
  const getState = () => ({
    authSession: { user: mocks.workspace.user },
    loadSubscriptionLabel: mocks.loadSubscriptionLabel,
    loadWorkspaces: mocks.loadWorkspaces,
    renameTeam: mocks.renameTeam,
    workspaceId: mocks.workspace.id,
    workspaces: mocks.workspace.all,
  })
  const useWorkspaceSessionStore = Object.assign(vi.fn(), { getState })
  return {
    deriveAllWorkspaces: (state: { workspaces: unknown[] }) => state.workspaces,
    deriveWorkspaceId: (state: { workspaceId: number }) => state.workspaceId,
    useAllWorkspaces: () => mocks.workspace.all,
    useCurrentMember: () => mocks.workspace.member,
    useCurrentUser: () => mocks.workspace.user,
    useCurrentWorkspace: () => mocks.workspace.current,
    useWorkspaceId: () => mocks.workspace.id,
    useWorkspaceSessionStore,
  }
})

vi.mock('@/stores/ui', () => ({
  useUiStore: (selector: (state: { workspaceSwitchLocked: boolean }) => unknown) =>
    selector({ workspaceSwitchLocked: false }),
}))

vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/composables/useSafeWorkspaceSwitch', () => ({
  useSafeWorkspaceSwitch: () => mocks.switchWorkspaceSafely,
}))

vi.mock('@/stores/guide', () => ({ armSmartGuide: vi.fn() }))

vi.mock('@/utils/pendingNewTeamOrder', () => ({
  bindPendingNewTeamOrder: (intent: any, orderId: number, newWorkspaceId: number) =>
    intent ? { ...intent, orderId, ...(newWorkspaceId ? { newWorkspaceId } : {}) } : null,
  clearPendingNewTeamOrder: mocks.clearPendingNewTeamOrder,
  loadPendingNewTeamOrder: mocks.loadPendingNewTeamOrder,
  loadPendingNewTeamOrders: mocks.loadPendingNewTeamOrders,
  savePendingNewTeamOrder: mocks.savePendingNewTeamOrder,
}))

vi.mock('@/observability/openobserve-logger', () => ({
  logger: { warn: vi.fn() },
}))

vi.mock('@/components/smart/EntryCanvasBg', () => ({
  default: ({ index, count }: { index: number; count?: number }) => (
    <canvas data-testid="smart-entry-background" data-index={index} data-count={count} />
  ),
}))

import MemberCenterModal from '@/components/MemberCenterModal'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function plan({
  id,
  name,
  planType,
  priceCents,
}: {
  id: number
  name: string
  planType: 'personal' | 'team'
  priceCents: number
}) {
  return {
    id,
    code: `${planType}-${id}`,
    name,
    period: 'month',
    plan_type: planType,
    price_cents: priceCents,
    base_credits: 100,
    status: 'active',
  }
}

function fakePaymentWindow() {
  return {
    close: vi.fn(),
    location: { href: '' },
    opener: window,
  }
}

function renderModal() {
  return render(<MemberCenterModal open onClose={vi.fn()} embedded />)
}

describe('MemberCenterModal behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.id = 21
    mocks.workspace.user = { id: 7, nickname: '测试用户' }
    mocks.workspace.current = { id: 21, name: '个人空间', type: 'personal', owner_user_id: 7 }
    mocks.workspace.member = { user_id: 7, workspace_id: 21, role: 'owner' }
    mocks.workspace.all = [
      { id: 21, name: '个人空间', type: 'personal', owner_user_id: 7 },
      { id: 30, name: '测试用户的团队', type: 'team', owner_user_id: 7 },
    ]
    mocks.listBillingPlans.mockResolvedValue([
      plan({ id: 1, name: '一分体验会员', planType: 'personal', priceCents: 1 }),
      plan({ id: 2, name: '团队协作会员', planType: 'team', priceCents: 9900 }),
    ])
    mocks.listCreditPackages.mockResolvedValue([{ id: 8, name: '小额积分包', amount_cents: 100, credits: 100 }])
    mocks.getWallet.mockResolvedValue({ available: 88 })
    mocks.getSubscription.mockResolvedValue({ active: false })
    mocks.listPaymentOrders.mockResolvedValue([])
    mocks.reconcilePaymentOrder.mockResolvedValue(undefined)
    mocks.createRechargeOrder.mockResolvedValue({ order: { id: 901 }, pay_url: 'https://pay.example/recharge' })
    mocks.createSubscriptionOrder.mockImplementation((params) => mocks.actualCreateSubscriptionOrder!(params))
    mocks.loadPendingNewTeamOrder.mockReturnValue(null)
    mocks.loadPendingNewTeamOrders.mockReturnValue([])
    mocks.requestConfirm.mockResolvedValue(true)
    mocks.switchWorkspaceSafely.mockReturnValue(true)
  })

  it('uses the smart creation background only in full-screen mode', () => {
    const fullscreen = render(<MemberCenterModal open onClose={vi.fn()} />)
    const background = screen.getByTestId('smart-entry-background')
    const dialog = screen.getByRole('dialog', { name: '会员中心' })

    expect(background.parentElement).toHaveClass('mcm-bg')
    expect(background.parentElement?.nextElementSibling).toBe(dialog)
    expect(background).toHaveAttribute('data-index', '0')
    expect(background).toHaveAttribute('data-count', '1')

    fullscreen.unmount()
    renderModal()
    expect(screen.queryByTestId('smart-entry-background')).not.toBeInTheDocument()
  })

  it('preserves cent precision and separates personal and team plans', async () => {
    const user = userEvent.setup()
    renderModal()

    const personalCard = (await screen.findByText('个人版/一分体验会员')).closest('.mc-card')
    expect(personalCard).not.toBeNull()
    expect(within(personalCard as HTMLElement).getByText('0.01')).toBeInTheDocument()
    expect(screen.queryByText('团队版/团队协作会员')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '团队版' }))
    expect(screen.getByText('团队版/团队协作会员')).toBeInTheDocument()
    expect(screen.queryByText('个人版/一分体验会员')).not.toBeInTheDocument()
  })

  it('shows recharge only to a personal-space user or team owner', async () => {
    const personal = renderModal()
    expect(await screen.findByRole('button', { name: '积分充值' })).toBeInTheDocument()
    personal.unmount()

    mocks.workspace.id = 30
    mocks.workspace.current = { id: 30, name: '协作团队', type: 'team', owner_user_id: 99 }
    mocks.workspace.member = { user_id: 7, workspace_id: 30, role: 'member' }
    const member = renderModal()
    await screen.findByText('个人版/一分体验会员')
    expect(screen.queryByRole('button', { name: '积分充值' })).not.toBeInTheDocument()
    member.unmount()

    mocks.workspace.current = { id: 30, name: '我的团队', type: 'team', owner_user_id: 7 }
    mocks.workspace.member = { user_id: 7, workspace_id: 30, role: 'owner' }
    renderModal()
    expect(await screen.findByRole('button', { name: '积分充值' })).toBeInTheDocument()
  })

  it('deduplicates a rapid double click while the purchase request is pending', async () => {
    const user = userEvent.setup()
    const order = deferred<any>()
    const paymentWindow = fakePaymentWindow()
    vi.spyOn(window, 'open').mockReturnValue(paymentWindow as any)
    mocks.createSubscriptionOrder.mockReturnValue(order.promise)

    renderModal()
    const buy = await screen.findByRole('button', { name: '立即开通' })
    await user.dblClick(buy)

    expect(mocks.createSubscriptionOrder).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledTimes(1)

    await act(async () => {
      order.resolve({ order: { id: 101 }, pay_url: 'https://pay.example/101' })
      await order.promise
    })
    await waitFor(() => expect(paymentWindow.location.href).toBe('https://pay.example/101'))
  })

  it('posts new_team with an idempotency key and no old workspace_id', async () => {
    const user = userEvent.setup()
    const paymentWindow = fakePaymentWindow()
    const bodies: Record<string, unknown>[] = []
    vi.spyOn(window, 'open').mockReturnValue(paymentWindow as any)
    server.use(
      http.post('/api/v1/billing/subscription-orders', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ order: { id: 202 }, pay_url: 'https://pay.example/team' })
      }),
    )

    renderModal()
    await screen.findByText('个人版/一分体验会员')
    await user.click(screen.getByRole('button', { name: '团队版' }))
    await user.click(screen.getByRole('button', { name: '立即开通' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({
      intent: 'new_team',
      new_workspace_name: '测试用户的团队2',
      plan_id: 2,
    })
    expect(bodies[0]).not.toHaveProperty('workspace_id')
    expect(bodies[0].idempotency_key).toEqual(expect.stringMatching(/^[a-z0-9]+$/i))
    expect(mocks.savePendingNewTeamOrder).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', teamName: '测试用户的团队2', workspaceBaselineIds: [21, 30] }),
    )
  })

  it('offers a manual payment link when the browser blocks the popup', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'open').mockReturnValue(null)
    mocks.createSubscriptionOrder.mockResolvedValue({ order: { id: 303 }, pay_url: 'https://pay.example/manual' })

    renderModal()
    await user.click(await screen.findByRole('button', { name: '立即开通' }))

    const link = await screen.findByRole('link', { name: '点此手动打开支付页' })
    expect(link).toHaveAttribute('href', 'https://pay.example/manual')
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('浏览器拦截'), 'error')
  })

  it('closes the blank popup and reports an error when the order has no pay_url', async () => {
    const user = userEvent.setup()
    const paymentWindow = fakePaymentWindow()
    vi.spyOn(window, 'open').mockReturnValue(paymentWindow as any)
    mocks.createSubscriptionOrder.mockResolvedValue({ order: { id: 404 }, pay_url: '' })

    renderModal()
    await user.click(await screen.findByRole('button', { name: '立即开通' }))

    await waitFor(() => expect(paymentWindow.close).toHaveBeenCalledTimes(1))
    expect(mocks.showToast).toHaveBeenCalledWith('未获取到支付链接,请稍后重试', 'error')
    expect(screen.queryByRole('link', { name: '点此手动打开支付页' })).not.toBeInTheDocument()
  })

  it('ignores an older plan response after the workspace changes', async () => {
    const oldPlans = deferred<any[]>()
    const newPlans = deferred<any[]>()
    mocks.listBillingPlans.mockReset()
    mocks.listBillingPlans.mockReturnValueOnce(oldPlans.promise).mockReturnValueOnce(newPlans.promise)

    const view = renderModal()
    await waitFor(() => expect(mocks.listBillingPlans).toHaveBeenCalledTimes(1))

    mocks.workspace.id = 30
    mocks.workspace.current = { id: 30, name: '新团队', type: 'team', owner_user_id: 7 }
    mocks.workspace.member = { user_id: 7, workspace_id: 30, role: 'owner' }
    view.rerender(<MemberCenterModal open onClose={vi.fn()} embedded />)
    await waitFor(() => expect(mocks.listBillingPlans).toHaveBeenCalledTimes(2))

    await act(async () => {
      newPlans.resolve([plan({ id: 6, name: '新空间套餐', planType: 'personal', priceCents: 600 })])
      await newPlans.promise
    })
    expect(await screen.findByText('个人版/新空间套餐')).toBeInTheDocument()

    await act(async () => {
      oldPlans.resolve([plan({ id: 5, name: '旧空间套餐', planType: 'personal', priceCents: 500 })])
      await oldPlans.promise
    })
    expect(screen.queryByText('个人版/旧空间套餐')).not.toBeInTheDocument()
    expect(screen.getByText('个人版/新空间套餐')).toBeInTheDocument()
  })
})
