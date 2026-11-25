import { beforeEach, describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  clearCanvasDraft,
  clearRecoveredCanvasDrafts,
  hasOwnPendingCanvasDraft,
  loadCanvasDraft,
  loadPendingCanvasDrafts,
  mergePendingCanvasDrafts,
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

  it('保留未同步标记、基线以及清空后的文本', () => {
    ;(window as typeof window & { __canvasTextContents?: Map<string, string> }).__canvasTextContents = new Map([
      ['text-1', ''],
    ])
    const baseline = { nodes: [{ id: 'text-1', type: 'text', data: { text: '旧内容' } }], edges: [] }
    expect(
      saveCanvasDraft([], [], 12, 12, { userId: 7, workspaceId: 21 }, { pendingSync: true, syncBaseline: baseline }),
    ).toBe(true)
    expect(loadCanvasDraft(12, { userId: 7, workspaceId: 21 })).toMatchObject({
      pendingSync: true,
      syncBaseline: baseline,
      textContents: { 'text-1': '' },
    })
  })

  it('preserves another tab’s journal through clean saves and retires only confirmed snapshots', () => {
    const scope = { userId: 7, workspaceId: 21 }
    const baseline = { nodes: [], edges: [] }
    const node = (id: string): Node => ({ id, type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text' } })
    const prefix = 'zzh_canvas_draft_u7_w21_p32:pending:other-tab:'
    const remoteKey = `${prefix}000000000001`
    const saveOtherTab = (key: string, id: string, updatedAt: number) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          nodes: [node(id)],
          edges: [],
          textContents: {},
          boundCanvasId: 32,
          pendingSync: true,
          syncBaseline: baseline,
          updatedAt,
        }),
      )
    }
    saveOtherTab(remoteKey, 'other-tab', 1)
    saveCanvasDraft([node('this-tab')], [], 32, 32, scope, { pendingSync: true, syncBaseline: baseline })
    expect(hasOwnPendingCanvasDraft(32, scope)).toBe(true)
    const recovered = loadPendingCanvasDrafts(32, scope)
    expect(mergePendingCanvasDrafts({ nodes: [], edges: [] }, recovered)).toMatchObject({
      graph: { nodes: [expect.objectContaining({ id: 'other-tab' }), expect.objectContaining({ id: 'this-tab' })] },
      hasConflicts: false,
    })

    saveCanvasDraft([node('this-tab')], [], 32, 32, scope, { pendingSync: false })
    expect(hasOwnPendingCanvasDraft(32, scope)).toBe(false)
    expect(loadPendingCanvasDrafts(32, scope).map(({ key }) => key)).toEqual([remoteKey])
    const newerKey = `${prefix}000000000002`
    saveOtherTab(newerKey, 'other-tab-new', 2)
    clearRecoveredCanvasDrafts(recovered)
    expect(localStorage.getItem(remoteKey)).toBeNull()
    expect(loadPendingCanvasDrafts(32, scope).map(({ key }) => key)).toEqual([newerKey])
  })

  it('reports conflicting edits recovered from distinct browser documents', () => {
    const scope = { userId: 7, workspaceId: 21 }
    const baseline = { nodes: [], edges: [] }
    const node = (prompt: string): Node => ({
      id: 'shared',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { kind: 'image', prompt },
    })
    localStorage.setItem(
      'zzh_canvas_draft_u7_w21_p33:pending:other-tab:000000000001',
      JSON.stringify({
        nodes: [node('older')],
        edges: [],
        textContents: {},
        boundCanvasId: 33,
        pendingSync: true,
        syncBaseline: baseline,
        updatedAt: 1,
      }),
    )
    saveCanvasDraft([node('newer')], [], 33, 33, scope, { pendingSync: true, syncBaseline: baseline })
    expect(mergePendingCanvasDrafts({ nodes: [], edges: [] }, loadPendingCanvasDrafts(33, scope))).toMatchObject({
      graph: { nodes: [expect.objectContaining({ data: expect.objectContaining({ prompt: 'newer' }) })] },
      hasConflicts: true,
    })
    expect(loadPendingCanvasDrafts(33, scope)).toHaveLength(2)
  })

  it('keeps a reopened editor’s journal when the previous editor reports a late save', () => {
    const oldEditor = { userId: 7, workspaceId: 21, writerId: 'old-editor' }
    const newEditor = { ...oldEditor, writerId: 'new-editor' }
    const pending = { pendingSync: true, syncBaseline: { nodes: [], edges: [] } }
    saveCanvasDraft([], [], 34, 34, oldEditor, pending)
    saveCanvasDraft([], [], 34, 34, newEditor, pending)
    saveCanvasDraft([], [], 34, 34, oldEditor, { pendingSync: false })

    expect(hasOwnPendingCanvasDraft(34, oldEditor)).toBe(false)
    expect(hasOwnPendingCanvasDraft(34, newEditor)).toBe(true)
    expect(loadPendingCanvasDrafts(34, newEditor)).toHaveLength(1)
  })
})
