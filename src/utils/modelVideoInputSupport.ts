/**
 * 判断一个视频模型能不能把「一条视频」当作输入素材。
 *
 * 背景：画布的视频节点一律提交 video.generate，而只要连线来源是视频/时间线，
 * 那条素材就恒定以 role:'video' 下发（见 canvasGeneration.buildCanvasInputAssets）。
 * 模型下拉此前只按 operation 过滤，于是「参考生视频」这类只吃参考图的模型也会被列出来，
 * 选中提交后由后端回一句 INVALID_MODEL_PARAMS「素材类型不适用于当前操作」——
 * 用户走到付费提交那一步才知道这条路走不通。
 *
 * 判定刻意保守：只有拿到「明确说了不支持」的证据才判 unsupported。
 * 误判成不支持会让一个本来能用的模型从下拉里消失，比多一次失败更难排查，
 * 因为用户根本不知道该去找谁。
 */
import {
  findModelParamField,
  getModelParamFields,
  getModelParamOptionValues,
  normalizeModelParamName,
} from './modelSchema'
import { getCreativeVideoModelKind } from './creativeVideoModelKind'
import type { BackendGenerationModel } from './generationModelCatalog'

export type VideoInputSupport = 'supported' | 'unsupported' | 'unknown'

/** 后端 schema 中用于声明输入素材角色的字段名（与 modelInputAssetRole 同一口径）。 */
const INPUT_ASSET_ROLE_FIELD_NAMES = [
  'input_asset_role',
  'inputAssetRole',
  'input_role',
  'inputRole',
  'image_input_role',
  'imageInputRole',
  'reference_image_role',
  'referenceImageRole',
]

/** 读取 input_assets 数组项里的标准 JSON Schema role 声明。 */
function readNestedRoleField(fields: unknown[]): Record<string, unknown> | null {
  const inputAssetsField = findModelParamField(fields, ['input_assets', 'inputAssets']) as
    | Record<string, unknown>
    | undefined
    | null
  const items = inputAssetsField?.items
  const properties = items && typeof items === 'object' ? (items as Record<string, unknown>).properties : null
  const role = properties && typeof properties === 'object' ? (properties as Record<string, unknown>).role : null
  return role && typeof role === 'object' ? (role as Record<string, unknown>) : null
}

function isVideoRole(value: unknown): boolean {
  return normalizeModelParamName(value) === 'video'
}

/**
 * 既吃后端原始模型记录，也吃目录里的 GenerationModelOption。
 *
 * 两者都要能判：schema 挂在 option.source 上，而按名称兜底时 option 自己的 displayName
 * 才是用户看见的那个名字。只收一种形状的话，调用方就得在每个入口自己拆，迟早拆漏。
 */
export function resolveModelVideoInputSupport(model: unknown): VideoInputSupport {
  if (!model || typeof model !== 'object') return 'unknown'
  const option = model as { source?: unknown }
  const record = (option.source && typeof option.source === 'object' ? option.source : model) as BackendGenerationModel

  const fields = getModelParamFields(record)
  const field = (findModelParamField(fields, INPUT_ASSET_ROLE_FIELD_NAMES) || readNestedRoleField(fields)) as Record<
    string,
    unknown
  > | null

  // 明确列出了可用角色：列表里有没有 video 就是答案，不必再猜
  const options = field ? getModelParamOptionValues(field) : []
  if (options.length) return options.some(isVideoRole) ? 'supported' : 'unsupported'

  // 只有默认值、没有候选列表：默认值是 video 才敢说支持；是别的角色则不下结论——
  // 默认值只说明「不指定时用哪个」，不代表其它角色一律不收。
  const defaultRole = field?.default ?? field?.default_value ?? field?.defaultValue
  if (isVideoRole(defaultRole)) return 'supported'

  /*
   * schema 没有任何角色声明时，退回按模型效果分类判断。
   * 「参考生视频」的输入定义就是参考图，这一类可以确定不吃视频；
   * 其余分类（图生视频、seedance、未识别）都不下结论，交给后端裁决。
   */
  const kindOf = (candidate: unknown) => getCreativeVideoModelKind(candidate as BackendGenerationModel)
  // 名称可能只写在 option 上（source 里是机器名），两处都看
  return kindOf(record) === 'reference-video' || kindOf(model) === 'reference-video' ? 'unsupported' : 'unknown'
}

/** 模型不支持视频输入时展示给用户的原因，与下拉里其它不可用原因同一位置显示。 */
export const VIDEO_INPUT_UNSUPPORTED_REASON = '该模型不支持把视频作为输入素材，请改用图生视频类模型，或去掉视频连线'
