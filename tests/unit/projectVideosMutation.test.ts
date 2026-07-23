import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCreativeProject: vi.fn(),
  updateCreativeProjectDraft: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  getCreativeProject: mocks.getCreativeProject,
  updateCreativeProjectDraft: mocks.updateCreativeProjectDraft,
}))

import { addClassifiedVideo, deleteProjectVideo, publishProjectVideo } from '@/api/projectVideos'

function projectWithVersions(): any {
  return {
    id: 21,
    user_id: 88,
    draft_revision: 4,
    draft_json: {
      flow: 'smart',
      smart: {
        videoVersions: [
          {
            id: 'first',
            assetId: 501,
            updatedAt: '2026-07-15T09:00:00.000Z',
          },
          {
            id: 'second',
            assetId: 502,
            updatedAt: '2026-07-15T10:00:00.000Z',
          },
        ],
      },
      projectVideoStore: { records: [], overrides: {} },
    },
  }
}

describe('projectVideos mutations', () => {
  beforeEach(() => {
    mocks.getCreativeProject.mockReset()
    mocks.updateCreativeProjectDraft.mockReset()
    mocks.getCreativeProject.mockResolvedValue({
      id: 21,
      draft_revision: 4,
      draft_json: { flow: 'smart', projectVideoStore: { records: [], overrides: {} } },
    })
    mocks.updateCreativeProjectDraft.mockResolvedValue({ draft_revision: 5 })
  })

  it('records the target project owner so classifiers do not gain delete permission', async () => {
    await addClassifiedVideo({
      projectId: 21,
      workspaceId: 7,
      title: '归类成片',
      videoUrl: '/api/v1/assets/42/download?workspace_id=7',
      createdByName: '项目创建者',
      createdByUserId: 88,
      sourceKey: 'asset:42',
    })

    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 21,
        workspaceId: 7,
        draftRevision: 4,
        draft: expect.objectContaining({
          flow: 'smart',
          projectVideoStore: expect.objectContaining({
            records: [
              expect.objectContaining({
                title: '归类成片',
                createdByName: '项目创建者',
                createdByUserId: 88,
                sourceKey: 'asset:42',
              }),
            ],
          }),
        }),
      }),
    )
  })

  it('re-reads and retries after a revision conflict', async () => {
    mocks.getCreativeProject
      .mockResolvedValueOnce({ draft_revision: 4, draft_json: { projectVideoStore: { records: [], overrides: {} } } })
      .mockResolvedValueOnce({ draft_revision: 5, draft_json: { projectVideoStore: { records: [], overrides: {} } } })
    mocks.updateCreativeProjectDraft
      .mockRejectedValueOnce({ status: 409, code: 'DRAFT_CONFLICT' })
      .mockResolvedValueOnce({ draft_revision: 6 })

    await addClassifiedVideo({
      projectId: 21,
      workspaceId: 7,
      videoUrl: '/api/video.mp4',
      createdByUserId: 88,
      sourceKey: 'source:retry',
    })

    expect(mocks.getCreativeProject).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft.mock.calls[1][0].draftRevision).toBe(5)
  })

  it.each([
    ['delete', () => deleteProjectVideo({ projectId: 21, workspaceId: 7, videoId: 'derived-second-999' })],
    ['publish', () => publishProjectVideo({ projectId: 21, workspaceId: 7, videoId: 'derived-second-999' })],
  ])('rejects a stale %s ID instead of mutating another video', async (_action, run) => {
    mocks.getCreativeProject.mockResolvedValue(projectWithVersions())

    await expect(run()).rejects.toThrow('视频不存在或标识已失效')
    expect(mocks.getCreativeProject).toHaveBeenCalledTimes(1)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('persists an override only for an exact current derived video ID', async () => {
    mocks.getCreativeProject.mockResolvedValue(projectWithVersions())

    await deleteProjectVideo({ projectId: 21, workspaceId: 7, videoId: 'derived-second' })

    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          projectVideoStore: expect.objectContaining({
            overrides: expect.objectContaining({
              'derived-second': expect.objectContaining({ hidden: true }),
            }),
          }),
        }),
      }),
    )
  })

  it('treats a manual video already removed by a committed retry as idempotent success', async () => {
    const manualRecord = {
      id: 'video-manual-1',
      projectId: 21,
      workspaceId: 7,
      title: '手动视频',
      coverUrl: '',
      videoUrl: '/api/manual.mp4',
      durationSeconds: 5,
      status: 'published',
      createdByName: '项目创建者',
      createdByUserId: 88,
      createdAt: '2026-07-15T09:00:00.000Z',
      updatedAt: '2026-07-15T09:00:00.000Z',
      sourceType: 'smart',
      flow: 'smart',
      manual: true,
    }
    mocks.getCreativeProject
      .mockResolvedValueOnce({
        id: 21,
        draft_revision: 4,
        draft_json: { projectVideoStore: { records: [manualRecord], overrides: {} } },
      })
      .mockResolvedValueOnce({
        id: 21,
        draft_revision: 5,
        draft_json: { projectVideoStore: { records: [], overrides: {} } },
      })
    mocks.updateCreativeProjectDraft
      .mockRejectedValueOnce({ status: 409, code: 'DRAFT_CONFLICT' })
      .mockResolvedValueOnce({ draft_revision: 6 })

    await expect(
      deleteProjectVideo({ projectId: 21, workspaceId: 7, videoId: 'video-manual-1' }),
    ).resolves.toBeUndefined()

    expect(mocks.getCreativeProject).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(2)
  })
})
