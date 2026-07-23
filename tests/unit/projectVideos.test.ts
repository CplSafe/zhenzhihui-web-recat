import { describe, expect, it } from 'vitest'
import { countProjectVideos, deriveProjectVideos, formatVideoDuration, stableDerivedVideoId } from '@/api/projectVideos'
import { computeVideoContentSig } from '@/utils/smartDraft'

function projectWithVersions(): any {
  return {
    id: 21,
    title: '未命名创意',
    created_at: '2026-07-15T08:00:00.000Z',
    updated_at: '2026-07-15T09:00:00.000Z',
    draft_json: {
      flow: 'smart',
      smart: {
        projectName: '夏日饮品短片',
        genRatio: '16:9',
        videoVersions: [
          {
            id: 'old-version',
            assetId: 101,
            label: '第一版',
            durationSeconds: 5,
            updatedAt: '2026-07-15T09:00:00.000Z',
          },
          {
            id: 'new-version',
            assetId: 102,
            label: '第二版',
            durationSeconds: 8,
            updatedAt: '2026-07-15T10:00:00.000Z',
          },
        ],
      },
    },
  }
}

describe('projectVideos 派生视频', () => {
  it('持久化后的 derived id 不会在每次恢复时重复添加前缀', () => {
    expect(stableDerivedVideoId({ id: 'derived-version-1' }, 0, '', '')).toBe('derived-version-1')
  })

  it('保留全部版本并按更新时间倒序排列', () => {
    const project = projectWithVersions()
    const videos = deriveProjectVideos({ project, workspaceId: 7 })

    expect(videos).toHaveLength(2)
    expect(videos.map((video) => video.id)).toEqual(['derived-new-version', 'derived-old-version'])
    expect(videos[0]).toMatchObject({
      title: '夏日饮品短片 · 第二版',
      ratio: '16:9',
      durationSeconds: 8,
      status: 'published',
      videoAssetId: 102,
      videoUrl: '/api/v1/assets/102/download?workspace_id=7',
    })
    expect(countProjectVideos({ project, workspaceId: 7 })).toBe(2)
  })

  it('历史版本重排后仍为每个视频生成相同的稳定 ID', () => {
    const project = projectWithVersions()
    const before = deriveProjectVideos({ project, workspaceId: 7 })
    project.draft_json.smart.videoVersions.reverse()
    const after = deriveProjectVideos({ project, workspaceId: 7 })

    const idsByAsset = (videos: ReturnType<typeof deriveProjectVideos>) =>
      Object.fromEntries(videos.map((video) => [video.videoAssetId, video.id]))

    expect(idsByAsset(after)).toEqual(idsByAsset(before))
    expect(idsByAsset(after)).toEqual({
      101: 'derived-old-version',
      102: 'derived-new-version',
    })
  })

  it('项目清单中的隐藏覆盖只隐藏目标视频', () => {
    const project = projectWithVersions()
    project.draft_json.projectVideoStore = {
      records: [],
      overrides: {
        // 兼容曾经拼接数组下标的 derived-<rawId>-<index>。
        'derived-old-version-1': { hidden: true },
      },
    }

    const videos = deriveProjectVideos({ project, workspaceId: 7 })

    expect(videos.map((video) => video.id)).toEqual(['derived-new-version'])
  })

  it('不会把一个当前视频 ID 当成另一个视频的旧版下标 ID', () => {
    const project = projectWithVersions()
    project.draft_json.smart.videoVersions = [
      { id: 'x', assetId: 101, updatedAt: '2026-07-15T09:00:00.000Z' },
      { id: 'x-1', assetId: 102, updatedAt: '2026-07-15T10:00:00.000Z' },
    ]
    project.draft_json.projectVideoStore = {
      records: [],
      overrides: {
        'derived-x-1': { hidden: true },
      },
    }

    const videos = deriveProjectVideos({ project, workspaceId: 7 })

    expect(videos.map((video) => video.id)).toEqual(['derived-x'])
  })

  it('无稳定 ID 的历史版本重排后不会沿用不可靠的旧下标覆盖', () => {
    const project = projectWithVersions()
    project.draft_json.smart.videoVersions = [
      {
        url: 'https://cdn.example.com/a.mp4',
        updatedAt: '2026-07-15T09:00:00.000Z',
      },
      {
        url: 'https://cdn.example.com/b.mp4',
        updatedAt: '2026-07-15T10:00:00.000Z',
      },
    ]
    project.draft_json.projectVideoStore = {
      records: [],
      overrides: {
        'derived-1-1': { hidden: true },
      },
    }

    const before = deriveProjectVideos({ project, workspaceId: 7 })
    project.draft_json.smart.videoVersions.reverse()
    const after = deriveProjectVideos({ project, workspaceId: 7 })

    expect(before).toHaveLength(2)
    expect(after).toHaveLength(2)
    expect(new Set(after.map((video) => video.id))).toEqual(new Set(before.map((video) => video.id)))
  })

  it.each(['failed', 'error', 'rejected', 'cancelled', 'publish_failed', 'publishing_error'])(
    '将 %s 状态归一化为失败，不因存在视频地址误判为已发布',
    (status) => {
      const project = projectWithVersions()
      project.draft_json.smart.videoVersions = [{ id: 'failed-version', assetId: 103, label: '失败版本', status }]

      const [video] = deriveProjectVideos({ project, workspaceId: 7 })

      expect(video).toMatchObject({ id: 'derived-failed-version', status: 'failed' })
    },
  )

  it.each(['unpublished', 'draft'])('不会把 %s 状态误判为已发布', (status) => {
    const project = projectWithVersions()
    project.draft_json.smart.videoVersions = [{ id: 'unpublished-version', assetId: 103, label: '未发布版本', status }]

    const [video] = deriveProjectVideos({ project, workspaceId: 7 })

    expect(video).toMatchObject({ id: 'derived-unpublished-version', status: 'draft' })
  })

  it.each([undefined, '', 'success', 'succeeded', 'completed', 'done'])(
    '生成状态 %s 且已有成片时显示已发布',
    (status) => {
      const project = projectWithVersions()
      project.draft_json.smart.videoVersions = [{ id: 'generated-version', assetId: 103, status }]

      const [video] = deriveProjectVideos({ project, workspaceId: 7 })

      expect(video).toMatchObject({ id: 'derived-generated-version', status: 'published' })
    },
  )

  it.each(['processing', 'pending', 'running', 'queued', 'publishing'])(
    '%s 状态即使已有旧成片也保持生成中',
    (status) => {
      const project = projectWithVersions()
      project.draft_json.smart.videoVersions = [{ id: 'processing-version', assetId: 103, status }]

      const [video] = deriveProjectVideos({ project, workspaceId: 7 })

      expect(video).toMatchObject({ id: 'derived-processing-version', status: 'processing' })
    },
  )

  it.each(['success', 'unknown'])('%s 状态没有成片地址时仍是草稿', (status) => {
    const project = projectWithVersions()
    project.draft_json.smart.videoVersions = [
      { id: 'no-video-version', coverUrl: 'https://cdn.example.com/cover.jpg', status },
    ]

    const [video] = deriveProjectVideos({ project, workspaceId: 7 })

    expect(video).toMatchObject({ id: 'derived-no-video-version', status: 'draft', videoUrl: '' })
  })

  it('只有明确发布状态才显示已发布', () => {
    const project = projectWithVersions()
    project.draft_json.smart.videoVersions = [{ id: 'published-version', assetId: 103, status: 'published' }]

    const [video] = deriveProjectVideos({ project, workspaceId: 7 })

    expect(video).toMatchObject({ id: 'derived-published-version', status: 'published' })
  })

  it('只有顶层最终成片时也显示已发布', () => {
    const project = projectWithVersions()
    project.draft_json.smart.videoVersions = []
    project.draft_json.smart.fullVideoAssetId = 105

    const [video] = deriveProjectVideos({ project, workspaceId: 7 })

    expect(video).toMatchObject({ id: 'derived-generated-21', status: 'published', videoAssetId: 105 })
  })

  it('忽略旧切换模型草稿写入的签名字段，不把已发布视频误判为新草稿', () => {
    const project = projectWithVersions()
    const shots = [{ id: 'shot-1', imageAssetId: 1001, duration: '7s', line: '新品上市' }]
    const entryMeta = { ratio: '16:9', style: '写实' }
    const fixedSignature = computeVideoContentSig(shots, entryMeta, '夏日饮品')
    const legacySignature = JSON.stringify({
      ...JSON.parse(fixedSignature),
      videoModelVersionId: 7301,
      videoModel: 'happyhorse',
    })
    project.draft_json.smart = {
      shots,
      entryMeta,
      reqSummary: '夏日饮品',
      lastVideoSig: legacySignature,
      fullVideoAssetId: 105,
      videoVersions: [],
    }

    const videos = deriveProjectVideos({ project, workspaceId: 7 })

    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({ status: 'published', videoAssetId: 105 })
  })

  it.each([
    [0, '--:--'],
    [5, '00:05'],
    [65, '01:05'],
  ])('将 %s 秒格式化为 %s', (seconds, expected) => {
    expect(formatVideoDuration(seconds)).toBe(expected)
  })
})
