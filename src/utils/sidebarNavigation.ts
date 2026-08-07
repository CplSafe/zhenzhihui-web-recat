/** 全站侧边栏已上线入口的唯一路由表，页面不应再复制这份映射。 */
export const SIDEBAR_ROUTE_MAP: Readonly<Record<string, string>> = Object.freeze({
  home: '/home',
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
})

/** 解析侧边栏键对应的页面路径；未上线入口返回 undefined。 */
export function getSidebarRoute(key: string): string | undefined {
  return SIDEBAR_ROUTE_MAP[key]
}
