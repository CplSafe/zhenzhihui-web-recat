import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: false },
  confirm: vi.fn(),
  getReferralMyCode: vi.fn(),
  loadSubscriptionLabel: vi.fn(),
  openMemberCenter: vi.fn(),
  renameTeam: vi.fn(),
  safeSwitch: vi.fn(),
  showToast: vi.fn(),
  state: {
    activeId: 0,
    baseCredits: 0,
    credits: 0,
    currentMember: null as any,
    currentUser: null as any,
    currentWorkspace: null as any,
    expiresAt: '',
    planName: '',
    switchLocked: false,
    switchReason: '',
    workspaces: [] as any[],
  },
}))

vi.mock('@/api/business', () => ({ getReferralMyCode: mocks.getReferralMyCode }))
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/composables/useSafeWorkspaceSwitch', () => ({ useSafeWorkspaceSwitch: () => mocks.safeSwitch }))
vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.confirm }),
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('@/stores/ui', () => ({
  openTeamManage: vi.fn(),
  useUiStore: (selector: (state: any) => unknown) =>
    selector({
      openMemberCenter: mocks.openMemberCenter,
      workspaceSwitchLocked: mocks.state.switchLocked,
      workspaceSwitchLockReason: mocks.state.switchReason,
    }),
}))
vi.mock('@/stores/workspaceSession', () => ({
  useAllWorkspaces: () => mocks.state.workspaces,
  useCurrentMember: () => mocks.state.currentMember,
  useCurrentPlanExpiresAt: () => mocks.state.expiresAt,
  useCurrentPlanName: () => mocks.state.planName,
  useCurrentUser: () => mocks.state.currentUser,
  useCurrentWorkspace: () => mocks.state.currentWorkspace,
  usePlanBaseCredits: () => mocks.state.baseCredits,
  useWalletCredits: () => mocks.state.credits,
  useWorkspaceId: () => mocks.state.activeId,
  useWorkspaceSessionStore: Object.assign(
    (selector: (state: any) => unknown) =>
      selector({ loadSubscriptionLabel: mocks.loadSubscriptionLabel, renameTeam: mocks.renameTeam }),
    { getState: () => ({ renameTeam: mocks.renameTeam }) },
  ),
}))

import AppTopbar from '@/components/layout/AppTopbar'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="当前地址">{`${location.pathname}|${JSON.stringify(location.state)}`}</output>
}

function renderTopbar(props: React.ComponentProps<typeof AppTopbar> = {}) {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <AppTopbar {...props} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppTopbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.isAuthenticated = false
    Object.assign(mocks.state, {
      activeId: 0,
      baseCredits: 0,
      credits: 0,
      currentMember: null,
      currentUser: null,
      currentWorkspace: null,
      expiresAt: '',
      planName: '',
      switchLocked: false,
      switchReason: '',
      workspaces: [],
    })
    mocks.getReferralMyCode.mockResolvedValue('REF-CODE')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('shows guest actions, routes login with return state, and invokes menu/member actions', async () => {
    const user = userEvent.setup()
    const onMenu = vi.fn()
    renderTopbar({ onMenu })

    expect(screen.queryByRole('button', { name: '分享链接' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '打开菜单' }))
    await user.click(screen.getByRole('button', { name: '会员中心' }))
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(mocks.openMemberCenter).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/login|{"from":"/home"}')
    expect(mocks.loadSubscriptionLabel).not.toHaveBeenCalled()
  })

  it('loads membership, falls back from a broken avatar, and exposes an Escape-closeable user dialog', async () => {
    const user = userEvent.setup()
    mocks.auth.isAuthenticated = true
    Object.assign(mocks.state, {
      activeId: 21,
      currentMember: { role: 'owner', workspace_id: 21 },
      currentUser: { avatar: '/broken-avatar.png', id: 101, nickname: 'Alice' },
      currentWorkspace: { id: 21, name: 'Alice团队', owner_user_id: 101, type: 'team' },
      planName: '团队版',
      workspaces: [{ id: 21, name: 'Alice团队', type: 'team' }],
    })
    renderTopbar()

    await waitFor(() => expect(mocks.loadSubscriptionLabel).toHaveBeenCalledTimes(1))
    fireEvent.error(screen.getByRole('img', { name: 'Alice头像' }))
    const userButton = screen.getByRole('button', { name: /Alice/ })
    expect(userButton).toHaveTextContent('A')
    await user.click(userButton)

    expect(screen.getByRole('dialog', { name: '用户面板' })).toBeInTheDocument()
    expect(userButton).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '用户面板' })).not.toBeInTheDocument()
    expect(userButton).toHaveFocus()
  })

  it('copies one cached referral link and deduplicates rapid share clicks', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const pending = deferred<string>()
    mocks.auth.isAuthenticated = true
    Object.assign(mocks.state, { activeId: 31, currentUser: { id: 301, nickname: '分享用户' } })
    mocks.getReferralMyCode.mockReturnValue(pending.promise)
    renderTopbar()

    await user.dblClick(screen.getByRole('button', { name: '分享链接' }))
    expect(mocks.getReferralMyCode).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve('SAFE CODE')
      await pending.promise
    })
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/login?invite_code=SAFE%20CODE`)
    expect(mocks.showToast).toHaveBeenCalledWith('推广链接已复制', 'success')

    await user.click(screen.getByRole('button', { name: '分享链接' }))
    expect(mocks.getReferralMyCode).toHaveBeenCalledTimes(1)
  })

  it('ignores a referral response from a workspace that is no longer active', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const pending = deferred<string>()
    mocks.auth.isAuthenticated = true
    Object.assign(mocks.state, { activeId: 41, currentUser: { id: 401, nickname: '切换用户' } })
    mocks.getReferralMyCode.mockReturnValue(pending.promise)
    const view = renderTopbar()

    await user.click(screen.getByRole('button', { name: '分享链接' }))
    mocks.state.activeId = 42
    view.rerender(
      <MemoryRouter initialEntries={['/home']}>
        <AppTopbar />
      </MemoryRouter>,
    )
    await act(async () => {
      pending.resolve('STALE')
      await pending.promise
    })

    expect(writeText).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '分享链接' })).toBeEnabled()
  })
})
