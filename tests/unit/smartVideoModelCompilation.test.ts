import { describe, expect, it } from 'vitest'
import {
  buildFullVideoInputAssets,
  canReuseOriginalVideoFrameAssets,
  compileFullVideoModelRequest,
  compileVideoEditModelRequest,
} from '@/api/smartVideo'

describe('buildFullVideoInputAssets', () => {
  it('只复用逐项等于原始分镜的缓存，拒绝历史挖脸替换资产', () => {
    expect(canReuseOriginalVideoFrameAssets([11, 12], [11, 12], 2)).toBe(true)
    expect(canReuseOriginalVideoFrameAssets([11, 12], [91, 92], 2)).toBe(false)
    expect(canReuseOriginalVideoFrameAssets([11, 12], [11], 2)).toBe(false)
    expect(canReuseOriginalVideoFrameAssets([], [], 0)).toBe(true)
  })

  it('keeps the shot images on the model-declared role', () => {
    expect(buildFullVideoInputAssets({ imageAssetIds: [11, 12], imageRole: 'reference_image' })).toEqual([
      { asset_id: 11, role: 'reference_image' },
      { asset_id: 12, role: 'reference_image' },
    ])
  })

  it('appends the source video under its own role instead of reusing the image role', () => {
    expect(
      buildFullVideoInputAssets({ imageAssetIds: [11], imageRole: 'reference_image', sourceVideoAssetId: 99 }),
    ).toEqual([
      { asset_id: 11, role: 'reference_image' },
      { asset_id: 99, role: 'video' },
    ])
  })

  it('falls back to the image role and drops unusable ids', () => {
    expect(buildFullVideoInputAssets({ imageAssetIds: [0, -3, 12, Number.NaN] })).toEqual([
      { asset_id: 12, role: 'image' },
    ])
    // 没有源视频时不追加任何视频输入，普通整片生成的请求体保持不变
    expect(buildFullVideoInputAssets({ imageAssetIds: [12], sourceVideoAssetId: 0 })).toEqual([
      { asset_id: 12, role: 'image' },
    ])
  })

  it('still submits the source video when there is no shot image', () => {
    expect(buildFullVideoInputAssets({ sourceVideoAssetId: 99 })).toEqual([{ asset_id: 99, role: 'video' }])
  })
})

describe('compileFullVideoModelRequest', () => {
  it('compiles a Seedance schema without inventing audio or a non-declared input role', () => {
    const compiled = compileFullVideoModelRequest(
      {
        model_version_id: '801',
        modelVersionId: 802,
        id: 803,
        display_name: 'Seedance 2.0',
        operation_codes: ['video.generate'],
        params_schema: {
          fields: [
            { name: 'seconds', options: [5, 10, 15] },
            { name: 'ratio', options: ['16:9', '9:16'] },
            { name: 'resolution', options: ['720p', '1080p'] },
          ],
        },
      },
      {
        shots: [{ duration: '5s' }, { duration: '5s' }],
        ratio: '16:9',
        referenceImageCount: 2,
      },
    )

    expect(compiled).toMatchObject({
      modelVersionId: 801,
      inputAssetRole: 'image',
      referenceImageCount: 2,
      params: {
        seconds: 10,
        ratio: '16:9',
        resolution: '720p',
      },
    })
    expect(compiled.params).not.toHaveProperty('generate_audio')
    expect(compiled.params).not.toHaveProperty('generateAudio')
  })

  it('提交用户在入口选择的分辨率，模型不支持时直接报错而不是静默改档', () => {
    const model = {
      model_version_id: 901,
      display_name: 'Seedance 2.0',
      operation_codes: ['video.generate'],
      params_schema: {
        fields: [
          { name: 'duration', options: [5, 10] },
          { name: 'ratio', options: ['16:9'] },
          { name: 'resolution', options: ['720p', '1080p'] },
        ],
      },
    }
    const args = { shots: [{ duration: '5s' }, { duration: '5s' }], ratio: '16:9', referenceImageCount: 2 }

    expect(compileFullVideoModelRequest(model, { ...args, resolution: '1080p' }).params).toMatchObject({
      resolution: '1080p',
    })
    // 未选择时沿用 schema 默认（这里是 720p），保持旧项目的出片规格不变。
    expect(compileFullVideoModelRequest(model, args).params).toMatchObject({ resolution: '720p' })
    expect(() => compileFullVideoModelRequest(model, { ...args, resolution: '4k' })).toThrow('不支持当前分辨率 4k')
  })

  it('lets the model decide the duration range instead of a hardcoded 1–15 seconds', () => {
    // 模型声明 30 秒档位就必须能编译出请求：入口下拉允许选 30s，
    // 走到这里再用写死的 1–15 秒拒绝，会让整条流程在最后一步断掉。
    const model = {
      model_version_id: 951,
      display_name: 'Seedance 2.5',
      operation_codes: ['video.generate'],
      params_schema: {
        fields: [
          { name: 'duration', options: [5, 10, 15, 30] },
          { name: 'ratio', options: ['16:9'] },
        ],
      },
    }
    const shots = [{ duration: '10s' }, { duration: '10s' }, { duration: '10s' }]

    expect(compileFullVideoModelRequest(model, { shots, ratio: '16:9', referenceImageCount: 3 }).params).toMatchObject({
      duration: 30,
    })
    // 模型没有的档位仍然拦下，且报错点名是模型不支持，而不是笼统的「必须 1 至 15 秒」。
    expect(() =>
      compileFullVideoModelRequest(model, {
        shots: [{ duration: '10s' }, { duration: '11s' }],
        ratio: '16:9',
        referenceImageCount: 2,
      }),
    ).toThrow('所选视频模型不支持当前总时长')
  })

  it('keeps a schema-less MiniMax model on its real 6/10 second tiers', () => {
    // 线上实况：海螺 schema 只声明了 duration 字段名和 resolution 档位，没有时长可选值。
    // 修复前 5 秒会被原样编译并下发，换回 minimax HTTP 400: bad_request_error。
    const hailuo = {
      model_version_id: 20,
      display_name: 'MiniMax 海螺',
      operation_codes: ['video.generate'],
      params_schema: {
        fields: [
          { name: 'duration' },
          { name: 'ratio', options: ['16:9', '9:16'] },
          { name: 'resolution', options: ['768P', '1080P'] },
        ],
      },
    }
    const args = { ratio: '16:9', resolution: '768P', referenceImageCount: 2 }

    expect(() =>
      compileFullVideoModelRequest(hailuo, { ...args, shots: [{ duration: '2s' }, { duration: '3s' }] }),
    ).toThrow('所选视频模型不支持当前总时长')

    expect(
      compileFullVideoModelRequest(hailuo, { ...args, shots: [{ duration: '3s' }, { duration: '3s' }] }).params,
    ).toMatchObject({ duration: 6, ratio: '16:9', resolution: '768P' })
    expect(
      compileFullVideoModelRequest(hailuo, { ...args, shots: [{ duration: '5s' }, { duration: '5s' }] }).params,
    ).toMatchObject({ duration: 10 })
  })

  it('falls back to the default 1–15 second range only when the model declares no duration', () => {
    const model = {
      model_version_id: 952,
      display_name: '无时长声明的视频模型',
      operation_codes: ['video.generate'],
      params_schema: { fields: [{ name: 'ratio', options: ['16:9'] }] },
    }

    expect(() =>
      compileFullVideoModelRequest(model, {
        shots: [{ duration: '10s' }, { duration: '10s' }, { duration: '10s' }],
        ratio: '16:9',
        referenceImageCount: 3,
      }),
    ).toThrow('智能成片总时长必须是 1 至 15 秒内的整数')
  })

  it('uses explicit reference role, supported resolution and disabled audio for a reference-video schema', () => {
    const compiled = compileFullVideoModelRequest(
      {
        modelVersionId: 811,
        display_name: 'HappyHorse 参考生视频',
        operation_codes: ['video.generate'],
        params_schema: {
          fields: [
            { name: 'duration', minimum: 1, maximum: 15 },
            { name: 'aspect_ratio', options: ['9:16', '16:9'] },
            { name: 'size', options: ['1080p'] },
            { name: 'generate_audio', const: false },
            { name: 'reference_images', minItems: 1, maxItems: 2 },
            { name: 'input_asset_role', const: 'reference_image' },
          ],
        },
      },
      {
        shots: [{ duration: '3s' }, { duration: '4s' }],
        ratio: '9:16',
        referenceImageCount: 2,
      },
    )

    expect(compiled).toEqual({
      modelVersionId: 811,
      modelVersion: expect.objectContaining({ id: 811 }),
      params: {
        duration: 7,
        aspect_ratio: '9:16',
        size: '1080p',
        generate_audio: false,
      },
      inputAssetRole: 'reference_image',
      referenceImageCount: 2,
    })
  })

  it('keeps audio enabled when the selected model allows it', () => {
    const compiled = compileFullVideoModelRequest(
      {
        id: 812,
        operation_codes: ['video.generate'],
        params_schema: {
          fields: [{ name: 'duration' }, { name: 'generateAudio', options: [false, true] }],
        },
      },
      {
        shots: [{ duration: '6s' }],
        referenceImageCount: 1,
      },
    )

    expect(compiled.params).toMatchObject({ duration: 6, generateAudio: true })
  })

  it.each([0, 3])('rejects reference count %s outside an explicitly declared 1–2 range', (count) => {
    expect(() =>
      compileFullVideoModelRequest(
        {
          id: 813,
          operation_codes: ['video.generate'],
          params_schema: {
            fields: [{ name: 'reference_images', minItems: 1, maxItems: 2 }],
          },
        },
        {
          shots: [{ duration: '5s' }],
          referenceImageCount: count,
        },
      ),
    ).toThrow('所选视频模型不支持当前参考图')
  })
})

describe('compileVideoEditModelRequest', () => {
  it('canonicalizes the model and compiles schema-safe edit params with one shared default prompt', () => {
    const compiled = compileVideoEditModelRequest(
      {
        model_version_id: '821',
        modelVersionId: 822,
        id: 823,
        display_name: 'HappyHorse 视频编辑',
        operation_codes: ['video.edit'],
        params_schema: {
          fields: [
            { name: 'duration' },
            { name: 'source_video_duration' },
            { name: 'aspect_ratio', options: ['9:16', '16:9'] },
            { name: 'size', options: ['1080p'] },
            { name: 'generate_audio', const: false },
          ],
        },
      },
      {
        ratio: '9:16',
        durationSec: 7,
        sourceVideoDurationSec: 5.06,
      },
    )

    expect(compiled).toEqual({
      modelVersionId: 821,
      modelVersion: expect.objectContaining({ id: 821 }),
      prompt: expect.stringContaining('保留原视频镜头内容'),
      params: {
        duration: 7,
        source_video_duration: 5.06,
        aspect_ratio: '9:16',
        size: '1080p',
        generate_audio: false,
      },
    })
  })

  it('rejects a model that explicitly declares a different operation', () => {
    expect(() =>
      compileVideoEditModelRequest(
        {
          id: 824,
          operation_codes: ['video.generate'],
          params_schema: { fields: [] },
        },
        { prompt: '提高亮度' },
      ),
    ).toThrow('已选择的模型不支持视频修改(video.edit)')
  })
})
