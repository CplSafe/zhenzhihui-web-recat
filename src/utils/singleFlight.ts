/**
 * 单航班异步工具：相同实例的并发调用共享一个 Promise，并允许显式重置。
 * 通过请求令牌避免重置前的旧 Promise 在完成时误清除新请求。
 */
/** 可复用的并发请求去重控制器。 */
export interface SingleFlight<T> {
  run(factory: () => Promise<T>): Promise<T>
  reset(): void
}

/** 创建一个仅保留当前异步任务的单航班控制器。 */
export function createSingleFlight<T>(): SingleFlight<T> {
  let current: Promise<T> | null = null
  let currentToken: object | null = null

  return {
    run(factory) {
      if (current) return current

      const source = (() => {
        try {
          return factory()
        } catch (error) {
          return Promise.reject(error)
        }
      })()
      const token = {}

      const tracked = source.then(
        (value) => {
          if (currentToken === token) {
            current = null
            currentToken = null
          }
          return value
        },
        (error: unknown) => {
          if (currentToken === token) {
            current = null
            currentToken = null
          }
          throw error
        },
      )

      current = tracked
      currentToken = token
      return tracked
    },
    reset() {
      current = null
      currentToken = null
    },
  }
}
