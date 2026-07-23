import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: {
    authCheckError: '',
    isAuthenticated: true,
    isCheckingSession: false,
    loadAuthSession: vi.fn(),
  },
  safeSwitch: vi.fn(),
}))

vi.mock('@/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mocks.auth,
}))
vi.mock('@/components/AppToast', () => ({ default: () => null }))
vi.mock('@/components/AppConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/common/HelpCenter', () => ({ default: () => <div aria-label="帮助中心已挂载" /> }))
vi.mock('@/components/task/TaskCenterCoordinator', () => ({ default: () => null }))
vi.mock('@/composables/useSafeWorkspaceSwitch', () => ({ useSafeWorkspaceSwitch: () => mocks.safeSwitch }))
vi.mock('@/stores/guide', () => ({
  useGuideStore: (selector: (state: any) => unknown) => selector({ activeKey: '' }),
}))
vi.mock('@/stores/ui', () => ({
  useUiStore: (selector: (state: any) => unknown) =>
    selector({
      closeMemberCenter: vi.fn(),
      comingSoonOpen: false,
      joinTeamOpen: false,
      memberCenterOpen: false,
      teamManageOpen: false,
    }),
}))
vi.mock('@/stores/workspaceSession', () => ({
  deriveWorkspaceId: () => 0,
  useWorkspaceSessionStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ pendingWorkspaceTransition: null }),
    { getState: () => ({ pendingWorkspaceTransition: null }) },
  ),
}))
vi.mock('@/utils/inviteCode', () => ({ captureInviteCode: vi.fn() }))

import { AppShell } from '@/App'

function renderApp(path = '/home') {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          { path: '/home', element: <div>首页</div>, handle: { requiresAuth: false } },
          { path: '/login', element: <div>登录页</div>, handle: { requiresAuth: false } },
          { path: '/welcome', element: <div>开屏页</div>, handle: { requiresAuth: false } },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  const result = render(<RouterProvider router={router} />)
  return { ...result, router }
}

describe('AppShell HelpCenter visibility', () => {
  beforeEach(() => {
    mocks.auth.authCheckError = ''
    mocks.auth.isAuthenticated = true
    mocks.auth.isCheckingSession = false
    mocks.auth.loadAuthSession.mockClear()
  })

  it('mounts HelpCenter only after an authenticated session check', async () => {
    mocks.auth.isCheckingSession = true
    const result = renderApp()
    expect(screen.queryByLabelText('帮助中心已挂载')).not.toBeInTheDocument()

    mocks.auth.isCheckingSession = false
    await act(async () => {
      await result.router.navigate('/home?checked=1')
    })
    expect(await screen.findByLabelText('帮助中心已挂载')).toBeInTheDocument()

    mocks.auth.isCheckingSession = true
    await act(async () => {
      await result.router.navigate('/home?refresh=1')
    })
    expect(screen.getByLabelText('帮助中心已挂载')).toBeInTheDocument()
  })

  it('does not mount HelpCenter for a checked anonymous session', async () => {
    mocks.auth.isAuthenticated = false
    renderApp()

    await waitFor(() => expect(screen.getByText('首页')).toBeInTheDocument())
    expect(screen.queryByLabelText('帮助中心已挂载')).not.toBeInTheDocument()
  })
})
