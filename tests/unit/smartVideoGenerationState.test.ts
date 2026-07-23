import { describe, expect, it } from 'vitest'
import { deriveSmartVideoGenerationActivity, resolveSmartActiveTask } from '@/utils/smartVideoGenerationState'

describe('deriveSmartVideoGenerationActivity', () => {
  it('把无执行者的 processing task 标成可清理状态，避免转圈状态自锁', () => {
    expect(
      deriveSmartVideoGenerationActivity({
        taskId: 77,
        generations: [{ id: 'stale', status: 'processing', taskId: 77 }],
      }),
    ).toEqual({
      runtimeActive: false,
      persistedActive: true,
      visibleActive: true,
      staleRecoveryState: true,
    })
  })

  it('登记表或页面执行者仍在时不清理 processing', () => {
    expect(
      deriveSmartVideoGenerationActivity({
        generations: [{ id: 'active', status: 'processing', taskId: 88 }],
        registered: true,
      }),
    ).toMatchObject({ runtimeActive: true, visibleActive: true, staleRecoveryState: false })
  })

  it('把没有 generation record 的孤立 taskId 也标成可清理恢复凭证', () => {
    expect(deriveSmartVideoGenerationActivity({ taskId: 99 })).toEqual({
      runtimeActive: false,
      persistedActive: true,
      visibleActive: true,
      staleRecoveryState: true,
    })
  })

  it('队列只代表待恢复凭证，不能冒充真实执行者阻止自愈', () => {
    expect(deriveSmartVideoGenerationActivity({ queueLength: 2 })).toEqual({
      runtimeActive: false,
      persistedActive: true,
      visibleActive: true,
      staleRecoveryState: true,
    })
  })

  it('没有任务和记录时保持空闲', () => {
    expect(deriveSmartVideoGenerationActivity({})).toEqual({
      runtimeActive: false,
      persistedActive: false,
      visibleActive: false,
      staleRecoveryState: false,
    })
  })
})

describe('resolveSmartActiveTask', () => {
  it('keeps a newer backend task over an older local task', () => {
    expect(
      resolveSmartActiveTask(
        [
          { id: 'backend-new', status: 'processing', taskId: 22, createdAt: 200 },
          { id: 'local-old', status: 'processing', taskId: 11, createdAt: 100 },
        ],
        22,
      ),
    ).toEqual({ generationId: 'backend-new', taskId: 22 })
  })

  it('allows a genuinely newer local generation to become the active owner', () => {
    expect(
      resolveSmartActiveTask(
        [
          { id: 'backend-old', status: 'processing', taskId: 22, createdAt: 100 },
          { id: 'local-new', status: 'processing', taskId: 33, createdAt: 300 },
        ],
        22,
      ),
    ).toEqual({ generationId: 'local-new', taskId: 33 })
  })

  it('uses the server owner as a deterministic tie-breaker', () => {
    expect(
      resolveSmartActiveTask(
        [
          { id: 'local', status: 'processing', taskId: 11, createdAt: 100 },
          { id: 'server', status: 'processing', taskId: 22, createdAt: 100 },
        ],
        22,
      ),
    ).toEqual({ generationId: 'server', taskId: 22 })
  })
})
