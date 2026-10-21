import { describe, expect, it } from 'vitest'
import {
  buildCanvasStoryboardPrompt,
  isCanvasStoryboardText,
  parseCanvasStructuredText,
  toCanvasPromptContext,
} from '@/utils/canvasStructuredText'

describe('parseCanvasStructuredText', () => {
  it('生成请求明确分镜字段契约，并保留原始需求', () => {
    const prompt = buildCanvasStoryboardPrompt(' 五秒咖啡广告 ')
    expect(prompt).toContain('title、prompt、duration、shot')
    expect(prompt).toContain('用户需求：\n五秒咖啡广告')
  })

  it('编辑时清空一个镜头不丢失卡片，但不能被当作有效生成结果', () => {
    const text = '[{"title":"开场","prompt":""}]'
    expect(parseCanvasStructuredText(text)).toMatchObject({
      kind: 'storyboard',
      items: [{ title: '开场', prompt: '' }],
    })
    expect(isCanvasStoryboardText(text)).toBe(false)
    expect(isCanvasStoryboardText('不是分镜')).toBe(false)
  })
  it('parses marked storyboard arrays', () => {
    const result = parseCanvasStructuredText(
      '<<<STORYBOARD_JSON>>>\n[{"title":"开场","prompt":"球员冲向篮筐","duration":3}]',
    )

    expect(result).toEqual({
      kind: 'storyboard',
      items: [{ title: '开场', prompt: '球员冲向篮筐', duration: '3', shot: '' }],
    })
  })

  it('supports storyboard wrapper objects and alternate field names', () => {
    const result = parseCanvasStructuredText(
      '```json\n{"shots":[{"name":"特写","description":"篮球入网","camera":"慢动作"}]}\n```',
    )

    expect(result.kind).toBe('storyboard')
    if (result.kind === 'storyboard') {
      expect(result.items[0]).toMatchObject({ title: '特写', prompt: '篮球入网', shot: '慢动作' })
    }
  })

  it('supports the script API shots[].desc response shape', () => {
    const text = JSON.stringify({
      shots: [
        {
          duration: '3s',
          desc: '篮球运动员从三分线起步，镜头平稳跟拍。',
          voiceover: '',
          subtitle: '',
          sfx: '球鞋摩擦地板声',
          subjects: [{ name: '篮球运动员', kind: '人物' }],
        },
      ],
    })

    expect(parseCanvasStructuredText(text)).toMatchObject({
      kind: 'storyboard',
      items: [{ title: '镜头 1', prompt: '篮球运动员从三分线起步，镜头平稳跟拍。', duration: '3s' }],
    })
    expect(isCanvasStoryboardText(text)).toBe(true)
  })

  it('falls back to readable plain text when JSON is incomplete', () => {
    expect(parseCanvasStructuredText('<<<STORYBOARD_JSON>>>\n[{"title":"开场"')).toEqual({
      kind: 'plain',
      text: '[{"title":"开场"',
    })
  })

  it('removes the storyboard protocol before using text as downstream context', () => {
    const context = toCanvasPromptContext(
      '<<<STORYBOARD_JSON>>>\n[{"title":"开场","prompt":"球员冲向篮筐","duration":3,"shot":"推进"}]',
    )

    expect(context).toBe('1. 开场（时长 3，镜头 推进）\n球员冲向篮筐')
    expect(context).not.toContain('STORYBOARD_JSON')
    expect(context).not.toContain('"prompt"')
  })
})
