import { describe, expect, it } from 'vitest'

import { sanitizeHotCopyPersistentDraft } from '@/utils/hotCopyPersistentDraft'

describe('sanitizeHotCopyPersistentDraft', () => {
  it('canonicalizes progress snapshots before backend persistence', () => {
    const signed = 'https://provider.example/media.mp4?X-Amz-Signature=temporary'
    const draft = sanitizeHotCopyPersistentDraft(
      {
        flow: 'hot-copy',
        generatedVideoUrl: signed,
        generatedVideoAssetId: 301,
        videoHistoryList: [
          { url: signed, assetId: 301 },
          { url: signed, assetId: 0 },
        ],
        smart: {
          flow: 'hot-copy',
          sourceVideo: { url: 'blob:local-preview', assetId: 101 },
          fullVideoUrl: signed,
          fullVideoAssetId: 301,
          videoVersions: [{ url: signed, assetId: 301 }],
          genDurationSec: 7,
          entryInitial: {
            videoSource: 'library',
            videoPreview: 'blob:local-preview',
            libraryVideo: { assetId: 101, src: 'blob:local-preview' },
            products: [{ assetId: 201, url: 'data:image/png;base64,temporary' }],
            duration: '7s',
          },
        },
      },
      21,
    )

    expect(JSON.stringify(draft)).not.toContain('temporary')
    expect(JSON.stringify(draft)).not.toContain('blob:')
    expect(JSON.stringify(draft)).not.toContain('data:image')
    expect(draft).toMatchObject({
      generatedVideoUrl: '/api/v1/assets/301/download?workspace_id=21',
      videoHistoryList: [{ url: '/api/v1/assets/301/download?workspace_id=21', assetId: 301 }],
      smart: {
        sourceVideo: { url: '/api/v1/assets/101/download?workspace_id=21', assetId: 101 },
        fullVideoUrl: '/api/v1/assets/301/download?workspace_id=21',
        videoVersions: [{ url: '/api/v1/assets/301/download?workspace_id=21', assetId: 301 }],
        genDurationSec: 7,
        entryInitial: {
          videoPreview: '/api/v1/assets/101/download?workspace_id=21',
          libraryVideo: {
            assetId: 101,
            src: '/api/v1/assets/101/download?workspace_id=21',
          },
          products: [{ assetId: 201, url: '/api/v1/assets/201/download?workspace_id=21', file: null }],
          duration: '7s',
        },
      },
    })
  })

  it('sanitizes media adopted from a latest-draft merge immediately before PUT', () => {
    const merged = {
      flow: 'hot-copy',
      videoHistoryList: [
        {
          assetId: 401,
          url: 'https://provider.example/concurrent.mp4?security-token=secret&signature=temporary',
        },
      ],
      smart: {
        flow: 'hot-copy',
        fullVideoAssetId: 401,
        fullVideoUrl: 'https://provider.example/concurrent.mp4?security-token=secret&signature=temporary',
        videoVersions: [
          {
            assetId: 401,
            url: 'https://provider.example/concurrent.mp4?security-token=secret&signature=temporary',
          },
        ],
      },
    }

    const persistent = sanitizeHotCopyPersistentDraft(merged, 21)

    expect(JSON.stringify(persistent)).not.toContain('secret')
    expect(JSON.stringify(persistent)).not.toContain('temporary')
    expect(persistent.smart.fullVideoUrl).toBe('/api/v1/assets/401/download?workspace_id=21')
    expect(persistent.videoHistoryList).toEqual([{ assetId: 401, url: '/api/v1/assets/401/download?workspace_id=21' }])
  })
})
