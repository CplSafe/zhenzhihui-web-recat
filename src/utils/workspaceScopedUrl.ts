/**
 * 工作区素材地址绑定工具：只修改明确的应用 assets 下载路径中的 workspace_id。
 * 第三方 CDN 或签名地址保持原样，避免破坏其签名与跨域语义。
 */
/** 可安全重绑定工作区参数的素材路径格式。 */
const WORKSPACE_ASSET_PATH = /^\/(?:api\/v1\/)?assets\/\d+(?:\/download)?\/?$/i

/**
 * 后端有时会把头像返回为带“上一个工作空间 workspace_id”的素材直传 URL。
 * 仅对明确的 assets 路径替换 workspace_id，其它 CDN/签名地址保持不变。
 */
export function bindAssetUrlToWorkspace(value: unknown, workspaceId: unknown): string {
  const raw = String(value ?? '').trim()
  const ws = Math.floor(Number(workspaceId) || 0)
  if (!raw || ws <= 0) return raw

  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    const parsed = new URL(raw, 'http://workspace.local')
    if (!WORKSPACE_ASSET_PATH.test(parsed.pathname)) return raw
    parsed.searchParams.set('workspace_id', String(ws))
    return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return raw
  }
}
