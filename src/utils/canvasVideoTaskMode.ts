/**
 * 视频任务类型（Seedance 的 params.mode）：生成 / 编辑 / 延长。
 *
 * 上游按提示词语义自行判断是否为编辑 / 延长，判成后只接受「比例、时长跟随原视频」，
 * 上游不接受固定比例；后端模型 schema 仍可能要求 duration，需保留必填值供后端校验，
 * 由后端根据任务类型处理上游请求。
 * 只有接入了视频素材时才有意义；没有视频时不下发 mode，后端按「生成」处理。
 */

const TASK_MODE_LABELS: Readonly<Record<string, string>> = {
  generate: '生成',
  edit: '编辑',
  extend: '延长',
}

const FOLLOW_SOURCE_MODES = new Set(['edit', 'extend'])

/** 识别任务类型字段：名为 mode 且选项里有编辑 / 延长（避免误伤别的同名字段）。 */
export function isVideoTaskModeField(field: { name: string; options?: readonly unknown[] }): boolean {
  if (field.name.trim().toLowerCase() !== 'mode') return false
  return (field.options || []).some((option) => FOLLOW_SOURCE_MODES.has(String(option)))
}

/** 编辑 / 延长：出片比例与时长跟随原视频，用户选的比例、时长不生效。 */
export function isFollowSourceVideoMode(mode: unknown): boolean {
  return FOLLOW_SOURCE_MODES.has(String(mode ?? ''))
}

export function formatVideoTaskModeLabel(mode: unknown): string {
  const key = String(mode ?? '')
  return TASK_MODE_LABELS[key] ?? key
}

/**
 * 按是否接入视频收口 params：
 * - 没有视频：去掉 mode，后端按「生成」处理；
 * - 有视频且模型声明源时长字段时，上报读到的实际时长。含视频任务按「原视频 + 出片」秒数计费，
 *   不上报时后端只能按上限预冻，报价会虚高。
 * 编辑/延长保留 schema 要求的时长字段以通过后端校验，出片仍由服务端跟随原视频。
 * 不修改入参；没有相关字段时原样返回。
 */
export function applyVideoTaskModeParams(
  params: Record<string, unknown>,
  args: {
    modeFieldName?: string
    sourceDurationFieldName?: string
    requiredDurationFieldNames?: readonly string[]
    hasVideoInput: boolean
    sourceVideoSeconds: number
  },
): Record<string, unknown> {
  if (!args.modeFieldName && !args.sourceDurationFieldName) return params
  const next = { ...params }
  if (!args.hasVideoInput) {
    if (args.modeFieldName) delete next[args.modeFieldName]
    return next
  }
  if (args.modeFieldName && isFollowSourceVideoMode(next[args.modeFieldName])) {
    for (const name of Object.keys(next)) {
      const key = name.replace(/[^a-z0-9]/gi, '').toLowerCase()
      if (
        ['ratio', 'aspectratio'].includes(key) ||
        (['duration', 'durationsec', 'durationseconds'].includes(key) &&
          !args.requiredDurationFieldNames?.includes(name))
      ) {
        delete next[name]
      }
    }
  }
  if (args.sourceDurationFieldName && args.sourceVideoSeconds > 0) {
    next[args.sourceDurationFieldName] = args.sourceVideoSeconds
  }
  return next
}

/**
 * 节点自己那条视频是否作为输入下发，返回其 asset_id（0 = 不下发）。
 *
 * - 没有连接其他素材的改片（isEditingVideo）：下发。
 * - 已连接视频时只使用连入的视频，避免把旧结果也作为第二条视频。
 * - 换过模型的节点是「用新模型重新生成」，从头生成，默认不带自身视频；
 *   但选了编辑 / 延长就是要改这条视频，必须带上，否则任务类型可选却没有源视频。
 */
export function resolveSelfVideoAssetId(args: {
  isEditingVideo: boolean
  followSourceVideo: boolean
  assetId: number
  hasConnectedMedia?: boolean
  hasConnectedVideo?: boolean
}): number {
  if (!(args.assetId > 0) || args.hasConnectedVideo) return 0
  return args.followSourceVideo || (args.isEditingVideo && !args.hasConnectedMedia) ? args.assetId : 0
}
