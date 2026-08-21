/**
 * 创作台「视频生成模式」与音频开关的纯逻辑层。
 *
 * 后端 `POST /ai/tasks` 对 video.generate 的 role 约定（见 router.go 的 @Description）：
 * 通用模型接受 image≤9 / video≤3 / audio≤3 任意组合，全不传即纯文生；
 * 部分模型（如 HappyHorse）按模型名细分为 t2v(不收素材) / i2v(仅 1 张首帧) / r2v(1~9 张参考图)。
 *
 * 这里把这套规则收敛成三种用户可见的模式，并给出每种模式下参考图的数量与角色。
 * 不发请求、不读全局状态。
 */
import { getCreativeVideoModelKind, matchesModelIdentity } from './creativeVideoModelKind'
import type { GenerationModelConstraints } from './modelRestrictions'

/**
 * 视频生成模式。
 * 与画布的 CanvasVideoMode 命名保持一致，避免同一概念在项目里出现两套词。
 * 纯文生不作为独立模式：不传参考素材本身就等价于文生，无需再占一个页签。
 */
export type StudioVideoMode = 'first-last' | 'full-ref'

/** 一种模式的展示与约束。 */
export interface StudioVideoModeSpec {
  value: StudioVideoMode
  label: string
  description: string
  /** 该模式下参考图数量上限。 */
  maxImages: number
  /** 至少需要几张参考图才能提交；0 表示不传也可以（退化为纯文生）。 */
  minImages: number
}

/** 参考生视频最多 9 张参考图（后端 r2v 约定）。 */
const FULL_REF_MAX_IMAGES = 9

const MODE_SPECS: Readonly<Record<StudioVideoMode, StudioVideoModeSpec>> = {
  'first-last': {
    value: 'first-last',
    label: '首尾帧',
    description: '用首帧（可选尾帧）图定义画面起止，视频在两帧之间演进',
    maxImages: 2,
    // 不传图时后端按纯文生处理，这里不强制要求参考图。
    minImages: 0,
  },
  'full-ref': {
    value: 'full-ref',
    label: '参考生视频',
    description: '用 1~9 张参考图约束主体与风格，画面自由发挥',
    maxImages: FULL_REF_MAX_IMAGES,
    minImages: 0,
  },
}

/** 默认模式：首尾帧。 */
export const DEFAULT_VIDEO_MODE: StudioVideoMode = 'first-last'

/** 取某个模式的展示与约束。 */
export function getVideoModeSpec(mode: StudioVideoMode): StudioVideoModeSpec {
  return MODE_SPECS[mode] || MODE_SPECS[DEFAULT_VIDEO_MODE]
}

/** 命中即只支持首帧图的模型（后端 *-i2v 约定）。 */
const IMAGE_TO_VIDEO_IDENTITIES = ['-i2v', 'i2v', 'imagetovideo', 'image2video'] as const
/** 命中即只支持纯文生的模型（后端 *-t2v 约定）。 */
const TEXT_TO_VIDEO_IDENTITIES = ['-t2v', 't2v', 'texttovideo', 'text2video'] as const

/**
 * 解析该模型实际支持哪几种生成模式。
 *
 * 优先信任后端声明的参考图上限；再按模型身份识别 t2v / i2v / r2v 这类细分；
 * 都识别不出来时按通用模型处理（两种模式全开）。
 *
 * 纯文生模型不返回任何模式：页面据此隐藏模式切换与参考图区，
 * 用户直接写提示词即可，不需要在只有一个选项的页签上做选择。
 */
export function resolveAvailableVideoModes(
  model: unknown,
  constraints?: GenerationModelConstraints,
): StudioVideoMode[] {
  const declaredMax = Number(constraints?.referenceImages?.maximum)

  // 后端明确声明「不收参考图」的模型只能纯文生，没有模式可选。
  if (Number.isFinite(declaredMax) && declaredMax <= 0) return []
  if (matchesModelIdentity(model as any, TEXT_TO_VIDEO_IDENTITIES)) return []

  const kind = getCreativeVideoModelKind(model as any)
  // 参考生视频类模型（r2v）以参考图为主，不提供首尾帧。
  if (kind === 'reference-video') return ['full-ref']

  if (matchesModelIdentity(model as any, IMAGE_TO_VIDEO_IDENTITIES)) return ['first-last']

  // 后端声明只收 1 张图时，参考生视频（需要多图才有意义）不再展示。
  if (Number.isFinite(declaredMax) && declaredMax === 1) return ['first-last']

  return ['first-last', 'full-ref']
}

/** 把当前模式收敛到可用集合内；不可用时退回第一个可用模式。 */
export function normalizeVideoMode(mode: StudioVideoMode, available: readonly StudioVideoMode[]): StudioVideoMode {
  if (available.includes(mode)) return mode
  return available[0] || DEFAULT_VIDEO_MODE
}

/**
 * 该模式对应的 `params.reference_mode`。
 *
 * video.generate 的图片一律以 role:'image' 下发，**首尾帧还是参考模式由这个布尔参数决定**：
 * 后端 volcengineContent 只按 image / video / audio 三种 role 分桶，再由
 * volcengineImageRole 按数组下标翻译成 first_frame / last_frame。
 * 前端直接传 first_frame 会落到分桶的默认分支被静默丢弃，图片等于没传。
 *
 * 注意后端还会强制转参考模式（volcengineReferencesOnly）：图超过 2 张，
 * 或同时带了参考视频/音频时，首尾帧放不下，一律按参考处理。
 */
export function videoReferenceMode(mode: StudioVideoMode): boolean {
  return mode === 'full-ref'
}

/** 校验当前模式下参考图数量是否满足要求；通过返回空串。 */
export function validateVideoModeImages(mode: StudioVideoMode, imageCount: number): string {
  const spec = getVideoModeSpec(mode)
  if (imageCount > spec.maxImages) return `${spec.label}最多 ${spec.maxImages} 张参考图`
  if (imageCount < spec.minImages) return `${spec.label}至少需要 ${spec.minImages} 张参考图`
  return ''
}

/**
 * 点「生成」时是否应当先拆一份分镜给用户确认，而不是直接出片。
 *
 * 视频生成是计费动作：开着智能分镜却还没有任何分镜就直接提交，
 * 等于让用户为一份自己没看过的镜头脚本付费。这里先拆再确认。
 * 图片模式没有分镜概念；分镜已存在时说明用户已经看过，直接出片。
 */
export function shouldStoryboardBeforeGenerate(args: {
  mode: 'image' | 'video'
  storyboardOn: boolean
  shotCount: number
}): boolean {
  return args.mode === 'video' && args.storyboardOn && args.shotCount === 0
}

/** 该模型是否支持音频输出开关（后端 params_schema 声明 audio 字段时才展示）。 */
export function supportsAudioToggle(constraints?: GenerationModelConstraints): boolean {
  const options = constraints?.audio?.options
  // 声明了 audio 且允许取两个值时才有「开/关」的意义。
  if (Array.isArray(options) && options.length > 1) return true
  return Boolean(constraints?.audio && !options)
}
