import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  buildEdgeId,
  comparableEdge,
  comparableNode,
  diffCanvasMutations,
  elementsToGraph,
  nodeToMutation,
} from '@/utils/canvasElements'

describe('canvasElements', () => {
  it('builds stable edge ids', () => {
    expect(buildEdgeId('source-node', 'target-node', 2)).toBe('e-source-node-target-node-2')
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
})
