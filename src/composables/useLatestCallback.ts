/**
 * 模块职责：提供引用稳定、但始终调用最新实现的 React 回调 Hook。
 * 适用于定时器、事件订阅和异步恢复流程，避免状态变化导致 effect 重启。
 */
import { useCallback, useRef } from 'react'

/** 返回一个恒定函数引用；每次执行时转发给最近一次渲染传入的 callback。 */
export function useLatestCallback<T extends (...args: any[]) => any>(callback: T): T {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  return useCallback(((...args: Parameters<T>) => callbackRef.current(...args)) as T, [])
}
