import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  protectedApiCall: vi.fn(),
  taskCenterRender: vi.fn(),
}))

vi.mock('@/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    authCheckError: '',
    isAuthenticated: false,
    isCheckingSession: false,
    loadAuthSession: vi.fn(),
  }),
}))

vi.mock('@/components/AppToast', () => ({ default: () => null }))
vi.mock('@/components/AppConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/task/TaskCenterCoordinator', () => ({
  default: () => {
    mocks.taskCenterRender()
    return null
  },
}))
vi.mock('@/stores/guide', () => ({
  useGuideStore: (selector: (state: any) => unknown) => selector({ activeKey: '' }),
}))
vi.mock('@/stores/ui', () => ({
  useUiStore: Object.assign(
    (selector: (state: any) => unknown) =>
      selector({
        closeMemberCenter: vi.fn(),
        comingSoonOpen: false,
        joinTeamOpen: false,
        memberCenterOpen: false,
        setWorkspaceSwitchLock: vi.fn(),
        setWorkspaceSwitchLockSource: vi.fn(),
        teamManageOpen: false,
      }),
    {
      getState: () => ({
        setWorkspaceSwitchLock: vi.fn(),
        setWorkspaceSwitchLockSource: vi.fn(),
      }),
    },
  ),
}))
vi.mock('@/utils/inviteCode', () => ({ captureInviteCode: vi.fn() }))

import { AppShell } from '@/App'

function ProtectedPage() {
  useEffect(() => {
    mocks.protectedApiCall()
  }, [])
  return <div>Protected page</div>
}

describe('App authentication guard', () => {
  it('redirects before mounting a protected route or its API effects', async () => {
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { path: '/protected', element: <ProtectedPage /> },
            { path: '/login', element: <div>Login page</div>, handle: { requiresAuth: false } },
          ],
        },
      ],
      { initialEntries: ['/protected'] },
    )

    render(<RouterProvider router={router} />)

    expect(screen.queryByText('Protected page')).not.toBeInTheDocument()
    expect(mocks.protectedApiCall).not.toHaveBeenCalled()
    expect(mocks.taskCenterRender).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument())
    expect(mocks.protectedApiCall).not.toHaveBeenCalled()
  })
})
