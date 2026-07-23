/**
 * 模块职责：在切换工作空间时提供一次短暂的中转页面，先卸载当前创作页，再由会话层更新工作空间。
 * 页面效果：正常切换期间显示“正在切换空间”；直接访问、状态丢失或切换中断时自动回到首页。
 * 状态边界：只读取路由 state 中的一次性切换标记，并设置恢复超时，避免中转页永久停留。
 */
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

/** 路由状态丢失时中转页自动回首页的最长等待时间。 */
const BRIDGE_RECOVERY_TIMEOUT_MS = 500

/** 在空间切换的两个同步阶段之间显示短暂占位，并处理非法直达。 */
export default function WorkspaceSwitchBridge() {
  const location = useLocation()
  const switchInProgress = Boolean(
    (location.state as { workspaceSwitchInProgress?: boolean } | null)?.workspaceSwitchInProgress,
  )
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    // 切换方应很快完成后续导航；超时后主动恢复首页，避免异常流程留下无限加载页面。
    if (!switchInProgress) return undefined
    const timer = window.setTimeout(() => setTimedOut(true), BRIDGE_RECOVERY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [switchInProgress])

  // 没有合法切换上下文也视为直接访问，用 replace 清掉无意义的桥接历史记录。
  if (!switchInProgress || timedOut) return <Navigate to="/home" replace />
  return <div className="route-loading" aria-label="正在切换空间" />
}
