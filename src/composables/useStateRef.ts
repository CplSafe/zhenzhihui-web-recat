/**
 * useStateRef / useValueAlias
 * Vue→React 迁移用的 state+ref 同步小工具。
 *
 * - useStateRef：返回 [state, setState, ref]，ref.current 始终与最新 state 同步，
 *   供异步回调里同步读取最新值（对应原 Vue 直接读取 ref.value 的行为）。
 * - useValueAlias：给普通 useRef 附加只读 .value（= .current），兼容 composable 的 RefLike 读取契约。
 *
 * 两者都会在 ref 上挂 .value 访问器：composable（useScriptPrompts / useStoryboardGeneration /
 * useVideoGeneration）按原 Vue 的 RefLike（{ value }）契约读写依赖。
 */
import { useCallback, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'

// 在 ref 对象上挂 .value 访问器（幂等：ref 跨渲染稳定，只定义一次）。
function defineValueAlias<T>(ref: MutableRefObject<T>, set?: (v: T) => void) {
  if (Object.prototype.hasOwnProperty.call(ref, 'value')) return
  Object.defineProperty(ref, 'value', {
    configurable: true,
    get() {
      return ref.current
    },
    set(v: T) {
      ref.current = typeof v === 'function' ? (v as (p: T) => T)(ref.current) : v
      set?.(ref.current)
    },
  })
}

export function useStateRef<T>(
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void, MutableRefObject<T>] {
  const [state, setState] = useState<T>(initial)
  const ref = useRef<T>(state)
  ref.current = state
  const set = useCallback((v: T | ((prev: T) => T)) => {
    setState((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      ref.current = next
      return next
    })
  }, [])
  // 读取 live current；写入经 set 触发 re-render（并同步更新 current 以便同一 tick 内回读）。
  defineValueAlias(ref, set)
  return [state, set, ref]
}

// 给普通 useRef 附加只读 .value（= .current），兼容 composable 的 RefLike 读取契约。
export function useValueAlias<T>(value: T): MutableRefObject<T> {
  const ref = useRef<T>(value)
  ref.current = value
  defineValueAlias(ref)
  return ref
}
