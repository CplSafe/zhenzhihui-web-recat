import { describe, expect, it } from 'vitest'
import {
  buildCanvasSubjectEditRequest,
  buildCanvasSubjectVideoEstimateRequest,
  getCanvasSubjectEditModels,
  getCanvasSubjectVideoReferenceLimit,
  supportsCanvasSubjectTargetReference,
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

  it('未选择主体时按同一模型和整段时长出价，正式请求仍要求指定主体', () => {
    const preview = buildCanvasSubjectVideoEstimateRequest({
      mode: 'remove',
      model: videoModel,
      sourceAssetId: video.sourceAssetId,
      duration: video.sourceVideoDurationSec,
      ratio: video.ratio,
    })
    const request = buildCanvasSubjectEditRequest(video)
    expect(preview).toMatchObject({
      modelVersionId: request.modelVersionId,
      operationCode: request.operationCode,
      inputAssets: request.inputAssets,
      params: request.params,
    })
    expect(preview.prompt).toContain('主体消除')
    expect(() => buildCanvasSubjectEditRequest({ ...video, target: '' })).toThrow('请选择或描述要处理的主体')
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

const subjectVideoRoles = [
  { role: 'video', min_count: 1, max_count: 1 },
  { role: 'image', max_count: 1, mime_types: ['image/jpeg', 'image/png'] },
]

const subjectVideoModes = { name: 'mode', options: ['generate', 'edit', 'extend'] }
const subjectVideoReferenceMode = { name: 'reference_mode', default: false }
const subjectVideoAdaptiveRatio = { name: 'ratio', options: ['adaptive', '16:9', '9:16'] }
const subjectVideoEditPolicies: ReadonlyArray<{
  versions: ReadonlyArray<readonly [number, string]>
  provider: string
  operationCode: 'video.edit' | 'video.generate'
  fields: ReadonlyArray<Record<string, unknown>>
  sourceRange: readonly [number, number]
  params: Record<string, unknown>
  prompt: string
  supportsSourceCutout?: boolean
}> = [
  {
    versions: [[9, 'happyhorse-1.0-video-edit']],
    provider: 'bailian',
    operationCode: 'video.edit',
    fields: [{ name: 'audio_setting', default: 'auto', options: ['auto', 'origin'] }],
    sourceRange: [3, 15],
    params: { audio_setting: 'origin' },
    prompt: '消除原视频',
    supportsSourceCutout: true,
  },
  {
    versions: [
      [19, 'wan3.0-video'],
      [20, 'wan3.0-video-prime'],
    ],
    provider: 'bailian',
    operationCode: 'video.edit',
    fields: [
      { name: 'duration', options: [-1, 5, 10, 15] },
      { name: 'audio', default: true },
      subjectVideoReferenceMode,
      subjectVideoAdaptiveRatio,
    ],
    sourceRange: [1, 15],
    params: { duration: -1, ratio: 'adaptive', audio: true, reference_mode: true },
    prompt: '严格编辑原视频（视频1）',
  },
  {
    versions: [
      [5, 'doubao-seedance-2-0-260128'],
      [15, 'doubao-seedance-2-0-fast-260128'],
      [16, 'doubao-seedance-2-0-mini-260615'],
    ],
    provider: 'volcengine',
    operationCode: 'video.generate',
    fields: [
      { name: 'duration', min: 4, max: 15, required: true },
      { name: 'ratio', options: ['16:9', '1:1', '9:16'] },
      subjectVideoReferenceMode,
      subjectVideoModes,
    ],
    sourceRange: [2, 15],
    params: { duration: 8, ratio: '1:1', mode: 'generate', reference_mode: true },
    prompt: '严格编辑原视频（视频1）',
  },
  {
    versions: [[18, 'doubao-seedance-2-5-260628']],
    provider: 'volcengine',
    operationCode: 'video.generate',
    fields: [
      { name: 'duration', min: 4, max: 30, required: true },
      { name: 'ratio', options: ['16:9', '9:16'] },
      subjectVideoReferenceMode,
      subjectVideoModes,
    ],
    sourceRange: [4, 30],
    params: { duration: 8, mode: 'edit', reference_mode: true },
    prompt: '严格编辑原视频（视频1）',
  },
  {
    versions: [[25, 'MiniMax-H3']],
    provider: 'minimax',
    operationCode: 'video.generate',
    fields: [
      { name: 'duration', min: 4, max: 15 },
      { name: 'source_video_duration', min: 2, max: 15 },
      subjectVideoReferenceMode,
      subjectVideoAdaptiveRatio,
    ],
    sourceRange: [2, 15],
    params: { duration: 8, source_video_duration: 7.25, ratio: 'adaptive', reference_mode: true },
    prompt: '[video editing] 严格编辑原视频 <Video 1>。',
  },
]

const subjectVideoCases = subjectVideoEditPolicies.flatMap((policy) =>
  policy.versions.map(([id, version]) => ({
    policy,
    model: {
      id,
      version,
      provider: policy.provider,
      operation_codes: [policy.operationCode],
      input_constraints: { [policy.operationCode]: { roles: subjectVideoRoles } },
      params_schema: { fields: policy.fields },
    },
  })),
)

describe('团队视频主体编辑适配', () => {
  it('隐藏 HappyHorse 和 Seedance 2.0 标准版，保留相邻版本', () => {
    const models = subjectVideoCases.map(({ model }) => model)
    const standard = models.find(({ version }) => version === 'doubao-seedance-2-0-260128')!
    expect(
      getCanvasSubjectEditModels('video', [...models, { ...standard, id: 103, version: 'doubao-seedance-2-0' }]).map(
        ({ id }) => id,
      ),
    ).toEqual([19, 20, 15, 16, 18, 25])
  })

  it.each([
    ['remove', [19, 20, 15, 18, 25, 118]],
    ['modify', [19, 20, 15, 16, 18, 25, 116, 118]],
    ['replace', [19, 20, 15, 16, 25, 116]],
  ] as const)('按 %s 模式筛选 Seedance Mini 和 2.5', (mode, expected) => {
    const models = subjectVideoCases.map(({ model }) => model)
    const mini = models.find(({ id }) => id === 16)!
    const seedance25 = models.find(({ id }) => id === 18)!
    const catalog = [
      ...models,
      { ...mini, id: 116, model: 'doubao-seedance-2-0-mini', version: '' },
      { ...seedance25, id: 118, modelCode: 'doubao-seedance-2-5', version: '' },
    ]

    expect(getCanvasSubjectEditModels('video', catalog, mode).map(({ id }) => id)).toEqual(expected)
  })

  it.each(subjectVideoCases)('$model.id $model.version 按模型能力编译主体编辑请求', ({ policy, model }) => {
    const source = { ...video, model, sourceVideoDurationSec: 7.25, ratio: '4:3' }
    expect(supportsCanvasSubjectVideoReference(model)).toBe(Boolean(policy.supportsSourceCutout))
    expect(supportsCanvasSubjectTargetReference('video', model)).toBe(true)

    const request = buildCanvasSubjectEditRequest(source)
    expect(request).toMatchObject({
      operationCode: policy.operationCode,
      modelVersionId: model.id,
      params: policy.params,
      inputAssets: [{ asset_id: video.sourceAssetId, role: 'video' }],
    })
    expect(request.prompt).toContain(policy.prompt)
    expect(request.requiresSeedanceModeration).toBe(policy.provider === 'volcengine' ? true : undefined)
    if (model.id === 18) expect(request.params).not.toHaveProperty('ratio')

    const [min, max] = policy.sourceRange
    expect(() => buildCanvasSubjectEditRequest({ ...source, sourceVideoDurationSec: min })).not.toThrow()
    expect(() => buildCanvasSubjectEditRequest({ ...source, sourceVideoDurationSec: max })).not.toThrow()
    expect(() => buildCanvasSubjectEditRequest({ ...source, sourceVideoDurationSec: min - 0.25 })).toThrow('原视频')
    expect(() => buildCanvasSubjectEditRequest({ ...source, sourceVideoDurationSec: max + 0.25 })).toThrow('原视频')

    const edit = { ...source, mode: 'modify', description: '外观改为红色' } as const
    expect(buildCanvasSubjectEditRequest(edit).inputAssets).toEqual([{ asset_id: video.sourceAssetId, role: 'video' }])
    const withTarget = buildCanvasSubjectEditRequest({ ...edit, targetReferenceAssetId: 105 })
    expect(withTarget.inputAssets).toEqual([
      { asset_id: video.sourceAssetId, role: 'video' },
      { asset_id: 105, role: 'image' },
    ])
    expect(withTarget.prompt).toContain('第1张参考图仅用于指定修改后的外观')
    if (model.id === 25) expect(withTarget.prompt).toContain('<Picture 1>')
  })

  it('按当前目录约束排除缺少适配或无法输入源视频的生成模型', () => {
    const directH3 = subjectVideoCases.find(({ model }) => model.id === 25)!.model
    const metaso = { ...directH3, id: 26, provider: 'metaso' }
    const noSource = { ...directH3, input_constraints: { 'video.generate': { roles: [subjectVideoRoles[1]] } } }
    const sourceOnly = { ...directH3, input_constraints: { 'video.generate': { roles: [subjectVideoRoles[0]] } } }
    expect(getCanvasSubjectEditModels('video', [metaso, noSource, sourceOnly])).toEqual([sourceOnly])
    expect(supportsCanvasSubjectTargetReference('video', sourceOnly)).toBe(false)
    expect(() =>
      buildCanvasSubjectEditRequest({ ...video, model: sourceOnly, mode: 'replace', targetReferenceAssetId: 105 }),
    ).toThrow('不支持附带目标参考图')
  })
})
