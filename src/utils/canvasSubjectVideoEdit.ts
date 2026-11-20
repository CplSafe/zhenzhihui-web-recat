import { compileVideoEditModelRequest, resolveSegmentGenerationDurationSec } from '@/api/smartVideo'
import { applyVideoTaskModeParams } from './canvasVideoTaskMode'
import { getBackendGenerationModelOperationCodes, type BackendGenerationModel } from './generationModelCatalog'
import { closestRatioOption, parseRatioValue } from './hotCopySourceMatch'
import { getModelInputConstraints } from './modelInputConstraints'
import { buildModelRestrictionSummary, getModelConstraintConflicts } from './modelRestrictions'
import {
  findFirstField,
  getModelParamFields,
  getModelParamOptionValues,
  matchModelParamOptionValue,
} from './modelSchema'
import { parseDurationSeconds } from './videoDurationValue'
import { withNoOnscreenTextGuard } from './videoPromptGuards'
import { buildVideoGenerationParams } from './videoTasks'

type SubjectVideoOperation = 'video.edit' | 'video.generate'
type SubjectVideoStrategy = 'happyhorse' | 'wan3' | 'seedance25' | 'seedance20' | 'minimax-h3' | 'legacy'

const SEEDANCE_25_IDENTITIES = new Set(['doubao-seedance-2-5', 'doubao-seedance-2-5-260628'])
const SEEDANCE_20_IDENTITIES = new Set([
  'doubao-seedance-2-0',
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini',
  'doubao-seedance-2-0-mini-260615',
])

function subjectVideoStrategy(model: BackendGenerationModel): SubjectVideoStrategy | null {
  const operations = getBackendGenerationModelOperationCodes(model)
  const identities = [model.model_code, model.modelCode, model.model, model.version].map((item) =>
    String(item ?? '')
      .trim()
      .toLowerCase(),
  )
  const provider = String(model.provider ?? '')
    .trim()
    .toLowerCase()
  if (operations.includes('video.edit')) {
    if (provider === 'bailian') {
      if (identities.includes('happyhorse-1.0-video-edit')) return 'happyhorse'
      if (identities.includes('wan3.0-video') || identities.includes('wan3.0-video-prime')) return 'wan3'
    }
    return 'legacy'
  }
  if (!operations.includes('video.generate')) return null
  const { roles } = getModelInputConstraints(model, 'video.generate')
  if (!roles.some(({ role, minCount, maxCount }) => role === 'video' && minCount <= 1 && maxCount >= 1)) return null

  if (provider === 'minimax' && identities.includes('minimax-h3')) return 'minimax-h3'
  if (provider === 'volcengine') {
    if (identities.some((id) => SEEDANCE_20_IDENTITIES.has(id))) return 'seedance20'
    const mode = findFirstField(getModelParamFields(model), ['mode'])
    if (identities.some((id) => SEEDANCE_25_IDENTITIES.has(id)) && getModelParamOptionValues(mode).includes('edit')) {
      return 'seedance25'
    }
  }
  return null
}

export function getCanvasSubjectVideoOperation(model: BackendGenerationModel): SubjectVideoOperation | null {
  const strategy = subjectVideoStrategy(model)
  if (!strategy) return null
  return strategy === 'happyhorse' || strategy === 'wan3' || strategy === 'legacy' ? 'video.edit' : 'video.generate'
}

export function getCanvasSubjectVideoSourceReferenceMode(model: BackendGenerationModel): 'cutout' | 'none' {
  const strategy = subjectVideoStrategy(model)
  return strategy === 'happyhorse' || strategy === 'legacy' ? 'cutout' : 'none'
}

const SUBJECT_VIDEO_DURATION_RANGES = {
  happyhorse: [3, 15],
  wan3: [1, 15],
  seedance25: [4, 30],
  seedance20: [2, 15],
  'minimax-h3': [2, 15],
} as const

const DURATION_FIELDS = ['duration', 'seconds']
const RATIO_FIELDS = ['ratio', 'aspect_ratio', 'aspectRatio']
const SOURCE_DURATION_FIELDS = ['source_video_duration', 'sourceVideoDuration']

/** 报价和提交都使用当前团队目录的字段名，原片和可选参考图由调用方绑定。 */
export function compileCanvasSubjectVideoRequest(
  model: BackendGenerationModel,
  args: { prompt: string; duration: number; ratio?: string; resolution?: string; targetReferenceIndex?: number },
): { prompt: string; params: Record<string, unknown> } {
  const { duration } = args
  const strategy = subjectVideoStrategy(model)
  if (!strategy) throw new Error('当前模型不支持视频主体编辑')
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取原视频时长，请重新加载视频后重试')

  const fields = getModelParamFields(model)
  const durationField = findFirstField(fields, DURATION_FIELDS)
  const sourceDurationField = findFirstField(fields, SOURCE_DURATION_FIELDS)
  if (sourceDurationField) {
    const minimum = Number(sourceDurationField.min ?? sourceDurationField.minimum ?? 0)
    const maximum = Number(sourceDurationField.max ?? sourceDurationField.maximum ?? Infinity)
    const options = getModelParamOptionValues(sourceDurationField)
      .map(parseDurationSeconds)
      .filter((value): value is number => value !== null)
    if (duration < minimum || duration > maximum || (options.length > 0 && !options.includes(duration))) {
      throw new Error('当前模型不支持这段原视频的完整时长，请选择其他模型或先在画布中裁切')
    }
  }
  if (strategy !== 'legacy') {
    const [minimum, maximum] = SUBJECT_VIDEO_DURATION_RANGES[strategy]
    if (duration < minimum || duration > maximum) {
      throw new Error(`当前模型支持 ${minimum}–${maximum} 秒的原视频，请选择其他模型或先在画布中裁切`)
    }
  }

  if (strategy === 'legacy' || strategy === 'happyhorse') {
    if (durationField) {
      const { constraints } = buildModelRestrictionSummary(model)
      const conflict = getModelConstraintConflicts(constraints, { durationSec: duration })[0]
      if (conflict) throw new Error(`${conflict}，请选择其他模型或先在画布中裁切`)
    }
    const { prompt, params } = compileVideoEditModelRequest(model, {
      prompt: args.prompt,
      ratio: args.ratio,
      resolution: args.resolution,
      durationSec: duration,
      sourceVideoDurationSec: duration,
    })
    if (strategy === 'happyhorse') {
      const audioSetting = findFirstField(fields, ['audio_setting'])
      const origin = matchModelParamOptionValue('origin', getModelParamOptionValues(audioSetting))
      if (audioSetting && origin !== undefined) params[audioSetting.name] = origin
    }
    return { prompt, params }
  }

  const ratioField = findFirstField(fields, RATIO_FIELDS)
  const ratioOptions = getModelParamOptionValues(ratioField)
  const adaptive = matchModelParamOptionValue('adaptive', ratioOptions)
  let ratio = args.ratio
  if (strategy === 'seedance25') {
    ratio = undefined
  } else if ((strategy === 'wan3' || strategy === 'minimax-h3') && typeof adaptive === 'string') {
    ratio = adaptive
  } else if (strategy === 'seedance20' && ratio && ratioOptions.length) {
    // 画布传入的是源视频的比例，2.0 系列只能选其 schema 支持的输出档。
    ratio = closestRatioOption(parseRatioValue(ratio), 1, ratioOptions.map(String)) || undefined
  }

  const automaticDuration =
    strategy === 'wan3' ? matchModelParamOptionValue(-1, getModelParamOptionValues(durationField)) : undefined
  const resolutionField = findFirstField(fields, ['resolution', 'size'])
  const params = buildVideoGenerationParams(model, {
    duration: automaticDuration === undefined ? resolveSegmentGenerationDurationSec(model, duration) : duration,
    durationMode: 'exact',
    validateExactDuration: automaticDuration === undefined,
    sourceVideoDuration: duration,
    ratio,
    resolution: args.resolution || resolutionField?.default,
    generateAudio: true,
  })
  const referenceField = findFirstField(fields, ['reference_mode'])
  if (referenceField) params[referenceField.name] = true

  if (strategy === 'wan3') {
    if (durationField && automaticDuration !== undefined) params[durationField.name] = automaticDuration
    const audioField = findFirstField(fields, ['audio'])
    if (audioField) params[audioField.name] = true
  }

  const mode = findFirstField(fields, ['mode'])
  let compiledParams = params as Record<string, unknown>
  if (mode && strategy === 'seedance25') {
    params[mode.name] = 'edit'
    // 与常规画布视频编辑一致，服务端根据 mode 转译火山的编辑任务类型与随原片参数。
    compiledParams = applyVideoTaskModeParams(params, {
      modeFieldName: mode.name,
      sourceDurationFieldName: sourceDurationField?.name,
      requiredDurationFieldNames: durationField?.required ? [durationField.name] : [],
      hasVideoInput: true,
      sourceVideoSeconds: duration,
    })
  }
  if (mode && strategy === 'seedance20' && getModelParamOptionValues(mode).includes('generate')) {
    params[mode.name] = 'generate'
  }

  const targetReference = args.targetReferenceIndex
  const lead = strategy === 'minimax-h3' ? '[video editing] 严格编辑原视频 <Video 1>。' : '严格编辑原视频（视频1）。'
  const targetHint =
    strategy === 'minimax-h3' && targetReference ? `<Picture ${targetReference}> 是修改后的主体外观参考。` : ''
  const prompt = withNoOnscreenTextGuard([lead, targetHint, args.prompt].filter(Boolean).join('\n'))
  return { prompt, params: compiledParams }
}
