import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  buildEdgeId,
  applyCanvasElementMutations,
  comparableEdge,
  comparableNode,
  collectCanvasSourceRefs,
  diffCanvasMutations,
  elementsToGraph,
  nodeToMutation,
} from '@/utils/canvasElements'

describe('canvasElements', () => {
  it('builds stable edge ids', () => {
    expect(buildEdgeId('source-node', 'target-node', 2)).toBe('e-source-node-target-node-2')
  })

  it('keeps image assets across an image -> text -> image chain', () => {
    const nodes = [
      {
        id: 'reference-image',
        type: 'image',
        position: { x: 0, y: 0 },
        data: { kind: 'image', assetId: 88, resultUrl: 'https://example.com/reference.png' },
      },
      { id: 'prompt-text', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text' } },
      { id: 'generated-image', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image' } },
    ] as Node[]
    const edges = [
      { id: 'image-to-text', source: 'reference-image', target: 'prompt-text', data: { slotIndex: 0 } },
      { id: 'text-to-image', source: 'prompt-text', target: 'generated-image', data: { slotIndex: 0 } },
    ] as Edge[]

    expect(collectCanvasSourceRefs('generated-image', nodes, edges)).toEqual([
      expect.objectContaining({ kind: 'text', sourceId: 'prompt-text', edgeId: 'text-to-image' }),
      expect.objectContaining({
        kind: 'image',
        sourceId: 'reference-image',
        edgeId: 'image-to-text',
        assetId: 88,
        inherited: true,
        role: 'reference_image',
      }),
    ])
  })

  it('restores first and last frame connection purposes from target mode', () => {
    const nodes = [
      { id: 'first', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', assetId: 1 } },
      { id: 'last', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', assetId: 2 } },
      {
        id: 'video',
        type: 'video',
        position: { x: 0, y: 0 },
        data: { kind: 'video', videoMode: 'first-last' },
      },
    ] as Node[]
    const edges = [
      { id: 'first-edge', source: 'first', target: 'video', data: { slotIndex: 0 } },
      { id: 'last-edge', source: 'last', target: 'video', data: { slotIndex: 1 } },
    ] as Edge[]

    expect(collectCanvasSourceRefs('video', nodes, edges)).toEqual([
      expect.objectContaining({ sourceId: 'first', role: 'first_frame' }),
      expect.objectContaining({ sourceId: 'last', role: 'last_frame' }),
    ])
  })

  it('deduplicates inherited assets and stops cyclic canvas links', () => {
    const nodes = [
      { id: 'image', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', assetId: 9 } },
      { id: 'text-a', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text' } },
      { id: 'text-b', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text' } },
      { id: 'target', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image' } },
    ] as Node[]
    const edges = [
      { id: 'image-a', source: 'image', target: 'text-a' },
      { id: 'image-b', source: 'image', target: 'text-b' },
      { id: 'a-b', source: 'text-a', target: 'text-b' },
      { id: 'b-a', source: 'text-b', target: 'text-a' },
      { id: 'b-target', source: 'text-b', target: 'target' },
    ] as Edge[]

    const refs = collectCanvasSourceRefs('target', nodes, edges)
    expect(refs.filter((ref) => ref.assetId === 9)).toHaveLength(1)
  })

  it('serializes persistent node data and text content', () => {
    const node = {
      id: 'node-1',
      type: 'text',
      position: { x: 12, y: 24 },
      selected: true,
      data: {
        kind: 'text',
        prompt: 'keep this',
        resultUrl: 'https://example.com/result.png',
        runtimeOnly: 'drop this',
      },
    } as Node

    expect(nodeToMutation(node, new Map([['node-1', 'canvas copy']]))).toEqual({
      element_id: 'node-1',
      kind: 'node',
      op: 'upsert',
      payload: {
        id: 'node-1',
        type: 'text',
        position: { x: 12, y: 24 },
        data: {
          kind: 'text',
          prompt: 'keep this',
          resultUrl: 'https://example.com/result.png',
          text: 'canvas copy',
        },
      },
    })
  })

  it('restores active graph elements and ignores tombstones or invalid records', () => {
    const graph = elementsToGraph([
      {
        element_id: 'node-1',
        kind: 'node',
        op: 'upsert',
        payload: { type: 'image', position: { x: 1, y: 2 }, data: { kind: 'image' } },
      },
      {
        element_id: 'edge-1',
        kind: 'edge',
        op: 'upsert',
        payload: { source: 'node-1', target: 'node-2' },
      },
      { element_id: 'deleted', kind: 'node', op: 'delete', payload: {} },
      { element_id: 'invalid-edge', kind: 'edge', op: 'upsert', payload: { source: 'node-1' } },
    ])

    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]).toMatchObject({ id: 'node-1', type: 'image', position: { x: 1, y: 2 } })
    expect(graph.edges).toEqual([{ id: 'edge-1', source: 'node-1', target: 'node-2' }])
  })

  it('emits changed upserts and removed tombstones only', () => {
    const unchanged = {
      id: 'node-1',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { kind: 'text' },
    } as Node
    const changed = {
      id: 'node-2',
      type: 'image',
      position: { x: 20, y: 30 },
      data: { kind: 'image', prompt: 'new prompt' },
    } as Node
    const currentEdge = { id: 'edge-new', source: 'node-1', target: 'node-2' } as Edge

    const mutations = diffCanvasMutations(
      {
        nodes: [
          comparableNode(unchanged),
          {
            id: 'node-2',
            type: 'image',
            position: { x: 10, y: 10 },
            data: { kind: 'image' },
          },
          { id: 'node-removed', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text' } },
        ],
        edges: [comparableEdge({ id: 'edge-removed', source: 'node-1', target: 'node-removed' } as Edge)],
      },
      { nodes: [unchanged, changed], edges: [currentEdge] },
    )

    expect(mutations.map(({ element_id, op }) => [element_id, op])).toEqual([
      ['node-2', 'upsert'],
      ['node-removed', 'delete'],
      ['edge-new', 'upsert'],
      ['edge-removed', 'delete'],
    ])
  })

  it('applies incremental updates without dropping untouched elements', () => {
    const current = {
      nodes: [
        { id: 'keep', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text' } } as Node,
        { id: 'remove', type: 'image', position: { x: 1, y: 1 }, data: { kind: 'image' } } as Node,
      ],
      edges: [{ id: 'linked', source: 'keep', target: 'remove' } as Edge],
    }
    const result = applyCanvasElementMutations(current, [
      { element_id: 'remove', kind: 'node', op: 'delete', payload: {} },
      {
        element_id: 'new',
        kind: 'node',
        op: 'upsert',
        payload: { type: 'video', position: { x: 8, y: 9 }, data: { kind: 'video' } },
      },
    ])

    expect(result.nodes.map((node) => node.id)).toEqual(['keep', 'new'])
    expect(result.edges).toEqual([])
  })
})
