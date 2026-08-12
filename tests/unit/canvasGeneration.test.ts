import { describe, expect, it } from 'vitest'
import { buildCanvasInputAssets, inferCanvasConnectionRole, validateCanvasVideoInputs } from '@/utils/canvasGeneration'

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
