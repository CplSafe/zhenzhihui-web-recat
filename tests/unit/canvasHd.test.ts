import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { HdItem, HdQuote, HdTask } from '@/api/canvasHd'
import {
  hdSources,
  hdTargets,
  isHdActive,
  materializeHdResults,
  validateHdPreflight,
  validateHdQuote,
} from '@/utils/canvasHd'
import { collectCanvasSourceRefs, nodeToMutation } from '@/utils/canvasElements'

const item: HdItem = {
  node_id: 'source',
  asset_id: 10,
  kind: 'video',
  name: '镜头.mp4',
  eligible: true,
  source_spec: '480P · 24fps',
  resolutions: ['720P', '1080P', '2K'],
  frame_rates: [30, 60, 90],
}
const quote: HdQuote = {
  quote_id: 'quote-1',
  expires_at: '2099-01-01',
  items: [{ node_id: 'source', asset_id: 10, credits: 12 }],
  total_credits: 12,
  balance: 100,
  can_afford: true,
}
const target = { resolution: '1080P', fps: 60 }
const source: Node = {
  id: 'source',
  type: 'video',
  position: { x: 100, y: 100 },
  style: { width: 320, height: 260 },
  data: { kind: 'video', assetId: 10, title: '镜头.mp4' },
  selected: true,
}
const task: HdTask = {
  id: 'HD-1',
  workspace_id: 21,
  canvas_id: 3,
  canvas_name: '第一集',
  source: item,
  source_spec: item.source_spec,
  target,
  status: 'completed',
  submitted_at: '2026-10-20',
  credits: 12,
  refund_status: 'none',
  refunded_credits: 0,
  result: {
    asset_id: 20,
    name: '镜头-HD.mp4',
    spec: '1080P · 60fps',
    width: 1920,
    height: 1080,
    review_policy: 'reuse_source',
  },
}

describe('canvasHd', () => {
  it('maps images, videos and rendered timelines without accepting text/audio as media', () => {
    const nodes = ['image', 'video', 'timeline', 'audio', 'text'].map((kind) => ({
      ...source,
      id: kind,
      data: { kind, assetId: kind === 'timeline' ? 0 : 10 },
    }))
    expect(hdSources(nodes).map((row) => [row.node_id, row.kind, row.asset_id])).toEqual([
      ['image', 'image', 10],
      ['video', 'video', 10],
      ['timeline', 'video', 0],
    ])
    expect(hdSources([{ ...source, data: { kind: 'image', title: '图' } }])[0]).toMatchObject({
      name: '图',
      asset_id: 0,
    })
  })
  it('requires exactly one server preflight result per input and preserves the source snapshot', () => {
    expect(validateHdPreflight([item], [{ ...item, name: '错误名字' }])[0].name).toBe(item.name)
    expect(() => validateHdPreflight([item], [])).toThrow('不完整')
    expect(() => validateHdPreflight([item], [{ ...item, asset_id: 99 }])).toThrow('不完整')
    expect(() => validateHdPreflight([item], [{ ...item, resolutions: null } as HdItem])).toThrow('不完整')
  })
  it('uses common supported targets, excludes skipped items and never enables 30fps', () => {
    expect(
      hdTargets([
        item,
        { ...item, resolutions: ['1080P', '2K'], frame_rates: [90] },
        { ...item, eligible: false, resolutions: [] },
      ]),
    ).toEqual({ resolutions: ['1080P', '2K'], frameRates: [90] })
    expect(hdTargets([])).toEqual({ resolutions: [], frameRates: [] })
    expect(hdTargets([{ ...item, eligible: false }]).resolutions).toEqual([])
  })
  it('accepts only fresh, complete, internally consistent quotes for the selected targets', () => {
    expect(validateHdQuote(quote, [item], target)).toBe(true)
    expect(validateHdQuote(quote, [item], { resolution: '720P', fps: 0 })).toBe(true)
    for (const patch of [
      { quote_id: '' },
      { expires_at: '2000-01-01' },
      { balance: NaN },
      { balance: -1 },
      { total_credits: -1 },
      { total_credits: 13 },
      { items: [] },
      { items: [{ ...quote.items[0], asset_id: 11 }] },
      { items: [{ ...quote.items[0], credits: NaN }] },
    ])
      expect(validateHdQuote({ ...quote, ...patch }, [item], target)).toBe(false)
    expect(validateHdQuote(quote, [], target)).toBe(false)
    expect(validateHdQuote(quote, [item], { ...target, resolution: '4K' })).toBe(false)
    expect(validateHdQuote(quote, [item], { ...target, fps: 30 })).toBe(false)
  })
  it('creates a separate persistent result and a non-input provenance edge exactly once', () => {
    const timeline: Node = {
      id: 'timeline',
      position: { x: 600, y: 0 },
      data: { kind: 'timeline', timeline: { clips: [{ assetId: 10, sourceNodeId: 'source' }] } },
    }
    const result = materializeHdResults([source, timeline], [], [task], 21, 3)
    expect(result.changed).toBe(true)
    expect(result.nodes[0]).toBe(source)
    expect(result.nodes[1]).toBe(timeline)
    expect(source.selected).toBe(true)
    const hd = result.nodes[2]
    expect(hd.data).toMatchObject({ assetId: 20, title: '镜头-HD.mp4', hd: { sourceAssetId: 10, taskId: 'HD-1' } })
    expect(hd.position.y).toBeGreaterThan(source.position.y)
    expect(collectCanvasSourceRefs(hd.id, result.nodes, result.edges)).toEqual([])
    expect(nodeToMutation(hd).payload?.data).toMatchObject({ hd: { taskId: 'HD-1' } })
    expect(JSON.stringify(nodeToMutation(hd))).not.toContain('Signature=')
    expect(materializeHdResults(result.nodes, result.edges, [task], 21, 3).changed).toBe(false)
    expect(
      materializeHdResults(
        result.nodes,
        result.edges,
        [{ ...task, id: 'HD-2', result: { ...task.result!, asset_id: 21 } }],
        21,
        3,
      ).nodes,
    ).toHaveLength(4)
  })
  it('ignores other workspaces/canvases, nonterminal tasks, missing assets and deleted sources', () => {
    for (const value of [
      { ...task, workspace_id: 22 },
      { ...task, canvas_id: 4 },
      { ...task, status: 'queued' as const },
      { ...task, result: undefined },
      { ...task, result: { ...task.result!, asset_id: 0 } },
    ])
      expect(materializeHdResults([source], [], [value], 21, 3).changed).toBe(false)
    expect(materializeHdResults([], [], [task], 21, 3).changed).toBe(false)
    expect(
      materializeHdResults([source], [], [{ ...task, result: { ...task.result!, canvas_delivery: 'removed' } }], 21, 3)
        .changed,
    ).toBe(false)
    expect(materializeHdResults([source], [], [task], 21, 3, new Set([task.id])).changed).toBe(false)
    expect(isHdActive({ ...task, status: 'queued' })).toBe(true)
    expect(isHdActive({ ...task, status: 'processing' })).toBe(true)
    expect(isHdActive(task)).toBe(false)
  })
})
