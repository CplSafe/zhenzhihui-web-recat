import { describe, expect, it } from 'vitest'
import {
  buildCanvasInputAssets,
  buildPolishImageRefs,
  inferCanvasConnectionRole,
  validateCanvasVideoInputs,
} from '@/utils/canvasGeneration'

describe('canvas polish reference images', () => {
  it('returns nothing when no image source is connected', () => {
    expect(buildPolishImageRefs(undefined)).toEqual({})
    expect(buildPolishImageRefs([])).toEqual({})
    // 文本内容已拼进 prompt，视频来源不能作为读图输入。
    expect(
      buildPolishImageRefs([
        { kind: 'text', assetId: 7 },
        { kind: 'video', assetId: 8, thumbnailUrl: 'https://cdn.example.com/a.mp4' },
      ]),
    ).toEqual({})
  })

  it('collects image sources and keeps url/assetId aligned by index', () => {
    expect(
      buildPolishImageRefs([
        { kind: 'image', assetId: 11, thumbnailUrl: 'https://cdn.example.com/first.png' },
        { kind: 'text', assetId: 99 },
        { kind: 'image', thumbnailUrl: 'https://cdn.example.com/second.png' },
        { kind: 'image', assetId: 13 },
        // 既无 assetId 也无地址：无法读图，必须丢弃而不是留空占位。
        { kind: 'image' },
      ]),
    ).toEqual({
      images: ['https://cdn.example.com/first.png', 'https://cdn.example.com/second.png', ''],
      imageAssetIds: [11, 0, 13],
    })
  })
})

describe('canvas video generation inputs', () => {
  it('allows text-to-video without a reference image', () => {
    expect(
      validateCanvasVideoInputs({ operationCode: 'video.generate', videoMode: 'first-last', sourceRefs: [] }),
    ).toBeNull()
  })

  it('allows zero to five optional references in free generation mode', () => {
    const refs = Array.from({ length: 5 }, (_, index) => ({ kind: 'image', assetId: index + 1, slotIndex: index }))
    expect(
      validateCanvasVideoInputs({ operationCode: 'video.generate', videoMode: 'auto', sourceRefs: refs }),
    ).toBeNull()
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.generate',
        videoMode: 'auto',
        sourceRefs: [...refs, { kind: 'image', assetId: 6, slotIndex: 5 }],
      }),
    ).not.toBeNull()
  })

  it('assigns semantic roles without changing the backend input-assets contract', () => {
    expect(inferCanvasConnectionRole({ targetKind: 'video', sourceKind: 'text' })).toBe('prompt')
    expect(
      inferCanvasConnectionRole({ targetKind: 'video', sourceKind: 'image', videoMode: 'first-last', slotIndex: 0 }),
    ).toBe('first_frame')
    expect(
      inferCanvasConnectionRole({ targetKind: 'video', sourceKind: 'image', videoMode: 'first-last', slotIndex: 1 }),
    ).toBe('last_frame')
    expect(
      inferCanvasConnectionRole({ targetKind: 'video', sourceKind: 'image', videoMode: 'auto', slotIndex: 0 }),
    ).toBe('reference_image')
  })

  it('allows one first-frame image or a first-and-last pair', () => {
    const first = { kind: 'image', assetId: 11, slotIndex: 0 }
    expect(
      validateCanvasVideoInputs({ operationCode: 'video.generate', videoMode: 'first-last', sourceRefs: [first] }),
    ).toBeNull()
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.generate',
        videoMode: 'first-last',
        sourceRefs: [first, { kind: 'image', assetId: 12, slotIndex: 1 }],
      }),
    ).toBeNull()
  })

  it('keeps estimate and task input-assets payloads deterministic', () => {
    expect(
      buildCanvasInputAssets(
        [
          { kind: 'text', assetId: 1 },
          { kind: 'image', assetId: 8 },
          { kind: 'image', assetId: 9 },
        ],
        'video.generate',
      ),
    ).toEqual([
      { asset_id: 8, role: 'image' },
      { asset_id: 9, role: 'image' },
    ])
  })
})
