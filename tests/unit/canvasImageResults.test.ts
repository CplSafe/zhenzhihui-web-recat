import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  canvasImageResultIds,
  canvasImageResultSize,
  selectCanvasImageResult,
  splitCanvasImageResults,
  updateCanvasImageResultNode,
} from '@/utils/canvasImageResults'
import {
  collectCanvasSourceRefs,
  nodeToMutation,
  elementsToGraph,
  collectCanvasElementAssetIds,
} from '@/utils/canvasElements'
import { saveCanvasDraft, loadCanvasDraft } from '@/utils/canvasDraft'

const node = (): Node => ({
  id: 'group',
  type: 'image',
  position: { x: 50, y: 60 },
  data: {
    kind: 'image',
    ratio: '16:9',
    assetId: 11,
    imageResultAssetIds: [11, 12, 13, 14],
    imageResultsExpanded: false,
    taskId: 7,
    taskStatus: 'succeeded',
  },
})

describe('canvas image results', () => {
  it('round-trips the complete batch, primary selection and expanded state through cloud and draft storage', () => {
    const chosen = updateCanvasImageResultNode(selectCanvasImageResult(node(), 13, 1), { imageResultsExpanded: true })
    const mutation = nodeToMutation(chosen)
    const restored = elementsToGraph([mutation]).nodes[0]!
    expect(restored.data).toMatchObject({
      assetId: 13,
      imageResultAssetIds: [11, 12, 13, 14],
      imageResultsExpanded: true,
    })
    expect([...collectCanvasElementAssetIds([mutation])]).toEqual(expect.arrayContaining([11, 12, 13, 14]))
    saveCanvasDraft([chosen], [], 'image-group-test')
    expect(loadCanvasDraft('image-group-test')!.nodes[0]!.data).toMatchObject(restored.data)
  })
  it('uses only the selected primary as the input of an outgoing edge', () => {
    const chosen = selectCanvasImageResult(node(), 14, 1)
    const refs = collectCanvasSourceRefs(
      'next',
      [chosen, { id: 'next', type: 'image', data: { kind: 'image' } }],
      [{ id: 'edge', source: 'group', target: 'next' }],
    )
    expect(refs).toHaveLength(1)
    expect(refs[0]!.assetId).toBe(14)
  })
  it.each([2, 3, 4, 10])('expands %i images as two columns and collapses to the original footprint', (count) => {
    const data = { ...node().data, imageResultAssetIds: Array.from({ length: count }, (_, i) => 11 + i) }
    const single = canvasImageResultSize(data)
    const expanded = canvasImageResultSize({ ...data, imageResultsExpanded: true })
    expect(expanded.width).toBe(single.width * 2 + 12)
    expect(expanded.height).toBe(single.height * Math.ceil(count / 2) + 12 * (Math.ceil(count / 2) - 1))
    expect(canvasImageResultSize({ ...data, imageResultsExpanded: false })).toEqual(single)
  })
  it('splits without losing assets, preserving the original primary node id for existing edges', () => {
    let index = 0
    const source = selectCanvasImageResult(node(), 13, 1)
    const nodes = splitCanvasImageResults(source, 1, () => `new-${++index}`)
    expect(nodes.map((n) => n.data.assetId)).toEqual([13, 11, 12, 14])
    expect(nodes[0]!.id).toBe('group')
    expect(new Set(nodes.map((n) => `${n.position.x},${n.position.y}`)).size).toBe(4)
    expect(nodes.every((n) => !n.data.imageResultsExpanded && canvasImageResultIds(n.data).length === 0)).toBe(true)
    expect(source.data.imageResultAssetIds).toEqual([11, 12, 13, 14])
  })
  it('does not revive an old group after replacing its primary with an unrelated asset', () => {
    expect(canvasImageResultIds({ ...node().data, assetId: 99 })).toEqual([])
    expect(selectCanvasImageResult(node(), 99, 1).data.assetId).toBe(11)
    expect(canvasImageResultIds({ assetId: 11, imageResultAssetIds: [11, 11, 0, -1, 'x', 12] })).toEqual([11, 12])
  })
})
