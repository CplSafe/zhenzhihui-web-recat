import { describe, expect, it } from 'vitest'
import {
  findFirstField,
  getModelParamOptionValues,
  getModelParamFields,
  hasModelParamSchema,
  normalizeModelParamName,
  parseParamsSchema,
} from '@/utils/modelSchema'
import {
  ENTRY_RATIO_OPTIONS,
  SEEDANCE_RATIO_OPTIONS,
  getModelParamOptions,
  normalizeImageRatio,
  normalizeSeedanceDuration,
  normalizeSeedanceRatio,
} from '@/utils/videoOptions'
import { buildVideoGenerationParams } from '@/utils/videoTasks'

describe('model schema helpers', () => {
  it.each([null, undefined, '', 0])('returns null for an empty schema: %p', (schema) => {
    expect(parseParamsSchema(schema)).toBeNull()
  })

  it('parses JSON strings, preserves objects and rejects malformed JSON', () => {
    const schema = { fields: [{ name: 'duration' }] }
    expect(parseParamsSchema(JSON.stringify(schema))).toEqual(schema)
    expect(parseParamsSchema(schema)).toBe(schema)
    expect(parseParamsSchema('{bad json')).toBeNull()
  })

  it('supports both params_schema spellings and ignores non-array fields', () => {
    expect(getModelParamFields({ params_schema: '{"fields":[{"name":"ratio"}]}' })).toEqual([{ name: 'ratio' }])
    expect(getModelParamFields({ paramsSchema: { fields: [{ name: 'duration' }] } })).toEqual([{ name: 'duration' }])
    expect(getModelParamFields({ params_schema: { fields: {} } })).toEqual([])
    expect(getModelParamFields(null)).toEqual([])
    expect(hasModelParamSchema({ params_schema: { fields: [] } })).toBe(true)
    expect(hasModelParamSchema({})).toBe(false)
  })

  it('converts standard JSON Schema properties and enums to model fields', () => {
    expect(
      getModelParamFields({
        params_schema: {
          type: 'object',
          required: ['duration'],
          properties: {
            duration: { type: 'integer', minimum: 4, maximum: 15 },
            ratio: { type: 'string', enum: ['16:9', '9:16'] },
            generate_audio: { type: 'boolean' },
          },
        },
      }),
    ).toEqual([
      { name: 'duration', type: 'integer', minimum: 4, maximum: 15, required: true },
      { name: 'ratio', type: 'string', enum: ['16:9', '9:16'], options: ['16:9', '9:16'] },
      { name: 'generate_audio', type: 'boolean' },
    ])
  })

  it('reads nested required fields, aliases and object-shaped options', () => {
    const fields = getModelParamFields({
      params_schema: {
        schema: {
          required: ['aspectRatio'],
          properties: {
            aspectRatio: {
              type: 'string',
              aliases: ['ratio', 'aspect_ratio'],
              options: {
                '16:9': '横屏',
                '9:16': '竖屏',
              },
            },
          },
        },
      },
    })

    expect(fields).toEqual([
      {
        name: 'aspectRatio',
        type: 'string',
        aliases: ['ratio', 'aspect_ratio'],
        options: ['16:9', '9:16'],
        required: true,
      },
    ])
    expect(findFirstField(fields, ['aspect_ratio'])).toBe(fields[0])
    expect(getModelParamOptionValues(fields[0])).toEqual(['16:9', '9:16'])
    expect(normalizeModelParamName('Aspect-Ratio')).toBe('aspectratio')
  })

  it('returns the first field matching candidate priority', () => {
    const fields = [{ name: 'seconds' }, { name: 'duration' }]
    expect(findFirstField(fields, ['duration', 'seconds'])).toEqual({ name: 'seconds' })
    expect(findFirstField(fields, ['ratio'])).toBeNull()
  })
})

describe('video option boundaries', () => {
  it('keeps every supported ratio and falls back safely for unknown values', () => {
    for (const ratio of SEEDANCE_RATIO_OPTIONS) {
      expect(normalizeSeedanceRatio(ratio)).toBe(ratio)
      expect(normalizeImageRatio(ratio)).toBe(ratio)
    }
    expect(normalizeSeedanceRatio('2:1')).toBe('9:16')
    expect(normalizeImageRatio(undefined)).toBe('9:16')
    expect(ENTRY_RATIO_OPTIONS).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4'])
  })

  it.each([
    [undefined, 10],
    ['', 10],
    ['not-a-number', 10],
    [-1, 1],
    [0, 10],
    [1, 1],
    ['7.9s', 7],
    [15, 15],
    [16, 15],
  ])('normalizes duration %p to %p seconds', (value, expected) => {
    expect(normalizeSeedanceDuration(value)).toBe(expected)
  })

  it('reads declared model options and returns an empty list for malformed schemas', () => {
    expect(
      getModelParamOptions(
        { params_schema: JSON.stringify({ fields: [{ name: 'ratio', options: ['16:9', '9:16'] }] }) },
        'ratio',
      ),
    ).toEqual(['16:9', '9:16'])
    expect(getModelParamOptions({ paramsSchema: { fields: [{ name: 'ratio', options: '16:9' }] } }, 'ratio')).toEqual(
      [],
    )
    expect(getModelParamOptions({ params_schema: '{bad' }, 'ratio')).toEqual([])
  })
})

describe('buildVideoGenerationParams', () => {
  it.each([
    [undefined, 10],
    [-1, 10],
    [1, 5],
    [7.5, 5],
    [8, 10],
    [13, 15],
    [99, 15],
    ['3.5s', 5],
    [11, 10],
  ])('snaps schema-less duration %p to %p', (duration, expected) => {
    expect(buildVideoGenerationParams({}, { duration })).toMatchObject({ duration: expected })
  })

  it('builds safe defaults when the model has no schema', () => {
    expect(
      buildVideoGenerationParams({}, { duration: 10, ratio: '16:9', resolution: '', generateAudio: false }),
    ).toEqual({ duration: 10, resolution: '720p', ratio: '16:9', generate_audio: false })
  })

  it('preserves exact durations by default and can strictly validate smart-video model options', () => {
    expect(buildVideoGenerationParams({}, { duration: 7, durationMode: 'exact' })).toMatchObject({ duration: 7 })

    const model = {
      display_name: 'Seedance 2.0',
      params_schema: { fields: [{ name: 'seconds', options: ['5', '10', '15'] }] },
    }
    expect(buildVideoGenerationParams(model, { duration: '11s', durationMode: 'exact' })).toEqual({ seconds: 11 })
    expect(() =>
      buildVideoGenerationParams(model, {
        duration: '11s',
        durationMode: 'exact',
        validateExactDuration: true,
      }),
    ).toThrow('Seedance 2.0 不支持 11 秒视频，可选时长：5、10、15 秒')
    expect(
      buildVideoGenerationParams(model, {
        duration: '10s',
        durationMode: 'exact',
        validateExactDuration: true,
      }),
    ).toEqual({ seconds: 10 })
  })

  it('uses declared aliases and picks the closest supported numeric option', () => {
    const model = {
      params_schema: {
        fields: [
          { name: 'seconds', options: ['5', '10', '15'] },
          { name: 'aspect_ratio', options: ['1:1', '16:9'] },
          { name: 'resolution', options: ['1080p', '720p'] },
          { name: 'sourceVideoDuration' },
          { name: 'generateAudio' },
        ],
      },
    }

    expect(
      buildVideoGenerationParams(model, {
        duration: 12.5,
        ratio: '16:9',
        resolution: '1080p',
        sourceVideoDuration: 4.6,
        generateAudio: true,
      }),
    ).toEqual({
      seconds: 10,
      aspect_ratio: '16:9',
      resolution: '1080p',
      sourceVideoDuration: 4.6,
      generateAudio: true,
    })
  })

  it('rejects explicitly selected unsupported ratio, resolution and audio values', () => {
    const model = {
      display_name: '后端视频模型',
      params_schema: {
        fields: [
          { name: 'aspect_ratio', options: ['16:9', '9:16'] },
          { name: 'resolution', options: { '720p': '标清', '1080p': '高清' } },
          { name: 'generate_audio', oneOf: [{ const: false }] },
        ],
      },
    }

    expect(() => buildVideoGenerationParams(model, { ratio: '4:3' })).toThrow(
      '后端视频模型 不支持当前画面比例 4:3，可选值：16:9、9:16',
    )
    expect(() => buildVideoGenerationParams(model, { ratio: '16:9', resolution: '4k' })).toThrow(
      '后端视频模型 不支持当前分辨率 4k，可选值：720p、1080p',
    )
    expect(() =>
      buildVideoGenerationParams(model, {
        ratio: '16:9',
        resolution: '720p',
        generateAudio: true,
      }),
    ).toThrow('后端视频模型 不支持当前音频生成参数 true，可选值：false')
  })

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'omits an invalid source-video duration: %p',
    (sourceVideoDuration) => {
      const result = buildVideoGenerationParams(
        { paramsSchema: { fields: [{ name: 'source_video_duration' }] } },
        { sourceVideoDuration },
      )
      expect(result).not.toHaveProperty('source_video_duration')
    },
  )

  it('does not send fields that are absent from the selected model schema', () => {
    const model = { params_schema: { fields: [{ name: 'ratio', options: ['9:16'] }] } }
    expect(
      buildVideoGenerationParams(model, {
        duration: 15,
        sourceVideoDuration: 10,
        generateAudio: true,
      }),
    ).toEqual({ ratio: '9:16' })
    expect(buildVideoGenerationParams(model, { generateAudio: false })).toEqual({ ratio: '9:16' })
  })

  it('keeps audio only when the selected model explicitly declares it', () => {
    const seedance = {
      params_schema: {
        fields: [
          { name: 'duration', options: [5, 10, 15] },
          { name: 'ratio', options: ['16:9', '9:16'] },
          { name: 'resolution', options: ['720p'] },
        ],
      },
    }
    expect(
      buildVideoGenerationParams(seedance, {
        duration: 10,
        durationMode: 'exact',
        validateExactDuration: true,
        ratio: '16:9',
        resolution: '720p',
        generateAudio: true,
      }),
    ).toEqual({ duration: 10, ratio: '16:9', resolution: '720p' })

    const happyHorse = {
      params_schema: {
        fields: [{ name: 'duration' }, { name: 'generateAudio' }],
      },
    }
    expect(
      buildVideoGenerationParams(happyHorse, {
        duration: 10,
        durationMode: 'exact',
        generateAudio: true,
      }),
    ).toEqual({ duration: 10, generateAudio: true })
  })

  it('treats an explicit empty schema as no configurable params and rejects malformed schema text', () => {
    expect(
      buildVideoGenerationParams({ params_schema: { fields: [] } }, { duration: 10, generateAudio: true }),
    ).toEqual({})
    expect(() =>
      buildVideoGenerationParams(
        { display_name: 'Seedance 2.0', params_schema: '{bad json' },
        { duration: 10, generateAudio: true },
      ),
    ).toThrow('Seedance 2.0 的参数定义无法解析')
  })

  it('validates exact duration against JSON Schema numeric boundaries', () => {
    const model = {
      display_name: 'Seedance 2.0',
      params_schema: {
        properties: {
          duration: { type: 'integer', minimum: 4, maximum: 15 },
        },
      },
    }
    expect(() =>
      buildVideoGenerationParams(model, {
        duration: 3,
        durationMode: 'exact',
        validateExactDuration: true,
      }),
    ).toThrow('Seedance 2.0 支持的时长为4–15 秒，当前为 3 秒')
    expect(
      buildVideoGenerationParams(model, {
        duration: 4,
        durationMode: 'exact',
        validateExactDuration: true,
      }),
    ).toEqual({ duration: 4 })
  })

  it('preserves a duration when the model declares no numeric options', () => {
    expect(
      buildVideoGenerationParams(
        { params_schema: { fields: [{ name: 'duration', options: ['auto', null] }] } },
        { duration: 6.25 },
      ),
    ).toEqual({ duration: 6.25 })
  })

  it('parses decimals before applying model-declared duration options', () => {
    const model = { params_schema: { fields: [{ name: 'duration', options: ['5', '10', '15'] }] } }

    expect(buildVideoGenerationParams(model, { duration: '3.5s' })).toEqual({ duration: 5 })
    expect(buildVideoGenerationParams(model, { duration: '11s' })).toEqual({ duration: 10 })
  })
})
