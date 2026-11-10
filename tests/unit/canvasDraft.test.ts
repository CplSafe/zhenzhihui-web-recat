import { beforeEach, describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  clearCanvasDraft,
  loadCanvasDraft,
  readDraftBoundCanvasId,
  saveCanvasDraft,
  saveCanvasScriptCreationHandled,
  markCanvasScriptCreationPending,
  hasCanvasScriptCreationPending,
  clearCanvasScriptCreationPending,
} from '@/utils/canvasDraft'

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

  it('隔离账号和空间，并不自动读取归属不明的旧草稿', () => {
    const first = { userId: 7, workspaceId: 21 }
    const second = { userId: 7, workspaceId: 22 }
    const otherUser = { userId: 8, workspaceId: 21 }
    saveCanvasDraft([], [], 10, 10)
    expect(loadCanvasDraft(10, first)).toBeNull()
    saveCanvasDraft([], [], 10, 10, first)
    expect(readDraftBoundCanvasId(10, first)).toBe(10)
    expect(loadCanvasDraft(10, second)).toBeNull()
    expect(loadCanvasDraft(10, otherUser)).toBeNull()
    saveCanvasScriptCreationHandled(10, true, second)
    expect(loadCanvasDraft(10, second)?.scriptCreationHandled).toBe(true)
    expect(loadCanvasDraft(10, first)?.scriptCreationHandled).toBeUndefined()
    clearCanvasDraft(10, first)
    expect(loadCanvasDraft(10, first)).toBeNull()
    expect(loadCanvasDraft(10, second)).not.toBeNull()
  })

  it('单次脚本引导只在标记的画布生效', () => {
    markCanvasScriptCreationPending(10)
    expect(hasCanvasScriptCreationPending(10)).toBe(true)
    expect(hasCanvasScriptCreationPending(11)).toBe(false)
    clearCanvasScriptCreationPending(10)
    expect(hasCanvasScriptCreationPending(10)).toBe(false)
  })
})
