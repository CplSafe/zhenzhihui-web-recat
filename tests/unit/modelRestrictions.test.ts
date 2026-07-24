import { describe, expect, it } from 'vitest'
import { buildModelRestrictionSummary, getModelConstraintConflicts } from '@/utils/modelRestrictions'

describe('model restriction metadata', () => {
  it('builds user-facing restrictions and structured constraints only from backend metadata', () => {
    const result = buildModelRestrictionSummary({
      limitations: ['真人素材暂不支持', { message: '单次仅生成一个结果' }],
      required_plan_name: 'Pro',
      params_schema: {
        fields: [
          { name: 'duration', options: [{ value: '5' }, { value: '10' }, { value: '15' }] },
          { name: 'ratio', options: ['16:9', '9:16'] },
          { name: 'resolution', options: ['720p', '1080p'] },
          { name: 'generate_audio', options: [false] },
          { name: 'reference_images', minItems: 1, maxItems: 3 },
        ],
      },
    })

    expect(result.messages).toEqual([
      '真人素材暂不支持',
      '单次仅生成一个结果',
      '套餐要求：Pro',
      '时长仅支持：5 秒、10 秒、15 秒',
      '画面比例支持：16:9、9:16',
      '分辨率支持：720p、1080p',
      '不支持生成音频',
      '参考图数量：1–3 张',
    ])
    expect(result.constraints).toEqual({
      duration: { options: [5, 10, 15] },
      ratios: ['16:9', '9:16'],
      ratio: { options: ['16:9', '9:16'] },
      resolutions: ['720p', '1080p'],
      resolution: { options: ['720p', '1080p'] },
      audio: { options: [false] },
      referenceImages: { minimum: 1, maximum: 3 },
    })
  })

  it('reads numeric ranges from standard JSON Schema and reports only actual conflicts', () => {
    const result = buildModelRestrictionSummary({
      params_schema: {
        type: 'object',
        properties: {
          duration: { type: 'integer', minimum: 4, maximum: 15 },
          aspect_ratio: { type: 'string', enum: ['1:1'] },
        },
      },
    })

    expect(result.messages).toEqual(['时长范围：4–15 秒', '画面比例支持：1:1'])
    expect(getModelConstraintConflicts(result.constraints, { durationSec: 3, ratio: '16:9' })).toEqual([
      '当前 3 秒不符合4–15 秒',
      '当前比例 16:9 不在支持范围 1:1 内',
    ])
    expect(getModelConstraintConflicts(result.constraints, { durationSec: 4, ratio: '1:1' })).toEqual([])
  })

  it('supports nested JSON Schema, aliases, object options, required fields and all task constraints', () => {
    const result = buildModelRestrictionSummary({
      params_schema: {
        parameters: {
          required: ['durationSeconds', 'aspectRatio', 'outputResolution', 'withAudio', 'referenceImageIds'],
          properties: {
            durationSeconds: {
              type: 'integer',
              aliases: ['duration', 'seconds'],
              enum: [5, 10],
            },
            aspectRatio: {
              aliases: ['ratio'],
              options: {
                '16:9': '横屏',
                '9:16': '竖屏',
              },
            },
            outputResolution: {
              aliases: ['resolution'],
              choices: [{ value: '720p' }, { value: '1080p' }],
            },
            withAudio: {
              aliases: ['generate_audio'],
              oneOf: [{ const: false }],
            },
            referenceImageIds: {
              aliases: ['reference_images'],
              type: 'array',
              minItems: 1,
              maxItems: 2,
            },
          },
        },
      },
    })

    expect(result.constraints).toEqual({
      duration: { options: [5, 10], required: true },
      ratios: ['16:9', '9:16'],
      ratio: { options: ['16:9', '9:16'], required: true },
      resolutions: ['720p', '1080p'],
      resolution: { options: ['720p', '1080p'], required: true },
      audio: { options: [false], required: true },
      referenceImages: { minimum: 1, maximum: 2, required: true },
      requiredFields: ['durationSeconds', 'aspectRatio', 'outputResolution', 'withAudio', 'referenceImageIds'],
    })
    expect(
      getModelConstraintConflicts(result.constraints, {
        durationSec: 15,
        ratio: '1:1',
        resolution: '4k',
        generateAudio: true,
        referenceImageCount: 0,
      }),
    ).toEqual([
      '当前 15 秒不在可选时长 5 秒、10 秒 内',
      '当前比例 1:1 不在支持范围 16:9、9:16 内',
      '当前分辨率 4k 不在支持范围 720p、1080p 内',
      '当前模型不支持生成音频',
      '当前参考图数量 0 不符合1–2 张',
    ])
  })

  it('does not invent restrictions when the backend declares none', () => {
    expect(buildModelRestrictionSummary({ display_name: '后端模型名称' })).toEqual({
      messages: [],
      constraints: {},
    })
    expect(buildModelRestrictionSummary(null)).toEqual({ messages: [], constraints: {} })
  })
})
