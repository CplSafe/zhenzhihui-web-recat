/**
 * localStorage 安全读写小工具。统一此前散落在各 util 里逐字重复的
 * 「typeof window 守卫 + try/catch + JSON.parse/stringify」样板(且守卫写法不一致)。
 * 读失败(无值 / 解析错 / SSR / 隐私模式)统一返回 fallback;写失败(配额满等)静默忽略。
 *
 * 注:智能成片草稿(smartDraft.ts)有 sanitize/stripHeavy + 配额回退等专有逻辑,不走这里。
 */

/** 读 JSON;无值或解析失败返回 fallback。不做类型校验(调用方自行 Array.isArray 等)。 */
export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage?.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 写 JSON;失败(配额满 / 隐私模式 / SSR)静默忽略。 */
export function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    /* 忽略存储失败 */
  }
}

/** 会话级 JSON 读取，供列表筛选等临时状态使用。 */
export function readSessionJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.sessionStorage?.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** 会话级 JSON 写入，失败时静默忽略。 */
export function writeSessionJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式或配额不足时不影响页面使用。
  }
}
