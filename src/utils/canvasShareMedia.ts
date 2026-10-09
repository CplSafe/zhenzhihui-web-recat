/** 分享接口可返回匿名可访问的地址；历史画布仍兼容原有 resultUrl。 */
export function resolveCanvasShareMediaUrl(
  data: Record<string, unknown>,
  kind: 'result' | 'poster' = 'result',
): string {
  const keys =
    kind === 'poster'
      ? ['publicPosterUrl', 'public_poster_url', 'sharePosterUrl', 'share_poster_url', 'posterUrl']
      : ['publicResultUrl', 'public_result_url', 'shareMediaUrl', 'share_media_url', 'resultUrl']
  for (const key of keys) {
    const value = typeof data[key] === 'string' ? data[key].trim() : ''
    // blob: 只在创建它的浏览器会话有效，不能拿来作为可分享素材。
    if (value && !value.startsWith('blob:')) return value
  }
  return ''
}

function shareAssetUrl(token: string, assetId: unknown): string {
  const id = Number(assetId)
  if (!token || !Number.isSafeInteger(id) || id <= 0) return ''
  return `/api/v1/canvas-shares/${encodeURIComponent(token)}/assets/${id}`
}

/**
 * 节点素材在分享页的匿名地址，结果写进 shareMediaUrl / sharePosterUrl 供 resolveCanvasShareMediaUrl 读取。
 *
 * 节点存的 resultUrl 多是 /api/v1/assets/{id}/download：要登录且是工作空间成员，匿名访客取必然失败。
 * 有素材 ID 就改走分享口令下的素材接口（后端只放行画布里确实引用的素材）；
 * 没有时返回空串，由 resolveCanvasShareMediaUrl 回退到节点原有地址。
 */
export function resolvePublicCanvasNodeMedia(
  token: string,
  data: Record<string, unknown> | undefined,
): { url: string; posterUrl: string } {
  const record = data || {}
  return { url: shareAssetUrl(token, record.assetId), posterUrl: shareAssetUrl(token, record.posterAssetId) }
}
