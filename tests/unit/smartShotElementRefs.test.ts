import { describe, expect, it } from 'vitest'
import { resolveShotElementReferenceAssetIds } from '@/utils/smartShotElementRefs'

describe('resolveShotElementReferenceAssetIds', () => {
  it('只携带当前镜头匹配到的客户上传元素', () => {
    expect(
      resolveShotElementReferenceAssetIds({
        subjects: [
          { tag: '@产品A', refAssetId: 11, refAssetIds: [11, 12], image: '/product.png', assetId: 11 },
          { tag: '@背景', image: '/generated.png', assetId: 99 },
        ],
      }),
    ).toEqual([11, 12])
  })

  it('兼容只有单个 refAssetId 的旧项目并去重', () => {
    expect(
      resolveShotElementReferenceAssetIds({
        subjects: [
          { tag: '@产品A', refAssetId: 11 },
          { tag: '@产品A侧面', refAssetId: 11 },
          { tag: '@产品B', refAssetId: 22 },
        ],
      }),
    ).toEqual([11, 22])
  })

  it('忽略非法 ID 和没有上传引用的 AI 素材', () => {
    expect(
      resolveShotElementReferenceAssetIds({
        subjects: [
          { tag: '@AI人物', assetId: 88 },
          { tag: '@无效素材', refAssetIds: [0, -1, Number.NaN] },
        ],
      }),
    ).toEqual([])
  })
})
