/**
 * useSidebarNavigate — <AppSidebar onNavigate> 的统一处理。
 * 之前 8 个视图各存一份逐字相同的 ROUTE_MAP + handler(改路由极易漏改某一份),集中到这里。
 * 已上线项跳路由;未上线项(设置/视频编辑/投前预审/数据看板等)弹全局「功能待开放」。
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { openComingSoon } from '@/stores/ui'

// 侧边栏导航键 → 路由(creative 即智能成片 /smart)
const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

/** 返回侧边栏统一导航处理器，未开放入口改为展示全局提示。 */
export function useSidebarNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (key: string) => {
      const path = ROUTE_MAP[key]
      if (path) navigate(path)
      else openComingSoon()
    },
    [navigate],
  )
}
