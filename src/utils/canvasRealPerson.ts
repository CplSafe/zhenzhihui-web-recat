/**
 * 无限画布 · 真人素材的身份约束层
 *
 * 后端没有真人专用参数：身份保持完全靠前端做对两件事——把真人图排在参考图首位、
 * 在提示词里注入身份约束（见 SmartCreateView 的同名调用）。做漏了后端不会报错，
 * 只会悄悄生成一个不像本人的人，因此这里把规则集中成纯函数并单独覆盖测试。
 *
 * 产品口径：一次生成最多引用一张真人素材；真人素材经过认证，不再单独做人脸脱敏；
 * 可用于参考图、首尾帧与 video.edit 输入。
 */
import type { CanvasInputAsset } from './canvasGeneration'
import {
  buildRealPersonIdentityPrompt,
  buildRealPersonVideoIdentityPrompt,
  prioritizeRealPersonReferenceAssetIds,
  type SmartRealPersonReference,
} from './smartRealPerson'

/** 连线来源中与真人素材相关的最小信息。 */
export interface CanvasRealPersonSourceRef {
  kind?: string
  assetId?: number
  realPerson?: SmartRealPersonReference | null
}

/** 解析结果：要么拿到唯一引用，要么给出可直接展示给用户的拦截原因。 */
export interface CanvasRealPersonResolution {
  reference: SmartRealPersonReference | null
  error: string | null
}

/**
 * 取出本次生成唯一的真人素材引用。
 *
 * 画布可以自由连多张参考图，但真人身份只能有一个基准：连入两张不同真人时无法判断
 * 该保谁的脸，必须拦截而不是猜。同一个人的同一张素材被重复连线不算冲突。
 */
export function resolveCanvasRealPersonReference(
  refs: readonly CanvasRealPersonSourceRef[] | undefined,
): CanvasRealPersonResolution {
  const references = (refs || [])
    .map((ref) => ref?.realPerson)
    .filter((reference): reference is SmartRealPersonReference => {
      return Boolean(reference && Number(reference.realPersonId) > 0 && Number(reference.localAssetId) > 0)
    })
  if (references.length === 0) return { reference: null, error: null }

  const distinct = new Map<string, SmartRealPersonReference>()
  for (const reference of references) {
    distinct.set(`${reference.realPersonId}:${reference.localAssetId}`, reference)
  }
  if (distinct.size > 1) {
    return {
      reference: null,
      error: '一次生成只能引用一张真人素材，请移除多余的真人素材后重试',
    }
  }
  return { reference: [...distinct.values()][0], error: null }
}

/** 身份约束注入所需的节点上下文。 */
export interface CanvasRealPersonIdentityInput {
  /** 目标节点类型：决定注入图片版还是视频版身份约束。 */
  kind: string
  /** 视频节点的生成方式；first-last 下参考图顺序表示首帧/尾帧，不能重排。 */
  videoMode?: string
  prompt: string
  inputAssets: readonly CanvasInputAsset[]
  reference: SmartRealPersonReference | null
}

/**
 * 按节点类型注入身份约束，并把真人图提到参考图首位。
 *
 * 首尾帧模式例外：该模式下参考图顺序本身就是「首帧、尾帧」的语义，重排会把用户
 * 指定的尾帧变成首帧，因此只注入提示词、保持既有顺序。
 */
export function applyCanvasRealPersonIdentity(input: CanvasRealPersonIdentityInput): {
  prompt: string
  inputAssets: CanvasInputAsset[]
} {
  const inputAssets = [...(input.inputAssets || [])]
  const reference = input.reference
  if (!reference) return { prompt: input.prompt, inputAssets }

  const prompt =
    input.kind === 'video'
      ? buildRealPersonVideoIdentityPrompt(input.prompt, reference.personName)
      : buildRealPersonIdentityPrompt(input.prompt, reference.personName)

  if (input.kind === 'video' && input.videoMode === 'first-last') {
    return { prompt, inputAssets }
  }

  const byAssetId = new Map(inputAssets.map((asset) => [asset.asset_id, asset]))
  const orderedIds = prioritizeRealPersonReferenceAssetIds(
    inputAssets.map((asset) => asset.asset_id),
    reference.localAssetId,
  )
  const ordered = orderedIds
    .map((assetId) => byAssetId.get(assetId))
    .filter((asset): asset is CanvasInputAsset => Boolean(asset))
  // prioritize 只认识 id，真人素材尚未连线时不会凭空补进来；补回未被列出的项以防丢素材。
  for (const asset of inputAssets) {
    if (!ordered.includes(asset)) ordered.push(asset)
  }
  return { prompt, inputAssets: ordered }
}
