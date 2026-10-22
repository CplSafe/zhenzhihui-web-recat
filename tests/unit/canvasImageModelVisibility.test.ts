import { describe, expect, it } from 'vitest'
import { isCanvasToolOnlyImageModel } from '@/utils/canvasImageModelVisibility'
import type { GenerationModelOption } from '@/utils/generationModelCatalog'

const model = (name: string, source = {}): GenerationModelOption => ({
  modelVersionId: 42,
  displayName: name,
  operationCodes: ['image.image_to_image'],
  source,
})

describe('普通画布图片模型可见性', () => {
  it.each(['Qwen edit 2.0', 'Qwen Image Edit 2.0', 'qwen-image-edit-2.0-2026-03-03'])(
    '仅识别编辑模型 2.0：%s',
    (name) => expect(isCanvasToolOnlyImageModel(model(name))).toBe(true),
  )

  it('通过后台代码识别重命名模型，不修改工具和历史目录', () => {
    const original = model('后台自定义名称', { model_code: 'qwen-edit-2.0' })
    expect(isCanvasToolOnlyImageModel(original)).toBe(true)
    expect(original.displayName).toBe('后台自定义名称')
    expect(original.operationCodes).toEqual(['image.image_to_image'])
  })

  it.each(['Qwen Image 2.0', 'Qwen Edit 2.1', 'Qwen3-VL', 'Qwen Image Edit Plus', '其他图片模型'])(
    '保留其他模型：%s',
    (name) => expect(isCanvasToolOnlyImageModel(model(name))).toBe(false),
  )
})
