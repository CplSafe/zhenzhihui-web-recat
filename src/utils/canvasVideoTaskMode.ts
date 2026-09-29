/**
 * 视频任务类型（Seedance 的 params.mode）：生成 / 编辑 / 延长。
 *
 * 上游按提示词语义自行判断是否为编辑 / 延长，判成后只接受「比例、时长跟随原视频」，
 * 带具体值会直接报错。所以由用户显式选择任务类型，后端据此改写请求。
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
 * - 有视频：上报原视频总时长（整秒向上取整）。含视频任务按「原视频 + 出片」秒数计费，
 *   不上报时后端只能按上限预冻，报价会虚高。
 * 不修改入参；模型没有任务类型字段时原样返回。
 */
export function applyVideoTaskModeParams(
  params: Record<string, unknown>,
  args: { modeFieldName?: string; hasVideoInput: boolean; sourceVideoSeconds: number },
): Record<string, unknown> {
  if (!args.modeFieldName) return params
  const next = { ...params }
  if (!args.hasVideoInput) {
    delete next[args.modeFieldName]
    return next
  }
  if (args.sourceVideoSeconds > 0) next.source_video_duration = Math.ceil(args.sourceVideoSeconds)
  return next
}
