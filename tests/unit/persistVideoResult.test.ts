import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCreativeProject: vi.fn(),
  updateCreativeProjectDraft: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  getCreativeProject: mocks.getCreativeProject,
  updateCreativeProjectDraft: mocks.updateCreativeProjectDraft,
}))

import { persistVideoResultToBackend, persistVideoTerminalStateToBackend } from '@/utils/persistVideoResult'
import { parseVideoModificationDraft, VIDEO_MODIFICATION_DRAFT_FIELD } from '@/utils/videoModificationDraft'

function projectWithDraft(smart: Record<string, any>, revision = 1, topLevel: Record<string, any> = {}): any {
  return {
    id: 88,
    draft_revision: revision,
    draft_json: {
      ...topLevel,
      flow: 'smart',
      smart,
    },
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('persistVideoResultToBackend', () => {
  beforeEach(() => {
    mocks.getCreativeProject.mockReset()
    mocks.updateCreativeProjectDraft.mockReset()
  })

  it('keeps a provider-signed URL out of project history until a stable asset id exists', async () => {
    const persisted = await persistVideoResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://provider.example/result.mp4?X-Amz-Signature=temporary',
      assetId: 0,
      taskId: 3063,
      genId: 'gen-pending-asset',
    })

    expect(persisted).toBe(false)
    expect(mocks.getCreativeProject).not.toHaveBeenCalled()
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('finalizes a matching processing generation even when its media is already persisted', async () => {
    mocks.getCreativeProject.mockResolvedValue(
      projectWithDraft(
        {
          fullVideoUrl: 'https://cdn.example.com/result.mp4',
          fullVideoAssetId: 2511,
          videoVersions: [
            { url: 'https://cdn.example.com/first.mp4', assetId: 2510 },
            { url: 'https://cdn.example.com/result.mp4', assetId: 2511 },
          ],
          vidGenTaskId: 3063,
          pendingVideoSig: 'signature-locked-at-submit',
          fields: {
            [VIDEO_MODIFICATION_DRAFT_FIELD]: JSON.stringify({
              overallNote: '',
              frameSlots: [],
              noteByVersion: {},
              pendingNote: '让动作更自然',
            }),
          },
          videoGenerations: [
            {
              id: 'gen-2',
              status: 'processing',
              taskId: 3063,
              modificationNote: '让动作更自然',
            },
          ],
        },
        36,
      ),
    )
    mocks.updateCreativeProjectDraft.mockResolvedValue({})

    const persisted = await persistVideoResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://provider.example/result.mp4?X-Amz-Signature=must-not-persist',
      assetId: 2511,
      taskId: 3063,
      genId: 'gen-2',
      modificationNote: '让动作更自然',
    })

    expect(persisted).toBe(true)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(1)
    const write = mocks.updateCreativeProjectDraft.mock.calls[0][0]
    expect(write).toMatchObject({ projectId: 88, workspaceId: 21, draftRevision: 36 })
    expect(write.draft.smart).toMatchObject({
      fullVideoUrl: '/api/v1/assets/2511/download?workspace_id=21',
      fullVideoAssetId: 2511,
      vidGenTaskId: 0,
      pendingVideoSig: '',
      lastVideoSig: 'signature-locked-at-submit',
      lastCompletedVideoGenerationId: 'gen-2',
      completedVideoGenerationIds: ['gen-2'],
      videoGenerations: [],
    })
    expect(write.draft.smart.videoVersions).toEqual([
      expect.objectContaining({ url: '/api/v1/assets/2510/download?workspace_id=21', assetId: 2510 }),
      expect.objectContaining({ url: '/api/v1/assets/2511/download?workspace_id=21', assetId: 2511 }),
    ])
    expect(parseVideoModificationDraft(write.draft.smart.fields[VIDEO_MODIFICATION_DRAFT_FIELD])).toMatchObject({
      pendingNote: '',
      noteByVersion: { 'asset:2511': '让动作更自然' },
    })
    expect(JSON.stringify(write.draft)).not.toContain('must-not-persist')
  })

  it('finalizes an old historical callback without replacing the newer current video', async () => {
    mocks.getCreativeProject.mockResolvedValue(
      projectWithDraft(
        {
          fullVideoUrl: 'https://cdn.example.com/newer.mp4',
          fullVideoAssetId: 3000,
          videoVersions: [
            { url: 'https://cdn.example.com/old.mp4', assetId: 2511 },
            { url: 'https://cdn.example.com/newer.mp4', assetId: 3000 },
          ],
          vidGenTaskId: 0,
          pendingVideoSig: '',
          lastVideoSig: 'newer-signature',
          lastCompletedVideoGenerationId: 'gen-newer',
          fields: {
            [VIDEO_MODIFICATION_DRAFT_FIELD]: JSON.stringify({
              overallNote: '',
              frameSlots: [],
              noteByVersion: {},
              pendingNote: '较新任务的修改',
            }),
          },
          videoGenerations: [
            {
              id: 'gen-old',
              status: 'processing',
              taskId: 3063,
              modificationNote: '旧任务的修改',
            },
          ],
        },
        38,
      ),
    )
    mocks.updateCreativeProjectDraft.mockResolvedValue({})

    const persisted = await persistVideoResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://cdn.example.com/old.mp4',
      assetId: 2511,
      taskId: 3063,
      genId: 'gen-old',
      lockedSig: 'old-signature',
    })

    expect(persisted).toBe(true)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(1)
    const write = mocks.updateCreativeProjectDraft.mock.calls[0][0]
    expect(write).toMatchObject({ projectId: 88, workspaceId: 21, draftRevision: 38 })
    expect(write.draft.smart).toMatchObject({
      fullVideoUrl: '/api/v1/assets/3000/download?workspace_id=21',
      fullVideoAssetId: 3000,
      vidGenTaskId: 0,
      pendingVideoSig: '',
      lastVideoSig: 'newer-signature',
      lastCompletedVideoGenerationId: 'gen-newer',
      completedVideoGenerationIds: ['gen-newer', 'gen-old'],
      videoGenerations: [],
    })
    expect(write.draft.smart.videoVersions).toEqual([
      expect.objectContaining({ url: '/api/v1/assets/2511/download?workspace_id=21', assetId: 2511 }),
      expect.objectContaining({ url: '/api/v1/assets/3000/download?workspace_id=21', assetId: 3000 }),
    ])
    expect(parseVideoModificationDraft(write.draft.smart.fields[VIDEO_MODIFICATION_DRAFT_FIELD])).toMatchObject({
      pendingNote: '较新任务的修改',
      noteByVersion: { 'asset:2511': '旧任务的修改' },
    })
  })

  it('does not PUT for a duplicate callback after the generation is fully finalized', async () => {
    mocks.getCreativeProject.mockResolvedValue(
      projectWithDraft(
        {
          fullVideoUrl: 'https://cdn.example.com/result.mp4',
          fullVideoAssetId: 2511,
          videoVersions: [{ url: 'https://cdn.example.com/result.mp4', assetId: 2511 }],
          vidGenTaskId: 0,
          pendingVideoSig: '',
          lastVideoSig: 'signature-locked-at-submit',
          lastCompletedVideoGenerationId: 'gen-2',
          videoGenerations: [],
        },
        37,
      ),
    )

    const persisted = await persistVideoResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://cdn.example.com/result.mp4',
      assetId: 2511,
      taskId: 3063,
      genId: 'gen-2',
    })

    expect(persisted).toBe(true)
    expect(mocks.getCreativeProject).toHaveBeenCalledTimes(1)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('把完成视频合并到最新草稿，并清除本次恢复凭证', async () => {
    mocks.getCreativeProject.mockResolvedValue(
      projectWithDraft(
        {
          projectName: '饮品广告',
          requirement: '清凉饮品',
          reqSummary: '清凉饮品大纲',
          entryMeta: { ratio: '16:9' },
          shots: [{ id: 'shot-1', imageAssetId: 61, duration: '5s', line: '畅饮一夏' }],
          fullVideoUrl: 'https://cdn.example.com/old.mp4',
          fullVideoAssetId: 80,
          videoVersions: [{ url: 'https://cdn.example.com/old.mp4', assetId: 80 }],
          vidGenTaskId: 501,
          pendingVideoSig: 'signature-locked-at-submit',
          videoGenerations: [
            { id: 'gen-1', status: 'processing', taskId: 501 },
            { id: 'gen-2', status: 'processing', taskId: 502 },
          ],
        },
        7,
        {
          restrictedMemberIds: [7, 8],
          projectVideoStore: {
            records: [{ id: 'manual-video', title: '运营手动分类' }],
            overrides: { 'asset:80': { category: '已发布' } },
          },
          externalFeatureMetadata: { owner: 'project-management', revision: 3 },
        },
      ),
    )
    mocks.updateCreativeProjectDraft.mockResolvedValue({})

    const persisted = await persistVideoResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://cdn.example.com/new.mp4',
      assetId: 81,
      taskId: 501,
      genId: 'gen-1',
    })

    expect(persisted).toBe(true)
    expect(mocks.getCreativeProject).toHaveBeenCalledWith({ projectId: 88, workspaceId: 21 })
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(1)
    const write = mocks.updateCreativeProjectDraft.mock.calls[0][0]
    expect(write).toMatchObject({ projectId: 88, workspaceId: 21, draftRevision: 7 })
    expect(write.draft).toMatchObject({
      restrictedMemberIds: [7, 8],
      projectVideoStore: {
        records: [{ id: 'manual-video', title: '运营手动分类' }],
        overrides: { 'asset:80': { category: '已发布' } },
      },
      externalFeatureMetadata: { owner: 'project-management', revision: 3 },
      generatedVideoUrl: '/api/v1/assets/81/download?workspace_id=21',
      generatedVideoAssetId: 81,
      smart: {
        fullVideoUrl: '/api/v1/assets/81/download?workspace_id=21',
        fullVideoAssetId: 81,
        vidGenTaskId: 0,
        pendingVideoSig: '',
        lastVideoSig: 'signature-locked-at-submit',
        lastCompletedVideoGenerationId: 'gen-1',
        completedVideoGenerationIds: ['gen-1'],
        videoGenerations: [{ id: 'gen-2', status: 'processing', taskId: 502 }],
      },
    })
    expect(write.draft.smart.videoVersions).toEqual([
      expect.objectContaining({ url: '/api/v1/assets/80/download?workspace_id=21', assetId: 80 }),
      expect.objectContaining({
        url: '/api/v1/assets/81/download?workspace_id=21',
        assetId: 81,
        createdAt: expect.any(String),
      }),
    ])
  })

  it('把失败终态写回并移除会在刷新后恢复的生成中标记', async () => {
    mocks.getCreativeProject.mockResolvedValue(
      projectWithDraft(
        {
          projectName: '饮品广告',
          vidGenTaskId: 501,
          pendingVideoSig: 'signature-locked-at-submit',
          videoGenerations: [
            { id: 'gen-1', status: 'processing', taskId: 501 },
            { id: 'gen-2', status: 'processing', taskId: 502 },
          ],
        },
        9,
        {
          restricted_member_ids: [17, 18],
          projectVideoStore: {
            records: [{ id: 'manual-video', title: '人工维护的视频' }],
            overrides: {},
          },
          externalFeatureMetadata: { owner: 'permissions', revision: 4 },
        },
      ),
    )
    mocks.updateCreativeProjectDraft.mockResolvedValue({})

    const persisted = await persistVideoTerminalStateToBackend({
      projectId: 88,
      workspaceId: 21,
      taskId: 501,
      genId: 'gen-1',
      status: 'failed',
      error: '生成服务超时',
    })

    expect(persisted).toBe(true)
    const write = mocks.updateCreativeProjectDraft.mock.calls[0][0]
    expect(write).toMatchObject({ projectId: 88, workspaceId: 21, draftRevision: 9 })
    expect(write.draft).toMatchObject({
      restricted_member_ids: [17, 18],
      projectVideoStore: {
        records: [{ id: 'manual-video', title: '人工维护的视频' }],
        overrides: {},
      },
      externalFeatureMetadata: { owner: 'permissions', revision: 4 },
    })
    expect(write.draft).not.toHaveProperty('restrictedMemberIds')
    expect(write.draft.smart).toMatchObject({
      vidGenTaskId: 0,
      pendingVideoSig: '',
      completedVideoGenerationIds: ['gen-1'],
      videoGenerations: [{ id: 'gen-2', status: 'processing', taskId: 502 }],
    })
    expect(write.draft.smart.videoGenerations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gen-1', status: 'processing' })]),
    )
  })

  it('旧草稿只有 vidGenTaskId 时也能清除失败任务的恢复凭证', async () => {
    mocks.getCreativeProject.mockResolvedValue(
      projectWithDraft(
        {
          projectName: '旧版智能成片',
          vidGenTaskId: 701,
          pendingVideoSig: 'legacy-pending-signature',
        },
        12,
      ),
    )
    mocks.updateCreativeProjectDraft.mockResolvedValue({})

    const persisted = await persistVideoTerminalStateToBackend({
      projectId: 88,
      workspaceId: 21,
      taskId: 701,
      genId: 'legacy-generation-not-persisted',
      status: 'failed',
      error: '后端任务已失败',
    })

    expect(persisted).toBe(true)
    expect(mocks.updateCreativeProjectDraft.mock.calls[0][0].draft.smart).toMatchObject({
      vidGenTaskId: 0,
      pendingVideoSig: '',
    })
  })

  it.each([
    ['已发布 generation', 'published', ''],
    ['已有成功结果标记', 'processing', 'gen-1'],
  ])('拒绝晚到的失败回调覆盖%s', async (_case, generationStatus, lastCompletedGenerationId) => {
    mocks.getCreativeProject.mockResolvedValue(
      projectWithDraft({
        fullVideoUrl: 'https://cdn.example.com/result.mp4',
        fullVideoAssetId: 81,
        vidGenTaskId: 0,
        lastCompletedVideoGenerationId: lastCompletedGenerationId,
        videoGenerations: [{ id: 'gen-1', status: generationStatus, taskId: 0 }],
      }),
    )

    const persisted = await persistVideoTerminalStateToBackend({
      projectId: 88,
      workspaceId: 21,
      taskId: 501,
      genId: 'gen-1',
      status: 'failed',
      error: '晚到的轮询错误',
    })

    expect(persisted).toBe(false)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('拒绝没有所有权的过期回调，避免覆盖新任务结果', async () => {
    mocks.getCreativeProject.mockResolvedValue(
      projectWithDraft({
        fullVideoUrl: 'https://cdn.example.com/current.mp4',
        fullVideoAssetId: 90,
        vidGenTaskId: 700,
        videoGenerations: [{ id: 'gen-current', status: 'processing', taskId: 700 }],
      }),
    )

    const persisted = await persistVideoResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://cdn.example.com/stale.mp4',
      assetId: 89,
      taskId: 699,
      genId: 'gen-stale',
    })

    expect(persisted).toBe(false)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('遇到 revision 409 时重拉最新草稿并只重试一次', async () => {
    const smart = {
      vidGenTaskId: 501,
      pendingVideoSig: 'locked-signature',
      videoGenerations: [{ id: 'gen-1', status: 'processing', taskId: 501 }],
    }
    mocks.getCreativeProject
      .mockResolvedValueOnce(projectWithDraft(smart, 4))
      .mockResolvedValueOnce(projectWithDraft({ ...smart, requirement: '并发保存后的新内容' }, 5))
    mocks.updateCreativeProjectDraft
      .mockRejectedValueOnce(Object.assign(new Error('DRAFT_CONFLICT'), { status: 409 }))
      .mockResolvedValueOnce({})

    await expect(
      persistVideoResultToBackend({
        projectId: 88,
        workspaceId: 21,
        url: 'https://cdn.example.com/result.mp4',
        assetId: 81,
        taskId: 501,
        genId: 'gen-1',
      }),
    ).resolves.toBe(true)

    expect(mocks.getCreativeProject).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft.mock.calls.map(([args]) => args.draftRevision)).toEqual([4, 5])
    expect(mocks.updateCreativeProjectDraft.mock.calls[1][0].draft.smart.requirement).toBe('并发保存后的新内容')
  })

  it('串行处理同一项目的并发完成回调，并让后一个保存读取前一个的新 revision', async () => {
    let database = projectWithDraft(
      {
        projectName: '并发生成',
        vidGenTaskId: 501,
        videoGenerations: [
          { id: 'gen-1', status: 'processing', taskId: 501 },
          { id: 'gen-2', status: 'processing', taskId: 502 },
        ],
      },
      1,
    )
    let releaseFirstWrite!: () => void
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    let writeCount = 0

    mocks.getCreativeProject.mockImplementation(async () => clone(database))
    mocks.updateCreativeProjectDraft.mockImplementation(async (args: any) => {
      writeCount += 1
      if (writeCount === 1) await firstWriteGate
      expect(args.draftRevision).toBe(database.draft_revision)
      database = {
        ...database,
        draft_revision: database.draft_revision + 1,
        draft_json: clone(args.draft),
      }
      return {}
    })

    const first = persistVideoResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://cdn.example.com/first.mp4',
      assetId: 801,
      taskId: 501,
      genId: 'gen-1',
    })
    const second = persistVideoResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://cdn.example.com/second.mp4',
      assetId: 802,
      taskId: 502,
      genId: 'gen-2',
    })

    await vi.waitFor(() => expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(1))
    expect(mocks.getCreativeProject).toHaveBeenCalledTimes(1)

    releaseFirstWrite()
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])

    expect(mocks.getCreativeProject).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft.mock.calls.map(([args]) => args.draftRevision)).toEqual([1, 2])
    expect(database.draft_revision).toBe(3)
    expect(database.draft_json.smart.videoVersions.map((version: any) => version.assetId)).toEqual([801, 802])
  })
})
