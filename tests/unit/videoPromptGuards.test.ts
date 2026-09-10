import { describe, expect, it } from 'vitest'
import { NO_ONSCREEN_TEXT_REQUIREMENT, withNoOnscreenTextGuard } from '@/utils/videoPromptGuards'

/**
 * 视频模型画中文必乱码，所有下发视频提示词的链路共用这一条禁文字硬约束。
 * 这里锁住工具函数本身的行为；各链路是否接上由对应链路的测试锁。
 */
describe('withNoOnscreenTextGuard', () => {
  it('在提示词末尾追加统一硬约束', () => {
    const guarded = withNoOnscreenTextGuard('把灯光调亮一点')
    expect(guarded.startsWith('把灯光调亮一点')).toBe(true)
    expect(guarded).toContain(NO_ONSCREEN_TEXT_REQUIREMENT)
  })

  it('已含约束时不重复追加(幂等)', () => {
    const once = withNoOnscreenTextGuard('调亮')
    const twice = withNoOnscreenTextGuard(once)
    expect(twice).toBe(once)
    expect(twice.split(NO_ONSCREEN_TEXT_REQUIREMENT).length - 1).toBe(1)
  })

  it('空提示原样返回,不把约束当正文单发', () => {
    expect(withNoOnscreenTextGuard('')).toBe('')
    expect(withNoOnscreenTextGuard('   ')).toBe('')
  })
})
