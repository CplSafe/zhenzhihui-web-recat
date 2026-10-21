import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createVoice,
  deleteVoice,
  getVoice,
  isVoiceReady,
  isVoiceTraining,
  listVoices,
  retryVoice,
  setVoiceFavorite,
  syncVoice,
  updateVoice,
} from '@/api/voices'

const voice = { id: 5, name: '角色声音', source: 'cloned', status: 'ready', workspace_id: 21 }
const context = { workspaceId: 21 }
const response = (data: unknown) =>
  new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())
describe('音色接口契约', () => {
  it('列表携带空间、模型兼容性、来源、搜索及分页参数', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ items: [voice], total: 1 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      listVoices({
        ...context,
        modelVersionId: 91,
        source: 'cloned',
        q: '角色',
        language: 'zh',
        favorites: true,
        limit: 50,
        offset: 0,
      }),
    ).resolves.toMatchObject({ items: [voice], total: 1 })
    const url = new URL(String(fetcher.mock.calls[0][0]), window.location.origin)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      workspace_id: '21',
      model_version_id: '91',
      source: 'cloned',
      q: '角色',
      language: 'zh',
      favorites: 'true',
      limit: '50',
      offset: '0',
    })
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })
  it('创建使用已上传资产、授权和稳定幂等键，空间同时传入 query 与 body', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(voice))
    vi.stubGlobal('fetch', fetcher)
    await createVoice(context, {
      name: ' 角色声音 ',
      sample_asset_id: 55,
      consent_confirmed: true,
      idempotency_key: 'stable-key',
    })
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/v1/voices?workspace_id=21')
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      workspace_id: 21,
      name: '角色声音',
      sample_asset_id: 55,
      consent_confirmed: true,
      idempotency_key: 'stable-key',
    })
  })
  it('详情、编辑、删除、收藏、取消收藏、替换样本重试和同步均使用独立接口', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(voice))
    vi.stubGlobal('fetch', fetcher)
    await getVoice(context, 5)
    await updateVoice(context, 5, { name: '新名称', description: '旁白' })
    await setVoiceFavorite(context, 5, true)
    await setVoiceFavorite(context, 5, false)
    await retryVoice(context, 5, 66)
    await retryVoice(context, 5)
    await syncVoice(context, 5)
    await deleteVoice(context, 5)
    expect(
      fetcher.mock.calls.map(([url, init]) => [
        new URL(String(url), window.location.origin).pathname,
        init?.method || 'GET',
      ]),
    ).toEqual([
      ['/api/v1/voices/5', 'GET'],
      ['/api/v1/voices/5', 'PUT'],
      ['/api/v1/voices/5/favorite', 'PUT'],
      ['/api/v1/voices/5/favorite', 'DELETE'],
      ['/api/v1/voices/5/retry', 'POST'],
      ['/api/v1/voices/5/retry', 'POST'],
      ['/api/v1/voices/5/sync', 'POST'],
      ['/api/v1/voices/5', 'DELETE'],
    ])
    expect(JSON.parse(String(fetcher.mock.calls[4][1]?.body))).toEqual({ sample_asset_id: 66 })
    expect(JSON.parse(String(fetcher.mock.calls[5][1]?.body))).toEqual({})
    expect(fetcher.mock.calls.every(([url]) => String(url).includes('workspace_id=21'))).toBe(true)
  })
  it('非法参数不发请求，空或畸形结果不视为正常列表', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ items: null, total: 0 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(listVoices({ workspaceId: 0 })).rejects.toThrow('工作空间')
    await expect(listVoices({ ...context, limit: 101 })).rejects.toThrow('分页')
    await expect(getVoice(context, -1)).rejects.toThrow('音色 ID')
    await expect(
      createVoice(context, { name: '', sample_asset_id: 1, consent_confirmed: true, idempotency_key: 'x' }),
    ).rejects.toThrow('授权')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(listVoices(context)).rejects.toThrow('格式')
    fetcher.mockImplementation(async () => response(null))
    await expect(getVoice(context, 5)).rejects.toThrow('格式')
    expect(isVoiceReady({ ...voice, status: 'unknown' })).toBe(false)
    expect(isVoiceTraining({ ...voice, status: 'training' })).toBe(true)
  })
})
