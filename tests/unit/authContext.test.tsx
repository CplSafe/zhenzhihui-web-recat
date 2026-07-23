import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  isUnauthorizedAuthError: vi.fn(),
  refreshSession: vi.fn(),
}))

vi.mock('@/api/auth', () => ({
  clearAuthSessionMarker: vi.fn(),
  getAuthErrorMessage: (_error: unknown, fallback: string) => fallback,
  getAuthenticatedSession: authMocks.getAuthenticatedSession,
  isUnauthorizedAuthError: authMocks.isUnauthorizedAuthError,
  listWorkspaceMembers: vi.fn(() => Promise.resolve([])),
  markAuthSessionExpected: vi.fn(),
  refreshSession: authMocks.refreshSession,
  resetAuthenticatedSession: vi.fn(),
}))

import { AuthProvider, useAuth } from '@/auth/AuthContext'
import { releaseLogoutDraftWriteBarrier } from '@/utils/logoutBarrier'
import { saveSmartEntryDraft, setSmartEntryDraftScope } from '@/utils/smartEntryDraft'

function LoginProbe() {
  const { handleLoginSuccess, isAuthenticated, loadAuthSession } = useAuth()
  return (
    <>
      <button
        type="button"
        onClick={() =>
          handleLoginSuccess({
            user: { id: 9 },
            workspaces: [{ id: 1, type: 'personal' }],
            workspace: { id: 1, type: 'personal' },
            expires_in: 120,
          })
        }
      >
        finish login
      </button>
      <button type="button" onClick={() => void loadAuthSession()}>
        reload session
      </button>
      <output aria-label="authenticated">{String(isAuthenticated)}</output>
    </>
  )
}

describe('AuthProvider login refresh scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    window.sessionStorage.clear()
    releaseLogoutDraftWriteBarrier('9')
    releaseLogoutDraftWriteBarrier('anon')
    vi.clearAllMocks()
    authMocks.getAuthenticatedSession.mockImplementation(() => new Promise(() => {}))
    authMocks.isUnauthorizedAuthError.mockReturnValue(false)
    authMocks.refreshSession.mockResolvedValue({ expires_in: 120 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts the refresh timer when login already supplies a session', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>
      </MemoryRouter>,
    )

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    fireEvent.click(screen.getByRole('button', { name: 'finish login' }))

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 84_000)
  })

  it('clears the matching account when another tab broadcasts logout', () => {
    window.localStorage.setItem('smart_create_draft_v1_uanon_ws1', '{"workspaceId":1}')
    window.localStorage.setItem('zzh_hotcopy_draft_v1_uanon_ws1', '{"started":true}')
    window.sessionStorage.setItem('zzh.smart-entry.draft.v2_uanon_ws1', '{"text":"private"}')

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'finish login' }))
    expect(screen.getByLabelText('authenticated')).toHaveTextContent('true')

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'zzh.auth.logout-event.v1',
          newValue: JSON.stringify({ userId: '9', nonce: 'other-tab' }),
        }),
      )
    })

    expect(screen.getByLabelText('authenticated')).toHaveTextContent('false')
    expect(window.localStorage.getItem('zzh.logout-draft-write-barrier.v1.9')).toBe('1')
    expect(window.localStorage.getItem('zzh.logout-draft-write-barrier.v1.anon')).toBe('1')
    expect(window.localStorage.getItem('smart_create_draft_v1_uanon_ws1')).toBeNull()
    expect(window.localStorage.getItem('zzh_hotcopy_draft_v1_uanon_ws1')).toBeNull()
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft.v2_uanon_ws1')).toBeNull()

    // Simulate a stale cleanup callback after the session store has already
    // switched draft helpers to the anonymous scope.
    setSmartEntryDraftScope('', 1)
    saveSmartEntryDraft({ text: 'must stay cleared' })
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft.v2_uanon_ws1')).toBeNull()
  })

  it('uses the old and anonymous write barriers when an authenticated session expires', async () => {
    window.localStorage.setItem('smart_create_draft_v1_u9_ws1', '{"workspaceId":1}')
    window.localStorage.setItem('smart_create_draft_v1_uanon_ws1', '{"workspaceId":1}')
    window.sessionStorage.setItem('zzh.smart-entry.draft.v2_u9_ws1', '{"text":"private"}')
    window.sessionStorage.setItem('zzh.smart-entry.draft.v2_uanon_ws1', '{"text":"private"}')

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'finish login' }))
    expect(screen.getByLabelText('authenticated')).toHaveTextContent('true')

    authMocks.getAuthenticatedSession.mockRejectedValueOnce({ status: 401 })
    authMocks.isUnauthorizedAuthError.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'reload session' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByLabelText('authenticated')).toHaveTextContent('false')
    expect(window.localStorage.getItem('zzh.logout-draft-write-barrier.v1.9')).toBe('1')
    expect(window.localStorage.getItem('zzh.logout-draft-write-barrier.v1.anon')).toBe('1')
    expect(window.localStorage.getItem('smart_create_draft_v1_u9_ws1')).toBeNull()
    expect(window.localStorage.getItem('smart_create_draft_v1_uanon_ws1')).toBeNull()
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft.v2_u9_ws1')).toBeNull()
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft.v2_uanon_ws1')).toBeNull()

    setSmartEntryDraftScope('', 1)
    saveSmartEntryDraft({ text: 'must stay cleared after expiry' })
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft.v2_uanon_ws1')).toBeNull()
  })

  it('does not block anonymous drafts when the initial session probe is unauthorized', async () => {
    authMocks.getAuthenticatedSession.mockRejectedValueOnce({ status: 401 })
    authMocks.isUnauthorizedAuthError.mockReturnValue(true)

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.localStorage.getItem('zzh.logout-draft-write-barrier.v1.anon')).toBeNull()
    setSmartEntryDraftScope('', 1)
    saveSmartEntryDraft({ text: 'anonymous draft remains available' })
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft.v2_uanon_ws1')).not.toBeNull()
  })
})
