import { describe, expect, it } from 'vitest'
import {
  getCreativeVideoModelKind,
  isHiddenCreativeVideoModel,
  isHiddenSmartVideoModel,
} from '@/utils/creativeVideoModelKind'

describe('creative video model kind', () => {
  it.each([
    [{ model_code: 'happyhorse-reference-to-video' }, 'reference-video'],
    [{ model: 'reference_video', provider_name: 'HappyHorse' }, 'reference-video'],
    [{ code: 'r2v' }, 'reference-video'],
    [{ display_name: '其他厂商参考生视频' }, 'reference-video'],
    [{ model: 'seedance-2.0' }, 'seedance-2.0'],
    [{ model_name: 'seedance_v2.0-pro' }, 'seedance-2.0'],
    [{ model_code: 'image-to-video', display_name: '图生视频' }, 'traditional-video'],
    [{ model_code: 'text-to-video', display_name: '文生视频' }, 'traditional-video'],
    [{ model: 'seedance-1.5-pro' }, 'other'],
    [{ display_name: '后端新增的视频模型' }, 'other'],
    [null, 'other'],
  ])('classifies %p as %s', (model, expected) => {
    expect(getCreativeVideoModelKind(model)).toBe(expected)
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

  it.each([
    [{ display_name: 'HappyHorse 图生视频' }, true],
    [{ display_name: 'HappyHorse 文生视频' }, true],
    [{ model_code: 'happyhorse-image-to-video' }, true],
    [{ model_code: 'text-to-video', provider_name: 'HappyHorse' }, true],
    // 仅屏蔽 HappyHorse 这两个效果，其他厂商同类模型与 HappyHorse 参考生视频照常展示。
    [{ display_name: 'MiniMax 图生视频' }, false],
    [{ display_name: '其他厂商文生视频' }, false],
    [{ display_name: 'HappyHorse 参考生视频' }, false],
    [{ display_name: 'HappyHorse Seedance 2.0' }, false],
    [{ display_name: '后端新增的视频模型' }, false],
    [null, false],
  ])('hides %p from the model dropdown=%p', (model, expected) => {
    expect(isHiddenCreativeVideoModel(model)).toBe(expected)
  })

  it.each([
    [{ display_name: 'Seedance 2.5' }, true],
    [{ model_code: 'seedance-2.5-pro' }, true],
    [{ model: 'seedance_v2.5' }, true],
    // 名称与版本分列两个字段时同样识别为 2.5 线。
    [{ display_name: 'Seedance', version_name: '2.5' }, true],
    [{ display_name: 'Seedance', version: 'v2.5.1' }, true],
    // 只屏蔽 2.5 线：其余 Seedance 版本、其他厂商模型、以及仅版本号相同的非 Seedance 模型照常展示。
    [{ display_name: 'Seedance 2.0' }, false],
    [{ display_name: 'Seedance 1.5 Pro' }, false],
    [{ display_name: '其他厂商 2.5' }, false],
    [{ display_name: 'HappyHorse 参考生视频' }, false],
    [{ display_name: '后端新增的视频模型', version_name: '2.5' }, false],
    [null, false],
  ])('hides %p from the smart-video dropdown=%p', (model, expected) => {
    expect(isHiddenSmartVideoModel(model)).toBe(expected)
    // 智能成片的屏蔽规则不得外溢到画布等其他入口。
    if (expected) expect(isHiddenCreativeVideoModel(model)).toBe(false)
  })

  it('reports contradictory effect metadata instead of guessing one', () => {
    expect(
      getCreativeVideoModelKind({
        display_name: 'HappyHorse 参考生视频',
        model_code: 'image-to-video',
      }),
    ).toBe('conflict')
  })
})
