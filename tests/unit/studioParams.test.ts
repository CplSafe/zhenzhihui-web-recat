import { describe, expect, it } from 'vitest'

import type { GenerationModelConstraints } from '@/utils/modelRestrictions'
import {
  defaultStudioParams,
  formatParamsSummary,
  normalizeParams,
  resolveParamOptions,
  toRatioOption,
} from '@/utils/studioParams'

describe('toRatioOption', () => {
  it('原样保留后端给的比例值作为 value 与展示文案', () => {
    // 图标形状交给共享的 RatioIcon 按 value 解析，这里只做包装。
    expect(toRatioOption('16:9')).toEqual({ value: '16:9', label: '16:9' })
  })

  it('后端返回的非标准比例也照样透传，不在前端丢弃', () => {
    expect(toRatioOption('智能')).toEqual({ value: '智能', label: '智能' })
  })
})

describe('resolveParamOptions', () => {
  it('模型声明的比例与分辨率优先于兜底档位', () => {
    // Arrange：模拟后端 schema 解析出的约束
    const constraints: GenerationModelConstraints = {
      ratios: ['21:9', '4:3'],
      resolutions: ['480p', '720p'],
    }

    // Act
    const options = resolveParamOptions('video', constraints)

    // Assert
    expect(options.ratios.map((r) => r.value)).toEqual(['21:9', '4:3'])
    expect(options.resolutions).toEqual(['480p', '720p'])
  })

  it('模型未声明时使用该模式的兜底档位', () => {
    const video = resolveParamOptions('video')
    const image = resolveParamOptions('image')
    expect(video.resolutions).toContain('1080p')
    expect(image.resolutions).toContain('2K')
    expect(image.durations).toEqual([])
  })

  it('时长优先取模型给的枚举档位', () => {
    const options = resolveParamOptions('video', { duration: { options: [4, 8, 12] } })
    expect(options.durations).toEqual([4, 8, 12])
  })

  it('只给 min/max 时按区间过滤兜底梯度，不自造模型没枚举过的秒数', () => {
    // 兜底梯度是 [5, 10]，上限 6 秒时只应保留 5。
    expect(resolveParamOptions('video', { duration: { minimum: 3, maximum: 6 } }).durations).toEqual([5])
  })

  it('区间与兜底梯度不相交时保留原梯度，不留空档位', () => {
    const options = resolveParamOptions('video', { duration: { minimum: 40, maximum: 60 } })
    expect(options.durations.length).toBeGreaterThan(0)
  })

  it('参考图上限以模型声明为准', () => {
    expect(resolveParamOptions('image', { referenceImages: { maximum: 3 } }).maxReferenceImages).toBe(3)
    // 未声明时图片与视频都按 9 张兜底（视频参考图兼作首尾帧与参考生成）
    expect(resolveParamOptions('video').maxReferenceImages).toBe(9)
    expect(resolveParamOptions('image').maxReferenceImages).toBe(9)
  })
})

describe('defaultStudioParams', () => {
  it('默认值取自可选档位，视频有时长图片没有', () => {
    expect(defaultStudioParams('video').durationSec).toBeGreaterThan(0)
    expect(defaultStudioParams('image').durationSec).toBe(0)
  })

  it('默认值一定落在模型声明的档位内', () => {
    const constraints: GenerationModelConstraints = { ratios: ['4:3'], resolutions: ['480p'] }
    const options = resolveParamOptions('video', constraints)
    const params = defaultStudioParams('video', options)
    expect(params.ratio).toBe('4:3')
    expect(params.resolution).toBe('480p')
  })
})

describe('normalizeParams', () => {
  it('换模型后不再支持的比例被收敛到合法值', () => {
    // Arrange：用户原来选了 16:9，新模型只支持 4:3
    const options = resolveParamOptions('video', { ratios: ['4:3'], resolutions: ['720p'] })
    const current = { resolution: '1080p', ratio: '16:9', durationSec: 5, count: 2, generateAudio: false }

    // Act
    const next = normalizeParams('video', current, options)

    // Assert
    expect(next.ratio).toBe('4:3')
    expect(next.resolution).toBe('720p')
  })

  it('仍然合法的选择保持不变', () => {
    const options = resolveParamOptions('video', {
      ratios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      duration: { options: [5, 10] },
    })
    const current = { resolution: '1080p', ratio: '9:16', durationSec: 10, count: 2, generateAudio: false }
    expect(normalizeParams('video', current, options)).toEqual(current)
  })

  it('分辨率大小写不同仍视为同一档，不重置用户选择', () => {
    // 模型声明 720P、页面存的是 720p：应保留而不是回退到默认值。
    const options = resolveParamOptions('video', { resolutions: ['720P', '1080P'] })
    const next = normalizeParams(
      'video',
      { resolution: '720p', ratio: '16:9', durationSec: 5, count: 1, generateAudio: false },
      options,
    )
    expect(next.resolution).toBe('720P')
  })

  it('图片模式强制清零时长', () => {
    const options = resolveParamOptions('image')
    const next = normalizeParams(
      'image',
      { resolution: '2K', ratio: '1:1', durationSec: 10, count: 1, generateAudio: false },
      options,
    )
    expect(next.durationSec).toBe(0)
  })
})

describe('formatParamsSummary', () => {
  it('视频摘要含时长，图片摘要不含', () => {
    const params = { resolution: '1080p', ratio: '16:9', durationSec: 5, count: 2, generateAudio: false }
    expect(formatParamsSummary('video', params)).toBe('1080p · 5s · 16:9 · 2 条')
    expect(formatParamsSummary('image', { ...params, resolution: '2K', durationSec: 0 })).toBe('2K · 16:9 · 2 条')
  })

  it('模型支持音频时摘要体现有声/无声', () => {
    const options = resolveParamOptions('video', { audio: { options: [true, false] } })
    const params = { resolution: '1080p', ratio: '16:9', durationSec: 5, count: 1, generateAudio: true }
    expect(formatParamsSummary('video', params, options)).toContain('有声')
    expect(formatParamsSummary('video', { ...params, generateAudio: false }, options)).toContain('无声')
  })

  it('模型不支持音频时摘要不出现声音字样，避免误解', () => {
    const options = resolveParamOptions('video')
    const params = { resolution: '1080p', ratio: '16:9', durationSec: 5, count: 1, generateAudio: false }
    expect(formatParamsSummary('video', params, options)).not.toContain('声')
  })
})
