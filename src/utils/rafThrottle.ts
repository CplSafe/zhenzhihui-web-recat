/**
 * 帧节流：把一帧内的多次调用合并成一次，在下一次重绘前只执行最后一次。
 *
 * scroll / resize / pointermove 这类监听会连续触发，回调里若读取布局
 * （getBoundingClientRect 等）或 setState，每个事件就是一次强制同步布局加一次
 * 重渲染。用它包一层后，浏览器每帧最多付出一次代价，跟随效果仍然不掉队。
 *
 * 捕获阶段的 scroll 监听（addEventListener('scroll', fn, true)）尤其需要：
 * 页面上任意可滚动祖先滚动都会触发它。
 */

/** 帧节流包装后的函数：卸载时调用 cancel 丢弃尚未执行的那一帧。 */
export interface RafThrottledFunction<A extends unknown[]> {
  (...args: A): void
  /** 取消尚未执行的那一帧，避免卸载后仍然触发回调。 */
  cancel(): void
}

/** 生成 fn 的帧节流版本；同一帧内的多次调用只保留最后一次的参数。 */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): RafThrottledFunction<A> {
  let frame = 0
  let pendingArgs: A | null = null

  const throttled = ((...args: A) => {
    pendingArgs = args
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const args2 = pendingArgs
      pendingArgs = null
      if (args2) fn(...args2)
    })
  }) as RafThrottledFunction<A>

  throttled.cancel = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    pendingArgs = null
  }

  return throttled
}
