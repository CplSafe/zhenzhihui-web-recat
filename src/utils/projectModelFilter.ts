/**
 * 项目视频列表「按视频生成模型筛选」的纯逻辑。
 *
 * 每条视频在生成成功时记录了 modelVersionId(+ 名字快照);老数据没记的由 projectVideos.ts
 * 回退成项目级最后一次使用的视频模型并标 inferred。这里只负责把列表里出现过的模型汇总成下拉项、
 * 以及判断一条视频是否命中筛选。展示名以当前空间模型目录为准,查不到退回快照,再退回「模型 #id」。
 */

/** 模型筛选下拉的一项。 */
export interface VideoModelFilterOption {
  value: string
  label: string
}

/** 「全部模型」的 value。 */
export const ALL_VIDEO_MODELS = ''
/** 「未记录模型」的 value:老数据既没有版本级记录、项目级也推断不出来的视频。 */
export const UNKNOWN_VIDEO_MODEL = 'unknown'

/** 参与筛选的视频只需要这两个字段。 */
export interface VideoModelSource {
  modelVersionId?: number
  modelName?: string
}

function toModelVersionId(value: unknown): number {
  const id = Math.floor(Number(value) || 0)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

/**
 * 由当前项目的视频汇总出下拉选项:全部 + 每个出现过的模型(按视频数降序,同数按名字),
 * 有未记录模型的视频时末尾再加一项「未记录模型」,让老视频也能被单独筛出来。
 */
export function buildVideoModelFilterOptions(
  videos: readonly VideoModelSource[],
  resolveName: (modelVersionId: number) => string,
): VideoModelFilterOption[] {
  const counts = new Map<number, number>()
  const snapshotNames = new Map<number, string>()
  let unknownCount = 0
  videos.forEach((video) => {
    const id = toModelVersionId(video.modelVersionId)
    if (!id) {
      unknownCount += 1
      return
    }
    counts.set(id, (counts.get(id) || 0) + 1)
    const snapshot = String(video.modelName || '').trim()
    if (snapshot && !snapshotNames.has(id)) snapshotNames.set(id, snapshot)
  })
  if (!counts.size) return []
  const labelOf = (id: number) => resolveName(id) || snapshotNames.get(id) || `模型 #${id}`
  const options = [...counts.entries()]
    .map(([id, count]) => ({ id, count, name: labelOf(id) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .map(({ id, count, name }) => ({ value: String(id), label: `${name}（${count}）` }))
  return [
    { value: ALL_VIDEO_MODELS, label: '全部' },
    ...options,
    ...(unknownCount ? [{ value: UNKNOWN_VIDEO_MODEL, label: `未记录模型（${unknownCount}）` }] : []),
  ]
}

/** 一条视频是否命中模型筛选;filter 为空表示不过滤。 */
export function matchesVideoModelFilter(video: VideoModelSource, filter: string): boolean {
  if (filter === ALL_VIDEO_MODELS) return true
  const id = toModelVersionId(video.modelVersionId)
  if (filter === UNKNOWN_VIDEO_MODEL) return !id
  return id > 0 && id === toModelVersionId(filter)
}
