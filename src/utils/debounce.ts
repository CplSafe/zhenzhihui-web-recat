/**
 * 高频输入去抖：约定窗口内的连续调用只执行最后一次。
 * 适用于搜索输入、表单实时校验、草稿落盘这类「用户停下来再处理」的场景。
 *
 * 与 rafThrottle 的分工：去抖只在停止调用之后执行一次，过程中不产生任何更新；
 * 跟随式 UI（浮层定位、拖拽）需要每帧都更新，必须改用 rafThrottle。
 */

/** 去抖包装后的函数：可丢弃待执行调用，也可立即结算。 */
export interface DebouncedFunction<A extends unknown[]> {
  (...args: A): void
  /** 丢弃尚未执行的那次调用。组件卸载时调用，避免卸载后仍触发副作用。 */
  cancel(): void
  /** 立即执行尚未执行的那次调用；没有待执行调用时什么都不做。 */
  flush(): void
}

/** 生成 fn 的去抖版本，默认 300ms 窗口。 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs = 300): DebouncedFunction<A> {
  let timer = 0
  let pendingArgs: A | null = null

  const run = () => {
    const args = pendingArgs
    timer = 0
    pendingArgs = null
    if (args) fn(...args)
  }

  const debounced = ((...args: A) => {
    pendingArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, waitMs)
  }) as DebouncedFunction<A>

  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = 0
    pendingArgs = null
  }

  debounced.flush = () => {
    if (!timer) return
    clearTimeout(timer)
    run()
  }

  return debounced
}
