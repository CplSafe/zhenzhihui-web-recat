import { describe, expect, it } from 'vitest'
import {
  buildGenerationModelExecutionFingerprint,
  getImageQueueModelLockError,
  getLockedGenerationModelAvailabilityError,
  getVideoQueueModelLockError,
} from '@/utils/generationQueueModelGuards'

describe('generation queue model guards', () => {
  it('always lets an existing image task resume without creating a replacement task', () => {
    expect(getImageQueueModelLockError({ taskId: 73 })).toBe('')
  })

  it('blocks an unsubmitted image queue item without a matching locked model operation', () => {
    expect(
      getImageQueueModelLockError({
        taskId: 0,
        operationCode: 'image.text_to_image',
        request: { refAssetIds: [81], modelVersionId: 5102 },
      }),
    ).toMatch(/已锁定模型/)
    expect(
      getImageQueueModelLockError({
        taskId: 0,
        operationCode: 'image.image_to_image',
        request: { refAssetIds: [81], modelVersionId: 5102 },
      }),
    ).toBe('')
  })

  it('requires a video queue model operation that matches generate or edit', () => {
    expect(
      getVideoQueueModelLockError({
        edit: false,
        operationCode: 'video.edit',
        modelVersionId: 7201,
      }),
    ).toMatch(/任务类型匹配/)
    expect(
      getVideoQueueModelLockError({
        edit: true,
        operationCode: 'video.edit',
        modelVersionId: 7201,
      }),
    ).toBe('')
    expect(
      getVideoQueueModelLockError({
        edit: false,
        operationCode: 'video.generate',
        modelVersionId: 0,
      }),
    ).toMatch(/已锁定模型/)
  })

  it('keeps execution fingerprints stable across object key order and ignores display metadata', () => {
    const left = {
      display_name: '旧名称',
      params_schema: { fields: [{ options: [5, 10], name: 'duration' }] },
      effect_type: 'seedance-2.0',
    }
    const right = {
      display_name: '新名称',
      effect_type: 'seedance-2.0',
      params_schema: { fields: [{ name: 'duration', options: [5, 10] }] },
    }

    expect(buildGenerationModelExecutionFingerprint(left)).toBe(buildGenerationModelExecutionFingerprint(right))
  })

  it('fails closed when a locked model disappears or its schema changes', () => {
    const locked = {
      model_version_id: 7201,
      operation_codes: ['video.generate'],
      effect_type: 'seedance-2.0',
      params_schema: { fields: [{ name: 'duration', options: [5, 10] }] },
    }

    expect(
      getLockedGenerationModelAvailabilityError({
        operationCode: 'video.generate',
        modelVersionId: 7201,
        modelVersion: locked,
        catalogModels: [],
      }),
    ).toMatch(/下架/)
    expect(
      getLockedGenerationModelAvailabilityError({
        operationCode: 'video.generate',
        modelVersionId: 7201,
        modelVersion: locked,
        catalogModels: [
          {
            ...locked,
            params_schema: { fields: [{ name: 'duration', options: [5, 10, 15] }] },
          },
        ],
      }),
    ).toMatch(/配置已更新/)
  })

  it('accepts the same enabled model from an operation-scoped catalog response', () => {
    const locked = {
      model_version_id: 7201,
      operation_codes: ['video.generate'],
      effect_type: 'seedance-2.0',
      params_schema: { fields: [{ name: 'duration', options: [5, 10] }] },
    }

    expect(
      getLockedGenerationModelAvailabilityError({
        operationCode: 'video.generate',
        modelVersionId: 7201,
        modelVersion: locked,
        catalogModels: [
          {
            model_version_id: 7201,
            effect_type: 'seedance-2.0',
            params_schema: { fields: [{ options: [5, 10], name: 'duration' }] },
          },
        ],
      }),
    ).toBe('')
  })
})
