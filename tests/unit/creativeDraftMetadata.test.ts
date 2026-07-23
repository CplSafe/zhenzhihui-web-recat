import { describe, expect, it } from 'vitest'
import {
  canRestrictWorkspaceMember,
  getCreativeProjectDraft,
  getRestrictedMemberIds,
  isCreativeProjectRestrictedForUser,
  mergeLatestProjectMetadata,
  normalizeArray,
  resolveCreativeProjectOwnerId,
  resolveUserId,
  resolveWorkspaceRole,
  toPlainObject,
} from '@/utils/creativeDraftMetadata'

describe('creative draft metadata', () => {
  it('normalizes shared JSON values without changing array identity', () => {
    const items = [{ id: 1 }]

    expect(toPlainObject('{"flow":"smart"}')).toEqual({ flow: 'smart' })
    expect(toPlainObject('not-json')).toBeNull()
    expect(normalizeArray(items)).toBe(items)
    expect(normalizeArray(null)).toEqual([])
  })

  describe('identity normalization', () => {
    it('resolves snake_case IDs and only falls back to the membership record ID', () => {
      expect(resolveUserId({ user_id: '41' })).toBe(41)
      expect(resolveUserId({ id: '42', role: 'member' })).toBe(42)
    })

    it('prefers an explicit user_id and nested user.id over the membership record ID', () => {
      expect(resolveUserId({ id: 9001, user: { id: 42 } })).toBe(42)
      expect(resolveUserId({ id: 9001, user_id: 43, user: { id: 42 } })).toBe(43)
    })

    it('normalizes member_role while giving workspace_role the highest priority', () => {
      expect(resolveWorkspaceRole({ member_role: ' MEMBER ', role: 'admin' })).toBe('member')
      expect(resolveWorkspaceRole({ workspace_role: ' ADMIN ', member_role: 'member', role: 'owner' })).toBe('admin')
      expect(resolveWorkspaceRole({ membership: { role: 'OWNER' } })).toBe('owner')
    })

    it.each([
      [{ user_id: 81 }],
      [{ userId: 81 }],
      [{ creator_user_id: 81 }],
      [{ creatorUserId: 81 }],
      [{ owner_user_id: 81 }],
      [{ ownerUserId: 81 }],
      [{ owner_id: 81 }],
      [{ ownerId: 81 }],
      [{ created_by_user_id: 81 }],
      [{ createdByUserId: 81 }],
      [{ data: { user_id: 81 } }],
      [{ data: { userId: 81 } }],
      [{ data: { creator_user_id: 81 } }],
      [{ data: { creatorUserId: 81 } }],
      [{ data: { owner_user_id: 81 } }],
      [{ data: { ownerUserId: 81 } }],
      [{ data: { owner_id: 81 } }],
      [{ data: { ownerId: 81 } }],
      [{ user: { id: 81 } }],
      [{ creator: { id: 81 } }],
      [{ owner: { id: 81 } }],
    ])('resolves a supported creative-project owner field from %j', (project) => {
      expect(resolveCreativeProjectOwnerId(project)).toBe(81)
    })

    it('enforces owner/admin/member restriction hierarchy and protects the project owner', () => {
      const canRestrict = (actorRole: string, targetRole: string, targetUserId = 10) =>
        canRestrictWorkspaceMember({
          actorRole,
          targetRole,
          targetUserId,
          projectOwnerId: 99,
        })

      expect(canRestrict('owner', 'admin')).toBe(true)
      expect(canRestrict('owner', 'member')).toBe(true)
      expect(canRestrict('owner', 'owner')).toBe(false)

      expect(canRestrict('admin', 'member')).toBe(true)
      expect(canRestrict('admin', 'admin')).toBe(false)
      expect(canRestrict('admin', 'owner')).toBe(false)

      expect(canRestrict('member', 'member')).toBe(true)
      expect(canRestrict('member', 'admin')).toBe(false)
      expect(canRestrict('member', 'owner')).toBe(false)

      expect(canRestrict('owner', 'member', 99)).toBe(false)
      expect(canRestrict('admin', 'member', 99)).toBe(false)
      expect(canRestrict('member', 'member', 99)).toBe(false)
    })
  })

  it('normalizes draft JSON and restricted member IDs', () => {
    const project = {
      draft_json: JSON.stringify({
        restricted_member_ids: ['2', 2, 0, 'bad', 3.8],
      }),
    }

    expect(getCreativeProjectDraft(project)).toMatchObject({ restricted_member_ids: ['2', 2, 0, 'bad', 3.8] })
    expect(getRestrictedMemberIds(project)).toEqual([2, 3])
    expect(isCreativeProjectRestrictedForUser(project, 2)).toBe(true)
    expect(isCreativeProjectRestrictedForUser(project, 9)).toBe(false)
    expect(isCreativeProjectRestrictedForUser({ ...project, user_id: 2 }, 2)).toBe(false)
  })

  it('retains metadata from the latest server draft without replacing editor content', () => {
    const snapshot = {
      flow: 'smart',
      description: '当前标签页的新内容',
      restrictedMemberIds: [1],
      projectVideoStore: { records: [{ id: 'stale' }] },
    }
    const latest = {
      draft_json: {
        description: '服务端旧内容',
        restricted_member_ids: [7, 8],
        projectVideoStore: { records: [{ id: 'latest' }], overrides: {} },
      },
    }

    expect(mergeLatestProjectMetadata(snapshot, latest)).toEqual({
      flow: 'smart',
      description: '当前标签页的新内容',
      restrictedMemberIds: [7, 8],
      projectVideoStore: { records: [{ id: 'latest' }], overrides: {} },
    })
    expect(snapshot.projectVideoStore.records[0].id).toBe('stale')
  })

  it('honors an explicit server-side clear', () => {
    const merged = mergeLatestProjectMetadata(
      { projectVideoStore: { records: [{ id: 'old' }] }, restrictedMemberIds: [5] },
      { projectVideoStore: null, restrictedMemberIds: [] },
    )

    expect(merged.projectVideoStore).toBeNull()
    expect(merged.restrictedMemberIds).toEqual([])
  })
})
