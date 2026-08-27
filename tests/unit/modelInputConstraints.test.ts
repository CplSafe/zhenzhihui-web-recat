import { describe, expect, test } from 'vitest'

import {
  getModelReferenceImageLimit,
  getModelInputConstraints,
  DEFAULT_REFERENCE_IMAGE_LIMIT,
} from '@/utils/modelInputConstraints'

/**
 * 后端 /ai/models 的 input_constraints 是上传上限的唯一真相（见 ai.InputConstraintsFor）。
 * 前端读错字段就会放行后端随后拒收的数量，用户到最后一步才发现白传。
 */
describe('getModelInputConstraints', () => {
  test('reads the image role limit for the requested operation', () => {
    const model = {
      input_constraints: {
        'video.generate': {
          roles: [
            { role: 'image', min_count: 0, max_count: 30, mime_types: ['image/jpeg', 'image/png'] },
            { role: 'audio', min_count: 0, max_count: 10 },
          ],
        },
      },
    }
    expect(getModelReferenceImageLimit(model, 'video.generate')).toBe(30)
  })

  test('keeps operations separate: video.edit accepts fewer images than video.generate', () => {
    const model = {
      input_constraints: {
        'video.generate': { roles: [{ role: 'image', min_count: 0, max_count: 9 }] },
        'video.edit': { roles: [{ role: 'image', min_count: 0, max_count: 5 }] },
      },
    }
    expect(getModelReferenceImageLimit(model, 'video.generate')).toBe(9)
    expect(getModelReferenceImageLimit(model, 'video.edit')).toBe(5)
  })

  test('falls back to the conservative default when the backend omits constraints', () => {
    // 老后端没有该字段。回退值必须偏保守，宁可少传也不要让用户传了再被拒。
    expect(getModelReferenceImageLimit({}, 'video.generate')).toBe(DEFAULT_REFERENCE_IMAGE_LIMIT)
    expect(getModelReferenceImageLimit(undefined, 'video.generate')).toBe(DEFAULT_REFERENCE_IMAGE_LIMIT)
  })

  test('uses reference_image when a model exposes that role instead of image', () => {
    // 万相把参考图叫 reference_image，首尾帧另有 role；上传控件关心的是参考图那一路。
    const wan = {
      input_constraints: {
        'video.generate': {
          roles: [
            { role: 'first_frame', min_count: 0, max_count: 1 },
            { role: 'reference_image', min_count: 0, max_count: 10 },
          ],
        },
      },
    }
    expect(getModelReferenceImageLimit(wan, 'video.generate')).toBe(10)
  })

  test('ignores malformed or non-positive limits rather than blocking all uploads', () => {
    const broken = {
      input_constraints: {
        'video.generate': { roles: [{ role: 'image', min_count: 0, max_count: 0 }] },
      },
    }
    expect(getModelReferenceImageLimit(broken, 'video.generate')).toBe(DEFAULT_REFERENCE_IMAGE_LIMIT)

    const garbage = { input_constraints: { 'video.generate': { roles: 'nope' } } }
    expect(getModelReferenceImageLimit(garbage, 'video.generate')).toBe(DEFAULT_REFERENCE_IMAGE_LIMIT)
  })

  test('exposes mutually exclusive role groups so the UI can warn before submit', () => {
    const wan = {
      input_constraints: {
        'video.generate': {
          roles: [{ role: 'reference_image', min_count: 0, max_count: 10 }],
          mutually_exclusive_role_groups: [
            ['first_frame', 'last_frame'],
            ['reference_image', 'reference_video'],
          ],
        },
      },
    }
    expect(getModelInputConstraints(wan, 'video.generate').mutuallyExclusiveRoleGroups).toEqual([
      ['first_frame', 'last_frame'],
      ['reference_image', 'reference_video'],
    ])
  })
})

/**
 * input_constraints 必须汇入 buildModelRestrictionSummary 的 referenceImages 约束，
 * 入口的上传上限、提交前校验和模型下拉的说明文案才会同源。
 * 大多数视频模型的 params_schema 并不声明参考图数量，此前这条约束一直是空的。
 */
describe('buildModelRestrictionSummary + input_constraints', () => {
  test('derives the reference-image ceiling from input_constraints', async () => {
    const { buildModelRestrictionSummary } = await import('@/utils/modelRestrictions')
    const seedance25 = {
      operation_codes: ['video.generate'],
      params_schema: { fields: [] },
      input_constraints: {
        'video.generate': { roles: [{ role: 'image', min_count: 0, max_count: 30 }] },
      },
    }
    expect(buildModelRestrictionSummary(seedance25).constraints.referenceImages?.maximum).toBe(30)
  })

  test('params_schema stays authoritative when it declares the field itself', async () => {
    const { buildModelRestrictionSummary } = await import('@/utils/modelRestrictions')
    const model = {
      operation_codes: ['video.generate'],
      params_schema: { fields: [{ name: 'reference_images', type: 'number', minimum: 1, maximum: 4 }] },
      input_constraints: {
        'video.generate': { roles: [{ role: 'image', min_count: 0, max_count: 30 }] },
      },
    }
    // schema 是模型自己声明的参数约束，比通用素材上限更贴近该模型的真实要求。
    expect(buildModelRestrictionSummary(model).constraints.referenceImages?.maximum).toBe(4)
  })
})
