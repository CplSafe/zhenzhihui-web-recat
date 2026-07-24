import { describe, expect, it } from 'vitest'
import {
  filterFeaturedCreativeVideoModels,
  getConflictingCreativeVideoModelIds,
  getCreativeVideoModelKind,
  isFeaturedCreativeVideoModel,
  isHiddenSmartVideoModel,
} from '@/utils/featuredVideoModels'

describe('featured creative video models', () => {
  it.each([
    [{ model_code: 'happyhorse-reference-to-video' }, true],
    [{ model: 'reference_video', provider_name: 'HappyHorse' }, true],
    [{ code: 'r2v', provider: 'happyhorse' }, true],
    [{ model: 'seedance-2.0' }, true],
    [{ model_name: 'seedance_v2.0-pro' }, true],
    [{ display_name: 'HappyHorse 参考生视频' }, true],
    [{ display_name: '其他厂商参考生视频' }, false],
    [{ display_name: 'Seedance 2.0' }, true],
    [{ model_code: 'image-to-video', display_name: '图生视频' }, false],
    [{ model_code: 'text-to-video', display_name: '文生视频' }, false],
    [{ model: 'seedance-1.5-pro' }, false],
    [null, false],
  ])('classifies %p as featured=%p', (model, expected) => {
    expect(isFeaturedCreativeVideoModel(model)).toBe(expected)
  })

  it('preserves backend records and order while removing unopened video effects', () => {
    const imageToVideo = {
      id: 101,
      model_code: 'image-to-video',
      display_name: '图生视频',
    }
    const referenceVideo = {
      id: 102,
      model_code: 'happyhorse-reference-to-video',
      display_name: 'HappyHorse 参考生视频',
    }
    const textToVideo = {
      id: 103,
      model_code: 'text-to-video',
      display_name: '文生视频',
    }
    const seedance20 = {
      id: 104,
      model: 'seedance-2.0',
      display_name: 'Seedance 2.0',
    }

    expect(filterFeaturedCreativeVideoModels([imageToVideo, referenceVideo, textToVideo, seedance20])).toEqual([
      referenceVideo,
      seedance20,
    ])
    expect(filterFeaturedCreativeVideoModels(null)).toEqual([])
  })

  it('keeps the standard, Fast, and Mini Seedance 2.0 variants as separate choices', () => {
    const models = [
      { id: 301, model: 'doubao-seedance-2-0', display_name: 'Seedance 2.0' },
      { id: 302, model: 'doubao-seedance-2-0-fast', display_name: 'Seedance 2.0 Fast' },
      { id: 303, model: 'doubao-seedance-2-0-mini', display_name: 'Seedance 2.0 Mini' },
    ]

    expect(filterFeaturedCreativeVideoModels(models)).toEqual(models)
  })

  it('keeps at most one model per featured effect and prefers enabled valid backend records', () => {
    const models = [
      {
        id: 201,
        model_code: 'happyhorse-reference-to-video',
        display_name: 'HappyHorse 参考生视频（配置损坏）',
        params_schema: { fields: [null] },
      },
      {
        id: 202,
        model_code: 'happyhorse-reference-to-video-v2',
        display_name: 'HappyHorse 参考生视频',
      },
      {
        id: 203,
        model_code: 'seedance-2.0-disabled',
        display_name: 'Seedance 2.0（停用）',
        enabled: false,
      },
      {
        id: 204,
        model_code: 'seedance-2.0',
        display_name: 'Seedance 2.0',
      },
      {
        id: 205,
        model_code: 'other-reference-to-video',
        display_name: '其他厂商参考生视频',
      },
    ]

    expect(filterFeaturedCreativeVideoModels(models)).toEqual([models[1], models[3]])
  })

  it.each([
    [{ display_name: 'HappyHorse 图生视频' }, true],
    [{ display_name: 'HappyHorse 文生视频' }, true],
    [{ model_code: 'happyhorse-image-to-video' }, true],
    [{ model_code: 'happyhorse-text-to-video' }, true],
    [{ model_code: 'image-to-video', display_name: 'HappyHorse 参考生视频' }, true],
    [{ model_code: 'text-to-video', display_name: 'Seedance 2.0' }, true],
    [{ display_name: '其他视频生成模型' }, false],
  ])('classifies %p as hidden from smart creation=%p', (model, expected) => {
    expect(isHiddenSmartVideoModel(model)).toBe(expected)
  })

  it('prioritizes explicit backend capability metadata over conflicting display names', () => {
    expect(
      getCreativeVideoModelKind({
        capability: 'image-to-video',
        display_name: '参考生视频',
      }),
    ).toBe('traditional-video')
    expect(
      getCreativeVideoModelKind({
        effect_type: 'reference-to-video',
        display_name: 'HappyHorse 图生视频',
      }),
    ).toBe('reference-video')
    expect(
      getCreativeVideoModelKind({
        model_family: 'seedance-2.0',
        display_name: '后端自定义展示名',
      }),
    ).toBe('seedance-2.0')
  })

  it('detects contradictory effects that share the same canonical model version ID', () => {
    const models = [
      {
        model_version_id: 801,
        effect_type: 'reference-to-video',
        display_name: '参考生视频 A',
      },
      {
        model_version_id: 801,
        effect_type: 'seedance-2.0',
        display_name: 'Seedance A',
      },
      {
        model_version_id: 802,
        capability: 'reference-to-video',
        provider_name: 'HappyHorse',
        display_name: 'HappyHorse 参考生视频 B',
      },
    ]

    expect(getConflictingCreativeVideoModelIds(models)).toEqual([801])
    expect(filterFeaturedCreativeVideoModels(models)).toEqual([models[2]])
  })
})
