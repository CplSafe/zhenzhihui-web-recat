import { describe, expect, it } from 'vitest'
import { applyCanvasRealPersonIdentity, resolveCanvasRealPersonReference } from '@/utils/canvasRealPerson'
import type { SmartRealPersonReference } from '@/utils/smartRealPerson'

function reference(overrides: Partial<SmartRealPersonReference> = {}): SmartRealPersonReference {
  return {
    realPersonId: 9,
    mappingId: 21,
    localAssetId: 501,
    personName: '已认证真人',
    verificationStatus: 'verified',
    assetStatus: 'ready',
    ...overrides,
  }
}

describe('canvas real-person reference resolution', () => {
  it('returns nothing when no real-person material is connected', () => {
    expect(resolveCanvasRealPersonReference(undefined)).toEqual({ reference: null, error: null })
    expect(resolveCanvasRealPersonReference([{ kind: 'image', assetId: 3 }])).toEqual({
      reference: null,
      error: null,
    })
  })

  it('ignores incomplete references instead of treating them as an identity baseline', () => {
    // 缺 realPersonId / localAssetId 的引用无法回查授权，等同于普通参考图。
    expect(
      resolveCanvasRealPersonReference([
        { kind: 'image', assetId: 501, realPerson: reference({ realPersonId: 0 }) },
        { kind: 'image', assetId: 502, realPerson: reference({ localAssetId: 0 }) },
      ]),
    ).toEqual({ reference: null, error: null })
  })

  it('accepts the same material connected twice but rejects two different people', () => {
    const same = resolveCanvasRealPersonReference([
      { kind: 'image', assetId: 501, realPerson: reference() },
      { kind: 'image', assetId: 501, realPerson: reference() },
    ])
    expect(same.error).toBeNull()
    expect(same.reference?.localAssetId).toBe(501)

    const conflicting = resolveCanvasRealPersonReference([
      { kind: 'image', assetId: 501, realPerson: reference() },
      { kind: 'image', assetId: 777, realPerson: reference({ realPersonId: 10, localAssetId: 777 }) },
    ])
    expect(conflicting.reference).toBeNull()
    expect(conflicting.error).toBe('一次生成只能引用一张真人素材，请移除多余的真人素材后重试')
  })
})

describe('canvas real-person identity injection', () => {
  const inputAssets = [
    { asset_id: 300, role: 'image' as const },
    { asset_id: 501, role: 'image' as const },
    { asset_id: 400, role: 'image' as const },
  ]

  it('leaves prompt and assets untouched without a real-person reference', () => {
    const result = applyCanvasRealPersonIdentity({ kind: 'image', prompt: '走在街上', inputAssets, reference: null })
    expect(result.prompt).toBe('走在街上')
    expect(result.inputAssets).toEqual(inputAssets)
  })

  it('moves the real-person material to the front and injects the image constraint', () => {
    const result = applyCanvasRealPersonIdentity({
      kind: 'image',
      prompt: '走在街上',
      inputAssets,
      reference: reference(),
    })
    // 模型按输入顺序分配参考权重，真人图必须第一位，否则身份会被场景图稀释。
    expect(result.inputAssets.map((asset) => asset.asset_id)).toEqual([501, 300, 400])
    expect(result.prompt).toContain('【真人身份强约束：已认证真人】')
    expect(result.prompt).toContain('走在街上')
  })

  it('uses the video constraint wording for video nodes', () => {
    const result = applyCanvasRealPersonIdentity({
      kind: 'video',
      videoMode: 'auto',
      prompt: '沿街行走',
      inputAssets,
      reference: reference(),
    })
    expect(result.inputAssets.map((asset) => asset.asset_id)).toEqual([501, 300, 400])
    expect(result.prompt).toContain('【真人出镜身份强约束：已认证真人】')
    // 图片版与视频版措辞不同，不能互相顶替。
    expect(result.prompt).not.toContain('【真人身份强约束：')
  })

  it('keeps first/last frame order intact because the slot order carries meaning', () => {
    const frames = [
      { asset_id: 300, role: 'image' as const },
      { asset_id: 501, role: 'image' as const },
    ]
    const result = applyCanvasRealPersonIdentity({
      kind: 'video',
      videoMode: 'first-last',
      prompt: '从远景走近',
      inputAssets: frames,
      reference: reference(),
    })
    // 重排会把用户指定的尾帧变成首帧，这里只注入提示词。
    expect(result.inputAssets.map((asset) => asset.asset_id)).toEqual([300, 501])
    expect(result.prompt).toContain('【真人出镜身份强约束：已认证真人】')
  })

  it('does not drop assets when the real-person material is not among the inputs', () => {
    const result = applyCanvasRealPersonIdentity({
      kind: 'image',
      prompt: '走在街上',
      inputAssets: [{ asset_id: 300, role: 'image' }],
      reference: reference(),
    })
    expect(result.inputAssets.map((asset) => asset.asset_id)).toEqual([300])
  })
})
