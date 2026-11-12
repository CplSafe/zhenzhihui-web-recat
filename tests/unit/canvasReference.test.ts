import { describe, expect, it } from 'vitest'
import { canvasReferenceFromNode, isCanvasReferenceTarget } from '@/components/director/canvasReference'

describe('canvas node reference', () => {
  it('keeps identity and a bounded label, without uploading or copying private node data', () => {
    const node = { id: 'n1', data: { kind: 'video', title: '第一集', assetId: 4566,
      prompt: 'private long script', resultUrl: 'https://assets.test/?signature=secret' } }
    expect(canvasReferenceFromNode(node)).toEqual({ id:'n1', title:'第一集', kind:'video' })
    expect(canvasReferenceFromNode({ ...node, data: { ...node.data, title:'x'.repeat(2000) } })?.title).toHaveLength(120)
  })
  it('does not treat group or decorative nodes as media references', () => {
    expect(canvasReferenceFromNode({ id: 'group', type:'group', data:{ kind:'group' } })).toBeUndefined()
    expect(canvasReferenceFromNode({ id: 'text', data:{ kind:'text' } })?.id).toBe('text')
  })
})

it('references a video surface while preserving player controls and editable inputs', () => {
  const node = document.createElement('div')
  node.innerHTML = '<video></video><div class="canvas-node-video-bar"><span>seek</span></div><button><span>play</span></button><input/><video controls></video>'
  expect(isCanvasReferenceTarget(node.querySelector('video')!)).toBe(true)
  for (const target of node.querySelectorAll('.canvas-node-video-bar span, button span, input, video[controls]')) {
    expect(isCanvasReferenceTarget(target)).toBe(false)
  }
})
