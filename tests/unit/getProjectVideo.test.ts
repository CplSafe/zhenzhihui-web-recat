import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCreativeProject: vi.fn(),
  updateCreativeProjectDraft: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  getCreativeProject: mocks.getCreativeProject,
  updateCreativeProjectDraft: mocks.updateCreativeProjectDraft,
}))

import { getProjectVideo } from '@/api/projectVideos'

const project = {
  id: 88,
  title: '饮品广告',
  draft_json: {
    smart: {
      videoVersions: [
        { id: 'first', assetId: 501, label: '第一版' },
        { id: 'second', assetId: 502, label: '第二版' },
      ],
    },
  },
}

describe('getProjectVideo 精确匹配', () => {
  beforeEach(() => {
    mocks.getCreativeProject.mockReset()
    mocks.updateCreativeProjectDraft.mockReset()
    mocks.getCreativeProject.mockResolvedValue(project)
  })

  it('错误或过期 videoId 返回 null，不回退到第一条视频', async () => {
    const payload = await getProjectVideo({ projectId: 88, workspaceId: 21, videoId: 'missing-video' })

    expect(payload.video).toBeNull()
    expect(mocks.getCreativeProject).toHaveBeenCalledWith({ projectId: 88, workspaceId: 21 })
  })

  it('当前稳定 ID 精确匹配对应版本', async () => {
    const payload = await getProjectVideo({
      projectId: 88,
      workspaceId: 21,
      videoId: 'derived-second',
    })

    expect(payload.video).toMatchObject({
      id: 'derived-second',
      videoAssetId: 502,
      title: '饮品广告 · 第二版',
    })
  })

  it('旧 index 形式或伪造后缀不能作为详情路由别名', async () => {
    const payload = await getProjectVideo({
      projectId: 88,
      workspaceId: 21,
      videoId: 'derived-second-999',
    })

    expect(payload.video).toBeNull()
  })
})
