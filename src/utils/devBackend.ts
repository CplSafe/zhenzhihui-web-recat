/**
 * 开发后端配置探测：浏览器只读取是否配置代理的布尔标记，不接触服务端目标地址。
 * 未配置真实后端时，开发环境可继续沿用现有的模拟会话行为。
 */
export function hasConfiguredDevBackend(): boolean {
  if (!import.meta.env.DEV) return true
  if (typeof import.meta.env.ZZH_DEV_PROXY_CONFIGURED === 'boolean') {
    return import.meta.env.ZZH_DEV_PROXY_CONFIGURED
  }
  return import.meta.env.MODE === 'test'
}
