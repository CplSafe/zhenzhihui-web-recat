import { beforeEach, describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { clearCanvasDraft, loadCanvasDraft, readDraftBoundCanvasId, saveCanvasDraft } from '@/utils/canvasDraft'

describe('canvasDraft', () => {
  beforeEach(() => {
    ;(window as typeof window & { __canvasTextContents?: Map<string, string> }).__canvasTextContents = new Map([
      ['text-1', 'saved canvas text'],
    ])
  })

  it('persists graph state and the bound canvas id', () => {
    const nodes = [
      {
        id: 'text-1',
        type: 'text',
        position: { x: 10, y: 20 },
        data: { kind: 'text', assetId: 11, resultUrl: 'https://example.com/a.png' },
        selected: true,
      } as Node,
    ]
    const edges = [{ id: 'edge-1', source: 'text-1', target: 'image-1' } as Edge]

    saveCanvasDraft(nodes, edges, 'project-a', 42)

    expect(readDraftBoundCanvasId('project-a')).toBe(42)
    expect(loadCanvasDraft('project-a')).toMatchObject({
      nodes: [
        {
          id: 'text-1',
          type: 'text',
          position: { x: 10, y: 20 },
          data: { kind: 'text', assetId: 11, resultUrl: 'https://example.com/a.png' },
        },
      ],
      edges: [{ id: 'edge-1', source: 'text-1', target: 'image-1' }],
      textContents: { 'text-1': 'saved canvas text' },
      boundCanvasId: 42,
    })
  })

  it('isolates drafts per project and clears only one project', () => {
    saveCanvasDraft([], [], 'project-a', 1)
    saveCanvasDraft([], [], 'project-b', 2)

    clearCanvasDraft('project-a')

    expect(loadCanvasDraft('project-a')).toBeNull()
    expect(readDraftBoundCanvasId('project-b')).toBe(2)
  })

  it('returns safe defaults for corrupt local data', () => {
    localStorage.setItem('zzh_canvas_draft_pbroken', '{not-json')

    expect(loadCanvasDraft('broken')).toBeNull()
    expect(readDraftBoundCanvasId('broken')).toBe(0)
  })
})
