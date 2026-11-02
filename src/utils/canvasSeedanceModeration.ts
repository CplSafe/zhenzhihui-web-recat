import { BusinessApiError, getSeedanceModeration, submitSeedanceModeration } from '@/api/business'
import { normalizeSeedanceModerationResult } from '@/utils/seedanceModeration'

/** Ensure a Seedance input asset has passed moderation before it is used for generation. */
export async function ensureCanvasSeedanceModeration(
  assetId: number,
  workspaceId: number,
  mediaType: string,
): Promise<string | null> {
  const query = async () => normalizeSeedanceModerationResult(await getSeedanceModeration(assetId, { workspaceId }))

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
  if (result?.state === 'rejected') {
    const reason = result.reason ? `：${result.reason}` : ''
    return `${mediaType}素材 ID ${assetId}审核未通过${reason}，请更换素材后重试`
  }
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
      if (result.state === 'rejected') {
        const reason = result.reason ? `：${result.reason}` : ''
        return `${mediaType}素材 ID ${assetId}审核未通过${reason}，请更换素材后重试`
      }
      if (result.state === 'unknown' || result.state === 'unreviewed') {
        return `${mediaType}素材 ID ${assetId}审核状态无法确认，请稍后重试`
      }
    }
    return `${mediaType}素材 ID ${assetId}仍在审核中，请稍后重试`
  } catch {
    return `自动审核${mediaType}素材 ID ${assetId}失败，请稍后重试`
  }
}
