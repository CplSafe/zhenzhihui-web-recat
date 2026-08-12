import { describe, expect, it } from 'vitest'
import {
  buildRealPersonIdentityPrompt,
  createSmartRealPersonReference,
  isReadyRealPersonAsset,
  isRealPersonReferenceStillAuthorized,
  isVerifiedRealPerson,
  prioritizeRealPersonReferenceAssetIds,
  registerRealPersonReference,
  requireRealPersonPreservationForShots,
  resolveShotRealPersonPreservation,
} from '@/utils/smartRealPerson'

const person = { id: 13, name: '测试人物', status: 'verified', assets: [] }
const asset = { id: 21, local_asset_id: 108, status: 'ready', asset_type: 'image' }

describe('smartRealPerson', () => {
  it('始终把已认证真人素材放在参考图第一位并去重', () => {
    expect(prioritizeRealPersonReferenceAssetIds([201, 108, 202, 108, 0], 108)).toEqual([108, 201, 202])
    expect(prioritizeRealPersonReferenceAssetIds([201, 201], 0)).toEqual([201])
  })

  it('把真人身份保持约束放在普通画面提示词之前', () => {
    const prompt = buildRealPersonIdentityPrompt('在咖啡馆微笑，暖色光线', '测试人物')
    expect(prompt).toContain('真人身份强约束：测试人物')
    expect(prompt).toContain('第一张参考图是已授权真人的唯一身份基准')
    expect(prompt).toContain('所有镜头中保持身份一致')
    expect(prompt).toContain('禁止换脸')
    expect(prompt).toContain('身份漂移')
    expect(prompt.indexOf('真人身份强约束')).toBeLessThan(prompt.indexOf('在咖啡馆微笑'))
  })

  it('重复构造真人图生图提示词时不会叠加身份约束', () => {
    const once = buildRealPersonIdentityPrompt('在咖啡馆微笑，暖色光线', '测试人物')
    const twice = buildRealPersonIdentityPrompt(once, '测试人物')

    expect(twice.match(/【真人身份强约束/g)).toHaveLength(1)
    expect(twice).toContain('在咖啡馆微笑，暖色光线')
  })

  it('只把已认证人物和同步完成的本地素材视为可用', () => {
    expect(isVerifiedRealPerson(person)).toBe(true)
    expect(isVerifiedRealPerson({ ...person, status: 'pending_verification' })).toBe(false)
    expect(isReadyRealPersonAsset(asset)).toBe(true)
    expect(isReadyRealPersonAsset({ ...asset, local_asset_id: 0 })).toBe(false)
    expect(isReadyRealPersonAsset({ ...asset, status: 'syncing' })).toBe(false)
  })

  it('保留真人档案、映射和本地素材三层 ID', () => {
    expect(createSmartRealPersonReference(person, asset)).toMatchObject({
      realPersonId: 13,
      mappingId: 21,
      localAssetId: 108,
      personName: '测试人物',
    })
  })

  it('生成前重新核验真人与素材映射', () => {
    const reference = createSmartRealPersonReference(person, asset)
    expect(isRealPersonReferenceStillAuthorized(reference, [{ ...person, assets: [asset] }])).toBe(true)
    expect(isRealPersonReferenceStillAuthorized(reference, [{ ...person, status: 'expired', assets: [asset] }])).toBe(
      false,
    )
    expect(
      isRealPersonReferenceStillAuthorized(reference, [{ ...person, assets: [{ ...asset, local_asset_id: 999 }] }]),
    ).toBe(false)
  })

  it('把真人素材登记到每个出镜主体且保留已有版本', () => {
    const url = '/api/v1/assets/108/download?workspace_id=2'
    const reference = createSmartRealPersonReference(person, asset)
    const original = { 主播: { versions: ['/old.jpg'], prompt: '原提示词' } }
    const registered = registerRealPersonReference(original, ['主播', '顾客'], url, reference)

    expect(registered.主播).toMatchObject({
      versions: [url, '/old.jpg'],
      prompt: '原提示词',
      ids: { [url]: 108 },
      sources: { [url]: 'upload' },
      realPersonRefs: { [url]: reference },
    })
    expect(registered.顾客.versions).toEqual([url])
    expect(registered).not.toBe(original)
  })

  it('仅单一人物主体使用已认证真人版本时允许保留', () => {
    const url = '/api/v1/assets/108/download?workspace_id=2'
    const registry = {
      主播: {
        versions: [url],
        realPersonRefs: { [url]: createSmartRealPersonReference(person, asset) },
      },
    }
    expect(
      resolveShotRealPersonPreservation(
        {
          subjects: [
            { tag: '@主播', kind: '人物', image: url },
            { tag: '@产品', kind: '产品' },
          ],
        },
        registry,
      )?.realPersonId,
    ).toBe(13)
    expect(
      resolveShotRealPersonPreservation(
        {
          subjects: [
            { tag: '@主播', kind: '人物', image: url },
            { tag: '@顾客', kind: '人物', image: '/other.jpg' },
          ],
        },
        registry,
      ),
    ).toBeNull()
    expect(
      resolveShotRealPersonPreservation({ subjects: [{ tag: '@主播', kind: '人物', image: '/other.jpg' }] }, registry),
    ).toBeNull()
  })

  it('真人视频要求每一个镜头都携带有效真人引用', () => {
    const url = '/api/v1/assets/108/download?workspace_id=2'
    const registry = {
      主播: {
        versions: [url],
        realPersonRefs: { [url]: createSmartRealPersonReference(person, asset) },
      },
    }
    expect(
      requireRealPersonPreservationForShots(
        [
          { no: '镜头1', subjects: [{ tag: '@主播', kind: '人物', image: url }] },
          { no: '镜头2', subjects: [{ tag: '@主播', kind: '人物', image: url }] },
        ],
        registry,
      ),
    ).toHaveLength(2)
    expect(() =>
      requireRealPersonPreservationForShots(
        [
          { no: '镜头1', subjects: [{ tag: '@主播', kind: '人物', image: url }] },
          { no: '镜头2', subjects: [{ tag: '@路人', kind: '人物', image: '/unknown.jpg' }] },
        ],
        registry,
      ),
    ).toThrow('镜头2缺少唯一且有效的真人素材')
  })
})
