import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCreativeProject: vi.fn(),
  updateCreativeProjectDraft: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  getCreativeProject: mocks.getCreativeProject,
  updateCreativeProjectDraft: mocks.updateCreativeProjectDraft,
}))

import { persistHotCopyResultToBackend, persistHotCopyTerminalStateToBackend } from '@/utils/persistHotCopyResult'
import { parseVideoModificationDraft } from '@/utils/videoModificationDraft'

function hotCopyDraft(overrides: Record<string, unknown> = {}): any {
  return {
    flow: 'hot-copy',
    description: '必须保留的项目描述',
    generatedVideoUrl: '/old.mp4',
    generatedVideoAssetId: 10,
    videoHistoryList: [{ url: '/old.mp4', assetId: 10 }],
    smart: {
      flow: 'hot-copy',
      basePrompt: '必须保留的生成提示词',
      fullVideoUrl: '/old.mp4',
      fullVideoAssetId: 10,
      videoVersions: [{ url: '/old.mp4', assetId: 10 }],
      videoGenerating: true,
      vidGenTaskId: 101,
      videoGenerations: [
        {
          id: 'generation-target',
          status: 'processing',
          taskId: 101,
          note: '首次生成',
          createdAt: 1_800_000_000_000,
        },
        {
          id: 'generation-other',
          status: 'processing',
          taskId: 202,
          note: '另一个任务',
          createdAt: 1_800_000_001_000,
        },
      ],
    },
    ...overrides,
  }
}

function savedDraft(callIndex = 0): any {
  return mocks.updateCreativeProjectDraft.mock.calls[callIndex]?.[0]?.draft
}

beforeEach(() => {
  mocks.getCreativeProject.mockReset()
  mocks.updateCreativeProjectDraft.mockReset()
  mocks.getCreativeProject.mockResolvedValue({
    draft_revision: 4,
    draft_json: hotCopyDraft(),
  })
  mocks.updateCreativeProjectDraft.mockResolvedValue({})
})

describe('persistHotCopyResultToBackend', () => {
  it('does not persist a provider-signed result before its asset id is available', async () => {
    const persisted = await persistHotCopyResultToBackend({
      projectId: 55,
      workspaceId: 21,
      url: 'https://provider.example/result.mp4?signature=temporary',
      assetId: 0,
      taskId: 910,
      generationId: 'gen-awaiting-asset',
    })

    expect(persisted).toBe(false)
    expect(mocks.getCreativeProject).not.toHaveBeenCalled()
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('成功落库后发布目标 generation、清理当前任务并保留其他草稿字段', async () => {
    const original = hotCopyDraft()
    original.smart.videoModificationDraft = {
      overallNote: '',
      frameSlots: [],
      noteByVersion: { 'asset:10': '上一版说明' },
      pendingNote: '让人物动作更自然',
    }
    original.smart.videoGenerations[0].modificationNote = '让人物动作更自然'
    mocks.getCreativeProject.mockResolvedValue({ draft_revision: 4, draft_json: original })

    const persisted = await persistHotCopyResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: 'https://provider.example/result.mp4?x-oss-signature=must-not-persist',
      assetId: 501,
      taskId: 101,
      generationId: 'generation-target',
      modificationNote: '让人物动作更自然',
    })

    expect(persisted).toBe(true)
    expect(mocks.getCreativeProject).toHaveBeenCalledWith({ projectId: 88, workspaceId: 21 })
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(1)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 88, workspaceId: 21, draftRevision: 4 }),
    )

    const saved = savedDraft()
    expect(saved).toMatchObject({
      flow: 'hot-copy',
      description: '必须保留的项目描述',
      generatedVideoUrl: '/api/v1/assets/501/download?workspace_id=21',
      generatedVideoAssetId: 501,
    })
    expect(saved.videoHistoryList).toEqual([
      { url: '/api/v1/assets/10/download?workspace_id=21', assetId: 10 },
      { url: '/api/v1/assets/501/download?workspace_id=21', assetId: 501 },
    ])
    expect(saved.smart).toMatchObject({
      basePrompt: '必须保留的生成提示词',
      fullVideoUrl: '/api/v1/assets/501/download?workspace_id=21',
      fullVideoAssetId: 501,
      videoGenerating: false,
      vidGenTaskId: 0,
      lastCompletedVideoGenerationId: 'generation-target',
    })
    expect(saved.smart.videoVersions).toEqual([
      { url: '/api/v1/assets/10/download?workspace_id=21', assetId: 10 },
      { url: '/api/v1/assets/501/download?workspace_id=21', assetId: 501 },
    ])
    expect(saved.smart.videoGenerations).toEqual([
      expect.objectContaining({ id: 'generation-target', status: 'published', taskId: 0 }),
      expect.objectContaining({ id: 'generation-other', status: 'processing', taskId: 202 }),
    ])
    expect(parseVideoModificationDraft(saved.smart.videoModificationDraft)).toMatchObject({
      pendingNote: '',
      noteByVersion: {
        'asset:10': '上一版说明',
        'asset:501': '让人物动作更自然',
      },
    })
    expect(JSON.stringify(saved)).not.toContain('must-not-persist')

    expect(original.generatedVideoAssetId).toBe(10)
    expect(original.smart.vidGenTaskId).toBe(101)
    expect(original.smart.videoGenerations[0].status).toBe('processing')
  })

  it('结果已经存在时保持幂等，不重复提交草稿', async () => {
    const existing = hotCopyDraft({ generatedVideoAssetId: 501, generatedVideoUrl: '/result.mp4' })
    mocks.getCreativeProject.mockResolvedValue({ draft_revision: 4, draft_json: existing })

    const persisted = await persistHotCopyResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: '/result.mp4',
      assetId: 501,
    })

    expect(persisted).toBe(true)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('媒体已存在但任务仍在 processing 时继续完成收尾且不重复历史', async () => {
    const existing = hotCopyDraft({
      generatedVideoAssetId: 501,
      generatedVideoUrl: '/result.mp4',
      videoHistoryList: [
        { url: '/old.mp4', assetId: 10 },
        { url: '/result.mp4', assetId: 501 },
      ],
    })
    existing.smart.fullVideoUrl = '/result.mp4'
    existing.smart.fullVideoAssetId = 501
    existing.smart.videoVersions = [
      { url: '/api/v1/assets/10/download?workspace_id=21', assetId: 10 },
      { url: '/api/v1/assets/501/download?workspace_id=21', assetId: 501 },
    ]
    mocks.getCreativeProject.mockResolvedValue({ draft_revision: 4, draft_json: existing })

    const persisted = await persistHotCopyResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: '/result.mp4',
      assetId: 501,
      taskId: 101,
      generationId: 'generation-target',
    })

    expect(persisted).toBe(true)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(1)
    const saved = savedDraft()
    expect(saved.videoHistoryList).toEqual([
      { url: '/api/v1/assets/10/download?workspace_id=21', assetId: 10 },
      { url: '/api/v1/assets/501/download?workspace_id=21', assetId: 501 },
    ])
    expect(saved.smart).toMatchObject({
      fullVideoUrl: '/api/v1/assets/501/download?workspace_id=21',
      fullVideoAssetId: 501,
      videoGenerating: false,
      vidGenTaskId: 0,
      lastCompletedVideoGenerationId: 'generation-target',
    })
    expect(saved.smart.videoVersions).toEqual([
      { url: '/api/v1/assets/10/download?workspace_id=21', assetId: 10 },
      { url: '/api/v1/assets/501/download?workspace_id=21', assetId: 501 },
    ])
    expect(saved.smart.videoGenerations).toEqual([
      expect.objectContaining({ id: 'generation-target', status: 'published', taskId: 0 }),
      expect.objectContaining({ id: 'generation-other', status: 'processing', taskId: 202 }),
    ])
  })

  it('旧结果已在历史中时只收尾旧 generation，不覆盖新任务和当前视频', async () => {
    const newerDraft = hotCopyDraft()
    newerDraft.generatedVideoUrl = '/new-current.mp4'
    newerDraft.generatedVideoAssetId = 900
    newerDraft.videoHistoryList = [
      { url: '/old.mp4', assetId: 10 },
      { url: '/late-old-result.mp4', assetId: 501 },
      { url: '/new-current.mp4', assetId: 900 },
    ]
    newerDraft.smart.fullVideoUrl = '/new-current.mp4'
    newerDraft.smart.fullVideoAssetId = 900
    newerDraft.smart.videoVersions = [
      { url: '/old.mp4', assetId: 10 },
      { url: '/late-old-result.mp4', assetId: 501 },
      { url: '/new-current.mp4', assetId: 900 },
    ]
    newerDraft.smart.vidGenTaskId = 202
    newerDraft.smart.lastCompletedVideoGenerationId = 'generation-other'
    mocks.getCreativeProject.mockResolvedValue({ draft_revision: 8, draft_json: newerDraft })

    const persisted = await persistHotCopyResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: '/late-old-result.mp4',
      assetId: 501,
      taskId: 101,
      generationId: 'generation-target',
    })

    expect(persisted).toBe(true)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(1)
    const saved = savedDraft()
    expect(saved).toMatchObject({
      generatedVideoUrl: '/api/v1/assets/900/download?workspace_id=21',
      generatedVideoAssetId: 900,
    })
    expect(saved.videoHistoryList.filter((item: any) => item.assetId === 501)).toHaveLength(1)
    expect(saved.smart).toMatchObject({
      fullVideoUrl: '/api/v1/assets/900/download?workspace_id=21',
      fullVideoAssetId: 900,
      videoGenerating: true,
      vidGenTaskId: 202,
      lastCompletedVideoGenerationId: 'generation-other',
    })
    expect(saved.smart.videoVersions.filter((item: any) => item.assetId === 501)).toHaveLength(1)
    expect(saved.smart.videoGenerations).toEqual([
      expect.objectContaining({ id: 'generation-target', status: 'published', taskId: 0 }),
      expect.objectContaining({ id: 'generation-other', status: 'processing', taskId: 202 }),
    ])
  })

  it('遇到 409 时重新读取最新 revision，并且只重试一次', async () => {
    mocks.getCreativeProject
      .mockResolvedValueOnce({ draft_revision: 4, draft_json: hotCopyDraft() })
      .mockResolvedValueOnce({
        data: {
          draft_revision: 5,
          draft_json: JSON.stringify(hotCopyDraft({ description: '冲突后的最新描述' })),
        },
      })
    mocks.updateCreativeProjectDraft
      .mockRejectedValueOnce(Object.assign(new Error('draft conflict'), { status: 409 }))
      .mockResolvedValueOnce({})

    const persisted = await persistHotCopyResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: '/result.mp4',
      assetId: 501,
      taskId: 101,
      generationId: 'generation-target',
    })

    expect(persisted).toBe(true)
    expect(mocks.getCreativeProject).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft.mock.calls[0][0].draftRevision).toBe(4)
    expect(mocks.updateCreativeProjectDraft.mock.calls[1][0].draftRevision).toBe(5)
    expect(savedDraft(1).description).toBe('冲突后的最新描述')
  })

  it('旧 generation 完成时只追加历史并发布自身，不覆盖正在生成的新结果', async () => {
    const newerDraft = hotCopyDraft()
    newerDraft.generatedVideoUrl = '/new-current.mp4'
    newerDraft.generatedVideoAssetId = 900
    newerDraft.smart.fullVideoUrl = '/new-current.mp4'
    newerDraft.smart.fullVideoAssetId = 900
    newerDraft.smart.vidGenTaskId = 202
    newerDraft.smart.lastCompletedVideoGenerationId = 'generation-other'
    mocks.getCreativeProject.mockResolvedValue({ draft_revision: 8, draft_json: newerDraft })

    const persisted = await persistHotCopyResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: '/late-old-result.mp4',
      assetId: 501,
      taskId: 101,
      generationId: 'generation-target',
    })

    expect(persisted).toBe(true)
    const saved = savedDraft()
    expect(saved).toMatchObject({
      generatedVideoUrl: '/api/v1/assets/900/download?workspace_id=21',
      generatedVideoAssetId: 900,
    })
    expect(saved.videoHistoryList).toContainEqual({
      url: '/api/v1/assets/501/download?workspace_id=21',
      assetId: 501,
    })
    expect(saved.smart).toMatchObject({
      fullVideoUrl: '/api/v1/assets/900/download?workspace_id=21',
      fullVideoAssetId: 900,
      videoGenerating: true,
      vidGenTaskId: 202,
      lastCompletedVideoGenerationId: 'generation-other',
    })
    expect(saved.smart.videoGenerations).toEqual([
      expect.objectContaining({ id: 'generation-target', status: 'published', taskId: 0 }),
      expect.objectContaining({ id: 'generation-other', status: 'processing', taskId: 202 }),
    ])
  })

  it('任务和 generation 都不归属当前草稿时拒绝落库', async () => {
    const persisted = await persistHotCopyResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: '/foreign-result.mp4',
      assetId: 999,
      taskId: 999,
      generationId: 'generation-missing',
    })

    expect(persisted).toBe(false)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it.each([
    { projectId: 0, workspaceId: 21, url: '/result.mp4', assetId: 501 },
    { projectId: 88, workspaceId: 0, url: '/result.mp4', assetId: 501 },
    { projectId: 88, workspaceId: 21, url: '', assetId: 0 },
  ])('无效输入直接返回 false：%o', async (args) => {
    await expect(persistHotCopyResultToBackend(args)).resolves.toBe(false)
    expect(mocks.getCreativeProject).not.toHaveBeenCalled()
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('不是爆款复制草稿时不写入其他流程', async () => {
    mocks.getCreativeProject.mockResolvedValue({
      draft_revision: 4,
      draft_json: { flow: 'smart', smart: { vidGenTaskId: 101 } },
    })

    const persisted = await persistHotCopyResultToBackend({
      projectId: 88,
      workspaceId: 21,
      url: '/result.mp4',
      assetId: 501,
      taskId: 101,
    })

    expect(persisted).toBe(false)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })
})

describe('persistHotCopyTerminalStateToBackend', () => {
  it('失败终态只清理匹配任务并保留未完成的其他 generation', async () => {
    const persisted = await persistHotCopyTerminalStateToBackend({
      projectId: 88,
      workspaceId: 21,
      taskId: 101,
      generationId: 'generation-target',
      status: 'failed',
      error: '生成服务超时',
    })

    expect(persisted).toBe(true)
    const saved = savedDraft()
    expect(saved.smart).toMatchObject({ videoGenerating: false, vidGenTaskId: 0 })
    expect(saved.smart.videoGenerations).toEqual([
      expect.objectContaining({
        id: 'generation-target',
        status: 'failed',
        taskId: 0,
        error: '生成服务超时',
      }),
      expect.objectContaining({ id: 'generation-other', status: 'processing', taskId: 202 }),
    ])
  })

  it('旧草稿只有 vidGenTaskId 时也能清除失败任务的恢复凭证', async () => {
    const legacy = hotCopyDraft()
    legacy.smart.vidGenTaskId = 303
    legacy.smart.videoGenerating = true
    delete legacy.smart.videoGenerations
    mocks.getCreativeProject.mockResolvedValue({ draft_revision: 11, draft_json: legacy })

    const persisted = await persistHotCopyTerminalStateToBackend({
      projectId: 88,
      workspaceId: 21,
      taskId: 303,
      generationId: 'legacy-generation-not-persisted',
      status: 'failed',
      error: '后端任务已失败',
    })

    expect(persisted).toBe(true)
    expect(savedDraft().smart).toMatchObject({
      videoGenerating: false,
      vidGenTaskId: 0,
    })
  })

  it('旧 generation 被取消时不清理较新的当前任务', async () => {
    const current = hotCopyDraft()
    current.smart.vidGenTaskId = 202
    mocks.getCreativeProject.mockResolvedValue({ draft_revision: 9, draft_json: current })

    const persisted = await persistHotCopyTerminalStateToBackend({
      projectId: 88,
      workspaceId: 21,
      taskId: 101,
      generationId: 'generation-target',
      status: 'cancelled',
    })

    expect(persisted).toBe(true)
    const saved = savedDraft()
    expect(saved.smart).toMatchObject({ videoGenerating: true, vidGenTaskId: 202 })
    expect(saved.smart.videoGenerations).toEqual([
      expect.objectContaining({ id: 'generation-target', status: 'cancelled', taskId: 0 }),
      expect.objectContaining({ id: 'generation-other', status: 'processing', taskId: 202 }),
    ])
  })

  it.each([
    ['已发布 generation', 'published', ''],
    ['已有成功结果标记', 'processing', 'generation-target'],
  ])('拒绝晚到的失败回调覆盖%s', async (_case, generationStatus, lastCompletedGenerationId) => {
    const successful = hotCopyDraft()
    successful.smart.vidGenTaskId = 0
    successful.smart.lastCompletedVideoGenerationId = lastCompletedGenerationId
    successful.smart.videoGenerations[0] = {
      ...successful.smart.videoGenerations[0],
      status: generationStatus,
      taskId: 0,
    }
    mocks.getCreativeProject.mockResolvedValue({ draft_revision: 9, draft_json: successful })

    const persisted = await persistHotCopyTerminalStateToBackend({
      projectId: 88,
      workspaceId: 21,
      taskId: 101,
      generationId: 'generation-target',
      status: 'failed',
      error: '晚到的轮询错误',
    })

    expect(persisted).toBe(false)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })

  it('终态回调不属于当前草稿时拒绝修改', async () => {
    const persisted = await persistHotCopyTerminalStateToBackend({
      projectId: 88,
      workspaceId: 21,
      taskId: 999,
      generationId: 'generation-missing',
      status: 'failed',
      error: '不应写入',
    })

    expect(persisted).toBe(false)
    expect(mocks.updateCreativeProjectDraft).not.toHaveBeenCalled()
  })
})
