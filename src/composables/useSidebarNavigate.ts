/**
 * useSidebarNavigate — <AppSidebar onNavigate> 的统一处理。
 * 之前 8 个视图各存一份逐字相同的 ROUTE_MAP + handler(改路由极易漏改某一份),集中到这里。
 * 已上线项跳路由;未上线项(设置/视频编辑/投前预审/数据看板等)弹全局「功能待开放」。
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { openComingSoon } from '@/stores/ui'
import { getSidebarRoute } from '@/utils/sidebarNavigation'

/** 返回侧边栏统一导航处理器，未开放入口改为展示全局提示。 */
export function useSidebarNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (key: string) => {
      const path = getSidebarRoute(key)
      // 从侧边栏进入创作入口表示开始一条新创作，而不是继续上一次已经完成的入口草稿。
      // 路由包装会用该标记重挂载 SmartCreateView，并由页面统一清理项目草稿和入口暂存。
      if (key === 'creative' && path) navigate(path, { state: { taskCenterNewSession: true } })
      else if (path) navigate(path)
      else openComingSoon()
    },
    [navigate],
  )
}
