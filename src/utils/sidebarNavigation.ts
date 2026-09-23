/** 应用默认落地页：首页下线后，登录回跳 / 未知路由 / 根路径都进入爆款复刻。 */
export const APP_HOME_PATH = '/hot-copy'

/** 全站侧边栏已上线入口的唯一路由表，页面不应再复制这份映射。 */
export const SIDEBAR_ROUTE_MAP: Readonly<Record<string, string>> = Object.freeze({
  // 首页已下线，旧的 home 键落到新的默认入口（爆款复刻）
  home: APP_HOME_PATH,
  market: '/market',
  canvas: '/canvas',
  studio: '/studio',
  creative: '/smart',
  'real-person-video': '/real-person-video',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
  'template-local-life': '/templates?category=local-life',
  'template-ecommerce': '/templates?category=ecommerce',
  distribution: '/distribution',
  team: '/team',
  collaborations: '/collaborations',
})

/** 解析侧边栏键对应的页面路径；未上线入口返回 undefined。 */
export function getSidebarRoute(key: string): string | undefined {
  return SIDEBAR_ROUTE_MAP[key]
}
