import { describe, expect, it } from 'vitest'
import {
  buildCanvasInputAssets,
  buildPolishImageRefs,
  inferCanvasConnectionRole,
  normalizeCanvasAssetSource,
  validateCanvasImageInputs,
  validateCanvasVideoInputs,
} from '@/utils/canvasGeneration'

describe('canvas image generation source validation', () => {
  it('normalizes real-person source aliases without classifying ordinary uploads', () => {
    expect(normalizeCanvasAssetSource('real-person')).toBe('real_person')
    expect(normalizeCanvasAssetSource('upload')).toBe('upload')
    expect(normalizeCanvasAssetSource('face-image')).toBe('unknown')
  })

  it('requires uploaded image assets and rejects cross-workspace references', () => {
    expect(
      validateCanvasImageInputs({
        operationCode: 'image.image_to_image',
        sourceRefs: [{ kind: 'image', assetId: 12, workspaceId: 21 }],
        workspaceId: 21,
      }),
    ).toBeNull()
    expect(
      validateCanvasImageInputs({ operationCode: 'image.image_to_image', sourceRefs: [{ kind: 'image' }] }),
    ).toContain('尚未上传')
    expect(
      validateCanvasImageInputs({
        operationCode: 'image.image_to_image',
        sourceRefs: [{ kind: 'image', assetId: 12, workspaceId: 9 }],
        workspaceId: 21,
      }),
    ).toContain('工作空间')
  })

  it('does not allow video refs to leak into image-to-image input', () => {
    expect(
      validateCanvasImageInputs({
        operationCode: 'image.image_to_image',
        sourceRefs: [{ kind: 'video', assetId: 12 }],
      }),
    ).toContain('仅支持图片')
  })

  it('按当前模型能力阻止超量图片，而不是静默截断', () => {
    expect(
      validateCanvasImageInputs({
        operationCode: 'image.image_to_image',
        sourceRefs: [1, 2, 3].map((assetId) => ({ kind: 'image', assetId })),
        maxImageRefs: 2,
      }),
    ).toContain('最多支持 2 张')
  })
})

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

  it('sends a connected video source under its own role, not as a reference image', () => {
    // 视频套上 image 角色，后端会当参考图去读，生成结果完全不是「在这条视频上改」
    expect(
      buildCanvasInputAssets(
        [
          { kind: 'image', assetId: 8 },
          { kind: 'video', assetId: 21 },
        ],
        'video.generate',
      ),
    ).toEqual([
      { asset_id: 8, role: 'image' },
      { asset_id: 21, role: 'video' },
    ])
  })

  it('appends the node own video last, so connected material stays the reference', () => {
    expect(buildCanvasInputAssets([{ kind: 'image', assetId: 8 }], 'video.generate', 99)).toEqual([
      { asset_id: 8, role: 'image' },
      { asset_id: 99, role: 'video' },
    ])
  })

  it('uses the role declared by the model schema for images, keeping the video role intact', () => {
    // 智能成片一直按模型 schema 下发角色，画布过去写死 image；
    // 模型声明了非 image 角色时，同一个模型就会出现「智能成片能跑、画布被后端拒」。
    expect(
      buildCanvasInputAssets(
        [
          { kind: 'image', assetId: 8 },
          { kind: 'video', assetId: 21 },
        ],
        'video.generate',
        0,
        'first_frame',
      ),
    ).toEqual([
      { asset_id: 8, role: 'first_frame' },
      { asset_id: 21, role: 'video' },
    ])
  })

  it('falls back to the historical roles when the model declares none', () => {
    expect(buildCanvasInputAssets([{ kind: 'image', assetId: 8 }], 'video.generate', 0, '')).toEqual([
      { asset_id: 8, role: 'image' },
    ])
    expect(buildCanvasInputAssets([{ kind: 'image', assetId: 8 }], 'image.image_to_image', 0, '   ')).toEqual([
      { asset_id: 8, role: 'reference_image' },
    ])
  })

  it('never lists the same asset twice when it is both connected and the node own video', () => {
    expect(buildCanvasInputAssets([{ kind: 'video', assetId: 99 }], 'video.generate', 99)).toEqual([
      { asset_id: 99, role: 'video' },
    ])
  })

  it('omits the source video when generating from scratch', () => {
    expect(buildCanvasInputAssets([{ kind: 'image', assetId: 8 }], 'video.generate', 0)).toEqual([
      { asset_id: 8, role: 'image' },
    ])
    expect(buildCanvasInputAssets([], 'video.generate')).toEqual([])
  })

  it('accepts a connected video as the source clip for video-to-video', () => {
    // 用户把生成好的视频连到新视频节点上：这是视频生视频，不该再被「只支持图片」拦下
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.generate',
        videoMode: 'auto',
        sourceRefs: [{ kind: 'video', assetId: 21 }],
      }),
    ).toBeNull()
  })

  it('treats a timeline clip as a video source too', () => {
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.generate',
        videoMode: 'auto',
        sourceRefs: [{ kind: 'timeline', assetId: 31 }],
      }),
    ).toBeNull()
  })

  it('lets images ride along with the source video without the first/last-frame slot rules', () => {
    // 带源视频时画面时序由源视频决定，图片只是风格/主体参考，不该要求放在首帧槽位
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.generate',
        videoMode: 'first-last',
        sourceRefs: [
          { kind: 'video', assetId: 21 },
          { kind: 'image', assetId: 8, slotIndex: 3 },
        ],
      }),
    ).toBeNull()
  })

  it('rejects two source videos, since there is no way to tell which one to rebuild', () => {
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.generate',
        videoMode: 'auto',
        sourceRefs: [
          { kind: 'video', assetId: 21 },
          { kind: 'video', assetId: 22 },
        ],
      }),
    ).toMatch(/只能连接一条源视频/)
  })

  it('still blocks material that has not finished uploading', () => {
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.generate',
        videoMode: 'auto',
        sourceRefs: [{ kind: 'image', assetId: 0 }],
      }),
    ).toMatch(/尚未上传完成/)
  })

  // 视频生视频实际提交的是 video.edit（后端的 video.generate 不接受视频素材）。
  // 这些校验必须跟着一起生效，否则那条链路等于完全没有前置检查。
  it('applies the same input checks to video.edit', () => {
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.edit',
        sourceRefs: [{ kind: 'video', assetId: 0 }],
      }),
    ).toMatch(/尚未上传完成/)

    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.edit',
        sourceRefs: [
          { kind: 'video', assetId: 21 },
          { kind: 'video', assetId: 22 },
        ],
      }),
    ).toMatch(/只能连接一条源视频/)

    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.edit',
        sourceRefs: [{ kind: 'text', assetId: 0 }],
      }),
    ).toBeNull()
  })

  it('lets images ride along under video.edit without the first/last-frame slot rules', () => {
    // 改片时节点自身的视频不在 sourceRefs 里，只有附带的参考图；不能套用首帧槽位规则
    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.edit',
        videoMode: 'first-last',
        sourceRefs: [{ kind: 'image', assetId: 8, slotIndex: 3 }],
      }),
    ).toBeNull()

    expect(
      validateCanvasVideoInputs({
        operationCode: 'video.edit',
        sourceRefs: Array.from({ length: 6 }, (_, index) => ({ kind: 'image', assetId: 100 + index })),
      }),
    ).toMatch(/最多再附带 5 张参考图片/)
  })

  it('still uses reference_image for image-to-image, and only for images', () => {
    expect(
      buildCanvasInputAssets(
        [
          { kind: 'image', assetId: 8 },
          { kind: 'video', assetId: 21 },
        ],
        'image.image_to_image',
      ),
    ).toEqual([
      { asset_id: 8, role: 'reference_image' },
      { asset_id: 21, role: 'video' },
    ])
  })
})
