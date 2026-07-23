/** 供页面与组合式逻辑复用的基础通用工具。 */

/**
 * 返回指定毫秒后完成的 Promise，负数会按 0 处理。
 * @param {number} ms 等待毫秒数
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms))
  })
}
