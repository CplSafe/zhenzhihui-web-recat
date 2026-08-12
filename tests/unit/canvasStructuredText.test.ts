import { describe, expect, it } from 'vitest'
import { parseCanvasStructuredText, toCanvasPromptContext } from '@/utils/canvasStructuredText'

describe('parseCanvasStructuredText', () => {
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
