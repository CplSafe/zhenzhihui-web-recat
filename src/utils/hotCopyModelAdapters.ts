/**
 * 爆款复制模型参数适配。
 *
 * Seedance 沿用上线模型切换前已经验证过的标准参数兜底；参考生视频等其他模型
 * 只发送其 schema 明确声明的字段，避免把一个供应商的私有参数套给另一个供应商。
 */
import { getCreativeVideoModelKind } from './featuredVideoModels'
import { getModelParamFields } from './modelSchema'
import { normalizeSeedanceRatio } from './videoOptions'
import { buildVideoGenerationParams } from './videoTasks'

export interface HotCopyModelParamInput {
  durationSec: number
  sourceVideoDurationSec?: number
  ratio?: string
}

const AUDIO_FIELD_NAMES = new Set(['generate_audio', 'generateAudio'])

/** Seedance 在旧版无 schema 时使用的、已经过爆款复制链路验证的标准参数。 */
function buildSeedanceFallbackParams(input: HotCopyModelParamInput): Record<string, unknown> {
  return {
    duration: input.durationSec,
    resolution: '720p',
    ratio: normalizeSeedanceRatio(input.ratio || '16:9'),
    generate_audio: true,
  }
}

/**
 * 按所选模型编译 video.replicate 参数。
 *
 * - Seedance：保留旧版 generate_audio 与无 schema 标准字段兜底。
 * - 其他模型：只使用 schema 编译结果；未声明音频字段时不擅自追加。
 */
export function buildHotCopyReplicateModelParams(
  model: Record<string, unknown>,
  input: HotCopyModelParamInput,
): Record<string, unknown> {
  const fields = getModelParamFields(model)
  const params = buildVideoGenerationParams(model, {
    duration: input.durationSec,
    durationMode: 'exact',
    sourceVideoDuration: input.sourceVideoDurationSec,
    resolution: '720p',
    ratio: normalizeSeedanceRatio(input.ratio || '16:9'),
    generateAudio: true,
  }) as Record<string, unknown>

  if (getCreativeVideoModelKind(model) === 'seedance-2.0') {
    if (!fields.length) return buildSeedanceFallbackParams(input)

    const declaresAudio = fields.some((field: { name?: unknown }) => AUDIO_FIELD_NAMES.has(String(field?.name || '')))
    if (!declaresAudio) params.generate_audio = true
    return params
  }

  const declaresAudio = fields.some((field: { name?: unknown }) => AUDIO_FIELD_NAMES.has(String(field?.name || '')))
  if (!declaresAudio) {
    delete params.generate_audio
    delete params.generateAudio
  }
  return params
}
