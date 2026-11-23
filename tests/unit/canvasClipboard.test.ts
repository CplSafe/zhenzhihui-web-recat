import { describe, expect, it } from 'vitest'
import { normalizeAudioSettings, syncTimelineAudio } from '@/utils/canvasAudio'
import {
  boundsOrigin,
  collectUpstreamNodeIds,
  copyCanvasNodes,
  materializeCanvasClipboard,
} from '@/utils/canvasClipboard'
import { syncTimelineClipsFromSources, type TimelineState } from '@/utils/timelineClips'

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
  it('仅连接原资产时只复制当前节点，并保留原有素材节点的出线和槽位', () => {
    const crop = { originalAssetId: 41, assetId: 42, workspaceId: 21 }
    const data = { ...nodes[1].data, assetId: 53, croppedInputAssets: { 'original-image-link': crop } }
    const payload = copyCanvasNodes({
      nodes: nodes.map((node) => (node.id === 'vid-1' ? { ...node, data } : node)),
      edges: [{ ...edges[0], id: 'original-image-link' }, edges[1]],
      selectedIds: ['vid-1'],
      runtimeKeys,
      reuseIncomingSources: true,
    })!
    const options = {
      origin: { x: 1000, y: 140 },
      createNodeId: () => 'vid-copy',
      buildEdgeId: (source: string, target: string, slot: string | number) => `${source}-${target}-${slot}`,
    }

    expect(materializeCanvasClipboard(payload, options).edges).toEqual([])
    const copy = materializeCanvasClipboard(payload, { ...options, reuseIncomingSources: true })
    expect(copy.nodes).toHaveLength(1)
    expect(copy.nodes[0].data).toEqual({ ...data, croppedInputAssets: { 'img-1-vid-copy-0': crop } })
    expect(copy.edges).toEqual([
      {
        id: 'img-1-vid-copy-0',
        source: 'img-1',
        target: 'vid-copy',
        sourceHandle: 'img-1-right-source',
        targetHandle: 'vid-copy-left-target',
        data: { slotIndex: 0, role: 'reference_image' },
      },
    ])
  })

  it('音频节点复制粘贴保留素材、时长与混音设置，不复制生成任务', () => {
    const audio = { durationSec: 8, inSec: 1, outSec: 7, volume: 0.6, origin: 'upload' }
    const payload = copyCanvasNodes({
      nodes: [
        {
          id: 'audio-1',
          position: { x: 20, y: 30 },
          data: {
            kind: 'audio',
            title: '旁白.mp3',
            assetId: 42,
            assetWorkspaceId: 21,
            audio,
            taskId: 9,
            taskStatus: 'running',
          },
        },
      ],
      edges: [],
      selectedIds: ['audio-1'],
      runtimeKeys,
    })!
    const result = materializeCanvasClipboard(payload, {
      origin: { x: 500, y: 600 },
      createNodeId: () => 'audio-new',
      buildEdgeId: () => 'edge',
    })
    expect(result.nodes[0]).toMatchObject({
      id: 'audio-new',
      position: { x: 500, y: 600 },
      data: { kind: 'audio', title: '旁白.mp3', assetId: 42, assetWorkspaceId: 21, audio },
    })
    expect(result.nodes[0].data).not.toHaveProperty('taskId')
    expect(result.nodes[0].data).not.toHaveProperty('taskStatus')
  })
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

describe('复制时间线内容', () => {
  const manualClip = { id: 'manual', assetId: 10, sourceDurationSec: 10, inSec: 1, outSec: 5 }
  const linkedClip = {
    id: 'split-a',
    assetId: 11,
    sourceNodeId: 'video-a',
    sourceDurationSec: 12,
    inSec: 3,
    outSec: 6,
    muted: true,
    keyframes: [{ timeSec: 4, label: '转场' }],
  }
  const splitClip = { ...linkedClip, id: 'split-b', inSec: 7, outSec: 9, keyframes: [] }
  const audio = {
    ...normalizeAudioSettings({ durationSec: 8, inSec: 1, outSec: 7, startSec: 2, volume: 0.6 }),
    assetId: 13,
    sourceNodeId: 'audio-a',
    title: '旁白',
  }
  const timeline: TimelineState = {
    clips: [linkedClip, manualClip, splitClip],
    audioClips: [audio],
    detachedSourceNodeIds: ['video-b'],
    originalAudioVolume: 0.5,
    output: { ratio: '16:9' },
  }
  const timelineNodes = [
    { id: 'video-a', position: { x: 0, y: 0 }, data: { kind: 'video', assetId: 11 } },
    { id: 'video-b', position: { x: 0, y: 300 }, data: { kind: 'video', assetId: 12 } },
    { id: 'audio-a', position: { x: 0, y: 600 }, data: { kind: 'audio', assetId: 13 } },
    { id: 'timeline-a', position: { x: 300, y: 0 }, data: { kind: 'timeline', timeline } },
  ]
  const timelineEdges = ['video-a', 'video-b', 'audio-a'].map((source) => ({ source, target: 'timeline-a' }))

  function copyTimeline(selectedIds: string[], reuseIncomingSources = false): TimelineState {
    const payload = copyCanvasNodes({
      nodes: timelineNodes,
      edges: timelineEdges,
      selectedIds,
      runtimeKeys,
      reuseIncomingSources,
    })!
    let sequence = 0
    const result = materializeCanvasClipboard(payload, {
      origin: { x: 0, y: 0 },
      createNodeId: (kind) => `${kind}-new-${++sequence}`,
      buildEdgeId: (source, target) => `${source}-${target}`,
      reuseIncomingSources,
    })
    return result.nodes.find((node) => node.data.kind === 'timeline')!.data.timeline as TimelineState
  }

  it('连来源一起粘贴时，改写来源 ID 并保留分割、排序、混音和移出记录', () => {
    const copied = copyTimeline(timelineNodes.map((node) => node.id))
    expect(copied).toEqual({
      ...timeline,
      clips: [
        { ...linkedClip, sourceNodeId: 'video-new-1' },
        manualClip,
        { ...splitClip, sourceNodeId: 'video-new-1' },
      ],
      audioClips: [{ ...audio, sourceNodeId: 'audio-new-3' }],
      detachedSourceNodeIds: ['video-new-2'],
    })
    expect(
      syncTimelineClipsFromSources(copied, [
        { sourceNodeId: 'video-new-1', assetId: 11 },
        { sourceNodeId: 'video-new-2', assetId: 12 },
      ]),
    ).toBe(copied)
    expect(syncTimelineAudio(copied.audioClips!, [{ ...audio, sourceNodeId: 'audio-new-3', volume: 1 }])).toEqual(
      copied.audioClips,
    )
    expect(timeline.clips[0].sourceNodeId).toBe('video-a')
  })

  it('仅复制时间线时保留视频剪辑，并清除未连接的画布来源', () => {
    const copied = copyTimeline(['timeline-a'])
    expect(copied.clips).toEqual([
      { ...linkedClip, sourceNodeId: undefined },
      manualClip,
      { ...splitClip, sourceNodeId: undefined },
    ])
    expect(copied.audioClips).toEqual([])
    expect(copied).not.toHaveProperty('detachedSourceNodeIds')
    expect(syncTimelineClipsFromSources(copied, [])).toBe(copied)
  })

  it('创建副本并沿用原有输入时保留时间线与原来源的关联', () => {
    expect(copyTimeline(['timeline-a'], true)).toEqual(timeline)
  })
})

describe('collectUpstreamNodeIds', () => {
  const chain = [
    { source: 'text-1', target: 'img-1' },
    { source: 'img-1', target: 'video-1' },
    { source: 'img-2', target: 'video-1' },
    { source: 'video-1', target: 'video-2' },
  ]

  it('collects every ancestor of the node, including itself', () => {
    expect(collectUpstreamNodeIds(['video-1'], chain).sort()).toEqual(['img-1', 'img-2', 'text-1', 'video-1'])
  })

  it('does not include downstream nodes', () => {
    expect(collectUpstreamNodeIds(['img-1'], chain).sort()).toEqual(['img-1', 'text-1'])
  })

  it('returns only the node itself when it has no upstream', () => {
    expect(collectUpstreamNodeIds(['text-1'], chain)).toEqual(['text-1'])
  })

  it('terminates on cyclic data', () => {
    const cyclic = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]
    expect(collectUpstreamNodeIds(['a'], cyclic).sort()).toEqual(['a', 'b'])
  })
})

describe('boundsOrigin', () => {
  it('returns the top-left corner of the picked nodes', () => {
    const picked = [
      { id: 'a', position: { x: 100, y: 40 } },
      { id: 'b', position: { x: 20, y: 300 } },
      { id: 'c', position: { x: -500, y: -500 } },
    ]
    expect(boundsOrigin(picked, ['a', 'b'])).toEqual({ x: 20, y: 40 })
    expect(boundsOrigin(picked, ['missing'])).toBeNull()
  })
})
