import { describe, expect, it } from 'vitest'
import { getSidebarRoute, SIDEBAR_ROUTE_MAP } from '@/utils/sidebarNavigation'

describe('sidebarNavigation', () => {
  it('把真人成片解析为已上线路由', () => {
    expect(getSidebarRoute('real-person-video')).toBe('/real-person-video')
  })

  it('未上线菜单仍保持未命中，交由页面展示待开放提示', () => {
    expect(getSidebarRoute('video-edit')).toBeUndefined()
  })

  it('路由表不能在运行时被页面篡改', () => {
    expect(Object.isFrozen(SIDEBAR_ROUTE_MAP)).toBe(true)
  })
  it('resolves the creative canvas route', () => {
    expect(getSidebarRoute('canvas')).toBe('/canvas')
  })
})
