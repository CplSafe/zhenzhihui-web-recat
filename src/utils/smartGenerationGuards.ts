/**
 * 智能成片生成前置守卫：稳定比较素材、校验分镜引用完整性，并先持久化入口图片。
 * 临时 data/blob 素材必须获得资产 ID 后才能发起生成，防止刷新或后台任务读取失效地址。
 */
import { buildPersistentAssetUrl } from '@/utils/persistentMediaUrl'

/** 仅存在于当前浏览器会话的临时媒体协议。 */
const TEMPORARY_MEDIA_RE = /^(?:data:|blob:)/i

/** 将候选素材标识规范化为正整数。 */
function positiveId(value: unknown): number {
  const id = Math.floor(Number(value) || 0)
  return id > 0 ? id : 0
}

/** 为生成素材构建不受签名参数变化影响的稳定比较键。 */
export function stableGenerationAssetKey(url: unknown, assetId: unknown): string {
  const id = positiveId(assetId)
  if (id) return `asset:${id}`
  const value = typeof url === 'string' ? url.trim() : ''
  if (!value || TEMPORARY_MEDIA_RE.test(value)) return value
  // 草稿水合只会刷新媒体签名；query/hash 不应被当成画面内容变化而触发自动重生成。
  if (/^(?:https?:\/\/|\/(?!\/))/i.test(value)) return value.split(/[?#]/, 1)[0]
  return value
}

/**
 * 校验提交给视频模型的参考图 asset_id。
 *
 * 参考图不再与分镜一一对应：用户上传的素材整体作为参考图下发，模型据此生成全片，
 * 中间没有逐镜出图环节。允许的张数由所选模型声明（后端 input_constraints），
 * 各模型差别很大，所以上限由调用方按当前模型传入。
 *
 * 空集合合法（纯文生视频）；超过上限直接拦下而不是截断——静默丢掉用户挑的素材，
 * 比报错更难被发现。
 */
export function requireReferenceImageAssetIds(assetIds: unknown[], maxCount: number): number[] {
  const ids = (assetIds || []).map(positiveId).filter((id) => id > 0)
  const ceiling = positiveId(maxCount)
  if (ceiling && ids.length > ceiling) {
    throw new Error(`当前模型最多支持 ${ceiling} 张参考图，请先移除多余素材（当前 ${ids.length} 张）`)
  }
  return ids
}

/** 并行持久化入口图片并返回与原顺序严格对应的稳定地址和资产 ID。 */
export async function persistSmartEntryImages(
  workspaceId: number,
  images: string[],
  persist: (
    workspaceId: number,
    url: string,
    cache: Record<string, number>,
  ) => Promise<{ url: string; assetId: number }>,
  knownAssetIds: unknown[] = [],
): Promise<{ images: string[]; imageAssetIds: number[] }> {
  const cache: Record<string, number> = {}
  const items = await Promise.all(
    images.map(async (sourceUrl, index) => {
      const knownAssetId = positiveId(knownAssetIds[index])
      if (knownAssetId) {
        return {
          assetId: knownAssetId,
          url: buildPersistentAssetUrl(knownAssetId, workspaceId) || String(sourceUrl || ''),
        }
      }
      let persisted: { url: string; assetId: number }
      try {
        persisted = await persist(workspaceId, sourceUrl, cache)
      } catch (error: any) {
        throw new Error(`第 ${index + 1} 张入口素材上传失败：${error?.message || '请稍后重试'}`)
      }

      const assetId = positiveId(persisted?.assetId)
      if (TEMPORARY_MEDIA_RE.test(sourceUrl) && !assetId) {
        throw new Error(`第 ${index + 1} 张入口素材上传失败，请重试后再开始生成`)
      }

      return {
        assetId,
        url:
          (assetId ? buildPersistentAssetUrl(assetId, workspaceId) : '') || String(persisted?.url || sourceUrl || ''),
      }
    }),
  )

  return {
    images: items.map((item) => item.url),
    imageAssetIds: items.map((item) => item.assetId),
  }
}

/** 根据已收到分镜数量生成可继续操作的流式脚本错误提示。 */
export function scriptStreamFailureMessage(error: unknown, receivedCount: number): string {
  const detail =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message || '').trim()
      : ''
  if (receivedCount > 0) {
    return `脚本生成中断，已保留 ${receivedCount} 个分镜；${detail || '请重试以生成完整脚本'}`
  }
  return detail || '脚本生成失败，请重试'
}
