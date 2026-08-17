import { describe, expect, it } from 'vitest'
import { resolveInheritedNodeRatio } from '@/utils/canvasNodeDefaults'

const node = (kind: string, ratio?: string) => ({ type: kind, data: { kind, ...(ratio ? { ratio } : {}) } })

describe('resolveInheritedNodeRatio', () => {
  it('inherits from the most recent node of the same kind', () => {
    const nodes = [node('video', '16:9'), node('image', '1:1'), node('video', '9:16')]
    expect(resolveInheritedNodeRatio(nodes, 'video', 'auto')).toBe('9:16')
    expect(resolveInheritedNodeRatio(nodes, 'image', '1:1')).toBe('1:1')
  })

  it('does not borrow a ratio across node kinds', () => {
    // 图片节点是 1:1，视频节点不该继承它
    expect(resolveInheritedNodeRatio([node('image', '1:1')], 'video', 'auto')).toBe('auto')
  })

  it('skips nodes that never had a ratio and keeps looking further back', () => {
    const nodes = [node('video', '9:16'), node('video')]
    expect(resolveInheritedNodeRatio(nodes, 'video', 'auto')).toBe('9:16')
  })

  it('falls back when the canvas has no node of that kind yet', () => {
    expect(resolveInheritedNodeRatio([node('text')], 'video', 'auto')).toBe('auto')
    expect(resolveInheritedNodeRatio([], 'video', 'auto')).toBe('auto')
    expect(resolveInheritedNodeRatio(undefined, 'video', 'auto')).toBe('auto')
  })

  it('reads the kind from node.type when data.kind is absent', () => {
    expect(resolveInheritedNodeRatio([{ type: 'video', data: { ratio: '4:3' } }], 'video', 'auto')).toBe('4:3')
  })

  it('returns the fallback for a blank kind instead of matching anything', () => {
    expect(resolveInheritedNodeRatio([node('video', '16:9')], '', 'auto')).toBe('auto')
  })
})
