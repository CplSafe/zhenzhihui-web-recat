import { describe, expect, it } from 'vitest'
import { buildTimelinePrompt } from '@/api/smartVideo'
import { buildRealPersonVideoIdentityConstraint } from '@/utils/smartRealPerson'

const shots = [
  { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '这家店我来对了' },
  { no: '分镜2', desc: '特写产品', duration: '5s' },
]

describe('buildTimelinePrompt', () => {
  it('不传身份约束时保持原样，仍以时间线说明开头', () => {
    const prompt = buildTimelinePrompt({ shots, basePrompt: '一条奶茶店广告' })
    expect(prompt.startsWith('请按照下面的时间线生成一条短视频广告')).toBe(true)
    expect(prompt).not.toContain('真人出镜身份强约束')
    expect(prompt).toContain('广告描述:一条奶茶店广告')
  })

  it('真人成片把身份约束放在时间线与广告描述之前', () => {
    const identityConstraint = buildRealPersonVideoIdentityConstraint('测试人物')
    const prompt = buildTimelinePrompt({ shots, basePrompt: '一条奶茶店广告', identityConstraint })

    expect(prompt.startsWith('【真人出镜身份强约束：测试人物】')).toBe(true)
    expect(prompt.indexOf('真人出镜身份强约束')).toBeLessThan(prompt.indexOf('请按照下面的时间线'))
    expect(prompt.indexOf('真人出镜身份强约束')).toBeLessThan(prompt.indexOf('广告描述'))
    // 约束是附加项，不能吃掉原有的时间线内容
    expect(prompt).toContain('人物走进店里')
    expect(prompt).toContain('这家店我来对了')
  })

  it('空白约束按未传处理，不留空行', () => {
    const prompt = buildTimelinePrompt({ shots, identityConstraint: '   ' })
    expect(prompt.startsWith('请按照下面的时间线生成一条短视频广告')).toBe(true)
  })
})
