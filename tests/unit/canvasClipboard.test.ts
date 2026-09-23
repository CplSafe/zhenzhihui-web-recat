import { describe, expect, it } from 'vitest'
import { copyCanvasNodes, materializeCanvasClipboard } from '@/utils/canvasClipboard'

const runtimeKeys = new Set(['taskId', 'taskStatus'])

const nodes = [
  {
    id: 'img-1',
    type: 'default',
    position: { x: 100, y: 100 },
    data: { kind: 'image', prompt: '海边', taskId: 9, taskStatus: 'running', groupId: 'g1', groupName: '组' },
    style: { width: 250, height: 250 },
  },
  {
    id: 'vid-1',
    type: 'default',
    position: { x: 500, y: 140 },
    data: { kind: 'video', prompt: '奔跑' },
    style: { width: 444, height: 250 },
  },
  { id: 'txt-9', type: 'default', position: { x: 0, y: 0 }, data: { kind: 'text' } },
]

const edges = [
  {
    source: 'img-1',
    target: 'vid-1',
    sourceHandle: 'img-1-right-source',
    targetHandle: 'vid-1-left-target',
    data: { slotIndex: 0, role: 'reference_image' },
  },
  { source: 'txt-9', target: 'img-1', sourceHandle: null, targetHandle: null, data: { slotIndex: 0 } },
]

describe('copyCanvasNodes', () => {
  it('只打包选中的节点与它们之间的连线，剥掉运行态与分组', () => {
    const payload = copyCanvasNodes({ nodes, edges, selectedIds: ['img-1', 'vid-1'], runtimeKeys })
    expect(payload).not.toBeNull()
    expect(payload!.nodes.map((node) => node.id)).toEqual(['img-1', 'vid-1'])
    expect(payload!.nodes[0].data).toEqual({ kind: 'image', prompt: '海边' })
    // 相对包围盒左上角 (100, 100)
    expect(payload!.nodes[1]).toMatchObject({ dx: 400, dy: 40 })
    expect(payload!.edges).toHaveLength(1)
    expect(payload!.width).toBe(500 + 444 - 100)
  })

  it('文本节点正文从外部读取并随节点带走', () => {
    const payload = copyCanvasNodes({
      nodes,
      edges,
      selectedIds: ['txt-9'],
      runtimeKeys,
      readText: (id) => (id === 'txt-9' ? '开场白' : undefined),
    })
    expect(payload!.nodes[0].text).toBe('开场白')
  })

  it('没选中任何节点返回 null', () => {
    expect(copyCanvasNodes({ nodes, edges, selectedIds: [], runtimeKeys })).toBeNull()
  })
})

describe('materializeCanvasClipboard', () => {
  it('换上新 id、按落点摆放，连线与 handle 里的旧 id 一并替换', () => {
    const payload = copyCanvasNodes({ nodes, edges, selectedIds: ['img-1', 'vid-1'], runtimeKeys })!
    let seq = 0
    const result = materializeCanvasClipboard(payload, {
      origin: { x: 1000, y: 2000 },
      createNodeId: (kind) => `${kind}-new-${++seq}`,
      buildEdgeId: (source, target, slot) => `e-${source}-${target}-${slot}`,
    })
    expect(result.nodes.map((node) => node.id)).toEqual(['image-new-1', 'video-new-2'])
    expect(result.nodes[0].position).toEqual({ x: 1000, y: 2000 })
    expect(result.nodes[1].position).toEqual({ x: 1400, y: 2040 })
    expect(result.nodes.every((node) => node.selected)).toBe(true)
    expect(result.edges).toEqual([
      {
        id: 'e-image-new-1-video-new-2-0',
        source: 'image-new-1',
        target: 'video-new-2',
        sourceHandle: 'image-new-1-right-source',
        targetHandle: 'video-new-2-left-target',
        data: { slotIndex: 0, role: 'reference_image' },
      },
    ])
  })

  it('文本正文映射到新 id 上', () => {
    const payload = copyCanvasNodes({ nodes, edges, selectedIds: ['txt-9'], runtimeKeys, readText: () => '正文' })!
    const result = materializeCanvasClipboard(payload, {
      origin: { x: 0, y: 0 },
      createNodeId: () => 'text-new',
      buildEdgeId: () => 'e',
    })
    expect(result.textContents).toEqual({ 'text-new': '正文' })
  })
})
