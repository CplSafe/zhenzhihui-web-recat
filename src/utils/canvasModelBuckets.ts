/**
 * 画布节点面板的模型分桶：把目录分组投影为「按节点类型」的三份列表。
 *
 * 存在这个模块只有一个原因——分组键与节点类型不是一对一的，而画布面板需要的是后者：
 *
 *   目录分组                    operation_codes                            节点类型
 *   script                     responses.multimodal                        text
 *   image                      image.text_to_image, image.image_to_image   image
 *   video                      video.generate                          ┐
 *   videoEdit                  video.edit                              ┘   video
 *
 * 图片的两个 operation 恰好同在 'image' 组，所以图片一直是对的；视频的两个 operation
 * 分在两组，只取 'video' 组就会让视频节点在接入视频输入、operation 切到 video.edit 之后，
 * 在一份只有 video.generate 模型的列表里做筛选 —— 结果恒为空，「视频生视频」整条路走不通，
 * 表现是模型选择器一直显示「暂无可用的视频修改模型」。
 *
 * 面板自己会按当前 operation_code 再过滤一次，所以这里必须给出「该节点类型可能用到的全部模型」，
 * 而不是某一个 operation 的子集。
 */
import type { GenerationModelGroup, GenerationModelOption } from './generationModelCatalog'

/** 画布节点类型 → 该类型可选的模型列表。 */
export interface CanvasModelBuckets {
  text: GenerationModelOption[]
  image: GenerationModelOption[]
  video: GenerationModelOption[]
}

/** 每个节点类型对应的目录分组键；视频刻意收两组。 */
const GROUP_KEYS_BY_NODE_KIND = {
  text: ['script'],
  image: ['image'],
  video: ['video', 'videoEdit'],
} as const

/** 按 modelVersionId 去重，保持首次出现的顺序。 */
function dedupeByVersionId(models: readonly GenerationModelOption[]): GenerationModelOption[] {
  const byVersion = new Map<number, GenerationModelOption>()
  for (const model of models) {
    const versionId = Number(model?.modelVersionId || 0)
    const existing = byVersion.get(versionId)
    if (!existing) {
      byVersion.set(versionId, model)
      continue
    }
    // 同一个模型版本会按 operation_code 被目录拆成多条记录。不能简单丢弃
    // 后续记录，否则模型可能只保留 image_to_image 或 text_to_image 其中一种能力。
    // 合并能力列表后，图片节点会根据是否有参考图正确切换两种模式。
    byVersion.set(versionId, {
      ...existing,
      operationCodes: Array.from(new Set([...(existing.operationCodes || []), ...(model.operationCodes || [])])),
      unavailableReason: existing.unavailableReason || model.unavailableReason,
    })
  }
  return Array.from(byVersion.values())
}

/** 把目录分组投影为画布面板需要的三份模型列表。 */
export function buildCanvasModelBuckets(
  groups: readonly GenerationModelGroup[] | null | undefined,
): CanvasModelBuckets {
  const list = Array.isArray(groups) ? groups : []
  const collect = (keys: readonly string[]): GenerationModelOption[] =>
    dedupeByVersionId(keys.flatMap((key) => list.find((group) => group.key === key)?.models || []))

  return {
    text: collect(GROUP_KEYS_BY_NODE_KIND.text),
    image: collect(GROUP_KEYS_BY_NODE_KIND.image),
    video: collect(GROUP_KEYS_BY_NODE_KIND.video),
  }
}
