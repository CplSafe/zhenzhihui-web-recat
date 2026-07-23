/**
 * 模块职责：校验并规范化开发服务器代理目标。
 * 只接受不含路径、查询、片段和凭据的 HTTP(S) origin，避免请求被静默转发到意外地址。
 */
export function resolveProxyTarget(configuredValue: string | undefined, fallback: string, envName: string): string {
  const configuredTarget = String(configuredValue || '').trim()
  const target = configuredTarget || String(fallback || '').trim()

  try {
    const parsed = new URL(target)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsafe protocol')
    if (parsed.username || parsed.password) throw new Error('credentials are not allowed')
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('origin required')
    return parsed.origin
  } catch {
    throw new Error(`${envName} 必须是不含路径、查询、片段或凭据的 HTTP(S) origin`)
  }
}
