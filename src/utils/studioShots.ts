/**
 * AI 创作台「智能分镜」的纯逻辑层。
 *
 * 只负责分镜数组的构造、增删改序与时长校验，不发请求、不读全局状态，
 * 便于单测覆盖。分镜结构与 smartVideo.generateFullVideo 的 shots 契约保持一致
 * （desc / line / subtitle / sfx / duration），页面无需再做二次映射。
 */

/** 单个镜头：描述 + 时长，其余脚本字段留给「智能分镜」自动填充。 */
export interface StudioShot {
  id: string
  /** 画面描述：谁在哪、发生了什么。 */
  desc: string
  /** 镜头时长（秒）。 */
  dur: number
  /** 台词 / 旁白，智能分镜生成时可能带出。 */
  line?: string
  /** 字幕。 */
  subtitle?: string
  /** 音效。 */
  sfx?: string
}

/** 单镜时长下限（秒）。 */
export const MIN_SHOT_SEC = 1
/** 单镜时长上限（秒）。 */
export const MAX_SHOT_SEC = 10
/** 分镜数量上限，避免一次提交过多镜头拖垮生成时长与额度。 */
export const MAX_SHOT_COUNT = 12
/** 新增镜头的默认时长（秒）。 */
export const DEFAULT_SHOT_SEC = 3

let shotSequence = 0

/** 生成浏览器实例内唯一的镜头 ID（用于 React key 与拖拽标识）。 */
export function createStudioShotId(): string {
  shotSequence += 1
  return globalThis.crypto?.randomUUID?.() || `shot-${Date.now().toString(36)}-${shotSequence.toString(36)}`
}

/** 把秒数收敛到 [MIN_SHOT_SEC, MAX_SHOT_SEC] 的整数。 */
export function clampShotSec(value: unknown): number {
  const raw = Math.round(Number(value) || 0)
  if (!Number.isFinite(raw)) return DEFAULT_SHOT_SEC
  return Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, raw))
}

/** 创建一个空镜头。 */
export function createStudioShot(dur: number = DEFAULT_SHOT_SEC, desc = ''): StudioShot {
  return { id: createStudioShotId(), desc, dur: clampShotSec(dur) }
}

/**
 * 按目标总时长切分出默认分镜。
 *
 * 可灵默认给 2 镜（2s + 3s）；这里同样保证「至少两镜、总和等于目标时长」，
 * 余数补给最后一镜，避免出现 0 秒镜头。
 */
export function createDefaultStudioShots(totalSec: number): StudioShot[] {
  const total = Math.max(MIN_SHOT_SEC * 2, Math.round(Number(totalSec) || 0) || DEFAULT_SHOT_SEC * 2)
  const count = Math.min(MAX_SHOT_COUNT, Math.max(2, Math.round(total / DEFAULT_SHOT_SEC)))
  const base = Math.max(MIN_SHOT_SEC, Math.floor(total / count))
  const shots = Array.from({ length: count }, () => createStudioShot(base))
  const assigned = base * count
  if (assigned < total) {
    const last = shots[shots.length - 1]
    last.dur = clampShotSec(last.dur + (total - assigned))
  }
  return shots
}

/** 分镜总时长（秒）。 */
export function totalStudioShotSec(shots: readonly StudioShot[]): number {
  return shots.reduce((sum, shot) => sum + clampShotSec(shot.dur), 0)
}

/** 不可变地更新某个镜头的字段。 */
export function updateStudioShot(
  shots: readonly StudioShot[],
  id: string,
  patch: Partial<Omit<StudioShot, 'id'>>,
): StudioShot[] {
  return shots.map((shot) =>
    shot.id === id ? { ...shot, ...patch, ...(patch.dur === undefined ? {} : { dur: clampShotSec(patch.dur) }) } : shot,
  )
}

/** 追加一个镜头；已达上限时原样返回。 */
export function appendStudioShot(shots: readonly StudioShot[], dur = DEFAULT_SHOT_SEC): StudioShot[] {
  if (shots.length >= MAX_SHOT_COUNT) return shots as StudioShot[]
  return [...shots, createStudioShot(dur)]
}

/** 删除一个镜头；只剩一个镜头时不允许删空。 */
export function removeStudioShot(shots: readonly StudioShot[], id: string): StudioShot[] {
  if (shots.length <= 1) return shots as StudioShot[]
  return shots.filter((shot) => shot.id !== id)
}

/** 把镜头从 from 位置移动到 to 位置（拖拽排序）。 */
export function moveStudioShot(shots: readonly StudioShot[], from: number, to: number): StudioShot[] {
  const list = [...shots]
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  return list
}

/**
 * 把智能分镜脚本（smartScript 的 Shot）归一化为创作台分镜。
 *
 * 脚本里的 duration 形如 "5s"，这里解析为秒数并做区间收敛；
 * 台词 / 字幕 / 音效原样保留，最终会进入 buildTimelinePrompt。
 */
export function fromScriptShots(scriptShots: readonly any[]): StudioShot[] {
  const list = (scriptShots || [])
    .map((shot) => {
      const desc = String(shot?.desc || '').trim()
      const dur = clampShotSec(parseFloat(String(shot?.duration ?? shot?.dur ?? DEFAULT_SHOT_SEC)))
      return {
        id: createStudioShotId(),
        desc,
        dur,
        line: String(shot?.voiceover ?? shot?.line ?? '').trim() || undefined,
        subtitle: String(shot?.subtitle || '').trim() || undefined,
        sfx: String(shot?.sfx || '').trim() || undefined,
      }
    })
    .filter((shot) => shot.desc)
  return list.slice(0, MAX_SHOT_COUNT)
}

/** 校验分镜是否可提交生成；返回第一条阻塞原因，通过时返回空串。 */
export function validateStudioShots(shots: readonly StudioShot[]): string {
  if (!shots.length) return '请至少添加一个镜头'
  if (shots.length > MAX_SHOT_COUNT) return `最多支持 ${MAX_SHOT_COUNT} 个镜头`
  if (shots.some((shot) => !String(shot.desc || '').trim())) return '每个镜头都需要填写画面描述'
  return ''
}
