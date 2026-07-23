import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_NAME_MAX, normalizeWorkspaceNameForCompare, validateWorkspaceName } from '@/utils/workspaceName'
import { shouldClearSessionAfterLogoutFailure, shouldRequestAuthenticatedSession } from '@/utils/workflowGuards'

const mocks = vi.hoisted(() => ({ getCreativeProject: vi.fn() }))

vi.mock('@/api/business', () => ({ getCreativeProject: mocks.getCreativeProject }))

import { resolveProjectPath } from '@/utils/projectRoute'

describe('workspace name validation', () => {
  it.each([
    ['', '空间名称不能为空'],
    ['   ', '空间名称不能为空'],
    [null, '空间名称不能为空'],
  ])('rejects an empty name %p', (value, expected) => {
    expect(validateWorkspaceName(value as unknown as string)).toBe(expected)
  })

  it('uses Unicode code points for the 20-character boundary', () => {
    expect(validateWorkspaceName('团'.repeat(WORKSPACE_NAME_MAX))).toBe('')
    expect(validateWorkspaceName('😀'.repeat(WORKSPACE_NAME_MAX))).toBe('')
    expect(validateWorkspaceName('😀'.repeat(WORKSPACE_NAME_MAX + 1))).toBe(
      `空间名称不能超过 ${WORKSPACE_NAME_MAX} 个字符`,
    )
  })

  it.each(['团队\n名称', '团队\t名称', `团队${String.fromCharCode(0x7f)}名称`])(
    'rejects control characters in %p',
    (value) => {
      expect(validateWorkspaceName(value)).toBe('空间名称不能包含换行或控制字符')
    },
  )

  it.each(['<script>', '团队>名称'])('rejects HTML delimiter characters in %p', (value) => {
    expect(validateWorkspaceName(value)).toBe('空间名称不能包含 < 或 > 字符')
  })

  it('trims harmless outer whitespace and normalizes duplicate names', () => {
    expect(validateWorkspaceName('  产品团队  ')).toBe('')
    expect(normalizeWorkspaceNameForCompare('  Team\t  A  ')).toBe('team a')
    expect(normalizeWorkspaceNameForCompare(null as unknown as string)).toBe('')
  })
})

describe('workflow guards', () => {
  it('only requests a session for the literal true marker', () => {
    expect(shouldRequestAuthenticatedSession(true)).toBe(true)
    for (const value of [false, 1, 'true', null, undefined]) {
      expect(shouldRequestAuthenticatedSession(value)).toBe(false)
    }
  })

  it('only clears local session state after an unauthorized logout failure', () => {
    expect(shouldClearSessionAfterLogoutFailure({ status: 401 })).toBe(true)
    for (const value of [{ status: 0 }, { status: 403 }, { response: { status: 401 } }, null]) {
      expect(shouldClearSessionAfterLogoutFailure(value)).toBe(false)
    }
  })
})

describe('resolveProjectPath', () => {
  beforeEach(() => mocks.getCreativeProject.mockReset())

  it.each([0, '', null, undefined, Number.NaN])('falls back without fetching for invalid project id %p', async (id) => {
    await expect(resolveProjectPath(id as never, 21)).resolves.toBe('/smart')
    expect(mocks.getCreativeProject).not.toHaveBeenCalled()
  })

  it.each([
    [{ flow: 'hot-copy' }, '/hot-copy/171'],
    [{ smart: { flow: 'HOT-COPY' } }, '/hot-copy/171'],
    [{ flow: 'smart' }, '/smart/171'],
    [{ smart: { requirement: 'legacy smart draft' } }, '/smart/171'],
    [{ flow: 'legacy' }, '/smart/171'],
    [null, '/smart/171'],
  ])('routes draft %p to %s', async (draft, expected) => {
    mocks.getCreativeProject.mockResolvedValue({ draft_json: draft })
    await expect(resolveProjectPath(171, 21)).resolves.toBe(expected)
    expect(mocks.getCreativeProject).toHaveBeenCalledWith({ projectId: 171, workspaceId: 21 })
  })

  it('parses nested and string draft response shapes', async () => {
    mocks.getCreativeProject.mockResolvedValue({ data: { draft_json: JSON.stringify({ flow: 'hot-copy' }) } })
    await expect(resolveProjectPath('88', 22)).resolves.toBe('/hot-copy/88')
  })

  it('falls back safely for malformed JSON', async () => {
    mocks.getCreativeProject.mockResolvedValue({ draft_json: '{bad json' })
    await expect(resolveProjectPath(9, 21)).resolves.toBe('/smart/9')
  })

  it('falls back safely when project resolution throws', async () => {
    const brokenResponse = Object.defineProperty({}, 'draft_json', {
      get() {
        throw new Error('offline')
      },
    })
    mocks.getCreativeProject.mockResolvedValue(brokenResponse)
    await expect(resolveProjectPath(9, 21)).resolves.toBe('/smart/9')
  })
})
