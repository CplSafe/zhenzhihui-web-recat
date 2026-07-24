import { describe, expect, it } from 'vitest'
import {
  getSmartVideoQueueOwnershipError,
  getSmartVideoQuoteValidationError,
  restoreSmartVideoQueueForOwner,
} from '@/utils/smartVideoQueueSafety'

const owner = { sessionId: 7, workspaceId: 21, projectId: 169 }

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 'generation-1',
  idempotencyKey: 'task-generation-1',
  checkpointState: 'saved',
  context: {
    sessionId: 2,
    workspaceId: owner.workspaceId,
    projectId: owner.projectId,
    modelVersionId: 88,
  },
  ...overrides,
})

describe('restoreSmartVideoQueueForOwner', () => {
  it('不信任旧 saved 标记，并把合法任务重绑到当前 session', () => {
    const restored = restoreSmartVideoQueueForOwner([job()], owner)

    expect(restored.rejected).toEqual([])
    expect(restored.jobs).toHaveLength(1)
    expect(restored.jobs[0]).toMatchObject({
      id: 'generation-1',
      idempotencyKey: 'task-generation-1',
      checkpointState: 'pending',
      context: owner,
    })
  })

  it('拒绝属于其他 workspace 或 project 的任务', () => {
    const restored = restoreSmartVideoQueueForOwner(
      [
        job({
          context: { sessionId: 2, workspaceId: 99, projectId: owner.projectId },
        }),
        job({
          id: 'generation-2',
          idempotencyKey: 'task-generation-2',
          context: { sessionId: 2, workspaceId: owner.workspaceId, projectId: 404 },
        }),
      ],
      owner,
    )

    expect(restored.jobs).toEqual([])
    expect(restored.rejected.map((item) => item.reason)).toEqual([
      '任务不属于当前工作空间或项目',
      '任务不属于当前工作空间或项目',
    ])
  })

  it('拒绝重复 ID 和缺少幂等键的旧任务', () => {
    const restored = restoreSmartVideoQueueForOwner(
      [
        job(),
        job({ idempotencyKey: 'task-duplicate' }),
        job({ id: 'generation-3', idempotencyKey: '' }),
        job({ id: 'generation-4' }),
      ],
      owner,
    )

    expect(restored.jobs.map((item) => item.id)).toEqual(['generation-1'])
    expect(restored.rejected.map((item) => item.reason)).toEqual(['任务 ID 重复', '缺少幂等键', '幂等键重复'])
  })
})

describe('getSmartVideoQueueOwnershipError', () => {
  it('要求每条任务与给定 session/workspace/project 完全一致', () => {
    const rebound = restoreSmartVideoQueueForOwner([job()], owner).jobs
    expect(getSmartVideoQueueOwnershipError(rebound, owner)).toBe('')
    expect(getSmartVideoQueueOwnershipError(rebound, { ...owner, projectId: 170 })).toContain('不一致')
  })

  it('不会把缺少 context 的旧任务视为当前项目任务', () => {
    expect(
      getSmartVideoQueueOwnershipError(
        [{ id: 'legacy', idempotencyKey: 'legacy-key', checkpointState: 'saved' }],
        owner,
      ),
    ).toContain('不一致')
  })
})

describe('getSmartVideoQuoteValidationError', () => {
  const quote = {
    operationCode: 'video.generate' as const,
    modelVersionId: 88,
    estimatedCost: 500,
    batchTotalCost: 1000,
    balanceAtQuote: 5000,
    batchSize: 2,
    quotedAt: 1_700_000_000_000,
  }

  it('接受同模型、同操作、同价格且余额充足的重新估价', () => {
    expect(
      getSmartVideoQuoteValidationError(quote, {
        operationCode: 'video.generate',
        modelVersionId: 88,
        estimatedCost: 500,
        balance: 4500,
        canAfford: true,
      }),
    ).toBe('')
  })

  it('在价格变化时要求重新确认，而不是静默提交', () => {
    expect(
      getSmartVideoQuoteValidationError(quote, {
        operationCode: 'video.generate',
        modelVersionId: 88,
        estimatedCost: 650,
        balance: 4500,
        canAfford: true,
      }),
    ).toContain('已由 500 积分变为 650 积分')
  })

  it('在模型身份变化或余额不足时阻止付费任务', () => {
    expect(
      getSmartVideoQuoteValidationError(quote, {
        operationCode: 'video.generate',
        modelVersionId: 99,
        estimatedCost: 500,
        balance: 4500,
        canAfford: true,
      }),
    ).toContain('模型或操作类型已变化')

    expect(
      getSmartVideoQuoteValidationError(quote, {
        operationCode: 'video.generate',
        modelVersionId: 88,
        estimatedCost: 500,
        balance: 100,
        canAfford: false,
      }),
    ).toContain('余额 100 积分不足')
  })

  it('拒绝缺失或被篡改的批次报价元数据', () => {
    expect(
      getSmartVideoQuoteValidationError(
        { ...quote, batchSize: 0 },
        {
          operationCode: 'video.generate',
          modelVersionId: 88,
          estimatedCost: 500,
          balance: 4500,
          canAfford: true,
        },
      ),
    ).toContain('报价无效')

    expect(
      getSmartVideoQuoteValidationError(
        { ...quote, batchTotalCost: 5001, balanceAtQuote: 5000 },
        {
          operationCode: 'video.generate',
          modelVersionId: 88,
          estimatedCost: 500,
          balance: 4500,
          canAfford: true,
        },
      ),
    ).toContain('报价无效')
  })
})
