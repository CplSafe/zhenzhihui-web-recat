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
   * 字幕开关必须严格跟着脚本走(产品确认的行为):
   * - 填了字幕 → 模型按镜头时间段「原样」显示指定文字,禁止改写(防乱码),
   *   且除指定字幕外不得出现其他文字;
   * - 全部删掉 → 完全禁止画面出现文字。模糊的「对齐字幕」指令曾让模型在
   *   删掉字幕后仍自己编出乱码字(Framora 1.0 实测)。
   */
  it('填了字幕:按镜头原样显示指定文本,其余文字仍被禁止', () => {
    const prompt = buildTimelinePrompt({
      shots: [
        { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '这家店我来对了', subtitle: '新店开业全场8折' },
        { no: '分镜2', desc: '特写产品', duration: '5s' },
      ],
      basePrompt: '一条奶茶店广告',
    })

    expect(prompt).toContain('字幕(原样显示在画面下方):「新店开业全场8折」')
    expect(prompt).toContain('不得改写、增减、翻译或变形')
    expect(prompt).toContain('未指定字幕的镜头不显示任何文字')
    expect(prompt).toContain('除各镜头指定的字幕外,画面中不得出现任何其他文字')
    // 旧版那句诱导模型自由发挥的「对齐字幕」指令不能回来
    expect(prompt).not.toContain('对齐画面、旁白、字幕')
  })

  /*
   * 旁白必须被「读出来」:此前提示词写「由后期配音完成」,等于告诉支持配音的模型
   * (万相 3.0/Framora 等)不要出声,成片只剩环境音效。改为明确要求普通话朗读+对口型;
   * 不支持配音的模型会忽略这条,无副作用。
   */
  it('填了旁白:要求作为音频朗读并对口型,文字仍不上画面', () => {
    const prompt = buildTimelinePrompt({ shots, basePrompt: '一条奶茶店广告' })

    expect(prompt).toContain('请将其作为音频用自然流畅的普通话朗读出来')
    expect(prompt).toContain('口型要与台词匹配')
    expect(prompt).toContain('旁白(用普通话配音朗读,文字不上画面):「这家店我来对了」')
    expect(prompt).not.toContain('由后期配音完成')
  })

  it('没有任何旁白时不出现朗读指令', () => {
    const prompt = buildTimelinePrompt({
      shots: [{ no: '分镜1', desc: '特写产品', duration: '5s' }],
      basePrompt: '一条奶茶店广告',
    })

    expect(prompt).not.toContain('朗读')
    expect(prompt).not.toContain('旁白(')
  })

  /*
   * 音频语义也跟脚本走:标注了什么配什么,全删则明确禁止模型自作主张配声音。
   * (完全静音还需入口「背景音」开关配合;这里锁的是提示词侧不再点菜。)
   */
  it('台词音效字幕全删:提示词明确不要任何人声/配乐/特效音,也无任何文字内容', () => {
    const prompt = buildTimelinePrompt({
      shots: [
        { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '', subtitle: '', sfx: '' },
        { no: '分镜2', desc: '特写产品', duration: '5s' },
      ],
      basePrompt: '一条奶茶店广告',
    })

    expect(prompt).toContain('不要添加任何旁白、人声、背景音乐与人为特效音')
    expect(prompt).not.toContain('朗读')
    expect(prompt).not.toContain('字幕(原样显示在画面下方)')
    expect(prompt).not.toContain('音效:')
    expect(prompt).toContain('画面中不得出现任何文字、字幕、标题、标语、水印或字符')
  })

  it('只有旁白没有音效:允许人声但不要配乐和特效音', () => {
    const prompt = buildTimelinePrompt({ shots, basePrompt: '一条奶茶店广告' })
    expect(prompt).toContain('除旁白人声外,不要添加背景音乐与人为特效音')
  })

  it('标注了音效:未标注的镜头不得加额外特效音', () => {
    const prompt = buildTimelinePrompt({
      shots: [{ no: '分镜1', desc: '开瓶', duration: '5s', sfx: '气泡声' }],
    })
    expect(prompt).toContain('音效标注用于生成对应的环境音与效果音')
    expect(prompt).toContain('未标注音效的镜头不要添加额外特效音')
    expect(prompt).toContain('音效:气泡声')
  })

  it('删光字幕:字幕文本与对齐指令都不进提示词,完全禁止画面文字', () => {
    const prompt = buildTimelinePrompt({
      shots: [
        { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '这家店我来对了', subtitle: '' },
        { no: '分镜2', desc: '特写产品', duration: '5s', subtitle: '   ' },
      ],
      basePrompt: '一条奶茶店广告',
    })

    expect(prompt).not.toContain('字幕(原样显示在画面下方)')
    expect(prompt).not.toContain('部分镜头指定了字幕')
    // 旁白仍要求配音朗读,但文字不上画面
    expect(prompt).toContain('旁白(用普通话配音朗读,文字不上画面):「这家店我来对了」')
    expect(prompt).toContain('画面中不得出现任何文字、字幕、标题、标语、水印或字符')
  })
})
