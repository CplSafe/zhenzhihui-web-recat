/**
 * 画布模型分桶。
 *
 * 这里锁的是一个反复出现的线上问题：视频节点接入视频输入后 operation 切到 video.edit，
 * 但目录把 video.edit 放在独立的 'videoEdit' 组，面板拿到的却只有 'video' 组，
 * 于是模型列表恒为空、显示「暂无可用的视频修改模型」，视频生视频整条路走不通。
 */
import { describe, expect, it } from 'vitest'
import { buildCanvasModelBuckets } from '@/utils/canvasModelBuckets'
import { buildGenerationModelGroups } from '@/utils/generationModelCatalog'

/** 造一条最小可用的后端模型记录。 */
function model(id: number, displayName: string, operationCodes: string[]) {
  return {
    id,
    model_version_id: id,
    display_name: displayName,
    capability: 'video',
    enabled: true,
    operation_codes: operationCodes,
  }
}

describe('buildCanvasModelBuckets', () => {
  it('把 video.generate 与 video.edit 一起装进 video 桶', () => {
    const groups = buildGenerationModelGroups([
      model(5, '通用文生视频', ['video.generate']),
      model(9, 'HappyHorse 视频编辑', ['video.edit']),
    ])

    const buckets = buildCanvasModelBuckets(groups)
    const ids = buckets.video.map((m) => m.modelVersionId).sort((a, b) => a - b)
    // 只装 'video' 组时这里会漏掉 9，视频生视频就永远选不到模型
    expect(ids).toEqual([5, 9])
  })

  it('同时支持两个 operation 的模型只出现一次', () => {
    const groups = buildGenerationModelGroups([model(7, '双能力模型', ['video.generate', 'video.edit'])])

    const buckets = buildCanvasModelBuckets(groups)
    expect(buckets.video.map((m) => m.modelVersionId)).toEqual([7])
  })

  it('目录里只有 video.edit 模型时，video 桶依然非空', () => {
    const groups = buildGenerationModelGroups([model(9, 'HappyHorse 视频编辑', ['video.edit'])])

    const buckets = buildCanvasModelBuckets(groups)
    expect(buckets.video).toHaveLength(1)
    expect(buckets.video[0].operationCodes).toContain('video.edit')
  })

  it('脚本与图片按各自分组投影，图片两个 operation 都在', () => {
    const groups = buildGenerationModelGroups([
      { ...model(1, '脚本模型', ['responses.multimodal']), capability: 'text' },
      { ...model(2, '文生图', ['image.text_to_image']), capability: 'image' },
      { ...model(3, '图生图', ['image.image_to_image']), capability: 'image' },
      model(4, '文生视频', ['video.generate']),
    ])

    const buckets = buildCanvasModelBuckets(groups)
    expect(buckets.text.map((m) => m.modelVersionId)).toEqual([1])
    expect(buckets.image.map((m) => m.modelVersionId).sort((a, b) => a - b)).toEqual([2, 3])
    expect(buckets.video.map((m) => m.modelVersionId)).toEqual([4])
  })

  it('空目录返回三个空桶而不是抛错', () => {
    expect(buildCanvasModelBuckets([])).toEqual({ text: [], image: [], video: [] })
    expect(buildCanvasModelBuckets(null)).toEqual({ text: [], image: [], video: [] })
  })
})
