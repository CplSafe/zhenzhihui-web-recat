import { describe, expect, it } from 'vitest'
import {
  MAX_TIMELINE_CLIPS,
  MIN_CLIP_DURATION_SEC,
  addTimelineClips,
  addTimelineKeyframe,
  duplicateTimelineClip,
  extractTimelineRange,
  resolveTimelineDropIndex,
  attachClipSourceDuration,
  buildTimelineCutlist,
  createTimelineClip,
  createTimelineState,
  getClipDuration,
  getClipOffsets,
  getTimelineDuration,
  isSameTimelineClips,
  locateTimelineTime,
  nextClipId,
  parseTimelineState,
  syncTimelineClipsFromSources,
  attachTimelineSource,
  buildTimelineTicks,
  removeTimelineClip,
  reorderTimelineClips,
  setTimelineClipMuted,
  splitTimelineClip,
  trimTimelineClip,
  validateTimeline,
  type TimelineState,
} from '@/utils/timelineClips'

/** 三段各 5 秒、源片各 10 秒的时间线。 */
function buildState(): TimelineState {
  return addTimelineClips(createTimelineState(), [
    createTimelineClip({ id: 'clip-1', assetId: 101, sourceDurationSec: 10, inSec: 0, outSec: 5 }),
    createTimelineClip({ id: 'clip-2', assetId: 102, sourceDurationSec: 10, inSec: 2, outSec: 7 }),
    createTimelineClip({ id: 'clip-3', assetId: 103, sourceDurationSec: 10, inSec: 5, outSec: 10 }),
  ])
}

describe('时间线片段模型', () => {
  it('按片段实际截取区间累加总时长与起点', () => {
    const state = buildState()
    expect(getClipDuration(state.clips[1])).toBe(5)
    expect(getTimelineDuration(state)).toBe(15)
    expect(getClipOffsets(state)).toEqual([0, 5, 10])
  })

  it('创建片段时默认整段使用，并把缺省结尾补成源片时长', () => {
    const clip = createTimelineClip({ id: 'clip-1', assetId: 7, sourceDurationSec: 8.5 })
    expect(clip).toMatchObject({ assetId: 7, inSec: 0, outSec: 8.5 })
  })

  it('新片段 ID 不与现有片段冲突', () => {
    expect(nextClipId([])).toBe('clip-1')
    expect(nextClipId(buildState().clips)).toBe('clip-4')
    // 乱序/异常 id 也要取到安全的下一个编号
    expect(nextClipId([{ id: 'clip-9', assetId: 1, sourceDurationSec: 1, inSec: 0, outSec: 1 }])).toBe('clip-10')
  })

  it('去重追加、删除与拖拽排序', () => {
    let state = buildState()
    state = addTimelineClips(state, [state.clips[0]])
    expect(state.clips).toHaveLength(3)

    state = reorderTimelineClips(state, 2, 0)
    expect(state.clips.map((c) => c.id)).toEqual(['clip-3', 'clip-1', 'clip-2'])
    // 越界下标按边界处理，不抛错也不丢片段
    expect(reorderTimelineClips(state, 0, 99).clips.map((c) => c.id)).toEqual(['clip-1', 'clip-2', 'clip-3'])

    state = removeTimelineClip(state, 'clip-1')
    expect(state.clips.map((c) => c.id)).toEqual(['clip-3', 'clip-2'])
  })

  it('裁剪被约束在源片范围内，且不会把片段拖成零长度', () => {
    const state = buildState()
    // 起点越过终点：停在「终点 - 最短时长」
    const pulled = trimTimelineClip(state, 'clip-1', { inSec: 9 })
    expect(pulled.clips[0].inSec).toBe(5 - MIN_CLIP_DURATION_SEC)
    // 终点越过源片结尾：收敛到源片时长
    const extended = trimTimelineClip(state, 'clip-1', { outSec: 99 })
    expect(extended.clips[0].outSec).toBe(10)
    // 负数起点收敛到 0
    expect(trimTimelineClip(state, 'clip-2', { inSec: -3 }).clips[1].inSec).toBe(0)
  })

  it('剪出选区并把前后两截接上', () => {
    // 三段各 5 秒；剪掉 [2, 8) 会切掉 clip-1 的后 3 秒和 clip-2 的前 3 秒
    const state = buildState()
    const { state: next, extracted } = extractTimelineRange(state, 2, 8)

    // 剩下的：clip-1 的前 2 秒 + clip-2 的后 2 秒 + clip-3 整段
    expect(next.clips.map((clip) => [clip.assetId, clip.inSec, clip.outSec])).toEqual([
      [101, 0, 2],
      [102, 5, 7],
      [103, 5, 10],
    ])
    expect(getTimelineDuration(next)).toBe(9)

    // 剪出来的跨两段素材，各自只带走重叠的部分
    expect(extracted.map((clip) => [clip.assetId, clip.inSec, clip.outSec])).toEqual([
      [101, 2, 5],
      [102, 2, 5],
    ])
  })

  it('选区落在单个片段内部时只切它，其余片段原样保留', () => {
    const state = buildState()
    const { state: next, extracted } = extractTimelineRange(state, 6, 9)

    expect(extracted.map((clip) => [clip.assetId, clip.inSec, clip.outSec])).toEqual([[102, 3, 6]])
    expect(next.clips.map((clip) => [clip.assetId, clip.inSec, clip.outSec])).toEqual([
      [101, 0, 5],
      [102, 2, 3],
      [102, 6, 7],
      [103, 5, 10],
    ])
    // 未被触及的片段连 id 都不变，避免整条时间线的引用全部失效
    expect(next.clips[0].id).toBe('clip-1')
    expect(next.clips[3].id).toBe('clip-3')
    // 新产生的片段 id 不与现有的冲突
    expect(new Set(next.clips.map((clip) => clip.id)).size).toBe(next.clips.length)
  })

  it('选区覆盖整条时间线时全部剪走，只留空时间线', () => {
    const state = buildState()
    const { state: next, extracted } = extractTimelineRange(state, 0, 15)
    expect(next.clips).toEqual([])
    expect(extracted).toHaveLength(3)
  })

  it('选区过短或为空时原样返回，不产生非法片段', () => {
    const state = buildState()
    expect(extractTimelineRange(state, 3, 3).extracted).toEqual([])
    expect(extractTimelineRange(state, 3, 3).state).toBe(state)
    // 短于最短片段时长的选区同样拒绝
    expect(extractTimelineRange(state, 3, 3 + MIN_CLIP_DURATION_SEC / 2).extracted).toEqual([])
  })

  it('丢弃短于最短时长的碎片，而不是留下存不住的片段', () => {
    const state = buildState()
    // 剪掉 [0.1, 8)：clip-1 只剩 0.1 秒的头，短于 MIN_CLIP_DURATION_SEC
    const { state: next } = extractTimelineRange(state, 0.1, 8)
    expect(next.clips.every((clip) => getClipDuration(clip) >= MIN_CLIP_DURATION_SEC)).toBe(true)
    expect(next.clips.map((clip) => clip.assetId)).toEqual([102, 103])
  })

  it('分割片段生成首尾两段，两侧过短时拒绝分割', () => {
    const state = buildState()
    const split = splitTimelineClip(state, 'clip-2', 2)
    expect(split.clips.map((c) => c.id)).toEqual(['clip-1', 'clip-2', 'clip-4', 'clip-3'])
    expect(split.clips[1]).toMatchObject({ inSec: 2, outSec: 4 })
    expect(split.clips[2]).toMatchObject({ assetId: 102, inSec: 4, outSec: 7 })
    // 总时长不因分割而改变
    expect(getTimelineDuration(split)).toBe(getTimelineDuration(state))
    // 贴着边缘分割会让某一侧短于下限 → 原样返回
    expect(splitTimelineClip(state, 'clip-2', 0.05)).toBe(state)
    expect(splitTimelineClip(state, 'clip-2', 4.99)).toBe(state)
  })

  it('播放头能定位到所在片段并换算成源片时间', () => {
    const state = buildState()
    expect(locateTimelineTime(state, 0)).toMatchObject({ index: 0, sourceTimeSec: 0 })
    // 第 7 秒落在第二段（起点 5 秒）内的第 2 秒 → 源片 2+2=4 秒
    expect(locateTimelineTime(state, 7)).toMatchObject({ index: 1, clipOffsetSec: 2, sourceTimeSec: 4 })
    // 结尾时刻归属最后一段，不返回空
    expect(locateTimelineTime(state, 15)).toMatchObject({ index: 2 })
    expect(locateTimelineTime(createTimelineState(), 1)).toBeNull()
  })

  it('回填真实源时长时收敛越界的裁剪点', () => {
    let state = addTimelineClips(createTimelineState(), [
      createTimelineClip({ id: 'clip-1', assetId: 5, inSec: 0, outSec: 30 }),
    ])
    state = attachClipSourceDuration(state, 'clip-1', 6)
    expect(state.clips[0]).toMatchObject({ sourceDurationSec: 6, inSec: 0, outSec: 6 })
  })

  it('静音开关只在开启时写入字段', () => {
    const state = buildState()
    const muted = setTimelineClipMuted(state, 'clip-1', true)
    expect(muted.clips[0].muted).toBe(true)
    expect(setTimelineClipMuted(muted, 'clip-1', false).clips[0]).not.toHaveProperty('muted')
  })
})

describe('时间线校验与 cutlist', () => {
  it('拦住片段不足、素材缺失、片段过短与超长的时间线', () => {
    expect(validateTimeline(createTimelineState())).toContain('至少需要 2 个片段才能合成')

    const missingAsset = addTimelineClips(createTimelineState(), [
      createTimelineClip({ id: 'clip-1', assetId: 0, sourceDurationSec: 5 }),
      createTimelineClip({ id: 'clip-2', assetId: 2, sourceDurationSec: 5 }),
    ])
    expect(validateTimeline(missingAsset).join()).toContain('还没有可用素材')

    const tooLong = addTimelineClips(
      createTimelineState(),
      Array.from({ length: 2 }, (_, i) =>
        createTimelineClip({ id: `clip-${i + 1}`, assetId: i + 1, sourceDurationSec: 400, inSec: 0, outSec: 400 }),
      ),
    )
    expect(validateTimeline(tooLong).join()).toContain('超过上限')

    const tooMany = addTimelineClips(
      createTimelineState(),
      Array.from({ length: MAX_TIMELINE_CLIPS + 1 }, (_, i) =>
        createTimelineClip({ id: `clip-${i + 1}`, assetId: i + 1, sourceDurationSec: 1, inSec: 0, outSec: 1 }),
      ),
    )
    expect(validateTimeline(tooMany).join()).toContain(`不能超过 ${MAX_TIMELINE_CLIPS} 个`)
  })

  it('cutlist 只包含合成需要的字段，且不合法时直接抛错', () => {
    const state = { ...buildState(), output: { ratio: '16:9', resolution: '1080p' } }
    expect(buildTimelineCutlist(state)).toEqual({
      clips: [
        { asset_id: 101, in_sec: 0, out_sec: 5, muted: false },
        { asset_id: 102, in_sec: 2, out_sec: 7, muted: false },
        { asset_id: 103, in_sec: 5, out_sec: 10, muted: false },
      ],
      output: { ratio: '16:9', resolution: '1080p' },
      total_duration_sec: 15,
    })
    expect(() => buildTimelineCutlist(createTimelineState())).toThrow('至少需要 2 个片段')
  })

  it('从持久化数据恢复时丢弃结构不合法的片段', () => {
    const restored = parseTimelineState({
      clips: [
        { id: 'clip-1', assetId: 11, sourceDurationSec: 9, inSec: 1, outSec: 4, muted: true },
        { id: '', assetId: 12, inSec: 0, outSec: 3 }, // 无 id
        { id: 'clip-3', assetId: 0, inSec: 0, outSec: 3 }, // 无素材
        { id: 'clip-4', assetId: 14, inSec: 3, outSec: 3 }, // 零长度
        null,
      ],
      output: { ratio: '9:16' },
    })
    expect(restored.clips.map((c) => c.id)).toEqual(['clip-1'])
    expect(restored.clips[0].muted).toBe(true)
    expect(restored.output).toEqual({ ratio: '9:16' })
    expect(parseTimelineState(null)).toEqual({ clips: [] })
  })

  it('按连线同步片段：新增追加、断开移除、已有编辑保留', () => {
    let state = createTimelineState()
    state = syncTimelineClipsFromSources(state, [
      { sourceNodeId: 'node-a', assetId: 201 },
      { sourceNodeId: 'node-b', assetId: 202 },
    ])
    expect(state.clips.map((c) => [c.sourceNodeId, c.assetId])).toEqual([
      ['node-a', 201],
      ['node-b', 202],
    ])

    // 用户排序并裁剪之后，再连入第三条：已有编辑必须原样保留，新片段追加到末尾
    state = reorderTimelineClips(state, 1, 0)
    state = attachClipSourceDuration(state, state.clips[0].id, 8)
    state = trimTimelineClip(state, state.clips[0].id, { inSec: 2 })
    const edited = state.clips[0]
    state = syncTimelineClipsFromSources(state, [
      { sourceNodeId: 'node-a', assetId: 201 },
      { sourceNodeId: 'node-b', assetId: 202 },
      { sourceNodeId: 'node-c', assetId: 203 },
    ])
    expect(state.clips[0]).toEqual(edited)
    expect(state.clips.map((c) => c.sourceNodeId)).toEqual(['node-b', 'node-a', 'node-c'])

    // 断开 node-a 的连线：只移除它的片段
    state = syncTimelineClipsFromSources(state, [
      { sourceNodeId: 'node-b', assetId: 202 },
      { sourceNodeId: 'node-c', assetId: 203 },
    ])
    expect(state.clips.map((c) => c.sourceNodeId)).toEqual(['node-b', 'node-c'])
  })

  it('同步时保留手动片段，并对分割出的同源片段不重复追加', () => {
    let state = addTimelineClips(createTimelineState(), [
      createTimelineClip({
        id: 'clip-1',
        assetId: 301,
        sourceDurationSec: 10,
        inSec: 0,
        outSec: 10,
        sourceNodeId: 'node-a',
      }),
      createTimelineClip({ id: 'clip-9', assetId: 999, sourceDurationSec: 5, inSec: 0, outSec: 5 }),
    ])
    state = splitTimelineClip(state, 'clip-1', 4)
    expect(state.clips.filter((c) => c.sourceNodeId === 'node-a')).toHaveLength(2)

    const synced = syncTimelineClipsFromSources(state, [{ sourceNodeId: 'node-a', assetId: 301 }])
    // 分割出的两段都保留、不因为「已存在」而被去重；手动片段（无 sourceNodeId）也不受影响
    expect(synced.clips.map((c) => c.id)).toEqual(state.clips.map((c) => c.id))
  })

  it('来源节点换素材时退回可持久化的整段占位，量到时长后展开为整段', () => {
    let state = addTimelineClips(createTimelineState(), [
      createTimelineClip({
        id: 'clip-1',
        assetId: 401,
        sourceDurationSec: 10,
        inSec: 3,
        outSec: 7,
        sourceNodeId: 'node-a',
      }),
    ])
    state = syncTimelineClipsFromSources(state, [{ sourceNodeId: 'node-a', assetId: 402 }])
    const reset = state.clips[0]
    expect(reset).toMatchObject({ assetId: 402, inSec: 0, sourceDurationSec: 0 })
    // 占位区间必须合法，否则重新加载时会被当成坏数据丢弃
    expect(reset.outSec).toBeGreaterThan(reset.inSec)
    expect(parseTimelineState(state).clips).toHaveLength(1)

    // 读到真实时长后展开成整段，而不是停在 0.2 秒的占位长度
    state = attachClipSourceDuration(state, reset.id, 12)
    expect(state.clips[0]).toMatchObject({ inSec: 0, outSec: 12, sourceDurationSec: 12 })
  })

  it('刻度按轨道实际宽度选档，落在好读的整秒位置上', () => {
    // 40 秒 / 600px = 15px 每秒：主刻度需要 ≥64px 间隔 → 取 5 秒档
    const ticks = buildTimelineTicks(40, 600)
    const majors = ticks.filter((tick) => tick.major).map((tick) => tick.sec)
    expect(majors).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40])
    // 次刻度取主刻度的 1/5 = 1 秒，间隔 15px 够用
    expect(ticks.map((tick) => tick.sec).slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
    // 不会越过总时长
    expect(Math.max(...ticks.map((tick) => tick.sec))).toBeLessThanOrEqual(40)
  })

  it('轨道很窄时自动稀疏，不会糊成一片', () => {
    const narrow = buildTimelineTicks(40, 120)
    const wide = buildTimelineTicks(40, 900)
    expect(narrow.length).toBeLessThan(wide.length)
    // 窄轨道下每条刻度至少还有几像素间隔
    expect(120 / Math.max(1, narrow.length - 1)).toBeGreaterThanOrEqual(7)
  })

  it('长片用更大的刻度档，短片用更细的档', () => {
    const long = buildTimelineTicks(300, 600)
      .filter((tick) => tick.major)
      .map((tick) => tick.sec)
    const short = buildTimelineTicks(4, 600)
      .filter((tick) => tick.major)
      .map((tick) => tick.sec)
    expect(long[1]).toBeGreaterThanOrEqual(30)
    expect(short[1]).toBeLessThanOrEqual(1)
  })

  it('宽度或时长缺失时不产生刻度，交给调用方不渲染', () => {
    expect(buildTimelineTicks(0, 600)).toEqual([])
    expect(buildTimelineTicks(40, 0)).toEqual([])
    expect(buildTimelineTicks(Number.NaN, Number.NaN)).toEqual([])
  })

  it('删掉的片段不会被连线同步重新加回来', () => {
    let state = syncTimelineClipsFromSources(createTimelineState(), [
      { sourceNodeId: 'node-a', assetId: 501 },
      { sourceNodeId: 'node-b', assetId: 502 },
    ])
    const removedId = state.clips.find((clip) => clip.sourceNodeId === 'node-a')!.id
    state = removeTimelineClip(state, removedId)
    expect(state.clips.map((c) => c.sourceNodeId)).toEqual(['node-b'])
    expect(state.detachedSourceNodeIds).toEqual(['node-a'])

    // 连线还在，但用户主动移出过：同步不能把它加回来，否则删除按钮等于失效
    state = syncTimelineClipsFromSources(state, [
      { sourceNodeId: 'node-a', assetId: 501 },
      { sourceNodeId: 'node-b', assetId: 502 },
    ])
    expect(state.clips.map((c) => c.sourceNodeId)).toEqual(['node-b'])
  })

  it('连线真正断开后清除墓碑，重新连线可以再次加入', () => {
    let state = syncTimelineClipsFromSources(createTimelineState(), [
      { sourceNodeId: 'node-a', assetId: 501 },
      { sourceNodeId: 'node-b', assetId: 502 },
    ])
    state = removeTimelineClip(state, state.clips[0].id)

    // 断开 node-a 的连线：墓碑随之失效
    state = syncTimelineClipsFromSources(state, [{ sourceNodeId: 'node-b', assetId: 502 }])
    expect(state.detachedSourceNodeIds).toBeUndefined()

    // 重新连上应当重新产生片段
    state = syncTimelineClipsFromSources(state, [
      { sourceNodeId: 'node-b', assetId: 502 },
      { sourceNodeId: 'node-a', assetId: 501 },
    ])
    expect(state.clips.map((c) => c.sourceNodeId).sort()).toEqual(['node-a', 'node-b'])
  })

  it('分割后删掉其中一段不算「移出」，另一段仍在时不立墓碑', () => {
    let state = syncTimelineClipsFromSources(createTimelineState(), [{ sourceNodeId: 'node-a', assetId: 601 }])
    state = attachClipSourceDuration(state, state.clips[0].id, 10)
    state = splitTimelineClip(state, state.clips[0].id, 5)
    expect(state.clips).toHaveLength(2)

    state = removeTimelineClip(state, state.clips[1].id)
    expect(state.detachedSourceNodeIds).toBeUndefined()
    expect(state.clips).toHaveLength(1)
  })

  it('墓碑随时间线一起持久化，刷新后删除仍然生效', () => {
    let state = syncTimelineClipsFromSources(createTimelineState(), [{ sourceNodeId: 'node-a', assetId: 701 }])
    state = removeTimelineClip(state, state.clips[0].id)
    const restored = parseTimelineState(JSON.parse(JSON.stringify(state)))
    expect(restored.detachedSourceNodeIds).toEqual(['node-a'])
    expect(syncTimelineClipsFromSources(restored, [{ sourceNodeId: 'node-a', assetId: 701 }]).clips).toEqual([])
  })

  it('从画布显式加入来源：追加片段并清掉该来源的墓碑', () => {
    let state = syncTimelineClipsFromSources(createTimelineState(), [{ sourceNodeId: 'node-a', assetId: 801 }])
    state = removeTimelineClip(state, state.clips[0].id)
    expect(state.detachedSourceNodeIds).toEqual(['node-a'])

    // 用户主动加回来：墓碑必须让路，否则「删了再加」永远加不回去
    state = attachTimelineSource(state, { sourceNodeId: 'node-a', assetId: 801 })
    expect(state.clips.map((c) => c.sourceNodeId)).toEqual(['node-a'])
    expect(state.detachedSourceNodeIds).toBeUndefined()

    // 加回来之后同步不应再把它移走
    state = syncTimelineClipsFromSources(state, [{ sourceNodeId: 'node-a', assetId: 801 }])
    expect(state.clips).toHaveLength(1)
  })

  it('重复加入同一来源不产生第二个片段；非法入参原样返回', () => {
    const state = attachTimelineSource(createTimelineState(), { sourceNodeId: 'node-a', assetId: 901 })
    expect(attachTimelineSource(state, { sourceNodeId: 'node-a', assetId: 901 })).toBe(state)
    expect(attachTimelineSource(state, { sourceNodeId: '', assetId: 901 })).toBe(state)
    expect(attachTimelineSource(state, { sourceNodeId: 'node-b', assetId: 0 })).toBe(state)
  })

  it('加入的片段留待测量，占位区间合法可被重新解析', () => {
    const state = attachTimelineSource(createTimelineState(), { sourceNodeId: 'node-a', assetId: 902 })
    expect(state.clips[0]).toMatchObject({ assetId: 902, sourceDurationSec: 0, inSec: 0 })
    expect(state.clips[0].outSec).toBeGreaterThan(state.clips[0].inSec)
    expect(parseTimelineState(JSON.parse(JSON.stringify(state))).clips).toHaveLength(1)
  })

  it('同步结果无变化时返回原对象，避免无谓的状态写入', () => {
    const state = syncTimelineClipsFromSources(createTimelineState(), [{ sourceNodeId: 'node-a', assetId: 1 }])
    expect(syncTimelineClipsFromSources(state, [{ sourceNodeId: 'node-a', assetId: 1 }])).toBe(state)
    // 无效来源（素材未就绪）不产生片段
    expect(syncTimelineClipsFromSources(createTimelineState(), [{ sourceNodeId: 'node-x', assetId: 0 }]).clips).toEqual(
      [],
    )
    expect(isSameTimelineClips(state.clips, state.clips)).toBe(true)
    expect(isSameTimelineClips(state.clips, [])).toBe(false)
  })

  it('多次裁剪与分割后时长不出现浮点毛刺', () => {
    let state = addTimelineClips(createTimelineState(), [
      createTimelineClip({ id: 'clip-1', assetId: 1, sourceDurationSec: 10, inSec: 0, outSec: 0.1 + 0.2 }),
      createTimelineClip({ id: 'clip-2', assetId: 2, sourceDurationSec: 10, inSec: 0, outSec: 0.3 }),
    ])
    state = trimTimelineClip(state, 'clip-1', { outSec: 0.1 + 0.2 })
    expect(getTimelineDuration(state)).toBe(0.6)
  })

  it('复制片段：副本紧跟原段，裁剪区间与静音一并带走', () => {
    let state = buildState()
    state = setTimelineClipMuted(state, 'clip-2', true)
    state = trimTimelineClip(state, 'clip-2', { inSec: 1, outSec: 4 })

    const next = duplicateTimelineClip(state, 'clip-2')
    expect(next.clips.map((clip) => clip.id)).toEqual(['clip-1', 'clip-2', 'clip-4', 'clip-3'])
    expect(next.clips[2]).toMatchObject({ assetId: next.clips[1].assetId, inSec: 1, outSec: 4, muted: true })
    // 关键帧要深拷贝：两段共享同一个数组时，给副本打点会连原段一起改
    const withFrame = addTimelineKeyframe(
      duplicateTimelineClip(addTimelineKeyframe(state, 'clip-2', 2), 'clip-2'),
      'clip-4',
      3,
    )
    expect(withFrame.clips[1].keyframes).toHaveLength(1)
    expect(withFrame.clips[2].keyframes).toHaveLength(2)

    expect(duplicateTimelineClip(state, 'missing')).toBe(state)
  })

  it('拖动落点按其余片段的中点判定，拖过一半才换位', () => {
    const state = buildState() // 三段各 5 秒

    // 拖 clip-1：其余两段是 clip-2(0~5)、clip-3(5~10)
    expect(resolveTimelineDropIndex(state, 'clip-1', 0)).toBe(0)
    expect(resolveTimelineDropIndex(state, 'clip-1', 2.4)).toBe(0) // 还没过 clip-2 的中点
    expect(resolveTimelineDropIndex(state, 'clip-1', 2.6)).toBe(1) // 过了就换位
    expect(resolveTimelineDropIndex(state, 'clip-1', 99)).toBe(2) // 拖到最后

    // 落点下标可以直接喂给 reorderTimelineClips
    expect(
      reorderTimelineClips(state, 0, resolveTimelineDropIndex(state, 'clip-1', 99)).clips.map((c) => c.id),
    ).toEqual(['clip-2', 'clip-3', 'clip-1'])
    expect(resolveTimelineDropIndex(state, 'missing', 1)).toBe(-1)
  })
})
