import { describe, it, expect } from 'vitest'
import { imageGenerationInfo, imagePixelRatio, canvasImageDetails, imageFunctionLabel } from '@/utils/canvasImageInfo'
import { pickPersistedNodeData } from '@/utils/canvasElements'

describe('图片结果参数快照', () => {
  it('保留零和布尔值，排除自动比例、空值、对象与非展示参数', () => {
    const params = { ratio: 'auto', seed: 0, quality: false, style: '', steps: NaN, size: {}, input_url: 'secret' }
    const info = imageGenerationInfo({ params, prompt: '原始描述' }, '模型', '2026-10-22')
    expect(info.rows).toEqual([
      { label: '质量', value: '否' },
      { label: '随机种子', value: '0' },
    ])
    params.seed = 123
    expect(info.rows[1].value).toBe('0')
    expect(JSON.stringify(info)).not.toContain('secret')
    const resultHistory = [{ assetId: 1, kind: 'image', imageInfo: info }]
    const imageGeneration = { submissionKey: 'submitted-request', info }
    expect(pickPersistedNodeData({ resultHistory, imageGeneration })).toEqual({ resultHistory, imageGeneration })
  })
  it('区分生成规格与图片比例，并允许缺少参数', () => {
    expect(imageGenerationInfo({}, '', '').rows).toEqual([])
    expect(
      imageGenerationInfo({ ratio: '16:9', params: { resolution: '2K', guidance_scale: 7 } }, '', '').rows,
    ).toEqual([
      { label: '生成比例', value: '16:9' },
      { label: '生成规格', value: '2K' },
      { label: '提示词引导', value: '7' },
    ])
    expect(imagePixelRatio(1536, 1024)).toBe('3:2')
    expect(imagePixelRatio(0, 0)).toBe('')
  })
})

describe('当前图片获取方式', () => {
  it.each([
    ['upload', '本地添加'],
    ['materials', '素材库添加'],
    ['real_person', '真人素材库'],
    ['capture', '视频截帧'],
    ['panorama', '全景取景'],
    ['upscale', '模型生成'],
  ] as const)('持久化并识别 %s，复制不会改变获取方式', (kind, sourceLabel) => {
    const data = { assetId: 11, imageOrigin: { assetId: 11, kind } }
    const restored = JSON.parse(JSON.stringify(pickPersistedNodeData(data)))
    expect(canvasImageDetails({ ...restored }, 11).sourceLabel).toBe(sourceLabel)
    expect(canvasImageDetails({ ...restored }, 12).sourceLabel).toBe('来源未记录')
  })
  it('历史生成结果优先于残留的上传标记，但替换素材时以新获取方式为准', () => {
    const info = imageGenerationInfo({ prompt: '原提示词' }, '原模型', '')
    const data = { assetId: 11, assetSource: 'upload', resultHistory: [{ assetId: 11, imageInfo: info }] }
    expect(canvasImageDetails(data, 11)).toEqual({ sourceLabel: '模型生成', generated: true, info })
    expect(canvasImageDetails({ ...data, assetId: 12, imageOrigin: { assetId: 12, kind: 'materials' } }, 12)).toEqual({
      sourceLabel: '素材库添加',
      generated: false,
      info: undefined,
    })
    expect(canvasImageDetails({ ...data, imageOrigin: { assetId: 11, kind: 'materials' } }, 11).sourceLabel).toBe(
      '素材库添加',
    )
    expect(canvasImageDetails({ ...data, assetId: 12 }, 11).info?.modelName).toBe('原模型')
  })
  it('无历史的组图仍能识别生成来源，不用当前任务状态和模型猜测旧图', () => {
    expect(
      canvasImageDetails({ assetId: 11, imageResultAssetIds: [11, 12], assetSource: 'upload' }, 12).sourceLabel,
    ).toBe('模型生成')
    expect(canvasImageDetails({ assetId: 11, assetSource: 'generated' }, 11).sourceLabel).toBe('模型生成')
    expect(canvasImageDetails({ assetId: 11, assetSource: 'materials', resultHistory: {} }, 11).sourceLabel).toBe(
      '素材库添加',
    )
    expect(canvasImageDetails({ assetId: 11, taskStatus: 'succeeded', modelVersionId: 1 }, 11).sourceLabel).toBe(
      '来源未记录',
    )
    expect(imagePixelRatio(940, 938)).toBe('约 1:1')
    expect(imagePixelRatio(2100, 900)).toBe('21:9')
    expect(imagePixelRatio(1237, 811)).toBe('1237:811')
  })
})

it('区分图片生成、编辑、超分与工具；旧超分节点只使用可信谱系', () => {
  for (const [operationCode, label] of [
    ['image.text_to_image', '文生图'],
    ['image.image_to_image', '图生图'],
    ['image.generate', '图片生成'],
    ['image.edit', '图片编辑'],
    ['image.upscale', '图片超分'],
  ]) {
    const info = imageGenerationInfo({ operationCode, modelVersionId: 42 }, '所用模型', '')
    expect(imageFunctionLabel(info)).toBe(label)
    expect(info.modelVersionId).toBe(42)
  }
  const toolInfo = imageGenerationInfo({ operationCode: 'image.generate', params: { tool: 'image.relight' } }, '', '')
  expect(imageFunctionLabel(toolInfo)).toBe('图片打光')
  expect(imageFunctionLabel()).toBe('')
  const oldHd = { assetId: 20, hd: { taskId: 'submission-old', sourceAssetId: 10 } }
  expect(canvasImageDetails(oldHd, 20)).toMatchObject({
    sourceLabel: '模型生成',
    generated: true,
    info: { operationCode: 'image.upscale' },
  })
  expect(canvasImageDetails({ ...oldHd, assetSource: 'upload' }, 20).sourceLabel).toBe('本地添加')
  expect(canvasImageDetails(oldHd, 10).sourceLabel).toBe('来源未记录')
  expect(
    canvasImageDetails(
      { ...oldHd, imageOrigin: { assetId: 99, kind: 'upscale', info: { modelName: '旧模型', rows: [] } } },
      20,
    ),
  ).toMatchObject({ sourceLabel: '来源未记录', info: undefined })
})
