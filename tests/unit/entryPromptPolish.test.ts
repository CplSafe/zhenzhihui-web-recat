import { beforeEach, expect, it, vi } from 'vitest'
import { generationPolishContext, polishEntryPrompt } from '@/api/entryPromptPolish'

const mocks = vi.hoisted(() => ({ list: vi.fn(), polish: vi.fn() }))
vi.mock('@/api/business', () => ({ listAiModels: mocks.list }))
vi.mock('@/api/aiPolish', () => ({ polishText: mocks.polish }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.polish.mockResolvedValue('优化文案')
})

it('只查当前空间的润色模型，绑定模型快照并传入对应参考图', async () => {
  mocks.list.mockResolvedValue([
    { id: 1, name: '停用', enabled: false },
    { id: 2, name: '视频模型', operation_codes: ['video.generate'] },
    { id: 3, name: '润色模型' },
  ])
  const signal = new AbortController().signal
  await expect(
    polishEntryPrompt('原文 @图片1', 21, 'video', { images: ['image.png'], imageAssetIds: [9], signal }),
  ).resolves.toBe('优化文案')
  expect(mocks.list).toHaveBeenCalledWith({ workspaceId: 21, operationCode: 'responses.multimodal', signal })
  expect(mocks.polish).toHaveBeenCalledWith(
    '原文 @图片1',
    expect.objectContaining({
      kind: 'generic',
      images: ['image.png'],
      imageAssetIds: [9],
      signal,
      maxTokens: 2000,
      modelVersionId: 3,
      requestContext: expect.objectContaining({
        workspaceId: 21,
        modelVersionId: 3,
        modelVersion: expect.objectContaining({ id: 3 }),
      }),
      context: expect.stringContaining('主体不变'),
    }),
  )
  expect(mocks.polish.mock.calls[0][1].context).toContain('@素材引用')
})

it('未选择空间或无可用模型时不发起付费润色', async () => {
  await expect(polishEntryPrompt('主题', 0, 'video', {})).rejects.toThrow('工作空间')
  expect(mocks.list).not.toHaveBeenCalled()
  mocks.list.mockResolvedValue([])
  await expect(polishEntryPrompt('主题', 21, 'video', {})).rejects.toThrow('暂无可用')
  expect(mocks.polish).not.toHaveBeenCalled()
})

it.each(['video', 'image'])('纯文本与参考图采用画布的 %s 润色语境', (kind) => {
  expect(generationPolishContext(kind, true)).toContain('参考图中的主体不变')
  expect(generationPolishContext(kind, false)).toContain('请补充场景')
  expect(generationPolishContext(kind, false)).toContain(kind === 'video' ? '主体动作' : '材质')
})
