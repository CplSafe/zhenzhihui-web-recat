import { beforeEach, describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { comparableNode, nodeToMutation } from '@/utils/canvasElements'
import { restoreCanvasTaskState } from '@/utils/canvasTaskState'
import {
  clearCanvasDraft,
  clearRecoveredCanvasDrafts,
  hasOwnPendingCanvasDraft,
  loadCanvasDraft,
  loadPendingCanvasDrafts,
  mergePendingCanvasDrafts,
  readCanvasConfirmedRevision,
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

  it('keeps the latest confirmed revision when another tab caches an older canvas snapshot', () => {
    const scope = { userId: 7, workspaceId: 21, writerId: 'saving-tab' }
    const anotherTab = { ...scope, writerId: 'reading-tab' }
    const oldNode: Node = { id: 'old', type: 'text', position: { x: 1, y: 2 }, data: { kind: 'text' } }
    const canvasId = 38
    expect(saveCanvasDraft([], [], canvasId, canvasId, scope, { pendingSync: false, confirmedRevision: 5 })).toBe(true)
    expect(
      saveCanvasDraft([oldNode], [], canvasId, canvasId, anotherTab, { pendingSync: false, confirmedRevision: 3 }),
    ).toBe(true)
    expect(readCanvasConfirmedRevision(canvasId, scope)).toBe(5)
    expect(loadCanvasDraft(canvasId, scope)?.nodes).toEqual([])
    expect(readCanvasConfirmedRevision(canvasId, { ...scope, workspaceId: 22 })).toBe(0)
    expect(readCanvasConfirmedRevision(canvasId, { ...scope, userId: 8 })).toBe(0)
  })

  it('restores an in-flight undo from another writer without treating the confirmed write as a conflict', () => {
    const prompt = '保留原提示词。'.repeat(1000)
    const original: Node = { id: 'shared', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', prompt } }
    const submitted = { ...original, data: { ...original.data, groupId: 'group-1' } }
    const writer = { userId: 7, workspaceId: 21, writerId: 'performing-undo' }
    const reader = { ...writer, writerId: 'reopened-canvas' }
    expect(
      saveCanvasDraft([original], [], 35, 35, writer, {
        pendingSync: true,
        syncBaseline: { nodes: [comparableNode(original)], edges: [] },
        submittedMutations: [nodeToMutation(submitted)],
        acknowledgedMutationIds: [submitted.id],
        acknowledgedRevision: 2,
        graphFromBaseline: true,
      }),
    ).toBe(true)

    const recovered = loadPendingCanvasDrafts(35, reader)
    expect(recovered[0]?.draft.acknowledgedRevision).toBe(2)
    expect(recovered[0]?.draft.nodes).toEqual([original])
    expect(recovered[0]?.draft.submittedMutations).toEqual([nodeToMutation(submitted)])
    expect(recovered[0]?.snapshot.split(prompt)).toHaveLength(2)
    expect(JSON.parse(recovered[0]?.snapshot ?? '{}')).toMatchObject({ nodes: null, edges: null })
    expect(mergePendingCanvasDrafts({ nodes: [submitted], edges: [] }, recovered)).toMatchObject({
      graph: { nodes: [original], edges: [] },
      hasConflicts: false,
    })

    const collaboratorVersion = { ...original, data: { ...original.data, groupId: 'other-group' } }
    expect(mergePendingCanvasDrafts({ nodes: [collaboratorVersion], edges: [] }, recovered)).toMatchObject({
      hasConflicts: true,
    })
  })

  it('retains a collaborator version newer than an unchanged acknowledged batch on reopen', () => {
    const prompt = '公共原提示词。'.repeat(1000)
    const image = (id: string, title: string): Node => ({
      id,
      type: 'image',
      position: { x: 0, y: 0 },
      data: { kind: 'image', title, prompt },
    })
    const before = [image('acknowledged', '云端原稿'), image('locked', '被锁原稿')]
    const local = [image('acknowledged', '已提交'), image('locked', '等待恢复')]
    const collaborator = image('acknowledged', '协作者的新版本')
    const writer = { userId: 7, workspaceId: 21, writerId: 'pending-batches' }
    const reader = { ...writer, writerId: 'reopened-canvas' }
    expect(
      saveCanvasDraft(local, [], 36, 36, writer, {
        pendingSync: true,
        syncBaseline: { nodes: before.map((node) => comparableNode(node)), edges: [] },
        acknowledgedMutationIds: ['acknowledged'],
        acknowledgedRevision: 2,
      }),
    ).toBe(true)

    const recovered = loadPendingCanvasDrafts(36, reader)
    expect(recovered[0]?.draft.nodes).toEqual(local)
    expect(recovered[0]?.draft.submittedMutations).toBeUndefined()
    expect(recovered[0]?.snapshot.split(prompt)).toHaveLength(3)
    expect(JSON.parse(recovered[0]?.snapshot ?? '{}').nodes).toBeNull()
    expect(mergePendingCanvasDrafts({ nodes: [collaborator, before[1]], edges: [] }, recovered)).toMatchObject({
      graph: { nodes: [collaborator, local[1]], edges: [] },
      hasConflicts: false,
    })
  })

  it('compares an unknown receipt with the persisted task state before rehydration', () => {
    const original: Node = {
      id: 'failed-video',
      type: 'video',
      position: { x: 0, y: 0 },
      data: { kind: 'video', taskId: 29, taskStatus: 'failed', taskError: '任务失败' },
    }
    const submitted = { ...original, position: { x: 200, y: 0 } }
    const rehydrated = { ...submitted, data: restoreCanvasTaskState(submitted.data) }
    const scope = { userId: 7, workspaceId: 21, writerId: 'unknown-aid' }
    expect(rehydrated.data.taskStatus).toBe('reconnecting')
    expect(
      saveCanvasDraft([original], [], 37, 37, scope, {
        pendingSync: true,
        syncBaseline: { nodes: [comparableNode(original)], edges: [] },
        submittedMutations: [nodeToMutation(submitted)],
        graphFromBaseline: true,
      }),
    ).toBe(true)

    const records = loadPendingCanvasDrafts(37, scope)
    expect(
      mergePendingCanvasDrafts({ nodes: [rehydrated], edges: [] }, records, { nodes: [submitted], edges: [] }),
    ).toMatchObject({ graph: { nodes: [original], edges: [] }, hasConflicts: false })
  })
})
