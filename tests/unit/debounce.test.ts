import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '@/utils/debounce'

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('窗口内的连续调用只结算最后一次，并透传最后一次的参数', () => {
    const spy = vi.fn()
    const debounced = debounce(spy, 300)

    debounced('a')
    debounced('ab')
    debounced('abc')
    // 窗口未到，一次都不该执行——这正是搜索框不该按一个字母打一次接口的原因
    expect(spy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('abc')
  })

  it('每次新调用都重新计时，停顿够久才结算', () => {
    const spy = vi.fn()
    const debounced = debounce(spy, 300)

    debounced(1)
    vi.advanceTimersByTime(200)
    debounced(2)
    vi.advanceTimersByTime(200)
    expect(spy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(spy).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('结算之后重新开始计时，下一批调用独立生效', () => {
    const spy = vi.fn()
    const debounced = debounce(spy, 300)

    debounced('first')
    vi.advanceTimersByTime(300)
    debounced('second')
    vi.advanceTimersByTime(300)

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(2, 'second')
  })

  it('cancel 丢弃待执行调用：组件卸载后不该再触发副作用', () => {
    const spy = vi.fn()
    const debounced = debounce(spy, 300)

    debounced('pending')
    debounced.cancel()
    vi.advanceTimersByTime(1000)

    expect(spy).not.toHaveBeenCalled()
  })

  it('flush 立即结算待执行调用，且不会在计时器到点后重复执行', () => {
    const spy = vi.fn()
    const debounced = debounce(spy, 300)

    debounced('draft')
    debounced.flush()
    expect(spy).toHaveBeenCalledExactlyOnceWith('draft')

    vi.advanceTimersByTime(1000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('没有待执行调用时 flush 什么都不做', () => {
    const spy = vi.fn()
    const debounced = debounce(spy, 300)

    debounced.flush()
    expect(spy).not.toHaveBeenCalled()

    debounced('x')
    vi.advanceTimersByTime(300)
    debounced.flush()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
