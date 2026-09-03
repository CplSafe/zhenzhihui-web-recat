import { describe, expect, it } from 'vitest'
import {
  CANVAS_TITLE_SUMMARY_MAX,
  deriveCanvasNodeSummary,
  getCanvasKindLabel,
  resolveCanvasNodeTitle,
} from '@/utils/canvasNodeTitle'
import { pickPersistedNodeData } from '@/utils/canvasElements'

describe('getCanvasKindLabel', () => {
  it('maps known kinds to Chinese labels', () => {
    expect(getCanvasKindLabel('image')).toBe('图片')
    expect(getCanvasKindLabel('timeline')).toBe('视频剪辑')
  })

  it('echoes unknown kinds so bad data stays visible instead of blank', () => {
    expect(getCanvasKindLabel('sticker')).toBe('sticker')
  })
})

describe('resolveCanvasNodeTitle', () => {
  it('always prefers a user-supplied name over any derived summary', () => {
    const title = resolveCanvasNodeTitle({
      kind: 'image',
      title: '主角定妆照',
      prompt: '一个站在走廊里的少年',
    })
    expect(title).toBe('主角定妆照')
  })

  it('falls back to the bare type label when there is nothing to summarize', () => {
    expect(resolveCanvasNodeTitle({ kind: 'image' })).toBe('图片')
  })

  it('combines type label and prompt summary when unnamed', () => {
    expect(resolveCanvasNodeTitle({ kind: 'image', prompt: '夜晚的教学楼走廊' })).toBe('图片 · 夜晚的教学楼走廊')
  })

  it('ignores a whitespace-only custom title rather than rendering an empty header', () => {
    expect(resolveCanvasNodeTitle({ kind: 'video', title: '   ' })).toBe('视频')
  })
})

describe('deriveCanvasNodeSummary', () => {
  it('collapses newlines so the header stays a single line', () => {
    expect(deriveCanvasNodeSummary({ kind: 'image', prompt: '走廊\n  夜晚' })).toBe('走廊 夜晚')
  })

  it('truncates long prompts with an ellipsis', () => {
    const prompt = '一'.repeat(50)
    const summary = deriveCanvasNodeSummary({ kind: 'image', prompt })
    expect(summary).toHaveLength(CANVAS_TITLE_SUMMARY_MAX + 1)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('identifies real-person nodes by their person name', () => {
    expect(deriveCanvasNodeSummary({ kind: 'image', realPerson: { name: '林小满' }, prompt: '一个少年' })).toBe(
      '林小满',
    )
  })

  it('falls back to a generic real-person label when the name is missing', () => {
    expect(deriveCanvasNodeSummary({ kind: 'image', assetSource: 'real_person' })).toBe('真人素材')
  })

  it('counts clips for timeline nodes that have no prompt', () => {
    const timeline = { clips: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    expect(deriveCanvasNodeSummary({ kind: 'timeline', timeline })).toBe('3 个片段')
  })

  it('returns empty for an empty timeline so the header shows just the type', () => {
    expect(resolveCanvasNodeTitle({ kind: 'timeline', timeline: { clips: [] } })).toBe('视频剪辑')
  })

  it('summarizes plain text nodes from their body', () => {
    expect(deriveCanvasNodeSummary({ kind: 'text', text: '这是一段旁白' })).toBe('这是一段旁白')
  })

  it('tolerates malformed timeline data instead of throwing', () => {
    expect(deriveCanvasNodeSummary({ kind: 'timeline', timeline: 'nonsense' })).toBe('')
    expect(deriveCanvasNodeSummary({ kind: 'image', realPerson: 'nonsense' })).toBe('')
  })
})

describe('title persistence', () => {
  it('keeps a custom title through the persisted-field whitelist', () => {
    // 白名单漏掉 title 会让改名在刷新后静默丢失
    expect(pickPersistedNodeData({ kind: 'image', title: '主角定妆照' })).toMatchObject({
      kind: 'image',
      title: '主角定妆照',
    })
  })

  it('omits the title field entirely when the node was never renamed', () => {
    expect(pickPersistedNodeData({ kind: 'image' })).not.toHaveProperty('title')
  })
})
