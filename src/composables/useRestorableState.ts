/**
 * 列表页筛选 / 分页状态的会话级记忆。用法与 useState 一致，区别是值会按 key
 * 存进 sessionStorage，离开路由再回来时自动回填，满足「返回上一页保留筛选、分页状态」。
 *
 * 为什么是 sessionStorage 而不是 localStorage：筛选条件是本次浏览的临时上下文，
 * 关掉标签页就该清掉，下次打开站点不该被上周的筛选条件迎面拦住（与 smartEntryDraft
 * 的取舍一致）。
 *
 * key 传 null 表示暂不持久化——作用域还没就绪时（工作区 id 尚未加载完）用它，
 * 此时行为与 useState 完全相同；key 变化（切换工作区 / 切换项目）会改读新作用域的快照。
 */
import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { debounce } from '@/utils/debounce'
import type { DebouncedFunction } from '@/utils/debounce'
import { readSessionJson, writeSessionJson } from '@/utils/storage'

/** 会话快照键前缀，便于排查时一眼认出并整批清理。 */
const KEY_PREFIX = 'zzh.list-view-state'
/** 搜索框这类状态每次按键都会变，落盘去抖，避免高频同步写 sessionStorage 卡主线程。 */
const WRITE_DEBOUNCE_MS = 200
/** 用于区分「快照不存在」和「快照本身就是 null/undefined」的哨兵。 */
const MISSING = Symbol('missing')

export interface RestorableStateOptions<T> {
  /**
   * 传 false 表示忽略已存快照、强制使用 initial（例如 URL 已显式指定了该筛选值，
   * 显式链接应当压过会话记忆）。后续变更仍会正常写入快照。
   */
  restore?: boolean
  /**
   * 校验并修正快照值：返回 undefined 表示这份快照不可用，回退到 initial。
   * 枚举类状态（标签页、排序方式）应当提供它，避免旧版本残留的取值让视图渲染成空。
   */
  sanitize?: (raw: unknown) => T | undefined
}

/** 生成「取值必须落在给定集合内」的快照校验器，用于标签页、排序方式等枚举筛选项。 */
export function oneOf<T extends string | number>(...allowed: T[]): (raw: unknown) => T | undefined {
  return (raw) => (allowed.includes(raw as T) ? (raw as T) : undefined)
}

/** 页码快照校验器：只接受正整数，挡掉旧版本残留的 0 / 负数 / 字符串。 */
export function asPageNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined
}

/** 文本快照校验器：非字符串一律回退到 initial。 */
export function asText(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined
}

/** 布尔快照校验器。 */
export function asFlag(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined
}

/** initial 支持惰性求值，语义与 useState 相同。 */
function resolveInitial<T>(initial: T | (() => T)): T {
  return typeof initial === 'function' ? (initial as () => T)() : initial
}

/** 读取并校验快照；无快照或校验不通过时返回 initial。 */
function readSnapshot<T>(storageKey: string, initial: T | (() => T), sanitize?: (raw: unknown) => T | undefined): T {
  const raw = readSessionJson<unknown>(storageKey, MISSING)
  if (raw === MISSING) return resolveInitial(initial)
  if (!sanitize) return raw as T
  const sanitized = sanitize(raw)
  return sanitized === undefined ? resolveInitial(initial) : sanitized
}

/** 与 useState 同形，但值按 key 记忆在当前标签页的会话里。 */
export function useRestorableState<T>(
  key: string | null,
  initial: T | (() => T),
  options: RestorableStateOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = key ? `${KEY_PREFIX}:${key}` : null

  // initial / sanitize 允许是每次渲染新建的闭包，用 ref 固定住，避免把它们放进依赖数组。
  const initialRef = useRef(initial)
  const sanitizeRef = useRef(options.sanitize)
  sanitizeRef.current = options.sanitize
  const restoreRef = useRef(options.restore !== false)

  const [value, setValue] = useState<T>(() =>
    storageKey && restoreRef.current
      ? readSnapshot(storageKey, initialRef.current, sanitizeRef.current)
      : resolveInitial(initialRef.current),
  )

  // key 变化 = 换了作用域（切工作区 / 切项目），改读新作用域的快照。
  const lastKeyRef = useRef(storageKey)
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return
    lastKeyRef.current = storageKey
    setValue(
      storageKey
        ? readSnapshot(storageKey, initialRef.current, sanitizeRef.current)
        : resolveInitial(initialRef.current),
    )
  }, [storageKey])

  // 去抖器只建一次：跨渲染复用同一个待写入队列，否则每次渲染都会另起一个计时器。
  const writeRef = useRef<DebouncedFunction<[string, T]> | null>(null)
  if (!writeRef.current) {
    writeRef.current = debounce<[string, T]>((k, v) => writeSessionJson(k, v), WRITE_DEBOUNCE_MS)
  }

  useEffect(() => {
    if (!storageKey) return
    // key 刚变化的那一帧这里会先拿到旧 value，但上面的再读效果紧接着就会触发一次
    // 新 value 的写入，且两次都发生在去抖窗口内，最终落盘的一定是新作用域的值。
    writeRef.current?.(storageKey, value)
  }, [storageKey, value])

  // 卸载时立刻结算待写入，避免「改完筛选马上跳走」丢掉最后一次变更。
  useEffect(() => {
    const write = writeRef.current
    return () => write?.flush()
  }, [])

  return [value, setValue]
}
