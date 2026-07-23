/**
 * 资产的同源流式地址(/download,后端鉴权、走 HTTPS、不过期)。
 * 统一此前在 templates / projectVideos / ProjectManagementView / ResourceManagementView 里逐字相同的
 * 4 份内联实现。与 business.getAssetDownloadUrl 同口径,但本函数是纯同步 URL 构造(不返回 Promise),
 * 用于直接当 img/video src 的场景。
 */
export function assetStreamUrl(assetId: number, workspaceId: number): string {
  const id = Number(assetId)
  const ws = Number(workspaceId)
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(ws) || ws <= 0) return ''
  return `/api/v1/assets/${id}/download?workspace_id=${ws}`
}
