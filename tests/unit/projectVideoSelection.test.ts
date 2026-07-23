import { describe, expect, it } from 'vitest'
import { readRequestedProjectVideoSelection, resolveRestoredVideoSelection } from '@/utils/projectVideoSelection'

describe('project video selection', () => {
  it('reads the stable video id and asset id without requiring a signed URL', () => {
    expect(
      readRequestedProjectVideoSelection('?video_id=derived-v2&video_asset_id=202', {
        projectVideoSelection: { videoId: 'ignored-state-id', videoAssetId: 101 },
      }),
    ).toEqual({ videoId: 'derived-v2', assetId: 202, url: '' })
  })

  it('opens the exact asset selected in project management instead of the draft current video', () => {
    const result = resolveRestoredVideoSelection(
      { url: '/api/v1/assets/101/download?workspace_id=7', assetId: 101 },
      [
        { id: 'derived-v1', url: '/api/v1/assets/101/download?workspace_id=7', assetId: 101 },
        { id: 'derived-v2', url: '/api/v1/assets/202/download?workspace_id=7', assetId: 202 },
      ],
      { videoId: 'derived-v2', assetId: 202, url: '' },
    )

    expect(result.current).toEqual({ url: '/api/v1/assets/202/download?workspace_id=7', assetId: 202 })
  })

  it('uses the stable derived id for an assetless historical video', () => {
    const result = resolveRestoredVideoSelection(
      { url: 'https://media.example/latest.mp4', assetId: 0 },
      [
        { id: 'derived-fallback-old', url: 'https://media.example/old.mp4?expired=1', assetId: 0 },
        { id: 'derived-fallback-latest', url: 'https://media.example/latest.mp4', assetId: 0 },
      ],
      { videoId: 'derived-fallback-old', assetId: 0, url: '' },
    )

    expect(result.current).toEqual({ url: 'https://media.example/old.mp4?expired=1', assetId: 0 })
  })

  it('matches refreshed signed URLs by stable path when no asset id exists', () => {
    const result = resolveRestoredVideoSelection(
      { url: 'https://media.example/video.mp4?signature=old', assetId: 0 },
      [{ url: 'https://media.example/video.mp4?signature=fresh', assetId: 0 }],
      null,
    )

    expect(result.current.url).toBe('https://media.example/video.mp4?signature=fresh')
    expect(result.versions).toHaveLength(1)
  })
})
