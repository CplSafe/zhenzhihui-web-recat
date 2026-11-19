import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runResponseText } from '@/api/aiResponses'
import { BusinessApiError, resolveTaskModel } from '@/api/business'
import { recognizeCanvasSubjectCandidates } from '@/api/canvasSubjectRecognition'

vi.mock('@/api/aiResponses', () => ({ runResponseText: vi.fn() }))
vi.mock('@/api/business', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/business')>()),
  resolveTaskModel: vi.fn(),
}))

const model = { model_version_id: 22, id: 11 }
const image = { workspaceId: 7, canvasId: 10, imageAssetId: 42, point: { x: 0.4, y: 0.5 } }
const frame = { workspaceId: 7, frameDataUrl: 'data:image/jpeg;base64,AAAA', point: { x: 0.4, y: 0.5 } }
const glasses = { label: '眼镜', bounds: { x: 0.3, y: 0.42, width: 0.2, height: 0.16 } }
const face = { label: '侧脸', bounds: { x: 0.25, y: 0.31, width: 0.35, height: 0.4 } }

describe('recognizeCanvasSubjectCandidates', () => {
  beforeEach(() => {
    vi.mocked(resolveTaskModel).mockReset().mockResolvedValue(model)
    vi.mocked(runResponseText).mockReset()
  })

  it('复用已有图片素材，并锁定同一工作区、画布和模型版本', async () => {
    vi.mocked(runResponseText).mockResolvedValue(
      `\`\`\`json\n${JSON.stringify({ candidates: [glasses, face] })}\n\`\`\``,
    )
    await expect(recognizeCanvasSubjectCandidates(image)).resolves.toEqual([glasses, face])

    expect(resolveTaskModel).toHaveBeenCalledWith({ operationCode: 'responses.multimodal', workspaceId: 7 })
    expect(runResponseText).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        user: expect.stringContaining('x=0.400000, y=0.500000'),
        imageAssetIds: [42],
        modelVersionId: 22,
        requestContext: { workspaceId: 7, canvasId: 10, modelVersionId: 22, modelVersion: model },
      }),
    )
    expect(vi.mocked(runResponseText).mock.calls[0][0]).not.toHaveProperty('images')
  })

  it('通过共享上传链路提交标记帧，并区分无匹配主体', async () => {
    const controller = new AbortController()
    vi.mocked(runResponseText).mockResolvedValue('{"candidates":[]}')
    await expect(recognizeCanvasSubjectCandidates({ ...frame, signal: controller.signal })).resolves.toEqual([])
    expect(runResponseText).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ images: [frame.frameDataUrl], signal: controller.signal }),
    )
    expect(vi.mocked(runResponseText).mock.calls[0][0]).not.toHaveProperty('imageAssetIds')
  })

  it('过滤重复名称、无效坐标和未覆盖点击的候选，保留最多四个', async () => {
    const candidates = [
      null,
      { ...glasses, label: 42 },
      { ...glasses, label: '  眼镜  ' },
      { ...glasses, label: '候选名称过长'.repeat(8) },
      { ...glasses, label: '远处衣物', bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
      { ...glasses, label: '非法边缘', bounds: { x: 0.3, y: 0.42, width: 0.8, height: 0.6 } },
      { ...glasses, label: '无面积', bounds: { x: 0.4, y: 0.5, width: 0, height: 0.2 } },
      { ...glasses, label: '字符串坐标', bounds: { ...glasses.bounds, x: '0.3' } },
      glasses,
      face,
      { ...face, label: '帽檐' },
      { ...face, label: '帽子' },
      { ...face, label: '人物' },
    ]
    vi.mocked(runResponseText).mockResolvedValue(JSON.stringify({ candidates }))
    await expect(recognizeCanvasSubjectCandidates(image)).resolves.toEqual([
      glasses,
      face,
      { ...face, label: '帽檐' },
      { ...face, label: '帽子' },
    ])
  })

  it.each(['无法判断', '{}', '{"candidates":[null]}'])('报告无效识别结果 %s', async (response) => {
    vi.mocked(runResponseText).mockResolvedValue(response)
    await expect(recognizeCanvasSubjectCandidates(image)).rejects.toThrow('主体识别结果格式不正确')
  })

  it('在查模型前拒绝无效来源或点击位置', async () => {
    await expect(recognizeCanvasSubjectCandidates({ ...image, workspaceId: 0 })).rejects.toThrow('未选择工作空间')
    await expect(recognizeCanvasSubjectCandidates({ ...image, imageAssetId: 4.2 })).rejects.toThrow('图片素材无效')
    await expect(recognizeCanvasSubjectCandidates({ ...image, point: { x: NaN, y: 0.5 } })).rejects.toThrow('点选主体')
    await expect(recognizeCanvasSubjectCandidates({ ...frame, frameDataUrl: 'https://example.test' })).rejects.toThrow(
      '当前帧无法识别',
    )
    await expect(
      recognizeCanvasSubjectCandidates({ ...frame, frameDataUrl: frame.frameDataUrl.repeat(900_000) }),
    ).rejects.toThrow('当前帧超过 10 MB')
    expect(resolveTaskModel).not.toHaveBeenCalled()
  })

  it('模型不可用、请求已取消或请求失败时不会继续提交识别', async () => {
    vi.mocked(resolveTaskModel).mockRejectedValueOnce(new BusinessApiError('missing', { code: 'MODEL_NOT_FOUND' }))
    await expect(recognizeCanvasSubjectCandidates(image)).rejects.toThrow('当前工作空间未启用视觉理解模型')
    vi.mocked(resolveTaskModel).mockResolvedValueOnce({ id: 0 })
    await expect(recognizeCanvasSubjectCandidates(image)).rejects.toThrow('当前工作空间未启用视觉理解模型')
    const networkError = new Error('offline')
    vi.mocked(resolveTaskModel).mockRejectedValueOnce(networkError)
    await expect(recognizeCanvasSubjectCandidates(image)).rejects.toBe(networkError)

    const controller = new AbortController()
    vi.mocked(resolveTaskModel).mockImplementationOnce(async () => {
      controller.abort()
      return model
    })
    await expect(recognizeCanvasSubjectCandidates({ ...image, signal: controller.signal })).rejects.toHaveProperty(
      'name',
      'AbortError',
    )
    expect(runResponseText).not.toHaveBeenCalled()
  })
})
