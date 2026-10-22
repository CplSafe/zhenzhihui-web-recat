import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasImageMetadataResolver } from '@/api/canvasImageMetadata'
import { getAiTask, listAiModels, listAssets } from '@/api/business'

vi.mock('@/api/business', () => ({
  getAiTask: vi.fn(),
  listAiModels: vi.fn(),
  listAssets: vi.fn(),
  extractAssetPage: (value: any) => value,
}))
beforeEach(() => vi.resetAllMocks())

describe('历史图片生成记录回查', () => {
  it('按素材的真实任务查询超分模型，缓存限定工作空间与本次画廊', async () => {
    vi.mocked(listAssets).mockResolvedValue({
      items: [
        { id: 7, task_id: 51 },
        { id: 8, task_id: 51 },
      ],
      total: 2,
    })
    vi.mocked(getAiTask).mockResolvedValue({
      id: 51,
      operation_code: 'image.upscale',
      model_version_id: 42,
      params_json: '{"seed":0}',
      created_at: '2026-10-22',
    })
    vi.mocked(listAiModels).mockResolvedValue({ items: [{ id: 7, model_version_id: 42, display_name: '超分模型' }] })
    const resolve = createCanvasImageMetadataResolver()
    const result = await resolve({ workspaceId: 21, assetId: 7 })
    expect(result).toMatchObject({
      modelName: '超分模型',
      operationCode: 'image.upscale',
      modelVersionId: 42,
      rows: [{ label: '随机种子', value: '0' }],
    })
    await resolve({ workspaceId: 21, assetId: 8 })
    expect(getAiTask).toHaveBeenCalledTimes(1)
    await resolve({ workspaceId: 22, assetId: 7 })
    expect(listAssets).toHaveBeenCalledTimes(2)
    expect(getAiTask).toHaveBeenLastCalledWith({ workspaceId: 22, taskId: 51 })
  })
  it('翻页查旧资产，重复页有界；不把任务查询失败当作未记录', async () => {
    vi.mocked(listAssets)
      .mockResolvedValueOnce({ items: [{ id: 1 }], total: 3 })
      .mockResolvedValue({ items: [{ id: 7, source_task_id: 51 }], total: 3 })
    vi.mocked(getAiTask)
      .mockRejectedValueOnce(new Error('没有权限'))
      .mockResolvedValue({ id: 51, operation_code: 'image.edit', model_name: '编辑模型' })
    const resolve = createCanvasImageMetadataResolver()
    await expect(resolve({ workspaceId: 21, assetId: 7 })).rejects.toThrow('没有权限')
    expect(listAssets).toHaveBeenCalledTimes(3)
    expect((await resolve({ workspaceId: 21, assetId: 7 }))?.modelName).toBe('编辑模型')
  })
  it('素材未关联任务、任务不匹配或非图片操作时不猜模型', async () => {
    const resolve = createCanvasImageMetadataResolver()
    expect(await resolve({ workspaceId: 0, assetId: 7 })).toBeUndefined()
    vi.mocked(listAssets).mockResolvedValue({ items: [{ id: 1 }, { id: 7, ai_task_id: 51 }], total: 2 })
    expect(await resolve({ workspaceId: 21, assetId: 1 })).toBeUndefined()
    vi.mocked(getAiTask).mockResolvedValue({ id: 99, operation_code: 'image.generate' })
    expect(await resolve({ workspaceId: 21, assetId: 7 })).toBeUndefined()
    vi.mocked(getAiTask).mockResolvedValue({ id: 51, operation_code: 'video.generate' })
    expect(await resolve({ workspaceId: 22, assetId: 7 })).toBeUndefined()
    expect(listAiModels).not.toHaveBeenCalled()
  })
  it('目录不可读时保留真实模型版本 ID，失败的素材查询可重新执行', async () => {
    vi.mocked(listAssets)
      .mockRejectedValueOnce(new Error('离线'))
      .mockResolvedValue({ items: [{ id: 7, task_id: 51 }], total: 1 })
    vi.mocked(getAiTask).mockResolvedValue({
      id: 51,
      operation_code: 'image.generate',
      model_version_id: 42,
      params_json: 'invalid json',
    })
    vi.mocked(listAiModels).mockRejectedValue(new Error('目录不可用'))
    const resolve = createCanvasImageMetadataResolver()
    await expect(resolve({ workspaceId: 21, assetId: 7 })).rejects.toThrow('离线')
    expect(await resolve({ workspaceId: 21, assetId: 7 })).toMatchObject({
      modelName: '',
      modelVersionId: 42,
      rows: [],
    })
  })
})
