import { describe, expect, it } from 'vitest'
import { findFirstField, getModelParamFields, parseParamsSchema } from '@/utils/modelSchema'
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

  it('preserves smart-video exact durations instead of snapping them to a legacy bucket', () => {
    expect(buildVideoGenerationParams({}, { duration: 7, durationMode: 'exact' })).toMatchObject({ duration: 7 })

    const model = { params_schema: { fields: [{ name: 'seconds', options: ['5', '10', '15'] }] } }
    expect(buildVideoGenerationParams(model, { duration: '11s', durationMode: 'exact' })).toEqual({ seconds: 11 })
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
        resolution: '4k',
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

  it('does not send undeclared generation fields except the intentional audio fallback', () => {
    const model = { params_schema: { fields: [{ name: 'ratio', options: ['9:16'] }] } }
    expect(
      buildVideoGenerationParams(model, {
        duration: 15,
        ratio: '16:9',
        resolution: '1080p',
        sourceVideoDuration: 10,
        generateAudio: true,
      }),
    ).toEqual({ ratio: '9:16', generate_audio: true })
    expect(buildVideoGenerationParams(model, { generateAudio: false })).toEqual({ ratio: '9:16' })
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
