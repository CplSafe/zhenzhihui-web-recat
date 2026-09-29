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
