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

  /*
   * 视频模型没有「贴字幕」的能力：提示词里出现字幕文本或「对齐字幕」的指令，
   * 只会让模型把中文画进画面渲染成乱码（Framora 1.0 实测复现）。字幕属于后期贴片，
   * 这里锁死：字幕文本不进提示词，旁白标注为配音，且带禁止画面文字的硬性要求。
   */
  it('字幕文本不进提示词，且带禁止画面出现文字的硬性要求', () => {
    const prompt = buildTimelinePrompt({
      shots: [
        { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '这家店我来对了', subtitle: '新店开业全场8折' },
        { no: '分镜2', desc: '特写产品', duration: '5s', subtitle: '扫码下单立减' },
      ],
      basePrompt: '一条奶茶店广告',
    })

    // 硬性要求里允许出现「字幕」这个词(用来禁止它);镜头行的「字幕:「…」」标签必须消失
    expect(prompt).not.toContain('字幕:')
    expect(prompt).not.toContain('对齐画面、旁白、字幕')
    expect(prompt).not.toContain('新店开业全场8折')
    expect(prompt).not.toContain('扫码下单立减')
    // 旁白保留为配音语义,供模型把握节奏,但明确不上画面
    expect(prompt).toContain('旁白(后期配音,不上画面):「这家店我来对了」')
    expect(prompt).toContain('不得出现任何文字')
  })
})
