import { afterEach, describe, expect, it, vi } from 'vitest'
import * as business from '@/api/business'
import {
  ensureCanvasSeedanceModeration,
  readCanvasSeedanceImageAspectRatioIssue,
  readCanvasSeedanceVideoAspectRatioIssue,
} from '@/utils/canvasSeedanceModeration'
import * as imageFile from '@/utils/imageFile'
import * as videoDuration from '@/utils/videoDuration'

afterEach(() => vi.useRealTimers())

describe('Seedance asset aspect ratio preflight', () => {
  it.each([
    [400, 1000],
    [1000, 400],
  ])('accepts the inclusive video boundary %i × %i', async (width, height) => {
    const read = vi.spyOn(videoDuration, 'readVideoMetadata').mockResolvedValue({ width, height, durationSec: 3 })

    await expect(readCanvasSeedanceVideoAspectRatioIssue(5269, 21)).resolves.toBeNull()
    expect(read).toHaveBeenCalledWith('/api/v1/assets/5269/download?workspace_id=21')
  })

  it.each([
    [399, 1000],
    [1001, 400],
  ])('prompts manual video cropping just outside the boundary %i × %i', async (width, height) => {
    vi.spyOn(videoDuration, 'readVideoMetadata').mockResolvedValue({ width, height, durationSec: 3 })

    await expect(readCanvasSeedanceVideoAspectRatioIssue(5269, 21, ' 视频示例 ')).resolves.toBe(
      `视频「视频示例」尺寸为 ${width} × ${height} 像素，宽高比（宽 ÷ 高）最小 0.4、最大 2.5。请手动裁剪到此范围后重试`,
    )
    await expect(readCanvasSeedanceVideoAspectRatioIssue(5269, 21)).resolves.toContain('视频素材 ID 5269')
  })

  it('defers unknown video dimensions to server validation', async () => {
    const read = vi
      .spyOn(videoDuration, 'readVideoMetadata')
      .mockResolvedValueOnce({ width: 0, height: 768, durationSec: 0 })
      .mockRejectedValueOnce(new Error('test read failed'))

    await expect(readCanvasSeedanceVideoAspectRatioIssue(0, 21)).resolves.toBeNull()
    await expect(readCanvasSeedanceVideoAspectRatioIssue(5269, 21)).resolves.toBeNull()
    await expect(readCanvasSeedanceVideoAspectRatioIssue(5269, 21)).resolves.toBeNull()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reads the original image and rejects an unreadable source', async () => {
    vi.spyOn(imageFile, 'readImageDimensions')
      .mockResolvedValueOnce({ width: 2048, height: 768 })
      .mockResolvedValueOnce({ width: 2048, height: 832 })
      .mockRejectedValueOnce(new Error('test read failed'))

    await expect(readCanvasSeedanceImageAspectRatioIssue(5269, 21)).resolves.toEqual({
      width: 2048,
      height: 768,
      url: '/api/v1/assets/5269/download?workspace_id=21',
    })
    await expect(readCanvasSeedanceImageAspectRatioIssue(5274, 21)).resolves.toBeNull()
    await expect(readCanvasSeedanceImageAspectRatioIssue(5274, 21)).rejects.toThrow('无法读取图片素材 ID 5274')
    await expect(readCanvasSeedanceImageAspectRatioIssue(0, 21)).rejects.toThrow('无法读取图片素材 ID 0')
  })

  it.each([
    [255, 512],
    [5761, 2400],
  ])('keeps manual review aspect-only but rejects generation input with width %i × %i', async (width, height) => {
    vi.spyOn(imageFile, 'readImageDimensions').mockResolvedValue({ width, height })

    await expect(readCanvasSeedanceImageAspectRatioIssue(5269, 21)).resolves.toBeNull()
    await expect(readCanvasSeedanceImageAspectRatioIssue(5269, 21, true)).resolves.toEqual({
      width,
      height,
      url: '/api/v1/assets/5269/download?workspace_id=21',
    })
  })
})

describe('automatic Seedance moderation', () => {
  const aspectFailure = 'media aspect ratio must be between 0.4 and 2.5'

  it('uses the video crop reminder if an existing review failed because of aspect ratio', async () => {
    vi.spyOn(business, 'getSeedanceModeration').mockResolvedValue({ status: 'failed', last_error: aspectFailure })
    const submit = vi.spyOn(business, 'submitSeedanceModeration')

    await expect(ensureCanvasSeedanceModeration(5269, 21, '视频')).resolves.toContain('请手动裁剪')
    await expect(ensureCanvasSeedanceModeration(5269, 21, '图片')).resolves.toContain('请更换素材')
    expect(submit).not.toHaveBeenCalled()
  })

  it('uses the video crop reminder if the initial submission returns a ratio error', async () => {
    vi.spyOn(business, 'getSeedanceModeration').mockRejectedValue(new business.BusinessApiError('', { status: 404 }))
    vi.spyOn(business, 'submitSeedanceModeration').mockRejectedValue(
      new business.BusinessApiError('提交失败', { response: { error_message: aspectFailure } }),
    )

    await expect(ensureCanvasSeedanceModeration(5269, 21, '视频')).resolves.toContain('最小 0.4、最大 2.5')
  })

  it('submits once and waits for an active result on a fresh image', async () => {
    vi.useFakeTimers()
    vi.spyOn(business, 'getSeedanceModeration')
      .mockResolvedValueOnce({ status: 'unreviewed' })
      .mockResolvedValueOnce({ status: 'processing' })
      .mockResolvedValueOnce({ status: 'active' })
    const submit = vi.spyOn(business, 'submitSeedanceModeration').mockResolvedValue({ status: 'processing' })

    const result = ensureCanvasSeedanceModeration(5274, 21, '图片')
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBeNull()
    expect(submit).toHaveBeenCalledExactlyOnceWith(5274, { workspaceId: 21 })
  })
})
