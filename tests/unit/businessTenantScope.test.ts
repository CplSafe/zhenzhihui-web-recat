import {
  createCreativeProject,
  deleteAsset,
  deleteCreativeProject,
  getAssetDownloadUrl,
  getCreativeProject,
  listAssets,
  patchCreativeProject,
  updateCreativeProjectDraft,
} from '@/api/business'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const INVALID_POSITIVE_INTEGERS = [0, -1, Number.NaN, 1.5]

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify({ data: value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[callIndex]?.[1]?.body || '{}'))
}

describe('business tenant-scoped project and asset requests', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid project id before reading a project: %s', (projectId) => {
    expect(() => getCreativeProject({ projectId, workspaceId: 21 })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid project id before writing a draft: %s', (projectId) => {
    expect(() =>
      updateCreativeProjectDraft({ projectId, workspaceId: 21, draft: { title: 'draft' }, draftRevision: 0 }),
    ).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid workspace before reading a project: %s', (workspaceId) => {
    expect(() => getCreativeProject({ projectId: 1, workspaceId })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid workspace before writing a draft: %s', (workspaceId) => {
    expect(() =>
      updateCreativeProjectDraft({ projectId: 1, workspaceId, draft: { title: 'draft' }, draftRevision: 0 }),
    ).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid workspace before creating a project: %s', (workspaceId) => {
    expect(() => createCreativeProject({ workspace_id: workspaceId, title: 'project' })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid workspace before patching a project: %s', (workspaceId) => {
    expect(() => patchCreativeProject({ projectId: 7, workspaceId, title: 'renamed' })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid workspace before deleting a project: %s', (workspaceId) => {
    expect(() => deleteCreativeProject({ projectId: 7, workspaceId })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid project id before deleting a project: %s', (projectId) => {
    expect(() => deleteCreativeProject({ projectId, workspaceId: 1 })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pins project reads, writes, patches and deletes to their explicit workspace', async () => {
    await getCreativeProject({ projectId: 7, workspaceId: 21 })
    await updateCreativeProjectDraft({
      projectId: 7,
      workspaceId: 21,
      draft: { title: 'workspace 21 draft' },
      draftRevision: 4,
      coverAssetId: 81,
    })
    await patchCreativeProject({ projectId: 7, workspaceId: 21, title: 'workspace 21 title' })
    await deleteCreativeProject({ projectId: 7, workspaceId: 21 })

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/creative/projects/7?workspace_id=21',
      '/api/v1/creative/projects/7/draft?workspace_id=21',
      '/api/v1/creative/projects/7?workspace_id=21',
      '/api/v1/creative/projects/7?workspace_id=21',
    ])
    expect(requestBody(fetchMock, 1)).toEqual({
      draft: JSON.stringify({ title: 'workspace 21 draft' }),
      draft_revision: 4,
      cover_asset_id: 81,
    })
    expect(requestBody(fetchMock, 2)).toEqual({ title: 'workspace 21 title' })
  })

  it('pins project creation to the payload workspace in both query and body', async () => {
    await createCreativeProject({ workspace_id: 22, title: 'new project' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/creative/projects?workspace_id=22',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(requestBody(fetchMock)).toEqual({ workspace_id: 22, title: 'new project' })
  })

  it('pins asset list, delete and download URLs to the requested workspace', async () => {
    await listAssets({ workspaceId: 31, type: 'video', status: 'active', source: 'upload', limit: 20, offset: 40 })
    await deleteAsset({ workspaceId: 31, assetId: 91 })

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/assets?workspace_id=31&limit=20&offset=40&type=video&status=active&source=upload',
      '/api/v1/assets/91?workspace_id=31',
    ])
    await expect(getAssetDownloadUrl({ workspaceId: 31, assetId: 91 })).resolves.toBe(
      '/api/v1/assets/91/download?workspace_id=31',
    )
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid asset-list workspace before fetch: %s', (workspaceId) => {
    expect(() => listAssets({ workspaceId })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid asset id before delete: %s', (assetId) => {
    expect(() => deleteAsset({ workspaceId: 1, assetId })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid asset-delete workspace before fetch: %s', (workspaceId) => {
    expect(() => deleteAsset({ workspaceId, assetId: 1 })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)(
    'rejects an invalid asset id before building a download URL: %s',
    async (assetId) => {
      await expect(getAssetDownloadUrl({ workspaceId: 1, assetId })).rejects.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each(INVALID_POSITIVE_INTEGERS)(
    'rejects an invalid workspace before building an asset download URL: %s',
    async (workspaceId) => {
      await expect(getAssetDownloadUrl({ workspaceId, assetId: 1 })).rejects.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('accepts one as the minimum positive tenant identifier', async () => {
    await getCreativeProject({ projectId: 1, workspaceId: 1 })
    await updateCreativeProjectDraft({ projectId: 1, workspaceId: 1, draft: {}, draftRevision: 0 })
    await createCreativeProject({ workspace_id: 1 })
    await deleteCreativeProject({ projectId: 1, workspaceId: 1 })
    await listAssets({ workspaceId: 1 })
    await deleteAsset({ workspaceId: 1, assetId: 1 })
    await expect(getAssetDownloadUrl({ workspaceId: 1, assetId: 1 })).resolves.toBe(
      '/api/v1/assets/1/download?workspace_id=1',
    )

    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})
