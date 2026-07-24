import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBusinessErrorMessage: vi.fn(),
  listAiModels: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  getBusinessErrorMessage: mocks.getBusinessErrorMessage,
  listAiModels: mocks.listAiModels,
}))

import { HOT_COPY_MODEL_OPERATION_CODE, useHotCopyModelCatalog } from '@/composables/useHotCopyModelCatalog'

describe('useHotCopyModelCatalog', () => {
  beforeEach(() => {
    mocks.getBusinessErrorMessage.mockReset()
    mocks.listAiModels.mockReset()
    mocks.getBusinessErrorMessage.mockImplementation((_reason, fallback) => fallback)
  })

  it('only requests video.replicate and exposes only the two featured video models', async () => {
    mocks.listAiModels.mockResolvedValue([
      {
        id: 101,
        model_code: 'happyhorse-reference-to-video',
        display_name: 'HappyHorse 参考生视频',
        operation_codes: ['video.replicate'],
      },
      {
        id: 102,
        display_name: 'Seedance 2.0',
        operation_codes: ['video.replicate'],
      },
      {
        id: 103,
        display_name: '图生视频',
        operation_codes: ['video.replicate'],
      },
      {
        id: 104,
        display_name: '文生视频',
        operation_codes: ['video.replicate'],
      },
      {
        id: 105,
        display_name: 'Seedance 2.0',
      },
      {
        id: 106,
        model_code: 'happyhorse-reference-to-video',
        display_name: 'HappyHorse 参考生视频（错误操作）',
        operation_codes: ['video.generate'],
      },
      {
        id: 107,
        model_code: 'happyhorse-reference-to-video-v2',
        display_name: 'HappyHorse 参考生视频（重复记录）',
        operation_codes: ['video.replicate'],
      },
      {
        id: 108,
        model_code: 'other-reference-to-video',
        display_name: '其他厂商参考生视频',
        operation_codes: ['video.replicate'],
      },
    ])

    const { result } = renderHook(() => useHotCopyModelCatalog(21))

    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(mocks.listAiModels).toHaveBeenCalledOnce()
    expect(mocks.listAiModels).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 21,
        operationCode: HOT_COPY_MODEL_OPERATION_CODE,
        plan: '',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(result.current.pickerGroups[0]?.subgroups?.[0]?.models.map((model) => model.name)).toEqual([
      'HappyHorse 参考生视频',
      'Seedance 2.0',
    ])
    expect(result.current.error).toBe('')
  })

  it('filters operation mismatches before selecting one model for each featured category', async () => {
    mocks.listAiModels.mockResolvedValue([
      {
        id: 111,
        model_code: 'happyhorse-reference-to-video',
        display_name: 'HappyHorse 错误操作记录',
        operation_codes: ['video.generate'],
      },
      {
        id: 112,
        model_code: 'happyhorse-reference-to-video-v2',
        display_name: 'HappyHorse 可用参考生视频',
        operation_codes: ['video.replicate'],
      },
      {
        id: 113,
        model_code: 'seedance-2.0',
        display_name: 'Seedance 2.0 停用版本',
        enabled: false,
        operation_codes: ['video.replicate'],
      },
      {
        id: 114,
        model_code: 'seedance-2.0-pro',
        display_name: 'Seedance 2.0 可用版本',
        operation_codes: ['video.replicate'],
      },
    ])

    const { result } = renderHook(() => useHotCopyModelCatalog(21))

    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.pickerGroups[0]?.subgroups?.[0]?.models.map((model) => model.name)).toEqual([
      'HappyHorse 可用参考生视频',
      'Seedance 2.0 可用版本',
    ])
    expect(result.current.resolveModel(111)).toBeNull()
    expect(result.current.resolveModel(113)).toBeNull()
    expect(result.current.resolveModel(112)).not.toBeNull()
    expect(result.current.resolveModel(114)).not.toBeNull()
  })

  it('resolves a selected model id to its complete backend model record', async () => {
    const paramsSchema = {
      fields: [
        { name: 'duration', options: [5, 10, 15] },
        { name: 'ratio', options: ['16:9', '9:16'] },
      ],
    }
    mocks.listAiModels.mockResolvedValue([
      {
        id: 201,
        display_name: 'Seedance 2.0',
        model_code: 'seedance-2.0',
        provider_name: 'volcengine',
        description: '后端模型说明',
        operation_codes: ['video.replicate'],
        params_schema: paramsSchema,
        custom_backend_field: { retained: true },
      },
    ])

    const { result } = renderHook(() => useHotCopyModelCatalog(21))

    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.resolveModel(201)).toEqual(
      expect.objectContaining({
        id: 201,
        display_name: 'Seedance 2.0',
        model_code: 'seedance-2.0',
        provider_name: 'volcengine',
        description: '后端模型说明',
        operation_codes: ['video.replicate'],
        params_schema: paramsSchema,
        custom_backend_field: { retained: true },
      }),
    )
    expect(result.current.resolveModel('201')).toEqual(result.current.resolveModel(201))
    expect(result.current.resolveModel(999)).toBeNull()
  })

  it('preserves the backend operation declaration without fabricating operation_codes', async () => {
    mocks.listAiModels.mockResolvedValue([
      {
        id: 202,
        display_name: 'Seedance 2.0',
        operationCodes: ['video.replicate'],
      },
    ])

    const { result } = renderHook(() => useHotCopyModelCatalog(21))

    await waitFor(() => expect(result.current.ready).toBe(true))

    const model = result.current.resolveModel(202)
    expect(model).toEqual(
      expect.objectContaining({
        id: 202,
        operationCodes: ['video.replicate'],
      }),
    )
    expect(model).not.toHaveProperty('operation_codes')
  })

  it('accepts a nested backend data/items catalog envelope', async () => {
    mocks.listAiModels.mockResolvedValue({
      data: {
        items: [
          {
            model_version_id: 203,
            display_name: 'Seedance 2.0',
            operation_codes: ['video.replicate'],
          },
        ],
      },
    })

    const { result } = renderHook(() => useHotCopyModelCatalog(21))

    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.resolveModel(203)).toEqual(
      expect.objectContaining({
        model_version_id: 203,
        id: 203,
      }),
    )
  })

  it('reports an empty catalog and provides a disabled placeholder model', async () => {
    mocks.listAiModels.mockResolvedValue([])

    const { result } = renderHook(() => useHotCopyModelCatalog(21))

    await waitFor(() => expect(result.current.error).toBe('当前工作空间暂无可用的参考生视频或 Seedance 2.0 模型'))

    expect(result.current.loading).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(result.current.resolveModel(101)).toBeNull()
    expect(result.current.pickerGroups[0]?.subgroups?.[0]?.models).toEqual([
      expect.objectContaining({
        name: '暂无可用模型',
        disabled: true,
        unavailableReason: '当前工作空间暂无可用的参考生视频或 Seedance 2.0 模型',
      }),
    ])
  })

  it('surfaces the business API error when the catalog request fails', async () => {
    const failure = new Error('catalog offline')
    mocks.listAiModels.mockRejectedValue(failure)
    mocks.getBusinessErrorMessage.mockReturnValue('爆款复制模型服务暂不可用')

    const { result } = renderHook(() => useHotCopyModelCatalog(21))

    await waitFor(() => expect(result.current.error).toBe('爆款复制模型服务暂不可用'))

    expect(result.current.loading).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(result.current.resolveModel(101)).toBeNull()
    expect(mocks.getBusinessErrorMessage).toHaveBeenCalledWith(failure, '爆款复制模型加载失败，请重试')
    expect(mocks.listAiModels).toHaveBeenCalledOnce()
  })

  it('aborts the in-flight catalog request when the workspace hook unmounts', () => {
    mocks.listAiModels.mockImplementation(() => new Promise(() => undefined))

    const { unmount } = renderHook(() => useHotCopyModelCatalog(21))
    const signal = mocks.listAiModels.mock.calls[0]?.[0]?.signal as AbortSignal

    expect(signal.aborted).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
