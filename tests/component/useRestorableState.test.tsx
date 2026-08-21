import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asFlag, asPageNumber, asText, oneOf, useRestorableState } from '@/composables/useRestorableState'

/** 与 useRestorableState 内部一致的键前缀，用于直接读写快照。 */
const PREFIX = 'zzh.list-view-state'
/** 略大于内部落盘去抖窗口，推进到这里即可确认已经写入。 */
const AFTER_WRITE_DEBOUNCE_MS = 250

function snapshotOf(key: string): unknown {
  const raw = window.sessionStorage.getItem(`${PREFIX}:${key}`)
  return raw === null ? undefined : JSON.parse(raw)
}

function seedSnapshot(key: string, value: unknown) {
  window.sessionStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(value))
}

describe('useRestorableState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('没有快照时使用 initial，变更后落盘到 sessionStorage', () => {
    const { result } = renderHook(() => useRestorableState('videos:page', 1, { sanitize: asPageNumber }))

    expect(result.current[0]).toBe(1)

    act(() => result.current[1](4))
    expect(result.current[0]).toBe(4)

    act(() => {
      vi.advanceTimersByTime(AFTER_WRITE_DEBOUNCE_MS)
    })
    expect(snapshotOf('videos:page')).toBe(4)
  })

  it('重新挂载时回填快照——「列表→详情→返回」不该被打回第一页', () => {
    const first = renderHook(() => useRestorableState('videos:page', 1, { sanitize: asPageNumber }))
    act(() => first.result.current[1](7))
    act(() => {
      vi.advanceTimersByTime(AFTER_WRITE_DEBOUNCE_MS)
    })
    first.unmount()

    const second = renderHook(() => useRestorableState('videos:page', 1, { sanitize: asPageNumber }))
    expect(second.result.current[0]).toBe(7)
  })

  it('卸载时立即结算未落盘的变更：改完筛选马上跳走也不丢', () => {
    const first = renderHook(() => useRestorableState('videos:query', '', { sanitize: asText }))
    act(() => first.result.current[1]('产品讲解'))
    // 刻意不推进计时器，模拟「输入完立刻点了别的页面」
    first.unmount()

    const second = renderHook(() => useRestorableState('videos:query', '', { sanitize: asText }))
    expect(second.result.current[0]).toBe('产品讲解')
  })

  it('key 传 null 时退化成普通 useState，完全不落盘', () => {
    const { result } = renderHook(() => useRestorableState(null, 'all', { sanitize: asText }))

    act(() => result.current[1]('image'))
    act(() => {
      vi.advanceTimersByTime(AFTER_WRITE_DEBOUNCE_MS)
    })

    expect(result.current[0]).toBe('image')
    expect(window.sessionStorage.length).toBe(0)
  })

  it('key 变化时改读新作用域的快照——切工作区不该串上一个空间的筛选', () => {
    seedSnapshot('ws2:page', 5)

    const { result, rerender } = renderHook(({ key }) => useRestorableState(key, 1, { sanitize: asPageNumber }), {
      initialProps: { key: 'ws1:page' },
    })
    expect(result.current[0]).toBe(1)

    act(() => {
      rerender({ key: 'ws2:page' })
    })
    expect(result.current[0]).toBe(5)
  })

  it('作用域就绪前后的 null → 真实 key 切换会读到该作用域的快照', () => {
    seedSnapshot('ws9:sort', 'oldest')

    const { result, rerender } = renderHook(
      ({ key }) => useRestorableState<'newest' | 'oldest'>(key, 'newest', { sanitize: oneOf('newest', 'oldest') }),
      { initialProps: { key: null as string | null } },
    )
    expect(result.current[0]).toBe('newest')

    act(() => {
      rerender({ key: 'ws9:sort' })
    })
    expect(result.current[0]).toBe('oldest')
  })

  it('sanitize 拒绝非法快照并回退 initial——旧版本残留的取值不该让视图渲染成空', () => {
    seedSnapshot('videos:sort', 'legacy-value-removed')

    const { result } = renderHook(() =>
      useRestorableState<'updatedAt' | 'createdAt'>('videos:sort', 'updatedAt', {
        sanitize: oneOf('updatedAt', 'createdAt'),
      }),
    )

    expect(result.current[0]).toBe('updatedAt')
  })

  it('页码校验器挡掉 0、负数和字符串', () => {
    expect(asPageNumber(3)).toBe(3)
    expect(asPageNumber(0)).toBeUndefined()
    expect(asPageNumber(-1)).toBeUndefined()
    expect(asPageNumber(1.5)).toBeUndefined()
    expect(asPageNumber('2')).toBeUndefined()
    expect(asText('x')).toBe('x')
    expect(asText(3)).toBeUndefined()
    expect(asFlag(false)).toBe(false)
    expect(asFlag('false')).toBeUndefined()
  })

  it('restore:false 时忽略已有快照，但后续变更仍会写入', () => {
    seedSnapshot('resources:mainTab', 'people')

    const { result } = renderHook(() =>
      useRestorableState('resources:mainTab', 'all', { restore: false, sanitize: asText }),
    )
    // URL 里显式带了 ?tab= 时走这条分支：分享出去的链接压过本地会话记忆
    expect(result.current[0]).toBe('all')

    act(() => result.current[1]('upload'))
    act(() => {
      vi.advanceTimersByTime(AFTER_WRITE_DEBOUNCE_MS)
    })
    expect(snapshotOf('resources:mainTab')).toBe('upload')
  })

  it('连续输入只在停顿后写一次盘，避免每个按键都同步写 sessionStorage', () => {
    // 在 Storage.prototype 上打桩：jsdom 的 storage 实例是 Proxy，直接 spy 实例方法拦不到。
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useRestorableState('videos:query', '', { sanitize: asText }))
    setItem.mockClear()

    act(() => result.current[1]('产'))
    act(() => result.current[1]('产品'))
    act(() => result.current[1]('产品讲'))
    act(() => result.current[1]('产品讲解'))
    expect(setItem).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(AFTER_WRITE_DEBOUNCE_MS)
    })
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(snapshotOf('videos:query')).toBe('产品讲解')
  })
})
