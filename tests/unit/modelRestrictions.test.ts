import { describe, expect, it } from 'vitest'
import {
  buildModelRestrictionSummary,
  getModelConstraintConflicts,
  getModelDurationLimitLabel,
} from '@/utils/modelRestrictions'

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

  it('treats option values that differ only in spelling as the same tier', () => {
    // 后端 HappyHorse 视频编辑模型把档位写成大写 720P/1080P，入口存的是小写 720p，
    // 这只是拼写差异；按大小写严格比较会把它误报成「不在支持范围」，让用户无从调整。
    const result = buildModelRestrictionSummary({
      params_schema: {
        fields: [
          { name: 'resolution', options: ['720P', '1080P'] },
          { name: 'ratio', options: ['16:9', '9:16'] },
        ],
      },
    })

    expect(getModelConstraintConflicts(result.constraints, { resolution: '720p', ratio: ' 9:16 ' })).toEqual([])
    expect(getModelConstraintConflicts(result.constraints, { resolution: '480p' })).toEqual([
      '当前分辨率 480p 不在支持范围 720P、1080P 内',
    ])
  })

  it('falls back to known duration tiers only when the backend declares none', () => {
    // 海螺(MiniMax)只接受 6/10 秒，但后端 schema 声明了 duration 字段却没给可选值。
    // 没有兜底时前端无从校验，5 秒、7 秒会被原样下发并换回 minimax HTTP 400: bad_request_error。
    const hailuo = buildModelRestrictionSummary({
      display_name: 'MiniMax 海螺',
      params_schema: {
        fields: [{ name: 'duration' }, { name: 'resolution', options: ['768P', '1080P'] }],
      },
    })

    expect(hailuo.constraints.duration).toEqual({ options: [6, 10] })
    expect(hailuo.messages).toContain('时长仅支持：6 秒、10 秒')
    expect(getModelConstraintConflicts(hailuo.constraints, { durationSec: 6 })).toEqual([])
    expect(getModelConstraintConflicts(hailuo.constraints, { durationSec: 5 })).toEqual([
      '当前 5 秒不在可选时长 6 秒、10 秒 内',
    ])
    expect(getModelConstraintConflicts(hailuo.constraints, { durationSec: 7 })).toHaveLength(1)
  })

  it('always prefers the backend schema over the fallback duration table', () => {
    // 后端一旦声明档位（或上下限），兜底表必须彻底让位，避免前端把正确配置改坏。
    const declaredOptions = buildModelRestrictionSummary({
      display_name: 'MiniMax 海螺',
      params_schema: { fields: [{ name: 'duration', options: [5, 8] }] },
    })
    expect(declaredOptions.constraints.duration).toEqual({ options: [5, 8] })
    expect(getModelConstraintConflicts(declaredOptions.constraints, { durationSec: 5 })).toEqual([])

    const declaredRange = buildModelRestrictionSummary({
      display_name: 'MiniMax 海螺',
      params_schema: { fields: [{ name: 'duration', minimum: 1, maximum: 15 }] },
    })
    expect(declaredRange.constraints.duration).toEqual({ minimum: 1, maximum: 15 })
    expect(getModelConstraintConflicts(declaredRange.constraints, { durationSec: 7 })).toEqual([])
  })

  it('leaves models without a fallback rule untouched', () => {
    const other = buildModelRestrictionSummary({
      display_name: '其他厂商视频模型',
      params_schema: { fields: [{ name: 'duration' }] },
    })
    expect(other.constraints.duration).toBeUndefined()
    expect(getModelConstraintConflicts(other.constraints, { durationSec: 7 })).toEqual([])
  })

  it('把后端声明的时长能力总结成下拉里的括注，未声明则不写', () => {
    expect(getModelDurationLimitLabel({ duration: { options: [5, 10, 15] } })).toBe('最长 15 秒')
    expect(getModelDurationLimitLabel({ duration: { minimum: 1, maximum: 15 } })).toBe('最长 15 秒')
    // options 与上限同时存在时以真实可选档位为准。
    expect(getModelDurationLimitLabel({ duration: { options: [5, 10], maximum: 30 } })).toBe('最长 10 秒')
    // 只声明下限时告知起步时长，仍不杜撰上限。
    expect(getModelDurationLimitLabel({ duration: { minimum: 3 } })).toBe('最短 3 秒')
    // 没有时长约束的模型（脚本、图片）不加括注。
    expect(getModelDurationLimitLabel({ ratios: ['16:9'] })).toBe('')
    expect(getModelDurationLimitLabel(undefined)).toBe('')
  })

  it('does not invent restrictions when the backend declares none', () => {
    expect(buildModelRestrictionSummary({ display_name: '后端模型名称' })).toEqual({
      messages: [],
      constraints: {},
    })
    expect(buildModelRestrictionSummary(null)).toEqual({ messages: [], constraints: {} })
  })
})
