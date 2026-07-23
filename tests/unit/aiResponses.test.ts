import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspaceId: 41,
  modelPlanCandidates: ['team-pro', 'team-standard'] as string[],
  ensureModelPlanCandidatesLoaded: vi.fn(),
  createAiResponse: vi.fn(),
  streamAiResponse: vi.fn(),
  getBusinessErrorMessage: vi.fn(),
  extractTaskText: vi.fn(),
  ensureAssetId: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  createAiResponse: mocks.createAiResponse,
  streamAiResponse: mocks.streamAiResponse,
  getBusinessErrorMessage: mocks.getBusinessErrorMessage,
  extractTaskText: mocks.extractTaskText,
}))

vi.mock('@/api/smartShotImage', () => ({
  ensureAssetId: mocks.ensureAssetId,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useWorkspaceSessionStore: {
    getState: () => ({
      ensureModelPlanCandidatesLoaded: mocks.ensureModelPlanCandidatesLoaded,
    }),
  },
  deriveWorkspaceId: () => mocks.workspaceId,
  deriveModelPlanCandidates: () => mocks.modelPlanCandidates,
}))

import { runResponseText, streamResponseText } from '@/api/aiResponses'

const operationPayload = {
  workspaceId: 41,
  operationCode: 'responses.multimodal',
  prompt: '系统设定\n\n用户问题',
  inputAssets: undefined,
  modelPlanCandidates: ['team-pro', 'team-standard'],
}

describe('aiResponses context and request payloads', () => {
  beforeEach(() => {
    mocks.workspaceId = 41
    mocks.modelPlanCandidates = ['team-pro', 'team-standard']
    Object.values(mocks).forEach((value) => {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
    })
    mocks.ensureModelPlanCandidatesLoaded.mockResolvedValue(undefined)
    mocks.getBusinessErrorMessage.mockImplementation(
      (error: any, fallback: string) => error?.businessMessage || fallback,
    )
    mocks.extractTaskText.mockImplementation((result: any) => result?.taskText || '')
  })

  it.each([
    ['非流式', () => runResponseText({ user: '问题' })],
    ['流式', () => streamResponseText({ user: '问题' })],
  ])('没有 workspace 时%s请求 fail-closed', async (_label, invoke) => {
    mocks.workspaceId = 0

    await expect(invoke()).rejects.toThrow('未选择工作空间')

    expect(mocks.ensureModelPlanCandidatesLoaded).toHaveBeenCalledOnce()
    expect(mocks.ensureAssetId).not.toHaveBeenCalled()
    expect(mocks.createAiResponse).not.toHaveBeenCalled()
    expect(mocks.streamAiResponse).not.toHaveBeenCalled()
  })

  it('套餐加载失败时使用 store 中已有候选套餐', async () => {
    mocks.ensureModelPlanCandidatesLoaded.mockRejectedValue(new Error('套餐接口不可用'))
    mocks.modelPlanCandidates = ['cached-plan']
    mocks.createAiResponse.mockResolvedValue('成功')

    await expect(runResponseText({ user: '问题' })).resolves.toBe('成功')

    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 41, modelPlanCandidates: ['cached-plan'] }),
    )
  })

  it('套餐加载完成后重新读取最新 workspace 和候选套餐', async () => {
    mocks.workspaceId = 7
    mocks.modelPlanCandidates = []
    mocks.ensureModelPlanCandidatesLoaded.mockImplementation(async () => {
      mocks.workspaceId = 42
      mocks.modelPlanCandidates = ['loaded-plan']
    })
    mocks.createAiResponse.mockResolvedValue('成功')

    await runResponseText({ user: '问题' })

    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 42, modelPlanCandidates: ['loaded-plan'] }),
    )
  })

  it('只提交上传成功且 id 有效的图片，并保留输入顺序和数量', async () => {
    const images = ['', 'one.png', 'failed.png', 'zero.png', 'two.png', 'three.png']
    mocks.ensureAssetId.mockImplementation(async (_workspaceId: number, url: string) => {
      if (url === 'failed.png') throw new Error('上传失败')
      if (url === 'zero.png') return 0
      return { 'one.png': 101, 'two.png': 102, 'three.png': 103 }[url]
    })
    mocks.createAiResponse.mockResolvedValue('完成')

    await runResponseText({ user: '识图', images })

    expect(mocks.ensureAssetId).toHaveBeenCalledTimes(5)
    expect(mocks.ensureAssetId.mock.calls.map(([, url]) => url)).toEqual(images.slice(1))
    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        inputAssets: [
          { asset_id: 101, role: 'image' },
          { asset_id: 102, role: 'image' },
          { asset_id: 103, role: 'image' },
        ],
      }),
    )
    const caches = mocks.ensureAssetId.mock.calls.map(([, , cache]) => cache)
    expect(new Set(caches).size).toBe(1)
  })

  it('使用非流式默认参数并正确拼接 system/user', async () => {
    mocks.createAiResponse.mockResolvedValue('完成')

    await runResponseText({ system: '系统设定', user: '用户问题' })

    expect(mocks.createAiResponse).toHaveBeenCalledWith({
      ...operationPayload,
      params: { temperature: 0.7, max_output_tokens: 512 },
    })
  })

  it('保留零值在内的自定义参数，且空 system 不产生多余换行', async () => {
    mocks.createAiResponse.mockResolvedValue('完成')

    await runResponseText({ system: '', user: '用户问题', temperature: 0, maxTokens: 0 })

    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '用户问题',
        params: { temperature: 0, max_output_tokens: 0 },
      }),
    )
  })
})

describe('aiResponses text extraction', () => {
  beforeEach(() => {
    mocks.workspaceId = 41
    mocks.modelPlanCandidates = ['team-pro']
    Object.values(mocks).forEach((value) => {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
    })
    mocks.ensureModelPlanCandidatesLoaded.mockResolvedValue(undefined)
    mocks.extractTaskText.mockImplementation((result: any) => result?.taskText || '')
  })

  it.each([
    ['字符串', '  字符串结果  ', '字符串结果'],
    ['任务对象', { taskText: '  任务结果  ' }, '任务结果'],
    ['嵌套任务对象', { task: { taskText: '  嵌套任务结果  ' } }, '嵌套任务结果'],
    ['直接 text', { text: '  直接文本  ' }, '直接文本'],
    ['根级 output_text', { output_text: '  根级输出  ' }, '根级输出'],
    ['response output_text', { response: { output_text: '  响应输出  ' } }, '响应输出'],
    [
      'responses output 数组',
      {
        response: {
          output: [{ content: [{ text: '第一段' }, { text: '第二段' }] }, { text: '第三段' }, { content: [{}] }],
        },
      },
      '第一段第二段第三段',
    ],
  ])('解析%s响应', async (_label, response, expected) => {
    mocks.createAiResponse.mockResolvedValue(response)

    await expect(runResponseText({ user: '问题' })).resolves.toBe(expected)

    expect(mocks.streamAiResponse).not.toHaveBeenCalled()
  })

  it('非流式响应为空时转为流式，并传递同一 payload 和 signal', async () => {
    const controller = new AbortController()
    mocks.createAiResponse.mockResolvedValue({ response: { output: [] } })
    mocks.streamAiResponse.mockResolvedValue({ response: { output_text: '  流式兜底文本  ' } })

    await expect(
      runResponseText({
        system: '系统设定',
        user: '用户问题',
        temperature: 0.2,
        maxTokens: 99,
        signal: controller.signal,
      }),
    ).resolves.toBe('流式兜底文本')

    const submittedPayload = mocks.createAiResponse.mock.calls[0][0]
    expect(mocks.streamAiResponse).toHaveBeenCalledWith({ ...submittedPayload, signal: controller.signal })
  })

  it('空响应转流式失败时原样传播错误', async () => {
    const streamError = new Error('流式请求失败')
    mocks.createAiResponse.mockResolvedValue(null)
    mocks.streamAiResponse.mockRejectedValue(streamError)

    await expect(runResponseText({ user: '问题' })).rejects.toBe(streamError)
  })
})

describe('aiResponses streaming and fallback policy', () => {
  beforeEach(() => {
    mocks.workspaceId = 41
    mocks.modelPlanCandidates = ['team-pro', 'team-standard']
    Object.values(mocks).forEach((value) => {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
    })
    mocks.ensureModelPlanCandidatesLoaded.mockResolvedValue(undefined)
    mocks.getBusinessErrorMessage.mockImplementation(
      (error: any, fallback: string) => error?.businessMessage || fallback,
    )
    mocks.extractTaskText.mockImplementation((result: any) => result?.taskText || '')
  })

  it('返回流式全文并透传 onDelta、signal 和流式默认参数', async () => {
    const controller = new AbortController()
    const onDelta = vi.fn()
    mocks.streamAiResponse.mockImplementation(async (args: any) => {
      args.onDelta('增量', '累计文本')
      return { text: '  最终全文  ' }
    })

    await expect(
      streamResponseText({ system: '系统设定', user: '用户问题', onDelta, signal: controller.signal }),
    ).resolves.toBe('最终全文')

    expect(onDelta).toHaveBeenCalledWith('增量', '累计文本')
    expect(mocks.streamAiResponse).toHaveBeenCalledWith({
      ...operationPayload,
      params: { temperature: 0.8, max_output_tokens: 4000 },
      onDelta,
      signal: controller.signal,
    })
    expect(mocks.createAiResponse).not.toHaveBeenCalled()
  })

  it.each([
    ['HTTP 500', { status: 500, message: 'server failed' }],
    ['HTTP 599', { status: 599, message: 'upstream failed' }],
    ['HTTP 400', { status: 400, message: 'Bad Request' }],
    ['bad_request 文本', new Error('bad_request: invalid payload')],
    ['SSE 原始错误', new Error('SSE event-stream disconnected')],
    ['规范化响应流错误', { message: 'gateway', businessMessage: '响应流中断' }],
  ])('%s 流式错误回退到非流式', async (_label, streamError) => {
    mocks.streamAiResponse.mockRejectedValue(streamError)
    mocks.createAiResponse.mockResolvedValue({ text: '  非流式兜底  ' })

    await expect(streamResponseText({ user: '问题' })).resolves.toBe('非流式兜底')

    expect(mocks.createAiResponse).toHaveBeenCalledOnce()
    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 41,
        operationCode: 'responses.multimodal',
        params: { temperature: 0.8, max_output_tokens: 4000 },
      }),
    )
  })

  it.each([
    ['HTTP 401 即使包含 SSE 文本', { status: 401, message: 'SSE token expired' }],
    ['HTTP 403', { status: 403, message: 'forbidden' }],
    ['非标准 600 状态', { status: 600, message: 'unknown status' }],
    ['普通网络错误', new Error('network offline')],
  ])('%s 不回退并原样传播', async (_label, streamError) => {
    mocks.streamAiResponse.mockRejectedValue(streamError)

    await expect(streamResponseText({ user: '问题' })).rejects.toBe(streamError)

    expect(mocks.createAiResponse).not.toHaveBeenCalled()
  })

  it('AbortError 即使包含 stream 文本也不回退', async () => {
    const abortError = new DOMException('stream aborted', 'AbortError')
    mocks.streamAiResponse.mockRejectedValue(abortError)

    await expect(streamResponseText({ user: '问题' })).rejects.toBe(abortError)

    expect(mocks.createAiResponse).not.toHaveBeenCalled()
  })

  it('signal 已取消时不回退', async () => {
    const controller = new AbortController()
    controller.abort()
    const streamError = new Error('SSE stream closed')
    mocks.streamAiResponse.mockRejectedValue(streamError)

    await expect(streamResponseText({ user: '问题', signal: controller.signal })).rejects.toBe(streamError)

    expect(mocks.createAiResponse).not.toHaveBeenCalled()
  })

  it('非流式回退失败时传播最终错误', async () => {
    const fallbackError = new Error('非流式也失败')
    mocks.streamAiResponse.mockRejectedValue({ status: 503, message: 'service unavailable' })
    mocks.createAiResponse.mockRejectedValue(fallbackError)

    await expect(streamResponseText({ user: '问题' })).rejects.toBe(fallbackError)
  })
})
