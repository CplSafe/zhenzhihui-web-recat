/**
 * 剪辑时间线的片段模型与纯逻辑。
 *
 * 这里只描述「用哪些素材、各截取哪一段、什么顺序」，不关心合成在哪执行：
 * 同一份 cutlist 既可以交给后端合成，也可以交给前端封装器，换引擎不需要改这一层。
 *
 * 所有操作都是纯函数并返回新对象，便于撤销/重做与 React 状态比较。
 * 时间一律以秒为单位，并统一舍入到毫秒——浮点累加会让 0.1+0.2 这类误差渗进时长与裁剪点。
 */

/** 单个片段：引用一条视频素材，并截取它的 [inSec, outSec) 区间。 */
export interface TimelineClip {
  id: string
  /** 素材 ID：唯一的持久化引用。绝不存签名 URL，播放地址运行时解析。 */
  assetId: number
  /** 源片总时长，用于约束裁剪范围；未知时为 0，表示暂不校验上界。 */
  sourceDurationSec: number
  inSec: number
  outSec: number
  muted?: boolean
  /**
   * 该片段由哪个画布视频节点连线而来。
   * 连线断开时据此移除对应片段；手动添加的片段没有这个字段，不受连线增删影响。
   */
  sourceNodeId?: string
  /** 片段内关键帧（前端编辑元数据，不影响原始素材）。 */
  keyframes?: Array<{ timeSec: number; label?: string }>
}

/** 连线到时间线节点的一个视频来源。 */
export interface TimelineClipSource {
  sourceNodeId: string
  assetId: number
}

/** 一条时间线的完整状态，直接存进画布节点的 data。 */
export interface TimelineState {
  clips: TimelineClip[]
  /**
   * 用户主动移出时间线、但连线仍然存在的来源节点。
   *
   * 没有这份记录时，删除片段会被 syncTimelineClipsFromSources 立刻按连线重新加回来，
   * 删除按钮等于失效。连线真正断开后要把 id 移出，否则重新连线也加不回来。
   */
  detachedSourceNodeIds?: string[]
  /** 输出规格；缺省表示跟随首个片段。 */
  output?: {
    ratio?: string
    resolution?: string
  }
}

/** 提交给合成引擎的请求体，与执行端无关。 */
export interface TimelineCutlist {
  clips: Array<{
    asset_id: number
    in_sec: number
    out_sec: number
    muted: boolean
  }>
  output: {
    ratio?: string
    resolution?: string
  }
  total_duration_sec: number
}

/** 单个片段的最短时长：短于这个长度的片段在成片里几乎不可见，且容易踩到编码器的边界。 */
export const MIN_CLIP_DURATION_SEC = 0.2
/** 时间线不限制片段数量；最终合成仍由后端按总时长/资源配额校验。 */
export const MAX_TIMELINE_CLIPS = 20
/** 单条时间线的总时长上限（秒）。 */
export const MAX_TIMELINE_DURATION_SEC = 300

/** 统一舍入到毫秒，避免浮点误差在多次裁剪/分割后累积。 */
export function roundSeconds(value: unknown): number {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return 0
  return Math.round(seconds * 1000) / 1000
}

/** 空时间线。 */
export function createTimelineState(): TimelineState {
  return { clips: [] }
}

/** 秒 → mm:ss.s，时间线上的读数需要精确到 0.1 秒。 */
export function formatTimelineTime(seconds: number): string {
  const safe = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

/** 时间刻度可用的间隔（秒）。都是人读得顺的整数档，避免出现 3.7 秒这种刻度。 */
const TICK_STEPS_SEC = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
/** 带时间标签的主刻度之间至少留这么多像素，否则标签会挤成一团。 */
const MIN_LABEL_GAP_PX = 64
/** 次刻度之间至少留这么多像素，太密就退化成一片灰。 */
const MIN_TICK_GAP_PX = 7

export interface TimelineTick {
  sec: number
  /** 主刻度：画得更高，并带时间标签。 */
  major: boolean
}

/**
 * 按轨道实际像素宽度算出时间刻度。
 *
 * 间隔从固定档位里挑，保证刻度落在整秒/半秒这类好读的位置；
 * 档位由可用宽度决定，窄轨道自动稀疏，不会糊成一片。
 */
export function buildTimelineTicks(totalSec: number, widthPx: number): TimelineTick[] {
  const total = Math.max(0, Number(totalSec) || 0)
  const width = Math.max(0, Number(widthPx) || 0)
  if (!(total > 0) || !(width > 0)) return []

  const pxPerSec = width / total
  const major =
    TICK_STEPS_SEC.find((step) => step * pxPerSec >= MIN_LABEL_GAP_PX) ?? TICK_STEPS_SEC[TICK_STEPS_SEC.length - 1]
  // 次刻度优先取主刻度的 1/5，放不下就退到 1/4、1/2，再放不下就只画主刻度
  const minor = [major / 5, major / 4, major / 2].find((step) => step * pxPerSec >= MIN_TICK_GAP_PX) ?? 0
  const step = minor > 0 ? minor : major

  const ticks: TimelineTick[] = []
  for (let index = 0; ; index += 1) {
    const sec = roundSeconds(index * step)
    if (sec > total + 1e-6) break
    const ratio = sec / major
    ticks.push({ sec, major: Math.abs(ratio - Math.round(ratio)) < 1e-6 })
  }
  return ticks
}

/** 生成不与现有片段冲突的新片段 ID（可预测，便于测试与调试）。 */
export function nextClipId(clips: readonly TimelineClip[]): string {
  let max = 0
  for (const clip of clips) {
    const matched = /^clip-(\d+)$/.exec(String(clip?.id || ''))
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return `clip-${max + 1}`
}

/**
 * 由一条素材创建片段，默认整段使用。
 * 源时长未知（0）时不设上界，等读到真实时长后再由 attachSourceDuration 收敛。
 */
export function createTimelineClip(args: {
  id: string
  assetId: number
  sourceDurationSec?: number
  inSec?: number
  outSec?: number
  muted?: boolean
  sourceNodeId?: string
}): TimelineClip {
  const sourceDurationSec = Math.max(0, roundSeconds(args.sourceDurationSec))
  const inSec = Math.max(0, roundSeconds(args.inSec))
  const rawOut = args.outSec === undefined ? sourceDurationSec : roundSeconds(args.outSec)
  const outSec = rawOut > 0 ? rawOut : sourceDurationSec
  return {
    id: args.id,
    assetId: Math.max(0, Math.floor(Number(args.assetId) || 0)),
    sourceDurationSec,
    inSec,
    outSec: Math.max(inSec + MIN_CLIP_DURATION_SEC, outSec),
    ...(args.muted ? { muted: true } : {}),
    ...(args.sourceNodeId ? { sourceNodeId: args.sourceNodeId } : {}),
  }
}

/** 片段实际使用的时长。 */
export function getClipDuration(clip: TimelineClip | null | undefined): number {
  if (!clip) return 0
  return Math.max(0, roundSeconds(clip.outSec - clip.inSec))
}

/** 时间线总时长。 */
export function getTimelineDuration(state: TimelineState | null | undefined): number {
  return roundSeconds((state?.clips || []).reduce((total, clip) => total + getClipDuration(clip), 0))
}

/** 每个片段在成片时间轴上的起点，用于播放头定位与轨道排版。 */
export function getClipOffsets(state: TimelineState | null | undefined): number[] {
  const offsets: number[] = []
  let cursor = 0
  for (const clip of state?.clips || []) {
    offsets.push(roundSeconds(cursor))
    cursor += getClipDuration(clip)
  }
  return offsets
}

/** 将时间吸附到片段边界、关键帧等编辑参考点。 */
export function snapTimelineTime(value: number, points: readonly number[], threshold = 0.08): number {
  const target = Math.max(0, roundSeconds(value))
  let best = target
  let distance = Math.max(0, Number(threshold) || 0)
  for (const point of points) {
    const candidate = Math.max(0, roundSeconds(point))
    const delta = Math.abs(candidate - target)
    if (delta <= distance) {
      best = candidate
      distance = delta
    }
  }
  return best
}

export function addTimelineKeyframe(
  state: TimelineState,
  clipId: string,
  timeSec: number,
  label?: string,
): TimelineState {
  return replaceClips(
    state,
    (state.clips || []).map((clip) => {
      if (clip.id !== clipId) return clip
      const time = Math.min(Math.max(roundSeconds(timeSec), clip.inSec), clip.outSec)
      const frames = [...(clip.keyframes || [])]
      if (!frames.some((frame) => Math.abs(frame.timeSec - time) < 0.01))
        frames.push({ timeSec: time, ...(label ? { label } : {}) })
      frames.sort((a, b) => a.timeSec - b.timeSec)
      return { ...clip, keyframes: frames }
    }),
  )
}

export function removeTimelineKeyframe(state: TimelineState, clipId: string, timeSec: number): TimelineState {
  return replaceClips(
    state,
    (state.clips || []).map((clip) => {
      if (clip.id !== clipId) return clip
      const keyframes = (clip.keyframes || []).filter((frame) => Math.abs(frame.timeSec - timeSec) >= 0.01)
      return keyframes.length
        ? { ...clip, keyframes }
        : (() => {
            const { keyframes: _removed, ...rest } = clip
            return rest
          })()
    }),
  )
}

/**
 * 定位成片时间轴上某一时刻落在哪个片段。
 * 返回该片段、它在时间轴上的序号，以及换算到源片上的时间（预览播放要按这个 seek）。
 */
export function locateTimelineTime(
  state: TimelineState | null | undefined,
  timelineSec: number,
): { index: number; clip: TimelineClip; clipOffsetSec: number; sourceTimeSec: number } | null {
  const clips = state?.clips || []
  if (!clips.length) return null
  const target = Math.max(0, roundSeconds(timelineSec))
  let cursor = 0
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index]
    const duration = getClipDuration(clip)
    // 末尾时刻归属最后一个片段，避免播放到结尾时定位不到任何片段
    const isLast = index === clips.length - 1
    if (target < cursor + duration || isLast) {
      const clipOffsetSec = roundSeconds(Math.min(Math.max(0, target - cursor), duration))
      return {
        index,
        clip,
        clipOffsetSec,
        sourceTimeSec: roundSeconds(clip.inSec + clipOffsetSec),
      }
    }
    cursor += duration
  }
  return null
}

function replaceClips(state: TimelineState, clips: TimelineClip[]): TimelineState {
  return { ...state, clips }
}

/** 追加片段到时间线末尾。 */
export function addTimelineClips(state: TimelineState, incoming: readonly TimelineClip[]): TimelineState {
  const clips = [...(state.clips || [])]
  for (const clip of incoming) {
    if (!clip || clips.some((existing) => existing.id === clip.id)) continue
    clips.push(clip)
  }
  return replaceClips(state, clips)
}

/**
 * 移除片段。
 *
 * 若这是某个来源节点的最后一个片段，同时把该节点记入 detachedSourceNodeIds——
 * 否则连线还在，同步逻辑下一轮就把片段原样加回来。
 */
export function removeTimelineClip(state: TimelineState, clipId: string): TimelineState {
  const removed = (state.clips || []).find((clip) => clip.id === clipId)
  const clips = (state.clips || []).filter((clip) => clip.id !== clipId)
  const next = replaceClips(state, clips)

  const sourceNodeId = removed?.sourceNodeId
  if (!sourceNodeId) return next
  if (clips.some((clip) => clip.sourceNodeId === sourceNodeId)) return next

  const detached = next.detachedSourceNodeIds || []
  if (detached.includes(sourceNodeId)) return next
  return { ...next, detachedSourceNodeIds: [...detached, sourceNodeId] }
}

/**
 * 显式把某个画布视频节点加成片段。
 *
 * 与 syncTimelineClipsFromSources 的自动追加不同，这是用户主动的动作，
 * 因此要同时清掉该来源的墓碑——否则「删掉后再手动加回来」会被墓碑挡住。
 * 已经有该来源的片段时原样返回，不重复添加。
 */
export function attachTimelineSource(
  state: TimelineState,
  source: { sourceNodeId: string; assetId: number },
): TimelineState {
  const sourceNodeId = String(source?.sourceNodeId || '').trim()
  const assetId = Math.max(0, Math.floor(Number(source?.assetId) || 0))
  if (!sourceNodeId || !(assetId > 0)) return state

  const clips = state.clips || []
  if (clips.some((clip) => clip.sourceNodeId === sourceNodeId)) return state

  const next = replaceClips(state, [...clips, createTimelineClip({ id: nextClipId(clips), assetId, sourceNodeId })])

  const detached = (next.detachedSourceNodeIds || []).filter((id) => id !== sourceNodeId)
  if (detached.length) return { ...next, detachedSourceNodeIds: detached }
  const { detachedSourceNodeIds: _dropped, ...rest } = next
  return rest
}

/** 按下标移动片段（拖拽排序）。越界下标按边界处理，不抛错。 */
export function reorderTimelineClips(state: TimelineState, fromIndex: number, toIndex: number): TimelineState {
  const clips = [...(state.clips || [])]
  if (!clips.length) return state
  const from = Math.min(Math.max(0, Math.floor(fromIndex)), clips.length - 1)
  const to = Math.min(Math.max(0, Math.floor(toIndex)), clips.length - 1)
  if (from === to) return state
  const [moved] = clips.splice(from, 1)
  clips.splice(to, 0, moved)
  return replaceClips(state, clips)
}

/**
 * 裁剪片段两端。
 *
 * 裁剪点被约束在 [0, sourceDurationSec] 内，且始终保证至少 MIN_CLIP_DURATION_SEC 的长度——
 * 拖动手柄越过对侧时应当停住，而不是产生一个负长度或零长度的片段。
 */
export function trimTimelineClip(
  state: TimelineState,
  clipId: string,
  edits: { inSec?: number; outSec?: number },
): TimelineState {
  return replaceClips(
    state,
    (state.clips || []).map((clip) => {
      if (clip.id !== clipId) return clip
      const upper = clip.sourceDurationSec > 0 ? clip.sourceDurationSec : Math.max(clip.outSec, 0)
      let inSec = clip.inSec
      let outSec = clip.outSec

      if (edits.inSec !== undefined) {
        const maxIn = roundSeconds(outSec - MIN_CLIP_DURATION_SEC)
        inSec = Math.min(Math.max(0, roundSeconds(edits.inSec)), Math.max(0, maxIn))
      }
      if (edits.outSec !== undefined) {
        const minOut = roundSeconds(inSec + MIN_CLIP_DURATION_SEC)
        const capped = upper > 0 ? Math.min(roundSeconds(edits.outSec), upper) : roundSeconds(edits.outSec)
        outSec = Math.max(capped, minOut)
      }
      return { ...clip, inSec: roundSeconds(inSec), outSec: roundSeconds(outSec) }
    }),
  )
}

/** 静音开关。 */
export function setTimelineClipMuted(state: TimelineState, clipId: string, muted: boolean): TimelineState {
  return replaceClips(
    state,
    (state.clips || []).map((clip) => {
      if (clip.id !== clipId) return clip
      const next = { ...clip }
      if (muted) next.muted = true
      else delete next.muted
      return next
    }),
  )
}

/**
 * 在片段内部某一点把它拆成两段。
 * 拆分点以「该片段内的偏移秒数」给出；两侧都不足最短时长时不拆分，原样返回。
 */
export function splitTimelineClip(state: TimelineState, clipId: string, clipOffsetSec: number): TimelineState {
  const clips = state.clips || []
  const index = clips.findIndex((clip) => clip.id === clipId)
  if (index < 0) return state

  const clip = clips[index]
  const cut = roundSeconds(clip.inSec + Math.max(0, roundSeconds(clipOffsetSec)))
  if (cut - clip.inSec < MIN_CLIP_DURATION_SEC || clip.outSec - cut < MIN_CLIP_DURATION_SEC) return state

  const head: TimelineClip = { ...clip, outSec: cut }
  const tail: TimelineClip = { ...clip, id: nextClipId(clips), inSec: cut }
  const next = [...clips]
  next.splice(index, 1, head, tail)
  return replaceClips(state, next)
}

/** 剪出一段区间的结果。 */
export interface TimelineExtraction {
  /** 剪掉那段之后的时间线；前后两截自动接上。 */
  state: TimelineState
  /** 被剪出来的片段，按时间顺序。调用方据此在画布上落成新节点。 */
  extracted: TimelineClip[]
}

/**
 * 把成片时间轴上 [fromSec, toSec) 这段剪出来。
 *
 * 与 splitTimelineClip 的区别：分割只在一点切开、片段都还在时间线上；
 * 这里是把选中的区间整段拿走，剩下的前后两截接在一起。
 * 区间跨越多个片段时逐段计算各自的重叠部分，因此一次可以剪出多段素材。
 *
 * 不足 MIN_CLIP_DURATION_SEC 的碎片会被丢弃——这个长度的片段在模型里本就是非法的，
 * 与其产出一个存不住的片段，不如让边界吸附到可用的位置。
 */
export function extractTimelineRange(
  state: TimelineState | null | undefined,
  fromSec: number,
  toSec: number,
): TimelineExtraction {
  const source = state || createTimelineState()
  const clips = source.clips || []
  const total = getTimelineDuration(source)
  const from = Math.max(0, Math.min(roundSeconds(fromSec), total))
  const to = Math.max(0, Math.min(roundSeconds(toSec), total))
  if (!clips.length || to - from < MIN_CLIP_DURATION_SEC) return { state: source, extracted: [] }

  const kept: TimelineClip[] = []
  const extracted: TimelineClip[] = []
  // id 必须在整个过程中保持唯一：留下的和剪出的都可能来自同一个原片段
  const issueId = () => nextClipId([...clips, ...kept, ...extracted])
  /** 按源片时间截出一小段；太短则跳过，不产出非法片段。 */
  const piece = (clip: TimelineClip, inSec: number, outSec: number, into: TimelineClip[], reuseId: boolean) => {
    if (roundSeconds(outSec - inSec) < MIN_CLIP_DURATION_SEC) return
    into.push({
      ...clip,
      id: reuseId ? clip.id : issueId(),
      inSec: roundSeconds(inSec),
      outSec: roundSeconds(outSec),
      // 关键帧跟着各自所在的区间走，落在区间外的丢掉
      ...(clip.keyframes
        ? {
            keyframes: clip.keyframes.filter((frame) => frame.timeSec >= inSec && frame.timeSec <= outSec),
          }
        : {}),
    })
  }

  let cursor = 0
  for (const clip of clips) {
    const duration = getClipDuration(clip)
    const clipStart = roundSeconds(cursor)
    const clipEnd = roundSeconds(cursor + duration)
    cursor = clipEnd

    // 完全在选区之外：原样保留，连 id 都不变
    if (clipEnd <= from || clipStart >= to) {
      kept.push(clip)
      continue
    }

    // 选区与该片段的重叠部分换算回源片时间
    const overlapStart = Math.max(clipStart, from)
    const overlapEnd = Math.min(clipEnd, to)
    const toSourceTime = (timelineSec: number) => roundSeconds(clip.inSec + (timelineSec - clipStart))

    // 头：选区之前留下的部分沿用原 id，避免整条时间线的 id 全部变动
    piece(clip, clip.inSec, toSourceTime(overlapStart), kept, true)
    piece(clip, toSourceTime(overlapStart), toSourceTime(overlapEnd), extracted, false)
    piece(clip, toSourceTime(overlapEnd), clip.outSec, kept, false)
  }

  if (!extracted.length) return { state: source, extracted: [] }
  return { state: replaceClips(source, kept), extracted }
}

/**
 * 复制片段：副本紧跟在原片段之后。
 *
 * 裁剪区间、静音与关键帧一并带走——复制出来的就该是同一段。
 * sourceNodeId 也保留：分割早就让「一个来源对多个片段」成了常态，
 * syncTimelineClipsFromSources 按来源判断是否已存在，不会因此重复追加。
 */
export function duplicateTimelineClip(state: TimelineState, clipId: string): TimelineState {
  const clips = state.clips || []
  const index = clips.findIndex((clip) => clip.id === clipId)
  if (index < 0) return state

  const source = clips[index]
  const copy: TimelineClip = {
    ...source,
    id: nextClipId(clips),
    ...(source.keyframes ? { keyframes: source.keyframes.map((frame) => ({ ...frame })) } : {}),
  }
  const next = [...clips]
  next.splice(index + 1, 0, copy)
  return replaceClips(state, next)
}

/**
 * 片段被拖到某个位置时该落在第几格。
 *
 * 按「其余片段的中点」判定插入点：拖过一半才换位，这是时间轴上最稳的手感——
 * 按边界判定会让片段在两段交界处来回跳。centerSec 是被拖片段的中心在成片时间轴上的位置。
 * 片段不存在时返回 -1，调用方据此忽略这次拖动。
 */
export function resolveTimelineDropIndex(
  state: TimelineState | null | undefined,
  clipId: string,
  centerSec: number,
): number {
  const clips = state?.clips || []
  if (!clips.some((clip) => clip.id === clipId)) return -1

  const others = clips.filter((clip) => clip.id !== clipId)
  const center = Math.max(0, roundSeconds(centerSec))
  let cursor = 0
  for (let index = 0; index < others.length; index += 1) {
    const duration = getClipDuration(others[index])
    if (center < cursor + duration / 2) return index
    cursor += duration
  }
  return others.length
}

/** 从素材读到真实时长后回填，并把越界的裁剪点收敛回合法范围。 */
export function attachClipSourceDuration(
  state: TimelineState,
  clipId: string,
  sourceDurationSec: number,
): TimelineState {
  const duration = Math.max(0, roundSeconds(sourceDurationSec))
  if (!(duration > 0)) return state
  return replaceClips(
    state,
    (state.clips || []).map((clip) => {
      if (clip.id !== clipId) return clip
      const inSec = Math.min(clip.inSec, Math.max(0, roundSeconds(duration - MIN_CLIP_DURATION_SEC)))
      // 还没量过时长、且区间仍是创建时的占位值 → 这条片段本意是「整段使用」，展开到真实结尾；
      // 旧数据可能把模型生成参数（常见为 5 秒）误存成源片总时长；若片段当时覆盖了“整个已知源片”，
      // 校准到更长的真实时长后仍应保持整段使用，而不是把那份错误的 5 秒当成用户主动裁剪。
      // 其余情况（用户已裁剪过，或区间大于真实时长）一律收敛到真实结尾。
      const isPlaceholderRange = clip.sourceDurationSec <= 0 && clip.outSec <= MIN_CLIP_DURATION_SEC
      const coveredWholeKnownSource =
        clip.sourceDurationSec > 0 && clip.inSec <= 0.001 && Math.abs(clip.outSec - clip.sourceDurationSec) <= 0.01
      const outSec =
        isPlaceholderRange || coveredWholeKnownSource
          ? duration
          : Math.min(clip.outSec > 0 ? clip.outSec : duration, duration)
      return {
        ...clip,
        sourceDurationSec: duration,
        inSec: roundSeconds(inSec),
        outSec: roundSeconds(Math.max(outSec, inSec + MIN_CLIP_DURATION_SEC)),
      }
    }),
  )
}

/**
 * 校验时间线能否提交合成。
 * 返回用户可读的问题列表；为空表示可以提交。
 */
export function validateTimeline(state: TimelineState | null | undefined): string[] {
  const clips = state?.clips || []
  const problems: string[] = []

  if (clips.length < 2) problems.push('至少需要 2 个片段才能合成')
  if (clips.length > MAX_TIMELINE_CLIPS) problems.push(`片段数不能超过 ${MAX_TIMELINE_CLIPS} 个`)

  const invalid = clips.filter((clip) => !(Number(clip.assetId) > 0))
  if (invalid.length) problems.push(`有 ${invalid.length} 个片段还没有可用素材`)

  const tooShort = clips.filter((clip) => getClipDuration(clip) < MIN_CLIP_DURATION_SEC)
  if (tooShort.length) problems.push(`有 ${tooShort.length} 个片段短于 ${MIN_CLIP_DURATION_SEC} 秒`)

  const total = getTimelineDuration(state)
  if (total > MAX_TIMELINE_DURATION_SEC) {
    problems.push(`总时长 ${total.toFixed(1)} 秒超过上限 ${MAX_TIMELINE_DURATION_SEC} 秒`)
  }

  return problems
}

/**
 * 组装提交给合成引擎的 cutlist。
 * 校验不通过时抛错：宁可在这里失败，也不要把一份不完整的 cutlist 送去创建任务。
 */
export function buildTimelineCutlist(state: TimelineState | null | undefined): TimelineCutlist {
  const problems = validateTimeline(state)
  if (problems.length) throw new Error(problems[0])

  const clips = (state?.clips || []).map((clip) => ({
    asset_id: clip.assetId,
    in_sec: roundSeconds(clip.inSec),
    out_sec: roundSeconds(clip.outSec),
    muted: clip.muted === true,
  }))

  return {
    clips,
    output: {
      ...(state?.output?.ratio ? { ratio: state.output.ratio } : {}),
      ...(state?.output?.resolution ? { resolution: state.output.resolution } : {}),
    },
    total_duration_sec: getTimelineDuration(state),
  }
}

/** 比较两条时间线的片段是否等价，用于避免无意义的状态写入。 */
export function isSameTimelineClips(
  left: readonly TimelineClip[] | undefined,
  right: readonly TimelineClip[] | undefined,
): boolean {
  const a = left || []
  const b = right || []
  if (a.length !== b.length) return false
  return a.every((clip, index) => {
    const other = b[index]
    return (
      clip.id === other.id &&
      clip.assetId === other.assetId &&
      clip.inSec === other.inSec &&
      clip.outSec === other.outSec &&
      clip.sourceDurationSec === other.sourceDurationSec &&
      (clip.muted === true) === (other.muted === true) &&
      (clip.sourceNodeId || '') === (other.sourceNodeId || '')
    )
  })
}

/**
 * 按当前连线同步片段：新连入的视频追加为片段，断开连线的视频移除其片段。
 *
 * 已有片段的顺序、裁剪与静音一律保留——用户排好的时间线不能因为一次无关的连线变动被重排。
 * 分割产生的多个片段共享同一个 sourceNodeId，因此判断「是否已存在」按来源节点而不是按数量。
 * 手动添加（没有 sourceNodeId）的片段不受连线增删影响。
 */
export function syncTimelineClipsFromSources(
  state: TimelineState,
  sources: readonly TimelineClipSource[],
): TimelineState {
  const validSources = (sources || []).filter((source) => source?.sourceNodeId && Number(source.assetId) > 0)
  const sourceById = new Map(validSources.map((source) => [source.sourceNodeId, source]))

  const kept: TimelineClip[] = []
  for (const clip of state.clips || []) {
    if (!clip.sourceNodeId) {
      kept.push(clip)
      continue
    }
    const source = sourceById.get(clip.sourceNodeId)
    if (!source) continue // 连线已断开
    if (source.assetId !== clip.assetId) {
      // 来源节点换了素材（重新生成/重新上传）：旧的裁剪点对新素材没有意义，退回「整段待测量」的占位区间。
      // 这里不能写 outSec: 0——那是个非法区间，重新加载时会被 parseTimelineState 当成坏数据丢弃。
      kept.push({
        ...clip,
        assetId: source.assetId,
        sourceDurationSec: 0,
        inSec: 0,
        outSec: MIN_CLIP_DURATION_SEC,
      })
      continue
    }
    kept.push(clip)
  }

  // 连线已断开的来源不再需要墓碑：留着会让「断开后重新连线」永远加不回片段
  const connectedIds = new Set(validSources.map((source) => source.sourceNodeId))
  const detached = (state.detachedSourceNodeIds || []).filter((id) => connectedIds.has(id))

  const represented = new Set(kept.map((clip) => clip.sourceNodeId).filter(Boolean))
  const appended: TimelineClip[] = []
  for (const source of validSources) {
    if (represented.has(source.sourceNodeId)) continue
    if (detached.includes(source.sourceNodeId)) continue // 用户主动移出，不自动加回
    appended.push(
      createTimelineClip({
        id: nextClipId([...kept, ...appended]),
        assetId: source.assetId,
        sourceNodeId: source.sourceNodeId,
      }),
    )
  }

  const clips = [...kept, ...appended]
  const sameDetached =
    detached.length === (state.detachedSourceNodeIds || []).length &&
    detached.every((id, index) => id === (state.detachedSourceNodeIds || [])[index])
  if (isSameTimelineClips(state.clips, clips) && sameDetached) return state
  const next = replaceClips(state, clips)
  if (detached.length) return { ...next, detachedSourceNodeIds: detached }
  const { detachedSourceNodeIds: _dropped, ...rest } = next
  return rest
}

/** 从节点持久化数据中恢复时间线，丢弃结构不合法的片段。 */
export function parseTimelineState(value: unknown): TimelineState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createTimelineState()
  const record = value as Record<string, unknown>
  const rawClips = Array.isArray(record.clips) ? record.clips : []
  const clips: TimelineClip[] = []

  for (const raw of rawClips) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const assetId = Math.max(0, Math.floor(Number(item.assetId) || 0))
    const id = String(item.id || '').trim()
    if (!id || !(assetId > 0)) continue
    const sourceDurationSec = Math.max(0, roundSeconds(item.sourceDurationSec))
    const inSec = Math.max(0, roundSeconds(item.inSec))
    const outSec = roundSeconds(item.outSec)
    if (!(outSec > inSec)) continue
    clips.push({
      id,
      assetId,
      sourceDurationSec,
      inSec,
      outSec,
      ...(item.muted === true ? { muted: true } : {}),
      ...(String(item.sourceNodeId || '').trim() ? { sourceNodeId: String(item.sourceNodeId).trim() } : {}),
      ...(Array.isArray(item.keyframes)
        ? {
            keyframes: item.keyframes
              .map((frame) => ({
                timeSec: roundSeconds((frame as Record<string, unknown>)?.timeSec),
                ...((frame as Record<string, unknown>)?.label
                  ? { label: String((frame as Record<string, unknown>).label) }
                  : {}),
              }))
              .filter((frame) => frame.timeSec >= inSec && frame.timeSec <= outSec),
          }
        : {}),
    })
  }

  const output = record.output && typeof record.output === 'object' ? (record.output as Record<string, unknown>) : null
  const ratio = String(output?.ratio || '').trim()
  const resolution = String(output?.resolution || '').trim()

  const detached = Array.isArray(record.detachedSourceNodeIds)
    ? [...new Set(record.detachedSourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : []

  return {
    clips,
    ...(detached.length ? { detachedSourceNodeIds: detached } : {}),
    ...(ratio || resolution ? { output: { ...(ratio ? { ratio } : {}), ...(resolution ? { resolution } : {}) } } : {}),
  }
}
