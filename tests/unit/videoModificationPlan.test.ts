import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTaskModel: vi.fn(),
}))

// smartVideo 从 business 引入任务/估价能力；本测试只关心模型解析路径
vi.mock('@/api/business', () => ({
  createAiTask: vi.fn(),
  waitForAiTask: vi.fn(),
  getAiTaskId: vi.fn(),
  resolveTaskModel: mocks.resolveTaskModel,
  estimateAiTaskCost: vi.fn(),
}))

import { resolveVideoModificationPlan } from '@/api/smartVideo'

/** 声明了 role:'video' 输入的生成模型（参考生视频门控开启）。 */
function referenceCapableModel(id: number) {
  return {
    id,
    display_name: 'Framora 1.0',
    operation_codes: ['video.generate'],
    input_constraints: {
      'video.generate': {
        roles: [
          { role: 'image', min_count: 0, max_count: 9 },
          { role: 'video', min_count: 0, max_count: 1 },
        ],
      },
    },
  }
}

describe('resolveVideoModificationPlan', () => {
  beforeEach(() => {
    mocks.resolveTaskModel.mockReset()
  })

  it('① 生成模型声明收 role:video → 同模型参考生视频', async () => {
    const plan = await resolveVideoModificationPlan({
      workspaceId: 21,
      generationModelVersion: referenceCapableModel(501),
    })
    expect(plan.mode).toBe('reference')
    expect(plan.modelVersionId).toBe(501)
    expect(plan.displayName).toBe('Framora 1.0')
    expect(plan.crossModelFallback).toBe(false)
    // 不需要去目录解析回退模型
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
  })

  it('② 不收视频输入但自身声明 video.edit → 同模型编辑', async () => {
    const plan = await resolveVideoModificationPlan({
      workspaceId: 21,
      generationModelVersion: {
        id: 502,
        display_name: 'HappyHorse 1.1',
        operation_codes: ['video.generate', 'video.edit'],
        input_constraints: { 'video.generate': { roles: [{ role: 'image', min_count: 1, max_count: 1 }] } },
      },
    })
    expect(plan.mode).toBe('edit')
    expect(plan.modelVersionId).toBe(502)
    expect(plan.crossModelFallback).toBe(false)
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
  })

  it('③ 两种能力都没有 → 回退目录默认修改模型并标记跨模型', async () => {
    mocks.resolveTaskModel.mockResolvedValue({
      id: 700,
      display_name: 'happyhorse-1.0-video-edit',
      operation_codes: ['video.edit'],
    })
    const plan = await resolveVideoModificationPlan({
      workspaceId: 21,
      generationModelVersion: {
        id: 503,
        display_name: 'Seedance 2.0',
        operation_codes: ['video.generate'],
        input_constraints: { 'video.generate': { roles: [{ role: 'image', min_count: 0, max_count: 9 }] } },
      },
    })
    expect(plan.mode).toBe('edit')
    expect(plan.modelVersionId).toBe(700)
    expect(plan.crossModelFallback).toBe(true)
  })

  it('目录里也没有可用修改模型时抛出统一原因', async () => {
    mocks.resolveTaskModel.mockResolvedValue({ id: 0 })
    await expect(
      resolveVideoModificationPlan({
        workspaceId: 21,
        generationModelVersion: { id: 503, operation_codes: ['video.generate'] },
      }),
    ).rejects.toThrow(/暂无.*视频编辑/)
  })

  it('优先级为产品确认的顺序：同时声明两种能力时参考生视频优先', async () => {
    const both = {
      ...referenceCapableModel(504),
      operation_codes: ['video.generate', 'video.edit'],
    }
    const plan = await resolveVideoModificationPlan({ workspaceId: 21, generationModelVersion: both })
    expect(plan.mode).toBe('reference')
    expect(plan.modelVersionId).toBe(504)
  })
})
