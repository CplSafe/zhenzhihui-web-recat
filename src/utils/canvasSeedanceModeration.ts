import {
  BusinessApiError,
  getSeedanceModeration,
  humanizeVideoAspectRatioError,
  submitSeedanceModeration,
} from '@/api/business'
import { assetStreamUrl } from '@/utils/assetUrl'
import {
  type ImageDimensions,
  isSupportedVideoReferenceImageAspectRatio,
  readImageDimensions,
  videoReferenceImageIssue,
} from '@/utils/imageFile'
import { normalizeSeedanceModerationResult, type SeedanceModerationResult } from '@/utils/seedanceModeration'
import { readVideoMetadata } from '@/utils/videoDuration'

// 火山方舟的单个参考视频宽高比限制，适用于 Seedance 2.0 / 2.5 系列。
const SEEDANCE_VIDEO_MIN_ASPECT_RATIO = 0.4
const SEEDANCE_VIDEO_MAX_ASPECT_RATIO = 2.5

/** 手动送审检查原图比例，视频生成同时检查参考图像素尺寸。 */
export async function readCanvasSeedanceImageAspectRatioIssue(
  assetId: number,
  workspaceId: number,
  checkVideoInputDimensions = false,
): Promise<(ImageDimensions & { url: string }) | null> {
  const url = assetStreamUrl(assetId, workspaceId)
  const readError = `无法读取图片素材 ID ${assetId} 的原图尺寸，请确认素材可预览后重试`
  if (!url) throw new Error(readError)

  const size = await readImageDimensions(url).catch(() => {
    throw new Error(readError)
  })
  const isValid = checkVideoInputDimensions
    ? !videoReferenceImageIssue(size)
    : isSupportedVideoReferenceImageAspectRatio(size)
  return isValid ? null : { url, ...size }
}

/** 只读取原视频元数据并提示范围。无法读取尺寸时继续由服务端校验。 */
export async function readCanvasSeedanceVideoAspectRatioIssue(
  assetId: number,
  workspaceId: number,
  title?: string,
): Promise<string | null> {
  const url = assetStreamUrl(assetId, workspaceId)
  if (!url) return null
  const dimensions = await readVideoMetadata(url).catch(() => null)
  if (!dimensions || !(dimensions.width > 0) || !(dimensions.height > 0)) return null

  const { width, height } = dimensions
  const ratio = width / height
  if (ratio >= SEEDANCE_VIDEO_MIN_ASPECT_RATIO && ratio <= SEEDANCE_VIDEO_MAX_ASPECT_RATIO) return null
  const name = title?.trim()
  const label = name ? `视频「${name}」` : `视频素材 ID ${assetId}`
  return `${label}尺寸为 ${width} × ${height} 像素，宽高比（宽 ÷ 高）最小 ${SEEDANCE_VIDEO_MIN_ASPECT_RATIO}、最大 ${SEEDANCE_VIDEO_MAX_ASPECT_RATIO}。请手动裁剪到此范围后重试`
}

/** Ensure a Seedance input asset has passed moderation before it is used for generation. */
export async function ensureCanvasSeedanceModeration(
  assetId: number,
  workspaceId: number,
  mediaType: string,
): Promise<string | null> {
  const query = async () => normalizeSeedanceModerationResult(await getSeedanceModeration(assetId, { workspaceId }))
  const videoLabel = mediaType === '视频' ? `视频素材 ID ${assetId}` : ''
  const rejected = ({ reason, lastError }: SeedanceModerationResult) =>
    (videoLabel && humanizeVideoAspectRatioError(lastError || reason, videoLabel)) ||
    `${mediaType}素材 ID ${assetId}审核未通过${reason ? `：${reason}` : ''}，请更换素材后重试`

  let result
  try {
    result = await query()
  } catch (cause) {
    // 404 means this asset has never been submitted; other errors are not safe to treat as unreviewed.
    if (!(cause instanceof BusinessApiError) || (cause as BusinessApiError & { status?: number }).status !== 404) {
      return `无法确认${mediaType}素材 ID ${assetId} 的 Seedance 审核状态，请稍后重试`
    }
    result = null
  }

  if (result?.state === 'approved') return null
  if (result?.state === 'rejected') return rejected(result)
  if (result?.state === 'unknown') {
    return `${mediaType}素材 ID ${assetId}审核状态无法识别，请稍后刷新状态再试`
  }

  try {
    if (result?.state !== 'pending') {
      await submitSeedanceModeration(assetId, { workspaceId })
    }
    const startedAt = Date.now()
    while (Date.now() - startedAt < 60_000) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
      result = await query()
      if (result.state === 'approved') return null
      if (result.state === 'rejected') return rejected(result)
      if (result.state === 'unknown' || result.state === 'unreviewed') {
        return `${mediaType}素材 ID ${assetId}审核状态无法确认，请稍后重试`
      }
    }
    return `${mediaType}素材 ID ${assetId}仍在审核中，请稍后重试`
  } catch (cause) {
    if (videoLabel && cause instanceof Error) {
      const aspectIssue = humanizeVideoAspectRatioError(cause, videoLabel)
      if (aspectIssue) return aspectIssue
    }
    return `自动审核${mediaType}素材 ID ${assetId}失败，请稍后重试`
  }
}
