import { describe, expect, it } from 'vitest'
import {
  buildCanvasSubjectEditRequest,
  getCanvasSubjectEditModels,
  supportsCanvasSubjectTargetReference,
} from '@/utils/canvasSubjectEdit'

const operation = 'image.image_to_image'
const imageModels = [
  [2, 'openai', 'gpt-image-2', 'mask'],
  [30, 'openai', 'gpt-image-2.5-sunburst', 'mask'],
  [31, 'openai', 'gpt-image-2.5-flare', 'mask'],
  [57, 'openai', 'gpt-image-2.6-sunburst', 'mask'],
  [58, 'openai', 'gpt-image-2.6-flare', 'mask'],
  [17, 'google', 'gemini-2.5-flash-image', 'description'],
  [27, 'google', 'gemini-nano-banana-2.1', 'description'],
  [28, 'google', 'gemini-3.1-flash-image', 'description'],
  [29, 'google', 'gemini-3-pro-image', 'description'],
  [48, 'bailian', 'qwen-image-2.0-2026-03-03', 'description'],
  [32, 'volcengine', 'doubao-seedream-5-0-flash', 'bbox'],
  [33, 'volcengine', 'doubao-seedream-5-0-pro', 'bbox'],
] as const

describe('团队图片模型的主体编辑', () => {
  it('隐藏初版 GPT Image 2、Nano Banana 和 Qwen 2.0，保留相邻版本', () => {
    const models = imageModels.map(([id, provider, version]) => ({
      id,
      provider,
      version,
      operation_codes: [operation],
    }))
    expect(
      getCanvasSubjectEditModels('image', [
        ...models,
        { id: 103, provider: 'bailian', version: 'qwen-image-2.0', operation_codes: [operation] },
      ]).map(({ id }) => id),
    ).toEqual([30, 31, 57, 58, 27, 28, 29, 32, 33])
  })

  it.each([
    ['remove', [30, 31, 57, 58, 27, 28, 29, 32, 33]],
    ['modify', [30, 57, 58, 27, 28, 29, 32, 33]],
    ['replace', [30, 31, 57, 58, 27, 28, 29, 32, 33]],
  ] as const)('按 %s 模式筛选 GPT Image 2.5 Flare', (mode, expected) => {
    const models = imageModels.map(([id, provider, version]) => ({
      id,
      provider,
      version,
      operation_codes: [operation],
    }))
    expect(getCanvasSubjectEditModels('image', models, mode).map(({ id }) => id)).toEqual(expected)
  })

  it.each(imageModels)('#%i %s %s 支持无目标图及可选目标图', (id, provider, version, strategy) => {
    const model = {
      id,
      provider,
      version,
      operation_codes: [operation],
      input_constraints: {
        [operation]: { roles: [{ role: 'reference_image', min_count: 1, max_count: 3 }] },
      },
    }
    const args = {
      kind: 'image',
      mode: 'modify',
      sourceAssetId: 100,
      model,
      maskAssetId: strategy === 'mask' ? 101 : undefined,
      imageSelection: { x: 0.2, y: 0.1, width: 0.3, height: 0.4 },
      target: '红色雨伞',
      description: '改成深蓝色',
    } as const
    const original = { asset_id: 100, role: 'reference_image' }
    const mask = strategy === 'mask' ? [{ asset_id: 101, role: 'mask' }] : []
    expect(supportsCanvasSubjectTargetReference('image', model)).toBe(true)
    const modification = buildCanvasSubjectEditRequest(args)
    expect(modification).toMatchObject({
      operationCode: operation,
      modelVersionId: id,
      inputAssets: [original, ...mask],
    })
    expect(modification.params.mask_asset_id).toBe(args.maskAssetId)
    expect(modification.prompt).toContain('改成深蓝色')
    if (strategy === 'description') expect(modification.prompt).toContain('从画面左边起 20%')
    if (strategy === 'bbox') expect(modification.prompt).toContain('<bbox>200 100 500 500</bbox>')
    if (strategy !== 'mask') expect(modification.prompt).toContain('红色雨伞')
    const replacement = buildCanvasSubjectEditRequest({
      ...args,
      mode: 'replace',
      description: undefined,
      targetReferenceAssetId: 102,
    })
    expect(replacement.inputAssets).toEqual([original, { asset_id: 102, role: 'reference_image' }, ...mask])
    expect(replacement.prompt).toContain('只编辑第1张原图')
    expect(() => buildCanvasSubjectEditRequest({ ...args, mode: 'remove', targetReferenceAssetId: 102 })).toThrow(
      '主体消除无需添加目标参考图',
    )
  })

  it('只有一个图片素材槽的编辑模型继续支持主体修改', () => {
    const model = {
      id: 2,
      provider: 'openai',
      operation_codes: [operation],
      input_constraints: { [operation]: { roles: [{ role: 'image', min_count: 1, max_count: 1 }] } },
    }
    const args = {
      kind: 'image',
      mode: 'modify',
      sourceAssetId: 100,
      maskAssetId: 101,
      model,
      description: '改成深蓝色',
    } as const
    expect(supportsCanvasSubjectTargetReference('image', model)).toBe(false)
    expect(buildCanvasSubjectEditRequest(args).inputAssets).toHaveLength(2)
    expect(() => buildCanvasSubjectEditRequest({ ...args, targetReferenceAssetId: 102 })).toThrow(
      '不支持附带目标参考图',
    )
  })
})
