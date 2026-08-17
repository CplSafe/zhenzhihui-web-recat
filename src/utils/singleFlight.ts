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

/** 按 key 分组的并发请求去重控制器。 */
export interface KeyedSingleFlight<T> {
  run(key: string | number, factory: () => Promise<T>): Promise<T>
  reset(key?: string | number): void
}

/**
 * 创建按 key 分组的单航班控制器。
 *
 * 与 createSingleFlight 的区别只在于「同一个 key 才共享在途请求」：像成员列表这种
 * 按 workspace 取的数据，不分组会让 ws2 的调用拿到 ws3 的结果。
 * 只去重在途请求、settle 后即释放，所以不会返回过期数据——
 * 变更成员后紧跟的重拉必然是一次真实请求。
 */
export function createKeyedSingleFlight<T>(): KeyedSingleFlight<T> {
  const flights = new Map<string, SingleFlight<T>>()

  return {
    run(key, factory) {
      const mapKey = String(key)
      let flight = flights.get(mapKey)
      if (!flight) {
        flight = createSingleFlight<T>()
        flights.set(mapKey, flight)
      }
      return flight.run(factory)
    },
    reset(key) {
      if (key === undefined) {
        flights.clear()
        return
      }
      flights.get(String(key))?.reset()
    },
  }
}
