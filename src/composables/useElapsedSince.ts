import { useEffect, useState } from 'react'

/**
 * 从某个时间点（ISO 字符串）起已经过去的整秒数，active 期间每秒刷新一次。
 *
 * 画布视频节点用它驱动预计进度；其他生成节点仍可显示已用时。
 * 起点取持久化的 taskStartedAt，刷新页面后接着走，不会从 0 重来。
 *
 * 起点缺失或无法解析时返回 null，调用方据此不显示计时。
 */
export function useElapsedSince(startedAt: unknown, active: boolean): number | null {
  const startMs = typeof startedAt === 'string' && startedAt ? Date.parse(startedAt) : NaN
  const valid = active && Number.isFinite(startMs)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!valid) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [valid, startMs])

  if (!valid) return null
  // 本机时钟回拨时不显示负数
  return Math.max(0, Math.floor((now - startMs) / 1000))
}
