import { describe, expect, it } from 'vitest'
import { buildCanvasSubjectEditRequest, getCanvasSubjectEditModels } from '@/utils/canvasSubjectEdit'

const videoModel = {
  id: 42,
  operation_codes: ['video.edit'],
  params_schema: {
    fields: [
      { name: 'duration', type: 'integer', min: 3, max: 15 },
      { name: 'source_video_duration', type: 'number', max: 15 },
      { name: 'ratio', type: 'string', options: ['16:9', '9:16'] },
    ],
  },
}

const imageModel = {
  id: 43,
  provider: 'openai',
  operation_codes: ['image.image_to_image'],
  input_constraints: { 'image.image_to_image': { roles: [{ role: 'image', min_count: 1, max_count: 1 }] } },
  params_schema: { fields: [{ name: 'count', type: 'integer', default: 2, options: [1, 2] }] },
}

const video = {
  kind: 'video',
  mode: 'remove',
  model: videoModel,
  sourceAssetId: 101,
  sourceVideoDurationSec: 12,
  ratio: '16:9',
  target: '森林路上移动的黑色汽车',
} as const

const image = {
  kind: 'image',
  mode: 'remove',
  model: imageModel,
  sourceAssetId: 102,
  maskAssetId: 103,
} as const

describe('画布主体编辑请求', () => {
  it('选择明确声明编辑能力的工作空间模型', () => {
    const models = [
      videoModel,
      imageModel,
      { ...imageModel, id: 44, provider: 'other' },
      { ...videoModel, enabled: false },
    ]
    expect(getCanvasSubjectEditModels('video', models)).toEqual([videoModel])
    expect(getCanvasSubjectEditModels('image', models)).toEqual([imageModel])
  })

  it('对完整 12 秒视频出价，携带原视频、真实时长和背景连续性约束', () => {
    const request = buildCanvasSubjectEditRequest(video)
    expect(request).toMatchObject({
      kind: 'video',
      subjectEdit: true,
      operationCode: 'video.edit',
      modelVersionId: 42,
      inputAssets: [{ asset_id: 101, role: 'video' }],
      params: { duration: 12, source_video_duration: 12, ratio: '16:9' },
    })
    expect(request.prompt).toContain('消除原视频中的「森林路上移动的黑色汽车」')
    expect(request.prompt).toContain('补出的背景跨帧连续')
  })

  it('视频超过输入上限或不满足输出时长时拒绝提交', () => {
    const sourceLimited = {
      ...videoModel,
      params_schema: { fields: [{ name: 'source_video_duration', max: 10 }] },
    }
    expect(() => buildCanvasSubjectEditRequest({ ...video, model: sourceLimited })).toThrow('完整时长')
    const outputLimited = {
      ...videoModel,
      params_schema: { fields: [{ name: 'duration', options: [5, 10] }] },
    }
    expect(() => buildCanvasSubjectEditRequest({ ...video, model: outputLimited })).toThrow('不在可选时长')
  })

  it('对蒙版内区域编辑，使用模型声明的原图角色且只生成一张结果', () => {
    const request = buildCanvasSubjectEditRequest(image)
    expect(request).toMatchObject({
      kind: 'image',
      subjectEdit: true,
      operationCode: 'image.image_to_image',
      modelVersionId: 43,
      inputAssets: [
        { asset_id: 102, role: 'image' },
        { asset_id: 103, role: 'mask' },
      ],
      params: { count: 1, mask_asset_id: 103 },
    })
    expect(request.prompt).toContain('消除蒙版标出的主体')
    expect(request.prompt).toContain('蒙版外的画面原样保留')
    expect(() => buildCanvasSubjectEditRequest({ ...image, maskAssetId: 102 })).toThrow('涂抹')
  })

  it('主体修改和替换使用各自的说明，并阻止空说明', () => {
    expect(buildCanvasSubjectEditRequest({ ...video, mode: 'modify', description: '车身改为白色' }).prompt).toContain(
      '修改要求：车身改为白色',
    )
    expect(
      buildCanvasSubjectEditRequest({ ...image, mode: 'replace', description: '换成一只棕色纸箱' }).prompt,
    ).toContain('替换要求：换成一只棕色纸箱')
    expect(() => buildCanvasSubjectEditRequest({ ...video, mode: 'modify' })).toThrow('修改说明')
    expect(() => buildCanvasSubjectEditRequest({ ...image, mode: 'replace' })).toThrow('替换说明')
  })
})
