import { describe, expect, it } from 'vitest'

import {
  getVideoModeSpec,
  normalizeVideoMode,
  resolveAvailableVideoModes,
  supportsAudioToggle,
  validateVideoModeImages,
  videoReferenceMode,
} from '@/utils/studioVideoMode'

describe('resolveAvailableVideoModes', () => {
  it('通用模型提供首尾帧与参考生视频两种模式', () => {
    expect(resolveAvailableVideoModes({ name: '某通用视频模型' })).toEqual(['first-last', 'full-ref'])
  })

  it('纯文生模型返回空数组，页面据此隐藏模式切换', () => {
    expect(resolveAvailableVideoModes({}, { referenceImages: { maximum: 0 } })).toEqual([])
    expect(resolveAvailableVideoModes({ model_code: 'happyhorse-t2v' })).toEqual([])
  })

  it('声明只收 1 张图时不提供参考生视频', () => {
    const modes = resolveAvailableVideoModes({}, { referenceImages: { maximum: 1 } })
    expect(modes).toEqual(['first-last'])
  })

  it('按模型名识别 i2v 只给首尾帧', () => {
    expect(resolveAvailableVideoModes({ model_code: 'happyhorse-i2v' })).toEqual(['first-last'])
  })

  it('参考生视频类模型只给 full-ref', () => {
    // capability 显式声明优先于名称。
    expect(resolveAvailableVideoModes({ capability: '参考生视频' })).toEqual(['full-ref'])
  })
})

describe('normalizeVideoMode', () => {
  it('当前模式不可用时退回第一个可用模式', () => {
    expect(normalizeVideoMode('full-ref', ['first-last'])).toBe('first-last')
  })

  it('仍然可用时保持不变', () => {
    expect(normalizeVideoMode('first-last', ['first-last', 'full-ref'])).toBe('first-last')
  })

  it('可用集合为空（纯文生模型）时回退到默认模式而不是崩溃', () => {
    expect(normalizeVideoMode('full-ref', [])).toBe('first-last')
  })
})

describe('videoReferenceMode', () => {
  // 首尾帧 / 参考的区分走 params.reference_mode，图片角色由后端按下标翻译；
  // 前端直传 first_frame 会被后端的 role 分桶丢弃（见 volcengineContent）。
  it('首尾帧对应 reference_mode=false', () => {
    expect(videoReferenceMode('first-last')).toBe(false)
  })

  it('参考生视频对应 reference_mode=true', () => {
    expect(videoReferenceMode('full-ref')).toBe(true)
  })
})

describe('validateVideoModeImages', () => {
  it('首尾帧不传图也允许（退化为纯文生），最多 2 张', () => {
    expect(validateVideoModeImages('first-last', 0)).toBe('')
    expect(validateVideoModeImages('first-last', 2)).toBe('')
    expect(validateVideoModeImages('first-last', 3)).toContain('最多 2 张')
  })

  it('参考生视频上限 9 张', () => {
    expect(validateVideoModeImages('full-ref', 0)).toBe('')
    expect(validateVideoModeImages('full-ref', 9)).toBe('')
    expect(validateVideoModeImages('full-ref', 10)).toContain('最多 9 张')
  })
})

describe('getVideoModeSpec', () => {
  it('未知模式回退到默认模式，不抛错', () => {
    expect(getVideoModeSpec('不存在' as any).value).toBe('first-last')
  })
})

describe('supportsAudioToggle', () => {
  it('模型声明 audio 且可取两值时支持开关', () => {
    expect(supportsAudioToggle({ audio: { options: [true, false] } })).toBe(true)
  })

  it('只允许一个取值时不展示开关', () => {
    expect(supportsAudioToggle({ audio: { options: [false] } })).toBe(false)
  })

  it('完全未声明 audio 时不展示开关', () => {
    expect(supportsAudioToggle({})).toBe(false)
    expect(supportsAudioToggle(undefined)).toBe(false)
  })
})
