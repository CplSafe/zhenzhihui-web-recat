import { describe, expect, it } from 'vitest'
import {
  filterAssetsByProjectAccess,
  filterProjectsByAccess,
  getAccessibleProjectIds,
  isAssetAccessibleByProject,
  resolveAssetProjectId,
  resolveCreativeProjectId,
} from '@/utils/projectAssetAccess'

describe('projectAssetAccess', () => {
  it('normalizes project and asset project IDs from supported response shapes', () => {
    expect(resolveCreativeProjectId({ project_id: '12' })).toBe(12)
    expect(resolveCreativeProjectId({ data: { id: 13 } })).toBe(13)
    expect(resolveCreativeProjectId({ project: { id: 14 } })).toBe(14)
    expect(resolveAssetProjectId({ creativeProjectId: '21' })).toBe(21)
    expect(resolveAssetProjectId({ meta_json: '{"project_id":22}' })).toBe(22)
    expect(resolveAssetProjectId({ data: { projectId: 23 } })).toBe(23)
  })

  it('keeps projects available to ordinary members and excludes only explicitly restricted projects', () => {
    const projects = [
      { id: 1, title: 'restricted legacy video', user_id: 8, draft_json: { restrictedMemberIds: [7] } },
      { id: 2, title: 'ordinary member can access', user_id: 8, draft_json: { restrictedMemberIds: [9] } },
      { id: 3, title: 'owner can access', user_id: 7, draft_json: { restrictedMemberIds: [7] } },
    ]
    const accessibleIds = getAccessibleProjectIds(projects, 7)

    expect([...accessibleIds]).toEqual([2, 3])
    expect(filterProjectsByAccess(projects, 7).map((project) => project.id)).toEqual([2, 3])
  })

  it('fails closed for project access while the authenticated user identity is unknown', () => {
    const projects = [
      { id: 1, draft_json: { restrictedMemberIds: [7] } },
      { id: 2, draft_json: { restrictedMemberIds: [] } },
    ]

    expect([...getAccessibleProjectIds(projects, 0)]).toEqual([])
    expect(filterProjectsByAccess(projects, null)).toEqual([])
  })

  it('fails closed for linked assets until permissions load while keeping unlinked assets visible', () => {
    const assets = [
      { id: 100, name: 'unlinked' },
      { id: 101, name: 'allowed', project_id: 2 },
      { id: 102, name: 'restricted', projectId: 1 },
      { id: 103, name: 'unknown', meta_json: { creative_project_id: 999 } },
    ]
    const accessibleIds = new Set([2])

    expect(filterAssetsByProjectAccess(assets, accessibleIds, false).map((asset) => asset.id)).toEqual([100])
    expect(filterAssetsByProjectAccess(assets, accessibleIds, true).map((asset) => asset.id)).toEqual([100, 101])
    expect(isAssetAccessibleByProject(assets[0], accessibleIds, false)).toBe(true)
  })
})
