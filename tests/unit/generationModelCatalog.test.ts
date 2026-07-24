import { describe, expect, it } from 'vitest'
import {
  areGenerationModelOperationsReady,
  buildGenerationModelGroups,
  createGenerationModelOperationStateMap,
  getBackendGenerationModelVersionId,
  getBackendGenerationModelName,
  getImageGenerationOperationCode,
  getUnavailableGenerationOperations,
  getUnavailableRequiredGenerationOperations,
  isBackendGenerationModelEnabled,
  isGenerationModelCatalogReadyForMode,
  normalizeGenerationModels,
  normalizeGenerationModelVersionId,
  resolveGenerationModelSelections,
  type GenerationModelSelectionMap,
} from '@/utils/generationModelCatalog'

describe('generation model catalog', () => {
  it('uses only backend fields to normalize model display names', () => {
    expect(
      getBackendGenerationModelName({
        display_name: '后端展示名',
        name: '普通名称',
        model: 'model-code',
        version: 'v1',
      }),
    ).toBe('后端展示名')
    expect(getBackendGenerationModelName({ displayName: 'Camel 展示名' })).toBe('Camel 展示名')
    expect(getBackendGenerationModelName({ name: '后端 name' })).toBe('后端 name')
    expect(getBackendGenerationModelName({ model_name: '后端 model_name' })).toBe('后端 model_name')
    expect(getBackendGenerationModelName({ model: 'backend-model', version: 'v2' })).toBe('backend-model v2')
    expect(getBackendGenerationModelName({ model: 'backend-model-v2', version: 'v2' })).toBe('backend-model-v2')
    expect(getBackendGenerationModelName({ version: 'version-only' })).toBe('version-only')
    expect(getBackendGenerationModelName({ provider: 'provider-only' })).toBe('')
  })

  it('filters explicitly disabled models while accepting backend enabled variants', () => {
    expect(isBackendGenerationModelEnabled({ enabled: true })).toBe(true)
    expect(isBackendGenerationModelEnabled({ is_enabled: 1 })).toBe(true)
    expect(isBackendGenerationModelEnabled({ isEnabled: 'true' })).toBe(true)
    expect(isBackendGenerationModelEnabled({ enabled: false })).toBe(false)
    expect(isBackendGenerationModelEnabled({ enabled: 0 })).toBe(false)
    expect(isBackendGenerationModelEnabled({ enabled: 'disabled' })).toBe(false)
    expect(isBackendGenerationModelEnabled({ status: 'archived' })).toBe(false)
    expect(isBackendGenerationModelEnabled({ status: 'active' })).toBe(true)
    expect(isBackendGenerationModelEnabled({ name: '接口已过滤但未返回 enabled' })).toBe(true)
  })

  it('normalizes operation variants, removes incomplete records and deduplicates only within each operation', () => {
    const models = normalizeGenerationModels([
      {
        id: '101',
        enabled: true,
        name: '普通名称',
        operation_codes: ['image.text_to_image'],
      },
      {
        model_version_id: 101,
        enabled: true,
        display_name: '后端首选展示名',
        operationCode: 'image.image_to_image',
      },
      {
        id: '102',
        enabled: true,
        model: 'video-from-backend',
        version: 'v3',
        operation_codes: 'video.generate, video.edit',
      },
      {
        id: 'video-model-id',
        enabled: true,
        display_name: '不可提交的字符串 ID',
        operation_codes: ['video.generate'],
      },
      {
        id: 202,
        enabled: true,
        display_name: '脚本模型',
        operations: [{ code: 'responses.multimodal' }, { code: 'unknown.operation' }],
      },
      {
        id: 303,
        enabled: false,
        display_name: '已停用模型',
        operation_codes: ['video.generate'],
      },
      {
        id: 404,
        enabled: true,
        operation_codes: ['video.generate'],
      },
      {
        id: 505,
        enabled: true,
        display_name: '没有支持的操作',
        operation_codes: ['audio.generate'],
      },
    ])

    expect(models).toHaveLength(5)
    expect(
      models.map(({ modelVersionId, displayName, operationCodes }) => ({
        modelVersionId,
        displayName,
        operationCodes,
      })),
    ).toEqual([
      {
        modelVersionId: 101,
        displayName: '普通名称',
        operationCodes: ['image.text_to_image'],
      },
      {
        modelVersionId: 101,
        displayName: '后端首选展示名',
        operationCodes: ['image.image_to_image'],
      },
      {
        modelVersionId: 102,
        displayName: 'video-from-backend v3',
        operationCodes: ['video.generate'],
      },
      {
        modelVersionId: 102,
        displayName: 'video-from-backend v3',
        operationCodes: ['video.edit'],
      },
      {
        modelVersionId: 202,
        displayName: '脚本模型',
        operationCodes: ['responses.multimodal'],
      },
    ])
  })

  it('keeps operation-specific source and params_schema for the same model version ID', () => {
    const groups = buildGenerationModelGroups([
      {
        model_version_id: 601,
        display_name: '同版本文生图',
        operation_codes: ['image.text_to_image'],
        source_marker: 'text-source',
        params_schema: {
          fields: [{ name: 'ratio', options: ['16:9'] }],
        },
      },
      {
        model_version_id: 601,
        display_name: '同版本图生图',
        operation_codes: ['image.image_to_image'],
        source_marker: 'image-source',
        params_schema: {
          fields: [{ name: 'ratio', options: ['1:1'] }],
        },
      },
    ])

    const imageGroup = groups.find((group) => group.key === 'image')
    const textModel = imageGroup?.operationGroups.find((group) => group.operationCode === 'image.text_to_image')
      ?.models[0]
    const imageModel = imageGroup?.operationGroups.find((group) => group.operationCode === 'image.image_to_image')
      ?.models[0]

    expect(textModel).toMatchObject({
      modelVersionId: 601,
      displayName: '同版本文生图',
      source: {
        source_marker: 'text-source',
        params_schema: {
          fields: [{ name: 'ratio', options: ['16:9'] }],
        },
      },
    })
    expect(imageModel).toMatchObject({
      modelVersionId: 601,
      displayName: '同版本图生图',
      source: {
        source_marker: 'image-source',
        params_schema: {
          fields: [{ name: 'ratio', options: ['1:1'] }],
        },
      },
    })
    expect(textModel?.source).not.toBe(imageModel?.source)
  })

  it('keeps malformed params_schema visible but unavailable and never resolves it for submission', () => {
    const groups = buildGenerationModelGroups([
      {
        id: 611,
        display_name: '损坏 JSON 模型',
        operation_codes: ['video.generate'],
        params_schema: '{bad json',
      },
      {
        id: 612,
        display_name: '损坏 fields 模型',
        operation_codes: ['video.edit'],
        params_schema: { fields: {} },
      },
      {
        id: 613,
        display_name: '合法模型',
        operation_codes: ['image.text_to_image'],
        params_schema: { fields: [] },
      },
    ])

    const videoModel = groups.find((group) => group.key === 'video')?.operationGroups[0].models[0]
    const editModel = groups.find((group) => group.key === 'videoEdit')?.operationGroups[0].models[0]
    const imageModel = groups
      .find((group) => group.key === 'image')
      ?.operationGroups.find((group) => group.operationCode === 'image.text_to_image')?.models[0]

    expect(videoModel?.unavailableReason).toContain('配置错误')
    expect(editModel?.unavailableReason).toContain('配置错误')
    expect(imageModel?.unavailableReason).toBeUndefined()
    expect(
      resolveGenerationModelSelections(groups, {
        'video.generate': 611,
        'video.edit': 612,
        'image.text_to_image': 613,
      }),
    ).toEqual({
      'image.text_to_image': imageModel,
    })
  })

  it('accepts only positive integer model IDs and converts numeric strings to numbers', () => {
    const models = normalizeGenerationModels([
      { id: '77', display_name: '数字字符串', operation_codes: ['video.generate'] },
      { id: 'model-78', display_name: '任意字符串', operation_codes: ['video.generate'] },
      { id: 0, display_name: '零', operation_codes: ['video.generate'] },
      { id: -1, display_name: '负数', operation_codes: ['video.generate'] },
      { id: 1.5, display_name: '小数', operation_codes: ['video.generate'] },
      { id: '9007199254740993', display_name: '非安全整数', operation_codes: ['video.generate'] },
    ])

    expect(models).toHaveLength(1)
    expect(models[0].modelVersionId).toBe(77)
    expect(typeof models[0].modelVersionId).toBe('number')
  })

  it('uses one canonical version-ID priority and does not treat legacy version_id as a submit ID', () => {
    expect(
      getBackendGenerationModelVersionId({
        model_version_id: '71',
        modelVersionId: 72,
        id: 73,
      }),
    ).toBe(71)
    expect(getBackendGenerationModelVersionId({ modelVersionId: '72', id: 73 })).toBe(72)
    expect(getBackendGenerationModelVersionId({ id: '73' })).toBe(73)
    expect(getBackendGenerationModelVersionId({ version_id: 74 })).toBeNull()
    expect(normalizeGenerationModelVersionId('75')).toBe(75)
    expect(normalizeGenerationModelVersionId('model-75')).toBeNull()
  })

  it('groups all available user-facing types and keeps image operations separate', () => {
    const groups = buildGenerationModelGroups([
      {
        id: 1,
        enabled: true,
        display_name: '脚本模型（来自后端）',
        operation_codes: ['responses.multimodal'],
      },
      {
        id: 2,
        enabled: true,
        display_name: '文生图模型（来自后端）',
        operation_codes: ['image.text_to_image'],
      },
      {
        id: 3,
        enabled: true,
        display_name: '双图片模型（来自后端）',
        operation_codes: ['image.text_to_image', 'image.image_to_image'],
      },
      {
        id: 4,
        enabled: true,
        display_name: '视频生成模型（来自后端）',
        operation_codes: ['video.generate'],
      },
      {
        id: 5,
        enabled: true,
        display_name: '视频修改模型（来自后端）',
        operation_codes: ['video.edit'],
      },
    ])

    expect(groups.map((group) => group.key)).toEqual(['script', 'image', 'video', 'videoEdit'])
    expect(groups.find((group) => group.key === 'videoEdit')?.models[0].displayName).toBe('视频修改模型（来自后端）')

    const imageGroup = groups.find((group) => group.key === 'image')
    expect(imageGroup?.operationGroups.map((group) => group.operationCode)).toEqual([
      'image.text_to_image',
      'image.image_to_image',
    ])
    expect(imageGroup?.operationGroups[0].models.map((model) => model.modelVersionId)).toEqual([2, 3])
    expect(imageGroup?.operationGroups[1].models.map((model) => model.modelVersionId)).toEqual([3])
    expect(imageGroup?.models.map((model) => model.modelVersionId)).toEqual([2, 3, 3])
  })

  it('preserves every fixed operation subgroup when one operation has no model', () => {
    const groups = buildGenerationModelGroups([
      {
        id: 9,
        enabled: true,
        display_name: '仅图生图模型',
        operation_codes: ['image.image_to_image'],
      },
    ])

    expect(groups.map((group) => group.key)).toEqual(['script', 'image', 'video', 'videoEdit'])
    const imageGroup = groups.find((group) => group.key === 'image')
    expect(imageGroup).toMatchObject({
      key: 'image',
      operationCodes: ['image.text_to_image', 'image.image_to_image'],
    })
    expect(imageGroup?.operationGroups).toHaveLength(2)
    expect(imageGroup?.operationGroups[0].models).toEqual([])
    expect(imageGroup?.operationGroups[1].models[0].modelVersionId).toBe(9)
  })

  it('resolves selections by exact operation and drops stale or incompatible model IDs', () => {
    const groups = buildGenerationModelGroups([
      {
        id: 11,
        enabled: true,
        display_name: '脚本模型',
        operation_codes: ['responses.multimodal'],
      },
      {
        id: 21,
        enabled: true,
        display_name: '文生图模型',
        operation_codes: ['image.text_to_image'],
      },
      {
        id: 22,
        enabled: true,
        display_name: '图生图模型',
        operation_codes: ['image.image_to_image'],
      },
      {
        id: 31,
        enabled: true,
        display_name: '视频生成模型',
        operation_codes: ['video.generate'],
      },
    ])
    const selections: GenerationModelSelectionMap = {
      'responses.multimodal': '11',
      'image.text_to_image': 21,
      'image.image_to_image': 22,
      'video.generate': 22,
      'video.edit': 999,
    }

    const resolved = resolveGenerationModelSelections(groups, selections)

    expect(resolved['responses.multimodal']?.modelVersionId).toBe(11)
    expect(resolved['image.text_to_image']?.modelVersionId).toBe(21)
    expect(resolved['image.image_to_image']?.modelVersionId).toBe(22)
    expect(resolved['video.generate']).toBeUndefined()
    expect(resolved['video.edit']).toBeUndefined()
  })

  it('gates video and image modes against their fixed required operation lists', () => {
    const states = createGenerationModelOperationStateMap('ready')

    expect(isGenerationModelCatalogReadyForMode(states, 'video')).toBe(true)
    expect(isGenerationModelCatalogReadyForMode(states, 'image')).toBe(true)

    states['video.edit'] = {
      operationCode: 'video.edit',
      status: 'empty',
      availableModelCount: 0,
      message: '视频修改模型暂无可用模型',
    }
    expect(isGenerationModelCatalogReadyForMode(states, 'video')).toBe(false)
    expect(isGenerationModelCatalogReadyForMode(states, 'image')).toBe(true)
    expect(getUnavailableRequiredGenerationOperations(states, 'video')).toEqual(['video.edit'])

    states['image.text_to_image'] = {
      operationCode: 'image.text_to_image',
      status: 'error',
      availableModelCount: 0,
      message: '文生图模型加载失败',
    }
    expect(isGenerationModelCatalogReadyForMode(states, 'image')).toBe(false)
    expect(getUnavailableRequiredGenerationOperations(states, 'image')).toEqual(['image.text_to_image'])
  })

  it('selects the active image operation from a normalized reference image count', () => {
    expect(getImageGenerationOperationCode(0)).toBe('image.text_to_image')
    expect(getImageGenerationOperationCode(-1)).toBe('image.text_to_image')
    expect(getImageGenerationOperationCode(Number.NaN)).toBe('image.text_to_image')
    expect(getImageGenerationOperationCode(Number.POSITIVE_INFINITY)).toBe('image.text_to_image')
    expect(getImageGenerationOperationCode('')).toBe('image.text_to_image')
    expect(getImageGenerationOperationCode('not-a-number')).toBe('image.text_to_image')
    expect(getImageGenerationOperationCode(true)).toBe('image.text_to_image')

    expect(getImageGenerationOperationCode(1)).toBe('image.image_to_image')
    expect(getImageGenerationOperationCode(0.5)).toBe('image.image_to_image')
    expect(getImageGenerationOperationCode(' 2 ')).toBe('image.image_to_image')
  })

  it('checks readiness for an explicit operation subset', () => {
    const states = createGenerationModelOperationStateMap('ready')
    states['image.image_to_image'] = {
      operationCode: 'image.image_to_image',
      status: 'error',
      availableModelCount: 0,
      message: '图生图模型加载失败',
    }

    expect(areGenerationModelOperationsReady(states, ['image.text_to_image'])).toBe(true)
    expect(areGenerationModelOperationsReady(states, ['image.image_to_image'])).toBe(false)
    expect(getUnavailableGenerationOperations(states, ['image.text_to_image', 'image.image_to_image'])).toEqual([
      'image.image_to_image',
    ])
  })

  it('returns an empty catalog and empty selection map for invalid input', () => {
    expect(normalizeGenerationModels(null)).toEqual([])
    expect(buildGenerationModelGroups(undefined)).toEqual([])
    expect(resolveGenerationModelSelections([], null)).toEqual({})
  })
})
