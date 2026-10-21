import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import {
  collectCanvasSourceRefs,
  nodeToMutation,
  elementsToGraph,
  collectCanvasElementAssetIds,
} from '@/utils/canvasElements'

const source: Node = {
  id: 'source',
  position: { x: 0, y: 0 },
  data: { kind: 'image', assetId: 10, assetSource: 'upload', assetWorkspaceId: 7 },
}
const target: Node = {
  id: 'target',
  position: { x: 0, y: 0 },
  data: { kind: 'video', croppedInputAssets: { reference: { originalAssetId: 10, assetId: 20, workspaceId: 7 } } },
}
const edge: Edge = { id: 'reference', source: 'source', target: 'target' }

describe('画布裁切引用', () => {
  it('只替换当前目标引用，保留源图片并使用鉴权缩略图', () => {
    const refs = collectCanvasSourceRefs('target', [source, target], [edge])
    expect(refs[0]).toMatchObject({
      assetId: 20,
      thumbnailUrl: '/api/v1/assets/20/download?workspace_id=7',
      workspaceId: 7,
    })
    expect(source.data.assetId).toBe(10)
    const other: Node = { ...target, id: 'other', data: { kind: 'video' } }
    expect(collectCanvasSourceRefs('other', [source, other], [{ ...edge, target: 'other' }])[0].assetId).toBe(10)
  })

  it('来源素材更换后废弃旧裁切', () => {
    const replaced = { ...source, data: { ...source.data, assetId: 30 } }
    expect(collectCanvasSourceRefs('target', [replaced, target], [edge])[0].assetId).toBe(30)
  })

  it('裁切素材可保存恢复并纳入资产收集', () => {
    const mutation = nodeToMutation(target)
    expect(elementsToGraph([mutation]).nodes[0].data.croppedInputAssets).toEqual(target.data.croppedInputAssets)
    expect(collectCanvasElementAssetIds([mutation]).has(20)).toBe(true)
  })
})
