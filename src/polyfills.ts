/**
 * 运行时兼容层：仅为 Safari 13.0 补齐 Promise.allSettled，避免现代浏览器加载整套旧版 polyfill。
 */
if (typeof Promise.allSettled !== 'function') {
  Object.defineProperty(Promise, 'allSettled', {
    configurable: true,
    writable: true,
    value: <T>(values: Iterable<T | PromiseLike<T>>) =>
      Promise.all(
        Array.from(values, (value) =>
          Promise.resolve(value).then(
            (resolved) => ({ status: 'fulfilled', value: resolved }) as PromiseFulfilledResult<Awaited<T>>,
            (reason) => ({ status: 'rejected', reason }) as PromiseRejectedResult,
          ),
        ),
      ),
  })
}

/** 将补丁文件保持为独立 ES 模块，避免污染全局脚本作用域。 */
export {}
