import { describe, expect, it } from 'vitest'
import { mergeImageMessagesForRecovery, shouldMergeLocalImageRecovery } from '@/utils/smartImageRecovery'
import type { SmartDraft } from '@/utils/smartDraft'

describe('smart image draft recovery', () => {
  it.each([
    { status: 'pending', extra: {} },
    { status: 'error', extra: { error: '轮询中断', terminalFailure: true } },
  ])('keeps the backend success over a local $status state for the same task', ({ status, extra }) => {
    const backendSuccess = {
      id: 'image-task-801',
      role: 'assistant',
      status: 'done',
      taskId: 801,
      images: [{ url: '/api/v1/assets/91/download?workspace_id=21', assetId: 91 }],
    }
    const localStaleState = {
      id: 'image-task-801',
      role: 'assistant',
      status,
      taskId: 801,
      ...extra,
    }

    expect(mergeImageMessagesForRecovery([backendSuccess], [localStaleState])).toEqual([backendSuccess])
  })

  it('recovers a newer local terminal success even when no local message is pending', () => {
    const backendDraft: SmartDraft = {
      started: true,
      projectId: 303,
      savedAt: 1_000,
      imageMessages: [],
    }
    const localSuccess = {
      id: 'image-task-802',
      role: 'assistant',
      status: 'done',
      taskId: 802,
      images: [{ url: '/api/v1/assets/92/download?workspace_id=21', assetId: 92 }],
    }
    const localDraft: SmartDraft = {
      started: true,
      projectId: 303,
      savedAt: 2_000,
      imageMessages: [localSuccess],
    }

    expect(shouldMergeLocalImageRecovery(backendDraft, localDraft, 303)).toBe(true)
    expect(mergeImageMessagesForRecovery(backendDraft.imageMessages, localDraft.imageMessages)).toEqual([localSuccess])
  })

  it('keeps both queued and submitted pending descriptors recoverable regardless of draft timestamp', () => {
    const queued = {
      id: 'image-task-queued',
      role: 'assistant',
      status: 'pending',
      taskId: 0,
      batchId: 'image-batch-1',
      idempotencyKey: 'image-batch-1-02',
      request: { text: '生成海报', ratio: '16:9', refAssetIds: [], refImages: [] },
    }
    const submitted = {
      id: 'image-task-submitted',
      role: 'assistant',
      status: 'pending',
      taskId: 803,
      batchId: 'image-batch-1',
      idempotencyKey: 'image-batch-1-03',
      request: { text: '生成海报', ratio: '16:9', refAssetIds: [], refImages: [] },
    }
    const backendDraft: SmartDraft = { started: true, projectId: 303, savedAt: 3_000, imageMessages: [] }
    const localDraft: SmartDraft = {
      started: true,
      projectId: 303,
      savedAt: 2_000,
      imageMessages: [queued, submitted],
    }

    expect(shouldMergeLocalImageRecovery(backendDraft, localDraft, 303)).toBe(true)
    expect(mergeImageMessagesForRecovery(backendDraft.imageMessages, localDraft.imageMessages)).toEqual([
      queued,
      submitted,
    ])
  })
})
