import { describe, expect, it } from 'vitest'
import { parseSubmittedIdea } from '@/utils/parseSubmittedIdea'

describe('申请正文展示', () => {
  it('拆分当前提交格式，保留换行和可选字段', () => {
    expect(
      parseSubmittedIdea(
        '剧名：血月\n\n题材：悬疑\n\n剧情第一段\n第二段\n\n第一集剧本剧情：\n场景一\n\n人物、身份、性格：\n小林',
      ),
    ).toEqual({ title: '血月', genre: '悬疑', synopsis: '剧情第一段\n第二段', plot: '场景一', characters: '小林' })
    expect(parseSubmittedIdea('剧名：故事\n\n题材：都市\n\n简介\n\n人物、身份、性格：\n角色')?.characters).toBe('角色')
  })
  it('兼容无可选字段和只有第一集剧情的正文', () => {
    expect(parseSubmittedIdea('剧名：剧\n\n题材：题\n\n简介')).toEqual({
      title: '剧',
      genre: '题',
      synopsis: '简介',
      plot: '',
      characters: '',
    })
    expect(parseSubmittedIdea('剧名：剧\n\n题材：题\n\n简介\n\n第一集剧本剧情：\n场景')?.plot).toBe('场景')
  })
  it('未知或异常结构不进行推测，保留原文展示', () => {
    expect(parseSubmittedIdea('历史申请正文')).toBeNull()
    expect(
      parseSubmittedIdea('剧名：剧\n\n题材：题\n\n正文\n\n人物、身份、性格：\n人\n\n第一集剧本剧情：\n场'),
    ).toBeNull()
  })
})
