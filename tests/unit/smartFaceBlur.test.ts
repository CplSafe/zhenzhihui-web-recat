import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAiTask: vi.fn(),
  waitForAiTask: vi.fn(),
  listAiModels: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  resolveGeneratedMediaUrls: vi.fn(),
  findAssetIdByTaskId: vi.fn(),
  extractOutputAssetId: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  createAiTask: mocks.createAiTask,
  waitForAiTask: mocks.waitForAiTask,
  listAiModels: mocks.listAiModels,
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
}))

vi.mock('@/utils/taskMedia', () => ({
  resolveGeneratedMediaUrls: mocks.resolveGeneratedMediaUrls,
  findAssetIdByTaskId: mocks.findAssetIdByTaskId,
  extractOutputAssetId: mocks.extractOutputAssetId,
}))

import { blurFacesOnAsset, clearFaceBlurCache, isNoFaceDetectedError } from '@/api/smartFaceBlur'

describe('smartFaceBlur', () => {
  beforeEach(() => {
    clearFaceBlurCache()
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.listAiModels.mockResolvedValue([{ id: 9, name: '人脸检测', operation_codes: ['image.face_detect'] }])
    mocks.createAiTask.mockResolvedValue({ id: 101 })
  })

  it('将 provider 的无人脸结果识别为可复用的业务结果', async () => {
    mocks.waitForAiTask.mockRejectedValue(new Error('InvalidImage.NotFoundFace: 图片中未检测到人脸'))

    const first = await blurFacesOnAsset({ workspaceId: 61, assetId: 2549 })
    const second = await blurFacesOnAsset({ workspaceId: 61, assetId: 2549 })

    expect(first).toMatchObject({ ok: false, noFace: true })
    expect(first.cached).toBeUndefined()
    expect(second).toMatchObject({ ok: false, noFace: true, cached: true })
    expect(second.debug.status).toBe('no_face_cached')
    expect(mocks.createAiTask).toHaveBeenCalledTimes(1)
    expect(mocks.waitForAiTask).toHaveBeenCalledTimes(1)
  })

  it('并发检测同一素材时复用同一个请求', async () => {
    let reject!: (error: Error) => void
    mocks.waitForAiTask.mockReturnValue(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise
      }),
    )

    const first = blurFacesOnAsset({ workspaceId: 61, assetId: 2549 })
    const second = blurFacesOnAsset({ workspaceId: 61, assetId: 2549 })
    reject(new Error('EAS_FACE_NOT_EXIST'))

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.noFace).toBe(true)
    expect(secondResult).toMatchObject({ noFace: true, cached: true })
    expect(mocks.createAiTask).toHaveBeenCalledTimes(1)
  })

  it('不缓存普通服务失败，下次仍会重试', async () => {
    mocks.waitForAiTask.mockRejectedValue(new Error('上游服务超时'))

    await blurFacesOnAsset({ workspaceId: 61, assetId: 2549 })
    await blurFacesOnAsset({ workspaceId: 61, assetId: 2549 })

    expect(mocks.createAiTask).toHaveBeenCalledTimes(2)
  })

  it('从嵌套后端字段识别无人脸语义', () => {
    expect(isNoFaceDetectedError({ response: { error_message: 'no faces detected' } })).toBe(true)
  })
})
