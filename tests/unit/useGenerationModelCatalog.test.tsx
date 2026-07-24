import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBusinessErrorMessage: vi.fn(),
  listAiModels: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  getBusinessErrorMessage: mocks.getBusinessErrorMessage,
  listAiModels: mocks.listAiModels,
}))

import {
  toGenerationModelPickerGroups,
  unwrapGenerationModelCatalogResponse,
  useGenerationModelCatalog,
} from '@/composables/useGenerationModelCatalog'
import { isGenerationModelSelectionComplete } from '@/components/smart/GenerationModelPicker'
import { buildGenerationModelGroups, isGenerationModelCatalogReadyForMode } from '@/utils/generationModelCatalog'

describe('useGenerationModelCatalog', () => {
  beforeEach(() => {
    mocks.getBusinessErrorMessage.mockReset()
    mocks.listAiModels.mockReset()
    mocks.getBusinessErrorMessage.mockImplementation((_reason, fallback) => fallback)
  })

  it('unwraps direct and commonly wrapped catalog responses', () => {
    const models = [{ id: 1 }]
    expect(unwrapGenerationModelCatalogResponse(models)).toBe(models)
    expect(unwrapGenerationModelCatalogResponse({ items: models })).toBe(models)
    expect(unwrapGenerationModelCatalogResponse({ list: models })).toBe(models)
    expect(unwrapGenerationModelCatalogResponse({ data: models })).toBe(models)
    expect(unwrapGenerationModelCatalogResponse({ data: { items: models } })).toBe(models)
    expect(unwrapGenerationModelCatalogResponse({ data: { list: models } })).toBe(models)
    expect(unwrapGenerationModelCatalogResponse({ data: { unexpected: models } })).toEqual([])
  })

  it('aborts obsolete workspace loads and never lets stale responses overwrite the latest catalog', async () => {
    const pending: Array<{
      workspaceId: number
      operationCode: string
      signal: AbortSignal
      resolve: (value: unknown) => void
    }> = []
    mocks.listAiModels.mockImplementation(
      ({ workspaceId, operationCode, signal }: { workspaceId: number; operationCode: string; signal: AbortSignal }) =>
        new Promise((resolve) => pending.push({ workspaceId, operationCode, signal, resolve })),
    )

    const { result, rerender, unmount } = renderHook(
      ({ workspaceId }: { workspaceId: number }) => useGenerationModelCatalog(workspaceId),
      { initialProps: { workspaceId: 21 } },
    )
    await waitFor(() => expect(pending.filter((request) => request.workspaceId === 21)).toHaveLength(5))

    rerender({ workspaceId: 22 })
    await waitFor(() => expect(pending.filter((request) => request.workspaceId === 22)).toHaveLength(5))
    expect(pending.filter((request) => request.workspaceId === 21).every((request) => request.signal.aborted)).toBe(
      true,
    )

    await act(async () => {
      pending
        .filter((request) => request.workspaceId === 22)
        .forEach((request) =>
          request.resolve({
            data: {
              items:
                request.operationCode === 'responses.multimodal' ? [{ id: 2201, display_name: '新空间脚本模型' }] : [],
            },
          }),
        )
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.groups.find((group) => group.key === 'script')?.models[0]?.modelVersionId).toBe(2201)

    await act(async () => {
      pending
        .filter((request) => request.workspaceId === 21)
        .forEach((request) =>
          request.resolve(
            request.operationCode === 'responses.multimodal' ? [{ id: 2101, display_name: '旧空间脚本模型' }] : [],
          ),
        )
    })
    expect(result.current.groups.find((group) => group.key === 'script')?.models[0]?.modelVersionId).toBe(2201)

    const currentSignals = pending.filter((request) => request.workspaceId === 22).map((request) => request.signal)
    unmount()
    expect(currentSignals.every((signal) => signal.aborted)).toBe(true)
  })

  it('keeps successful operation models when another operation request fails', async () => {
    mocks.listAiModels.mockImplementation(async ({ operationCode }: { operationCode: string }) => {
      if (operationCode === 'image.text_to_image') throw new Error('image models unavailable')
      if (operationCode === 'responses.multimodal') {
        return [
          {
            id: 701,
            display_name: '后端脚本模型',
            operation_codes: ['responses.multimodal'],
          },
        ]
      }
      return []
    })

    const { result } = renderHook(() => useGenerationModelCatalog(21))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('')
    expect(result.current.groups.map((group) => group.key)).toEqual(['script', 'image', 'video', 'videoEdit'])
    expect(result.current.groups.find((group) => group.key === 'script')?.models[0]).toMatchObject({
      modelVersionId: 701,
      displayName: '后端脚本模型',
    })
    expect(result.current.operationStates['responses.multimodal']).toMatchObject({
      status: 'ready',
      availableModelCount: 1,
    })
    expect(result.current.operationStates['image.text_to_image']).toMatchObject({
      status: 'error',
      availableModelCount: 0,
      message: '文生图模型加载失败，请重试',
    })
    expect(result.current.operationStates['image.image_to_image'].status).toBe('empty')
    expect(isGenerationModelCatalogReadyForMode(result.current.operationStates, 'video')).toBe(false)
    expect(isGenerationModelCatalogReadyForMode(result.current.operationStates, 'image')).toBe(false)

    const textToImageSlot = result.current.pickerGroups
      .find((group) => group.key === 'image')
      ?.subgroups?.find((group) => group.key === 'image.text_to_image')
    expect(textToImageSlot?.models).toEqual([
      expect.objectContaining({
        name: '暂无可用模型',
        disabled: true,
        unavailableReason: '文生图模型加载失败，请重试',
      }),
    ])
    expect(
      isGenerationModelSelectionComplete(result.current.pickerGroups, {
        'responses.multimodal': 701,
      }),
    ).toBe(false)
    expect(mocks.listAiModels).toHaveBeenCalledTimes(5)
  })

  it('shows a global error only when every operation request fails', async () => {
    mocks.listAiModels.mockRejectedValue(new Error('catalog offline'))
    mocks.getBusinessErrorMessage.mockReturnValue('可用模型加载失败，请重试')

    const { result } = renderHook(() => useGenerationModelCatalog(21))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.groups.map((group) => group.key)).toEqual(['script', 'image', 'video', 'videoEdit'])
    expect(Object.values(result.current.operationStates).every((state) => state.status === 'error')).toBe(true)
    expect(result.current.error).toBe('可用模型加载失败，请重试')
  })

  it('shows the no-model error when successful responses contain no submittable model', async () => {
    mocks.listAiModels.mockResolvedValue([
      {
        id: 'frontend-only-id',
        model: 'seedance-2.0',
        display_name: '不可提交模型',
        operation_codes: ['video.generate'],
      },
    ])

    const { result } = renderHook(() => useGenerationModelCatalog(21))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.groups.map((group) => group.key)).toEqual(['script', 'image', 'video', 'videoEdit'])
    expect(Object.values(result.current.operationStates).every((state) => state.status === 'empty')).toBe(true)
    expect(result.current.error).toBe('当前工作空间没有可用的生成模型，请联系管理员配置后重试')
  })

  it('binds a queried operation only when the record omits operation metadata', async () => {
    mocks.listAiModels.mockImplementation(async ({ operationCode }: { operationCode: string }) => {
      if (operationCode === 'image.text_to_image') {
        return [
          {
            id: 901,
            display_name: '省略 operation 的文生图模型',
          },
          {
            id: 902,
            display_name: '显式声明为图生图的错误响应',
            operation_codes: ['image.image_to_image'],
          },
        ]
      }
      if (operationCode === 'video.generate') {
        return [
          {
            id: 903,
            model_code: 'seedance-2.0',
            display_name: 'Seedance 2.0',
            operationCodes: ['video.generate', 'video.edit'],
          },
        ]
      }
      return []
    })

    const { result } = renderHook(() => useGenerationModelCatalog(21))

    await waitFor(() => expect(result.current.loading).toBe(false))

    const imageGroup = result.current.groups.find((group) => group.key === 'image')
    expect(
      imageGroup?.operationGroups
        .find((group) => group.operationCode === 'image.text_to_image')
        ?.models.map((model) => model.modelVersionId),
    ).toEqual([901])
    expect(
      imageGroup?.operationGroups
        .find((group) => group.operationCode === 'image.image_to_image')
        ?.models.map((model) => model.modelVersionId),
    ).toEqual([])
    expect(result.current.operationStates['image.text_to_image'].status).toBe('ready')
    expect(result.current.operationStates['image.image_to_image'].status).toBe('empty')
    expect(result.current.operationStates['video.generate'].status).toBe('ready')
    expect(result.current.operationStates['video.edit'].status).toBe('empty')
  })

  it('marks malformed params_schema as a configuration error without hiding other operations', async () => {
    mocks.listAiModels.mockImplementation(async ({ operationCode }: { operationCode: string }) => {
      if (operationCode === 'responses.multimodal') {
        return [
          {
            id: 911,
            display_name: '可用脚本模型',
            operation_codes: ['responses.multimodal'],
          },
        ]
      }
      if (operationCode === 'video.generate') {
        return [
          {
            id: 912,
            model_code: 'seedance-2.0',
            display_name: '参数配置损坏的视频模型',
            operation_codes: ['video.generate'],
            params_schema: { fields: [null] },
          },
        ]
      }
      return []
    })

    const { result } = renderHook(() => useGenerationModelCatalog(21))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('')
    expect(result.current.operationStates['responses.multimodal'].status).toBe('ready')
    expect(result.current.operationStates['video.generate']).toMatchObject({
      status: 'configuration-error',
      availableModelCount: 0,
      message: expect.stringContaining('配置错误'),
    })
    const unavailableVideo = result.current.pickerGroups
      .find((group) => group.key === 'video')
      ?.subgroups?.find((group) => group.key === 'video.generate')?.models[0]
    expect(unavailableVideo).toMatchObject({
      id: 912,
      name: '参数配置损坏的视频模型',
      disabled: true,
      unavailableReason: expect.stringContaining('配置错误'),
    })
    expect(isGenerationModelCatalogReadyForMode(result.current.operationStates, 'video')).toBe(false)
  })

  it('only exposes reference-video and Seedance 2.0 video models', async () => {
    mocks.listAiModels.mockImplementation(async ({ operationCode }: { operationCode: string }) => {
      if (operationCode !== 'video.generate') return []
      return [
        {
          id: 921,
          model_code: 'happyhorse-reference-to-video',
          display_name: 'HappyHorse 参考生视频',
          operation_codes: ['video.generate'],
        },
        {
          id: 922,
          model: 'seedance-2.0',
          display_name: 'Seedance 2.0',
          operation_codes: ['video.generate'],
        },
        {
          id: 923,
          model_code: 'image-to-video',
          display_name: 'HappyHorse 图生视频',
          operation_codes: ['video.generate'],
        },
        {
          id: 924,
          model_code: 'text-to-video',
          display_name: 'HappyHorse 文生视频',
          operation_codes: ['video.generate'],
        },
        {
          id: 925,
          model_code: 'third-party-video',
          display_name: '其他视频生成模型',
          operation_codes: ['video.generate'],
        },
        {
          id: 926,
          model_code: 'happyhorse-reference-to-video-v2',
          display_name: 'HappyHorse 参考生视频（重复记录）',
          operation_codes: ['video.generate'],
        },
        {
          id: 927,
          model_code: 'other-reference-to-video',
          display_name: '其他厂商参考生视频',
          operation_codes: ['video.generate'],
        },
      ]
    })

    const { result } = renderHook(() => useGenerationModelCatalog(21))

    await waitFor(() => expect(result.current.loading).toBe(false))

    const videoModels =
      result.current.groups
        .find((group) => group.key === 'video')
        ?.operationGroups.find((group) => group.operationCode === 'video.generate')?.models ?? []
    expect(videoModels.map(({ modelVersionId, displayName }) => ({ modelVersionId, displayName }))).toEqual([
      { modelVersionId: 921, displayName: 'HappyHorse 参考生视频' },
      { modelVersionId: 922, displayName: 'Seedance 2.0' },
    ])
    expect(result.current.operationStates['video.generate']).toMatchObject({
      status: 'ready',
      availableModelCount: 2,
    })

    const dropdownModels =
      result.current.pickerGroups
        .find((group) => group.key === 'video')
        ?.subgroups?.find((group) => group.key === 'video.generate')?.models ?? []
    expect(dropdownModels.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 921, name: 'HappyHorse 参考生视频' },
      { id: 922, name: 'Seedance 2.0' },
    ])
  })

  it('projects backend schema restrictions into the homepage dropdown without inventing model names', () => {
    const groups = buildGenerationModelGroups([
      {
        id: 801,
        display_name: '后端 Seedance 展示名',
        operation_codes: ['video.generate'],
        params_schema: {
          fields: [
            { name: 'duration', options: [5, 10, 15] },
            { name: 'ratio', options: ['16:9', '9:16'] },
          ],
        },
      },
    ])

    const option = toGenerationModelPickerGroups(groups)
      .find((group) => group.key === 'video')
      ?.subgroups?.find((group) => group.key === 'video.generate')?.models[0]
    expect(option).toMatchObject({
      id: 801,
      name: '后端 Seedance 展示名',
      restrictions: ['时长仅支持：5 秒、10 秒、15 秒', '画面比例支持：16:9、9:16'],
      constraints: {
        duration: { options: [5, 10, 15] },
        ratios: ['16:9', '9:16'],
      },
    })
  })
})
