import { describe, expect, it } from 'vitest'

import {
  findResumableItems,
  formatHistorySummary,
  isFinalTaskStatus,
  prependHistoryBatches,
  taskMode,
  toHistoryBatch,
  toHistoryBatches,
} from '@/utils/studioHistory'
import type { StudioHistoryTask } from '@/utils/studioHistory'
import type { StudioResultBatch } from '@/components/studio/StudioResultFeed/StudioResultFeed'

const WS = 7

function task(overrides: Partial<StudioHistoryTask> = {}): StudioHistoryTask {
  return {
    id: 1,
    status: 'succeeded',
    operation_code: 'video.generate',
    created_at: '2026-08-26T10:00:00Z',
    ...overrides,
  }
}

describe('taskMode', () => {
  it('产物类型优先于 operation_code', () => {
    // 产物是最直接的证据：拿到的是视频就按视频渲染。
    expect(taskMode(task({ operation_code: 'image.text_to_image', outputs: [{ type: 'video' }] }))).toBe('video')
  })

  it('没有产物时按 operation_code 前缀判定', () => {
    expect(taskMode(task({ operation_code: 'video.generate', outputs: [] }))).toBe('video')
    expect(taskMode(task({ operation_code: 'image.image_to_image', outputs: [] }))).toBe('image')
  })

  it('两者都缺失时按图片兜底', () => {
    expect(taskMode(task({ operation_code: '', outputs: [] }))).toBe('image')
  })
})

describe('isFinalTaskStatus', () => {
  it.each(['succeeded', 'failed', 'cancelled', 'canceled', 'expired', 'payment_failed'])('%s 是终态', (status) => {
    expect(isFinalTaskStatus(status)).toBe(true)
  })

  it.each(['queued', 'processing', 'running', 'submitted'])('%s 不是终态', (status) => {
    expect(isFinalTaskStatus(status)).toBe(false)
  })

  it('忽略大小写与空白', () => {
    expect(isFinalTaskStatus('  SUCCEEDED ')).toBe(true)
  })
})

describe('formatHistorySummary', () => {
  it('拼接存在的参数项', () => {
    expect(formatHistorySummary({ resolution: '1080p', duration_sec: 5, ratio: '16:9' })).toBe('1080p · 5s · 16:9')
  })

  it('缺失项自动略过', () => {
    expect(formatHistorySummary({ ratio: '1:1' })).toBe('1:1')
    expect(formatHistorySummary(undefined)).toBe('')
  })
})

describe('toHistoryBatch', () => {
  it('用素材中心地址而不是会过期的 provider URL', () => {
    const batch = toHistoryBatch(
      task({ outputs: [{ type: 'video', asset_id: 42, url: 'https://provider.example/x.mp4' }] }),
      WS,
    )
    expect(batch.items[0].url).toBe(`/api/v1/assets/42/download?workspace_id=${WS}`)
  })

  it('没有 asset_id 时退回 provider URL', () => {
    const batch = toHistoryBatch(task({ outputs: [{ type: 'image', url: 'https://provider.example/x.png' }] }), WS)
    expect(batch.items[0].url).toBe('https://provider.example/x.png')
  })

  it('携带比例，供占位格子定形', () => {
    expect(toHistoryBatch(task({ params: { ratio: '9:16' } }), WS).ratio).toBe('9:16')
  })

  it('失败任务造一条 failed 占位并带上原因', () => {
    const batch = toHistoryBatch(task({ status: 'failed', error_message: '内容审核未通过', outputs: [] }), WS)
    expect(batch.items).toHaveLength(1)
    expect(batch.items[0].status).toBe('failed')
    expect(batch.items[0].error).toBe('内容审核未通过')
  })

  it('进行中的任务是 pending，等待续轮询', () => {
    const batch = toHistoryBatch(task({ status: 'processing', outputs: [] }), WS)
    expect(batch.items[0].status).toBe('pending')
  })

  it('成功但产物已失效时给出可理解的说明', () => {
    const batch = toHistoryBatch(task({ status: 'succeeded', outputs: [] }), WS)
    expect(batch.items[0].status).toBe('failed')
    expect(batch.items[0].error).toBe('产物已失效')
  })

  it('未完成的产物带上 taskId，供刷新后续轮询', () => {
    // taskId 必须记在产物上：一批多个视频各有独立任务，记在批次上会互相覆盖，
    // 刷新后只有最后一个能续轮询，其余永远停在转圈。
    const batch = toHistoryBatch(task({ id: 88, status: 'processing', outputs: [] }), WS)
    expect(batch.items[0].taskId).toBe(88)
  })

  it('批次 id 由 task_id 派生，供翻页去重', () => {
    expect(toHistoryBatch(task({ id: 88 }), WS).id).toBe('task-88')
  })
})

describe('toHistoryBatches', () => {
  it('把后端的新→旧反转成页面的旧→新', () => {
    // 后端固定 created_at DESC，页面要聊天式的旧在上、新在下。
    const batches = toHistoryBatches(
      [
        task({ id: 3, created_at: '2026-08-26T12:00:00Z' }),
        task({ id: 2, created_at: '2026-08-26T11:00:00Z' }),
        task({ id: 1, created_at: '2026-08-26T10:00:00Z' }),
      ],
      WS,
    )
    expect(batches.map((batch) => batch.id)).toEqual(['task-1', 'task-2', 'task-3'])
  })

  it('丢弃没有有效 id 的记录', () => {
    expect(toHistoryBatches([task({ id: 0 }), task({ id: 5 })], WS).map((b) => b.id)).toEqual(['task-5'])
  })
})

describe('prependHistoryBatches', () => {
  const batch = (id: string): StudioResultBatch => ({
    id,
    mode: 'video',
    prompt: '',
    summary: '',
    createdAt: 0,
    items: [],
  })

  it('把更早的一页拼到前面', () => {
    const result = prependHistoryBatches([batch('task-3')], [batch('task-1'), batch('task-2')])
    expect(result.map((entry) => entry.id)).toEqual(['task-1', 'task-2', 'task-3'])
  })

  it('按 id 去重，保留列表里已有的那份', () => {
    // 已有条目可能带着本地更新的进度/产物，不能被历史快照覆盖回旧状态。
    const existing = { ...batch('task-1'), prompt: '本地最新' }
    const result = prependHistoryBatches([existing], [batch('task-1')])
    expect(result).toHaveLength(1)
    expect(result[0].prompt).toBe('本地最新')
  })

  it('整页都重复时保持原列表内容', () => {
    const result = prependHistoryBatches([batch('task-1'), batch('task-2')], [batch('task-1'), batch('task-2')])
    expect(result.map((entry) => entry.id)).toEqual(['task-1', 'task-2'])
  })
})

describe('findResumableItems', () => {
  const videoBatch = (id: string, items: StudioResultBatch['items']): StudioResultBatch => ({
    id,
    mode: 'video',
    prompt: '',
    summary: '',
    createdAt: 0,
    items,
  })

  it('一批多个视频各自认领，不会只接一个', () => {
    // 回归：taskId 曾记在批次上，N 个并发任务互相覆盖，刷新后只有最后一个能续轮询，
    // 其余产物永远停在转圈。
    const batch = videoBatch('b1', [
      { id: 'i1', status: 'pending', taskId: 101 },
      { id: 'i2', status: 'pending', taskId: 102 },
      { id: 'i3', status: 'pending', taskId: 103 },
    ])
    expect(findResumableItems([batch], new Set()).map((entry) => entry.taskId)).toEqual([101, 102, 103])
  })

  it('定位到具体的批次与产物', () => {
    const batch = videoBatch('b1', [{ id: 'i1', status: 'pending', taskId: 7 }])
    expect(findResumableItems([batch], new Set())).toEqual([{ batchId: 'b1', itemId: 'i1', taskId: 7 }])
  })

  it('跳过已认领的任务，避免重复轮询', () => {
    const batch = videoBatch('b1', [
      { id: 'i1', status: 'pending', taskId: 101 },
      { id: 'i2', status: 'pending', taskId: 102 },
    ])
    expect(findResumableItems([batch], new Set([101])).map((entry) => entry.taskId)).toEqual([102])
  })

  it('只认领仍在生成中的产物', () => {
    const batch = videoBatch('b1', [
      { id: 'done', status: 'done', url: '/a.mp4', taskId: 1 },
      { id: 'failed', status: 'failed', error: 'x', taskId: 2 },
      { id: 'pending', status: 'pending', taskId: 3 },
    ])
    expect(findResumableItems([batch], new Set()).map((entry) => entry.taskId)).toEqual([3])
  })

  it('没有 taskId 的产物无从续轮询，跳过', () => {
    const batch = videoBatch('b1', [{ id: 'i1', status: 'pending' }])
    expect(findResumableItems([batch], new Set())).toEqual([])
  })

  it('图片批次不走视频续轮询', () => {
    // 图片是同步返回的，没有可续的任务。
    const batch: StudioResultBatch = {
      id: 'b1',
      mode: 'image',
      prompt: '',
      summary: '',
      createdAt: 0,
      items: [{ id: 'i1', status: 'pending', taskId: 9 }],
    }
    expect(findResumableItems([batch], new Set())).toEqual([])
  })

  it('跨批次收集', () => {
    const result = findResumableItems(
      [
        videoBatch('b1', [{ id: 'i1', status: 'pending', taskId: 1 }]),
        videoBatch('b2', [{ id: 'i2', status: 'pending', taskId: 2 }]),
      ],
      new Set(),
    )
    expect(result.map((entry) => entry.batchId)).toEqual(['b1', 'b2'])
  })

  it('空列表返回空', () => {
    expect(findResumableItems([], new Set())).toEqual([])
  })
})
