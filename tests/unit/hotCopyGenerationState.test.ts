import { describe, expect, it } from 'vitest'
import {
  HOT_COPY_PENDING_TASK_GRACE_MS,
  resolveHotCopyActiveGenerationState,
  resolveHotCopyPendingRecovery,
} from '@/utils/hotCopyGenerationState'

describe('resolveHotCopyActiveGenerationState', () => {
  it('keeps the newer active task when an older callback arrives later', () => {
    expect(
      resolveHotCopyActiveGenerationState([
        { id: 'older', status: 'processing', taskId: 11, createdAt: 100 },
        { id: 'newer', status: 'processing', taskId: 22, createdAt: 200 },
      ]),
    ).toEqual({
      videoGenerating: true,
      vidGenTaskId: 22,
      generationId: 'newer',
    })
  })

  it('keeps another active task when one generation becomes terminal', () => {
    expect(
      resolveHotCopyActiveGenerationState([
        { id: 'finished', status: 'failed', taskId: 0, createdAt: 300 },
        { id: 'active', status: 'processing', taskId: 44, createdAt: 200 },
      ]),
    ).toEqual({
      videoGenerating: true,
      vidGenTaskId: 44,
      generationId: 'active',
    })
  })

  it('clears the project-level task only when no generation remains active', () => {
    expect(
      resolveHotCopyActiveGenerationState([{ id: 'done', status: 'published', taskId: 0, createdAt: 100 }]),
    ).toEqual({
      videoGenerating: false,
      vidGenTaskId: 0,
      generationId: '',
    })
  })
})

describe('resolveHotCopyPendingRecovery', () => {
  const startedAt = 1_000_000

  it('waits only for the remaining task-creation grace period', () => {
    expect(
      resolveHotCopyPendingRecovery({
        generations: [{ id: 'pending', status: 'processing', taskId: 0, createdAt: startedAt }],
        videoGenerating: true,
        now: startedAt + 40_000,
      }),
    ).toEqual({
      action: 'wait',
      taskId: 0,
      delayMs: HOT_COPY_PENDING_TASK_GRACE_MS - 40_000,
    })
  })

  it('fails exactly when a task-less preparing record reaches the grace boundary', () => {
    expect(
      resolveHotCopyPendingRecovery({
        generations: [{ id: 'pending', status: 'processing', taskId: 0, createdAt: startedAt }],
        videoGenerating: true,
        now: startedAt + HOT_COPY_PENDING_TASK_GRACE_MS,
      }),
    ).toEqual({ action: 'fail', taskId: 0, delayMs: 0 })
  })

  it('recovers a completed result before applying the generic stopped-state branch', () => {
    expect(
      resolveHotCopyPendingRecovery({
        generations: [],
        videoGenerating: false,
        hasResult: true,
        now: startedAt,
      }),
    ).toEqual({ action: 'recover-result', taskId: 0, delayMs: 0 })
  })

  it('does not mistake an older committed video for the result of a new preparing generation', () => {
    expect(
      resolveHotCopyPendingRecovery({
        generations: [{ id: 'new-run', status: 'processing', taskId: 0, createdAt: startedAt }],
        videoGenerating: true,
        hasResult: true,
        now: startedAt + 100,
      }),
    ).toEqual({
      action: 'wait',
      taskId: 0,
      delayMs: HOT_COPY_PENDING_TASK_GRACE_MS - 100,
    })
  })

  it('resumes a provider task recovered from its generation record', () => {
    expect(
      resolveHotCopyPendingRecovery({
        generations: [{ id: 'created', status: 'processing', taskId: 301, createdAt: startedAt }],
        videoGenerating: true,
        now: startedAt + 100,
      }),
    ).toEqual({ action: 'resume-task', taskId: 301, delayMs: 0 })
  })
})
