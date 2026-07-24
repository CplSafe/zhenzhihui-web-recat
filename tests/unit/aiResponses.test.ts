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

import { buildResponseModelParams, runResponseText, streamResponseText } from '@/api/aiResponses'

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

  it('显式请求上下文锁定工作空间且不再读取可变全局会话', async () => {
    mocks.workspaceId = 7
    mocks.modelPlanCandidates = ['global-plan']
    mocks.createAiResponse.mockResolvedValue('成功')

    await runResponseText({
      user: '问题',
      requestContext: { workspaceId: 88, modelPlanCandidates: ['locked-plan'] },
    })

    expect(mocks.ensureModelPlanCandidatesLoaded).not.toHaveBeenCalled()
    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 88,
        modelPlanCandidates: ['locked-plan'],
      }),
    )
  })

  it('允许由锁定的请求上下文提供模型版本 ID', async () => {
    mocks.createAiResponse.mockResolvedValue('成功')

    await runResponseText({
      user: '问题',
      requestContext: {
        workspaceId: 88,
        modelVersionId: 704,
      },
    })

    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 88,
        modelVersionId: 704,
      }),
    )
  })

  it('允许从同一请求上下文的模型快照推导模型版本 ID', async () => {
    mocks.createAiResponse.mockResolvedValue('成功')

    await runResponseText({
      user: '问题',
      requestContext: {
        workspaceId: 88,
        modelVersion: {
          model_version_id: '705',
          display_name: '锁定脚本模型',
        },
      },
    })

    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 88,
        modelVersionId: 705,
      }),
    )
  })

  it.each([
    {
      label: '调用参数与请求上下文',
      stream: false,
      modelVersionId: 701,
      requestContext: {
        workspaceId: 88,
        modelVersionId: 702,
        modelVersion: { id: 702 },
      },
    },
    {
      label: '请求上下文与模型快照',
      stream: true,
      modelVersionId: undefined,
      requestContext: {
        workspaceId: 88,
        modelVersionId: 702,
        modelVersion: { model_version_id: 703 },
      },
    },
    {
      label: '调用参数与模型快照',
      stream: false,
      modelVersionId: 701,
      requestContext: {
        workspaceId: 88,
        modelVersion: { modelVersionId: 703 },
      },
    },
  ])('$label 的模型版本 ID 不一致时在素材上传和付费请求前失败', async (testCase) => {
    const args = {
      user: '问题',
      images: ['one.png'],
      modelVersionId: testCase.modelVersionId,
      requestContext: testCase.requestContext,
    }

    await expect(testCase.stream ? streamResponseText(args) : runResponseText(args)).rejects.toThrow(
      '模型版本 ID 与模型参数快照不一致',
    )

    expect(mocks.ensureAssetId).not.toHaveBeenCalled()
    expect(mocks.createAiResponse).not.toHaveBeenCalled()
    expect(mocks.streamAiResponse).not.toHaveBeenCalled()
  })

  it('请求开始前已经取消时不上传素材也不调用 AI', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      runResponseText({
        user: '问题',
        images: ['one.png'],
        requestContext: { workspaceId: 88 },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(mocks.ensureAssetId).not.toHaveBeenCalled()
    expect(mocks.createAiResponse).not.toHaveBeenCalled()
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

  it('非流式请求透传用户显式选择的模型版本', async () => {
    mocks.createAiResponse.mockResolvedValue('完成')

    await runResponseText({ user: '用户问题', modelVersionId: 701 })

    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        modelVersionId: 701,
        operationCode: 'responses.multimodal',
      }),
    )
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

  it('显式模型只发送 schema 声明的参数并保留后端字段名', async () => {
    mocks.createAiResponse.mockResolvedValue('完成')

    await runResponseText({
      user: '用户问题',
      temperature: 0.4,
      maxTokens: 800,
      modelVersionId: 701,
      requestContext: {
        workspaceId: 41,
        modelVersion: {
          model_version_id: 701,
          params_schema: {
            type: 'object',
            properties: {
              temperature: { type: 'number', minimum: 0, maximum: 1 },
              maxTokens: { type: 'integer', minimum: 1, maximum: 2000 },
              response_format: { type: 'string', default: 'json' },
            },
            required: ['temperature', 'maxTokens', 'response_format'],
          },
        },
      },
    })

    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          temperature: 0.4,
          maxTokens: 800,
          response_format: 'json',
        },
      }),
    )
  })

  it('模型含流程无法提供的必填参数时在创建付费任务前失败', async () => {
    await expect(
      runResponseText({
        user: '用户问题',
        modelVersionId: 701,
        requestContext: {
          workspaceId: 41,
          modelVersion: {
            id: 701,
            display_name: '严格脚本模型',
            params_schema: {
              fields: [{ name: 'tenant_prompt_profile', required: true }],
            },
          },
        },
      }),
    ).rejects.toThrow('tenant_prompt_profile')

    expect(mocks.createAiResponse).not.toHaveBeenCalled()
    expect(mocks.streamAiResponse).not.toHaveBeenCalled()
  })
})

describe('buildResponseModelParams', () => {
  it('旧模型没有 schema 时保持兼容参数', () => {
    expect(buildResponseModelParams(undefined, { temperature: 0.3, maxOutputTokens: 256 })).toEqual({
      temperature: 0.3,
      max_output_tokens: 256,
    })
  })

  it('必填枚举只有一个值时使用该后端值', () => {
    expect(
      buildResponseModelParams(
        {
          params_schema: {
            fields: [{ name: 'response_mode', required: true, options: [{ value: 'structured' }] }],
          },
        },
        { temperature: 0.7, maxOutputTokens: 512 },
      ),
    ).toEqual({ response_mode: 'structured' })
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

  it('非流式成功但响应为空时 fail closed，不再另发流式任务', async () => {
    const controller = new AbortController()
    mocks.createAiResponse.mockResolvedValue({ response: { output: [] } })

    await expect(
      runResponseText({
        system: '系统设定',
        user: '用户问题',
        temperature: 0.2,
        maxTokens: 99,
        signal: controller.signal,
      }),
    ).rejects.toThrow('已停止重试以避免重复生成')

    expect(mocks.createAiResponse).toHaveBeenCalledOnce()
    expect(mocks.streamAiResponse).not.toHaveBeenCalled()
  })

  it('非流式 null 响应同样不会创建第二个任务', async () => {
    mocks.createAiResponse.mockResolvedValue(null)

    await expect(runResponseText({ user: '问题' })).rejects.toThrow('未返回可解析文本')

    expect(mocks.createAiResponse).toHaveBeenCalledOnce()
    expect(mocks.streamAiResponse).not.toHaveBeenCalled()
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
    ['HTTP 400 明确拒绝 streaming', { status: 400, code: 'STREAMING_NOT_SUPPORTED', message: 'Bad Request' }],
    ['HTTP 405 明确拒绝 SSE', { status: 405, message: 'SSE is not supported' }],
    ['HTTP 415 明确拒绝 event-stream', { status: 415, message: 'event-stream unsupported' }],
    ['HTTP 422 中文明确拒绝流式', { status: 422, businessMessage: '当前模型不支持流式响应' }],
    ['HTTP 501 明确未实现 stream', { status: 501, code_string: 'STREAM_NOT_IMPLEMENTED' }],
    ['嵌套后端错误码明确拒绝 SSE', { status: 406, response: { data: { code: 'SSE_UNSUPPORTED' } } }],
  ])('%s 时才安全回退到非流式', async (_label, streamError) => {
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

  it('显式模型的流式请求失败后使用同一模型进行非流式回退', async () => {
    mocks.streamAiResponse.mockRejectedValue({ status: 415, code: 'STREAM_UNSUPPORTED' })
    mocks.createAiResponse.mockResolvedValue({ text: '固定模型回退结果' })

    await expect(streamResponseText({ user: '问题', modelVersionId: 702 })).resolves.toBe('固定模型回退结果')

    expect(mocks.streamAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        modelVersionId: 702,
        operationCode: 'responses.multimodal',
      }),
    )
    expect(mocks.createAiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        modelVersionId: 702,
        operationCode: 'responses.multimodal',
      }),
    )
  })

  it.each([
    ['HTTP 401 即使包含 SSE 文本', { status: 401, message: 'SSE token expired' }],
    ['HTTP 403', { status: 403, message: 'forbidden' }],
    ['HTTP 500', { status: 500, message: 'server failed' }],
    ['HTTP 599', { status: 599, message: 'upstream failed' }],
    ['HTTP 400 泛化 Bad Request', { status: 400, message: 'Bad Request' }],
    ['HTTP 400 普通参数错误', { status: 400, code: 'INVALID_PARAMS', message: 'invalid payload' }],
    ['断流', new Error('SSE event-stream disconnected')],
    ['规范化响应流中断', { status: 502, message: 'gateway', businessMessage: '响应流中断' }],
    ['普通网络错误', new TypeError('Failed to fetch')],
    ['非标准 600 状态', { status: 600, message: 'unknown status' }],
  ])('%s 属于模糊失败，不回退并原样传播', async (_label, streamError) => {
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

    await expect(streamResponseText({ user: '问题', signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })

    expect(mocks.streamAiResponse).not.toHaveBeenCalled()
    expect(mocks.createAiResponse).not.toHaveBeenCalled()
  })

  it('非流式回退失败时传播最终错误', async () => {
    const fallbackError = new Error('非流式也失败')
    mocks.streamAiResponse.mockRejectedValue({ status: 415, message: 'streaming not supported' })
    mocks.createAiResponse.mockRejectedValue(fallbackError)

    await expect(streamResponseText({ user: '问题' })).rejects.toBe(fallbackError)

    expect(mocks.createAiResponse).toHaveBeenCalledOnce()
  })
})
