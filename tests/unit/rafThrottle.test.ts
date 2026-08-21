import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rafThrottle } from '@/utils/rafThrottle'

/**
 * 用可控的假 rAF 替换 jsdom 的实现：真实 rAF 的时机不可预测，
 * 而这里要断言的正是「同一帧内合并、跨帧不合并」。
 */
const pendingFrames = new Map<number, FrameRequestCallback>()
let nextFrameId = 0
let originalRequestAnimationFrame: typeof globalThis.requestAnimationFrame
let originalCancelAnimationFrame: typeof globalThis.cancelAnimationFrame

/** 执行当前排队的所有帧回调，模拟浏览器绘制一帧。 */
function paintFrame() {
  const callbacks = [...pendingFrames.values()]
  pendingFrames.clear()
  callbacks.forEach((callback) => callback(0))
}

describe('rafThrottle', () => {
  beforeEach(() => {
    pendingFrames.clear()
    nextFrameId = 0
    originalRequestAnimationFrame = globalThis.requestAnimationFrame
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      nextFrameId += 1
      pendingFrames.set(nextFrameId, callback)
      return nextFrameId
    }) as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number) => {
      pendingFrames.delete(id)
    }) as typeof globalThis.cancelAnimationFrame
  })

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('同一帧内的多次调用合并成一次，并使用最后一次的参数', () => {
    const spy = vi.fn()
    const throttled = rafThrottle(spy)

    // 相当于一帧内连续来了三个 scroll 事件
    throttled(1)
    throttled(2)
    throttled(3)
    expect(spy).not.toHaveBeenCalled()
    expect(pendingFrames.size).toBe(1)

    paintFrame()
    expect(spy).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('跨帧不会被吞掉：每帧都还有一次更新，跟随式定位才不会掉队', () => {
    const spy = vi.fn()
    const throttled = rafThrottle(spy)

    throttled('frame-1')
    paintFrame()
    throttled('frame-2')
    paintFrame()

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(1, 'frame-1')
    expect(spy).toHaveBeenNthCalledWith(2, 'frame-2')
  })

  it('执行过后不留残帧，静止时不再占用 rAF', () => {
    const throttled = rafThrottle(vi.fn())

    throttled()
    paintFrame()
    expect(pendingFrames.size).toBe(0)
  })

  it('cancel 撤销未执行的那一帧：卸载后不该再回调', () => {
    const spy = vi.fn()
    const throttled = rafThrottle(spy)

    throttled('dropped')
    throttled.cancel()
    expect(pendingFrames.size).toBe(0)

    paintFrame()
    expect(spy).not.toHaveBeenCalled()
  })

  it('cancel 之后仍可重新使用', () => {
    const spy = vi.fn()
    const throttled = rafThrottle(spy)

    throttled('dropped')
    throttled.cancel()
    throttled('kept')
    paintFrame()

    expect(spy).toHaveBeenCalledExactlyOnceWith('kept')
  })
})
