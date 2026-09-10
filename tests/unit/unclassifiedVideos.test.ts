import { describe, expect, it } from 'vitest'

import {
  collectClassifiedKeys,
  videoAssetKeyOf,
  videoKeyOf,
  videoSourceKeyCandidates,
} from '@/utils/unclassifiedVideos'

describe('unclassifiedVideos keys', () => {
  it('资产 key 与旧 URL key 格式互不冲突', () => {
    expect(videoKeyOf(303, 'https://cdn.example.com/v.mp4')).toBe('303::https://cdn.example.com/v.mp4')
    expect(videoAssetKeyOf(88)).toBe('asset::88')
  })

  it('能解析出 assetId 时 primary 用资产 key，同时保留旧 key 供历史归类记录匹配', () => {
    const keys = videoSourceKeyCandidates({ projectId: 303, assetId: 88, videoUrl: '/v.mp4' })
    expect(keys.primary).toBe('asset::88')
    expect(keys.candidates).toContain('asset::88')
    // 兼容:此前写进项目草稿的归类记录是旧格式,漏掉它会让已归类视频重新出现在待分类
    expect(keys.candidates).toContain('303::/v.mp4')
  })

  it('没有 assetId 时回退为旧 URL key', () => {
    const keys = videoSourceKeyCandidates({ projectId: 303, assetId: 0, videoUrl: '/v.mp4' })
    expect(keys.primary).toBe('303::/v.mp4')
    expect(keys.candidates).toEqual(['303::/v.mp4'])
  })

  it('散资产历史 key（videoKeyOf(assetId, "")）仍在候选里', () => {
    const keys = videoSourceKeyCandidates({ projectId: 88, assetId: 88, videoUrl: '' })
    expect(keys.primary).toBe('asset::88')
    expect(keys.candidates).toContain(videoKeyOf(88, ''))
  })
})

describe('collectClassifiedKeys', () => {
  it('汇总各项目草稿视频清单里的 sourceKey，忽略空值', () => {
    const projects = [
      {
        id: 1,
        draft_json: {
          projectVideoStore: {
            records: [{ sourceKey: 'asset::88' }, { sourceKey: '  ' }, { sourceKey: '303::/v.mp4' }],
          },
        },
      },
      { id: 2, draft_json: {} },
    ]
    const keys = collectClassifiedKeys(projects)
    expect(keys.has('asset::88')).toBe(true)
    expect(keys.has('303::/v.mp4')).toBe(true)
    expect(keys.size).toBe(2)
  })
})
