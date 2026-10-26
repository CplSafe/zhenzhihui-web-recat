import { describe, expect, it } from 'vitest'
import { parseCanvasScriptImport } from '@/utils/canvasScriptImport'

describe('canvas script import', () => {
  it('保留文本和换行，不调用生成', () => {
    expect(parseCanvasScriptImport('\uFEFF 开场\n\n正文 ', 'text')).toEqual({
      title: '导入文本',
      text: '开场\n\n正文',
      shotCount: 0,
    })
  })
  it.each(['', ' '.repeat(3)])('拒绝空内容 %s', (value) =>
    expect(() => parseCanvasScriptImport(value, 'text')).toThrow('请先'),
  )
  it('限制文本长度', () => expect(() => parseCanvasScriptImport('文'.repeat(50001), 'text')).toThrow('50,000'))
  it.each(['storyboard', 'shots', 'scenes'])('读取 %s 容器并规范化别名', (key) => {
    const result = parseCanvasScriptImport(
      JSON.stringify({ [key]: [{ name: '开场', description: '人在走动', seconds: 4, camera: '推进' }] }),
      'storyboard',
    )
    expect(result.shotCount).toBe(1)
    expect(JSON.parse(result.text)).toEqual([{ title: '开场', prompt: '人在走动', duration: '4', shot: '推进' }])
  })
  it('读取镜头数组', () => expect(parseCanvasScriptImport('[{"prompt":"人物出现"}]', 'storyboard').shotCount).toBe(1))
  it.each(['[]', '{}', 'null', '"text"'])('拒绝非镜头结构 %s', (value) =>
    expect(() => parseCanvasScriptImport(value, 'storyboard')).toThrow('非空镜头数组'),
  )
  it('拒绝非法 JSON', () => expect(() => parseCanvasScriptImport('[oops', 'storyboard')).toThrow('JSON 格式'))
  it('任何无效镜头均阻止整份导入，不静默丢失', () => {
    expect(() => parseCanvasScriptImport('[{"prompt":"有效"},{"title":"缺描述"}]', 'storyboard')).toThrow('镜头 2')
    expect(() => parseCanvasScriptImport('[null]', 'storyboard')).toThrow('镜头 1')
  })
  it('限制镜头数量', () =>
    expect(() =>
      parseCanvasScriptImport(JSON.stringify(Array.from({ length: 101 }, () => ({ prompt: '画面' }))), 'storyboard'),
    ).toThrow('100 个镜头'))
})
