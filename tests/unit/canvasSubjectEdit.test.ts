import { describe, expect, it } from 'vitest'
import {
  buildCanvasSubjectEditRequest,
  getCanvasSubjectEditModels,
  getCanvasSubjectVideoReferenceLimit,
  supportsCanvasSubjectVideoReference,
} from '@/utils/canvasSubjectEdit'

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

  it('以原视频时刻和相对选区提供定位提示，保留原视频素材', () => {
    const videoSelection = { time: 5.25, bounds: { x: 0.2, y: 0.4, width: 0.6, height: 0.5 } }
    const request = buildCanvasSubjectEditRequest({ ...video, videoSelection })
    expect(request.prompt).toContain('选区参考：原视频第 5.25 秒')
    expect(request.prompt).toContain('选区从画面左边起 20%、从上边起 40%，宽 60%、高 50%')
    expect(request.inputAssets).toEqual([{ asset_id: 101, role: 'video' }])
    expect(() => buildCanvasSubjectEditRequest({ ...video, videoSelection: { ...videoSelection, time: 13 } })).toThrow(
      '超出原视频',
    )
    expect(() =>
      buildCanvasSubjectEditRequest({
        ...video,
        videoSelection: { ...videoSelection, bounds: { ...videoSelection.bounds, height: 0.7 } },
      }),
    ).toThrow('重新框选')
  })

  it('可直接用标记帧选区定位主体，未选择且未填写描述时拒绝提交', () => {
    const videoSelection = { time: 5, bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 } }
    expect(buildCanvasSubjectEditRequest({ ...video, target: ' ', videoSelection }).prompt).toContain(
      '标记帧选区内的主体',
    )
    expect(() => buildCanvasSubjectEditRequest({ ...video, target: '' })).toThrow('请选择或描述要处理的主体')
  })

  it('仅为明确支持静态图片和源视频同传的模型附带裁出的 PNG', () => {
    const videoAndImage = {
      ...videoModel,
      input_constraints: {
        'video.edit': {
          roles: [
            { role: 'video', max_count: 1 },
            { role: 'image', mime_types: ['image/png'] },
          ],
        },
      },
    }
    const videoSelection = { time: 0.25, bounds: { x: 0, y: 0, width: 0.6, height: 0.5 }, referenceAssetId: 104 }
    const request = buildCanvasSubjectEditRequest({ ...video, model: videoAndImage, videoSelection })
    expect(request.inputAssets).toEqual([
      { asset_id: 101, role: 'video' },
      { asset_id: 104, role: 'image' },
    ])
    expect(request.prompt).toContain('参考图片仅用于辨认选中的主体')
    expect(() => buildCanvasSubjectEditRequest({ ...video, videoSelection })).toThrow('不支持附带')
    expect(() =>
      buildCanvasSubjectEditRequest({
        ...video,
        model: videoAndImage,
        videoSelection: { ...videoSelection, referenceAssetId: 101 },
      }),
    ).toThrow('参考图无效')
    expect(
      supportsCanvasSubjectVideoReference({
        ...videoModel,
        input_constraints: { 'video.edit': { roles: [{ role: 'image', max_count: 0 }] } },
      }),
    ).toBe(false)
    expect(
      supportsCanvasSubjectVideoReference({
        ...videoModel,
        input_constraints: { 'video.edit': { roles: [{ role: 'image', mime_types: ['image/jpeg'] }] } },
      }),
    ).toBe(false)
    expect(
      supportsCanvasSubjectVideoReference({
        ...videoModel,
        input_constraints: {
          'video.edit': { roles: [{ role: 'image' }], mutually_exclusive_role_groups: [['video'], ['image']] },
        },
      }),
    ).toBe(false)
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

  it('两张视频替换参考图分别用于定位和指定新主体，按原图在前的顺序发送', () => {
    const model = {
      ...videoModel,
      input_constraints: { 'video.edit': { roles: [{ role: 'image', min_count: 2 }] } },
    }
    const videoSelection = { time: 6, bounds: { x: 0.3, y: 0.4, width: 0.3, height: 0.3 }, referenceAssetId: 104 }
    expect(getCanvasSubjectVideoReferenceLimit(model)).toBe(5)
    expect(supportsCanvasSubjectVideoReference(model)).toBe(false)
    const request = buildCanvasSubjectEditRequest({
      ...video,
      mode: 'replace',
      model,
      videoSelection,
      replacementAssetId: 105,
    })
    expect(request.inputAssets).toEqual([
      { asset_id: 101, role: 'video' },
      { asset_id: 104, role: 'image' },
      { asset_id: 105, role: 'image' },
    ])
    expect(request.prompt).toContain('第1张参考图是原视频中选中的旧主体，仅用于定位')
    expect(request.prompt).toContain('第2张参考图是要换入的新主体')
    expect(request.prompt).not.toContain('替换要求：')
    expect(() => buildCanvasSubjectEditRequest({ ...video, mode: 'replace', model, replacementAssetId: 105 })).toThrow(
      '至少需要 2 张',
    )
  })

  it('单参考图模型用唯一的图片指定新主体，并用选区文字定位旧主体', () => {
    const model = {
      ...videoModel,
      input_constraints: { 'video.edit': { roles: [{ role: 'image', max_count: 1 }] } },
    }
    const videoSelection = { time: 6, bounds: { x: 0.3, y: 0.4, width: 0.3, height: 0.3 } }
    const replacement = { ...video, mode: 'replace', model, videoSelection, replacementAssetId: 105 } as const
    expect(getCanvasSubjectVideoReferenceLimit(model)).toBe(1)
    const request = buildCanvasSubjectEditRequest(replacement)
    expect(request.inputAssets).toEqual([
      { asset_id: 101, role: 'video' },
      { asset_id: 105, role: 'image' },
    ])
    expect(request.prompt).toContain('选区参考：原视频第 6 秒')
    expect(request.prompt).toContain(video.target)
    expect(request.prompt).toContain('第1张参考图是要换入的新主体')
    expect(() =>
      buildCanvasSubjectEditRequest({
        ...replacement,
        videoSelection: { ...videoSelection, referenceAssetId: 104 },
      }),
    ).toThrow('最多支持 1 张')
    expect(() =>
      buildCanvasSubjectEditRequest({
        ...replacement,
        videoSelection: { ...videoSelection, referenceAssetId: 105 },
      }),
    ).toThrow('不能与原主体参考图相同')
    expect(() => buildCanvasSubjectEditRequest({ ...replacement, replacementAssetId: video.sourceAssetId })).toThrow(
      '替换参考图无效',
    )
    expect(() => buildCanvasSubjectEditRequest({ ...replacement, model: videoModel })).toThrow('不支持附带')
    expect(() => buildCanvasSubjectEditRequest({ ...replacement, mode: 'remove' })).toThrow('仅用于视频主体替换')
  })
})
