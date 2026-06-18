/** 视频发布链接工具 — 生成可复制的视频外链。 */
export function getCopyableVideoLink(videoUrl) {
  return String(videoUrl || '').trim()
}

export function hasCopyableVideoLink(videoUrl) {
  return Boolean(getCopyableVideoLink(videoUrl))
}
