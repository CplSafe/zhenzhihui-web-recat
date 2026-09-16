/**
 * 视频修改任务下发的分辨率档位。
 *
 * 修改希望沿用原片像素，但 videoResolutionFromDimensions 只是一张固定阶梯表
 * （4k / 1080p / 768p / 720p），反推出的标签未必存在于目标模型 schema——
 * 模型只有 768P / 2K 时，2K 原片短边 1440 会被推成 1080p 而被拒。
 * 所以反推结果必须先对模型档位，对不上就回到入口选择的档位（生成时已被同一 schema 接受）。
 * 估价与提交必须走同一个函数，否则会出现「估价通过、提交被拒」。
 */
import {
  findFirstField,
  getModelParamFields,
  getModelParamOptionValues,
  matchModelParamOptionValue,
} from './modelSchema'
import { videoResolutionFromDimensions } from './videoDuration'

export function resolveVideoEditResolution(args: {
  model: unknown
  entryResolution?: string
  sourceWidth?: number
  sourceHeight?: number
}): string {
  const entry = String(args.entryResolution || '').trim()
  const derived = videoResolutionFromDimensions(Number(args.sourceWidth) || 0, Number(args.sourceHeight) || 0)
  const field = findFirstField(getModelParamFields(args.model), ['resolution', 'size'])
  const options = field ? getModelParamOptionValues(field).map((option) => String(option ?? '').trim()) : []
  if (!options.length) return entry || derived
  const derivedMatch = derived ? matchModelParamOptionValue(derived, options) : undefined
  if (derivedMatch) return derivedMatch
  const entryMatch = entry ? matchModelParamOptionValue(entry, options) : undefined
  if (entryMatch) return entryMatch
  return entry || derived
}
