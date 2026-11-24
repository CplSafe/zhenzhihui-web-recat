import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Navigate, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  protectedApiCall: vi.fn(),
  taskCenterRender: vi.fn(),
  isAuthenticated: false,
  authSession: null as any,
}))

vi.mock('@/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    authCheckError: '',
    authSession: mocks.authSession,
    isAuthenticated: mocks.isAuthenticated,
    isCheckingSession: false,
    loadAuthSession: vi.fn(),
  }),
}))

vi.mock('@/components/team/RequiredTeamSetup', () => ({ default: () => <div>Required team setup</div> }))
vi.mock('@/components/AppToast', () => ({ default: () => null }))
vi.mock('@/components/AppConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/common/HelpCenter', () => ({ default: () => null }))
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
import { consumeOAuthLoginReturnTo, keepOAuthLoginReturnTo } from '@/utils/loginReturnTo'

function ProtectedPage() {
  useEffect(() => {
    mocks.protectedApiCall()
  }, [])
  return <div>Protected page</div>
}

describe('App authentication guard', () => {
  beforeEach(() => {
    mocks.isAuthenticated = false
    mocks.authSession = null
    window.sessionStorage.clear()
  })

  it('blocks route effects while the server still requires team setup, including a fresh mount', async () => {
    mocks.isAuthenticated = true
    mocks.authSession = { user: { id: 8, team_setup_required: true } }
    const create = () =>
      createMemoryRouter([{ element: <AppShell />, children: [{ path: '/protected', element: <ProtectedPage /> }] }], {
        initialEntries: ['/protected'],
      })
    const first = render(<RouterProvider router={create()} />)
    expect(await screen.findByText('Required team setup')).toBeInTheDocument()
    expect(screen.queryByText('Protected page')).not.toBeInTheDocument()
    expect(mocks.protectedApiCall).not.toHaveBeenCalled()
    first.unmount()
    render(<RouterProvider router={create()} />)
    expect(await screen.findByText('Required team setup')).toBeInTheDocument()
    expect(mocks.protectedApiCall).not.toHaveBeenCalled()
  })

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
      { initialEntries: ['/protected?view=mine#selected'] },
    )

    render(<RouterProvider router={router} />)

    expect(screen.queryByText('Protected page')).not.toBeInTheDocument()
    expect(mocks.protectedApiCall).not.toHaveBeenCalled()
    expect(mocks.taskCenterRender).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument())
    expect(router.state.location.state).toEqual({ returnTo: '/protected?view=mine#selected' })
    expect(mocks.protectedApiCall).not.toHaveBeenCalled()
  })

  it('restores a one-shot OAuth return to the original protected route after auth is confirmed', async () => {
    mocks.isAuthenticated = true
    keepOAuthLoginReturnTo('/projects/12/videos?view=mine#selected')
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { path: '/home', element: <Navigate to="/hot-copy" replace />, handle: { requiresAuth: false } },
            { path: '/hot-copy', element: <div>Fallback landing</div>, handle: { requiresAuth: false } },
            { path: '/projects/:id/videos', element: <ProtectedPage /> },
          ],
        },
      ],
      { initialEntries: ['/home'] },
    )

    render(<RouterProvider router={router} />)

    expect(await screen.findByText('Protected page')).toBeInTheDocument()
    expect(router.state.location).toMatchObject({
      pathname: '/projects/12/videos',
      search: '?view=mine',
      hash: '#selected',
    })
    expect(consumeOAuthLoginReturnTo()).toBe('')
  })
})
