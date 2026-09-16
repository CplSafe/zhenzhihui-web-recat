import { describe, expect, it } from 'vitest'
import {
  NO_SOURCE_OVERLAY_REQUIREMENT,
  buildHotCopyReplicatePrompt,
  withNoSourceOverlayGuard,
} from '@/utils/hotCopyPrompt'

describe('buildHotCopyReplicatePrompt', () => {
  it('同款翻拍:用户文案在最前,说清保留与替换,并锁定产品外观', () => {
    const prompt = buildHotCopyReplicatePrompt({
      tab: 'remake',
      text: '把手里的饮料换成我的产品',
      products: [{ faceCheckStatus: 'no_face' }],
    })
    const lines = prompt.split('\n')
    expect(lines[0]).toBe('把手里的饮料换成我的产品')
    expect(prompt).toContain('任务:同款翻拍')
    expect(prompt).toContain('保留源视频的镜头顺序、时长节奏、运镜方式、场景与光线')
    expect(prompt).toContain('将源视频中的主体产品替换为参考图中的产品')
    expect(prompt).toContain('颜色、形状、比例、品牌标识、材质与可动部件不得改变')
    expect(prompt).toContain('手持、拿起、递出或操作产品')
    expect(prompt).not.toContain('多张参考图')
    expect(prompt).not.toContain('人物')
    expect(prompt.endsWith(NO_SOURCE_OVERLAY_REQUIREMENT)).toBe(true)
  })

  it('精准复刻:要求 1:1 还原,参考图只用于统一外观而不改构图', () => {
    const prompt = buildHotCopyReplicatePrompt({ tab: 'replica', products: [{}] })
    expect(prompt).toContain('任务:精准复刻')
    expect(prompt).toContain('1:1 还原')
    expect(prompt).toContain('参考图仅用于统一画面中产品的外观,不改变源视频的构图与动作')
    expect(prompt).not.toContain('替换为参考图')
  })

  it('参考图检测到人脸时按换人措辞,锁定面部与服装而不是产品外观', () => {
    const prompt = buildHotCopyReplicatePrompt({
      tab: 'remake',
      products: [{ faceCheckStatus: 'blurred' }],
    })
    expect(prompt).toContain('将源视频中的主体人物替换为参考图中的人物')
    expect(prompt).toContain('面部特征、发型、体型与服装一致')
    expect(prompt).not.toContain('品牌标识')
  })

  it('多张参考图时说明它们是同一主体的不同角度;视频素材不计入张数', () => {
    const prompt = buildHotCopyReplicatePrompt({
      tab: 'remake',
      products: [{}, {}, { isVideo: true }],
    })
    expect(prompt).toContain('多张参考图为同一产品的不同角度')
    expect(buildHotCopyReplicatePrompt({ tab: 'remake', products: [{}, { isVideo: true }] })).not.toContain(
      '多张参考图',
    )
  })

  it('没有参考图时不出现外观锁定与手部约束,但仍有保留结构的正向指令', () => {
    const prompt = buildHotCopyReplicatePrompt({ tab: 'remake' })
    expect(prompt).toContain('任务:同款翻拍')
    expect(prompt).toContain('保留源视频的爆点结构与主体')
    expect(prompt).not.toContain('参考图')
    expect(prompt).not.toContain('手持')
  })

  it('音频开关:关则不出声,开则允许配音与配乐且不禁人声,不传则不提音频', () => {
    expect(buildHotCopyReplicatePrompt({ tab: 'remake', generateAudio: false })).toContain(
      '不要生成任何人声、旁白与背景音乐',
    )
    const withAudio = buildHotCopyReplicatePrompt({ tab: 'remake', generateAudio: true })
    expect(withAudio).toContain('可生成与画面内容匹配的配音与背景音乐')
    // 曾写「不复刻源视频中的人声」，结果模型连自己生成配音也停了；开音频时不得出现任何禁人声措辞
    expect(withAudio).not.toContain('不复刻源视频中的人声')
    expect(withAudio).not.toMatch(/不要生成.*人声/)
    const silent = buildHotCopyReplicatePrompt({ tab: 'remake' })
    expect(silent).not.toContain('人声')
    expect(silent).not.toContain('背景音乐')
    expect(silent).not.toContain('配音')
  })

  it('禁复刻贴字约束在正文里只出现一次,guard 不会重复追加', () => {
    const prompt = buildHotCopyReplicatePrompt({ tab: 'remake', products: [{}] })
    expect(prompt.split(NO_SOURCE_OVERLAY_REQUIREMENT).length - 1).toBe(1)
    expect(withNoSourceOverlayGuard(prompt)).toBe(prompt)
    expect(withNoSourceOverlayGuard('随便一句')).toBe(`随便一句\n${NO_SOURCE_OVERLAY_REQUIREMENT}`)
    expect(withNoSourceOverlayGuard('')).toBe(NO_SOURCE_OVERLAY_REQUIREMENT)
  })
})
