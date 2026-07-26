import { describe, expect, it } from 'vitest'
import {
  getHotCopyRouteSessionToken,
  resolveHotCopyRouteSession,
  type HotCopyRouteSession,
} from '@/utils/hotCopyRouteSession'

function session(overrides: Partial<HotCopyRouteSession> = {}): HotCopyRouteSession {
  return {
    workspaceId: 21,
    projectId: '',
    version: 0,
    locationKey: 'entry',
    mountNonce: 'mount-1',
    ...overrides,
  }
}

describe('resolveHotCopyRouteSession', () => {
  it('keeps the editor mounted for the authenticated first project binding', () => {
    const current = session()
    const next = resolveHotCopyRouteSession(current, {
      workspaceId: 21,
      projectId: '210',
      locationKey: 'bound',
      routeState: {
        hotCopyCreationBindProjectId: 210,
        hotCopyCreationBindSessionToken: getHotCopyRouteSessionToken(current),
        hotCopyCreationBindWorkspaceId: 21,
      },
    })

    expect(next.projectId).toBe('210')
    expect(next.version).toBe(0)
  })

  it('remounts when another project is opened without the current binding token', () => {
    const current = session({ projectId: '210' })
    const next = resolveHotCopyRouteSession(current, {
      workspaceId: 21,
      projectId: '211',
      locationKey: 'other-project',
      routeState: {},
    })

    expect(next.projectId).toBe('211')
    expect(next.version).toBe(1)
  })

  it('rejects a first-binding marker from another workspace or session', () => {
    const current = session()
    const next = resolveHotCopyRouteSession(current, {
      workspaceId: 21,
      projectId: '210',
      locationKey: 'foreign-binding',
      routeState: {
        hotCopyCreationBindProjectId: 210,
        hotCopyCreationBindSessionToken: 'another-session',
        hotCopyCreationBindWorkspaceId: 99,
      },
    })

    expect(next.version).toBe(1)
  })

  it('remounts an explicit new session while staying on the entry route', () => {
    const current = session()
    const next = resolveHotCopyRouteSession(current, {
      workspaceId: 21,
      projectId: '',
      locationKey: 'new-entry',
      routeState: { taskCenterNewSession: true },
    })

    expect(next.version).toBe(1)
  })
})
