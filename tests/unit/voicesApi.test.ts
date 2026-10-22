import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createVoice,
  deleteVoice,
  getVoice,
  getVoiceFilters,
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
  it('筛选和列表共享查询条件，多选用重复参数，筛选请求不携带分页', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      response(
        String(url).includes('/filters?')
          ? { languages: ['zh', 'zh'], voice_features: ['温柔'] }
          : { items: [], total: 0 },
      ),
    )
    vi.stubGlobal('fetch', fetcher)
    const query = {
      ...context,
      modelVersionId: 91,
      source: 'public' as const,
      q: '旁白 & 角色',
      language: 'zh',
      provider: 'minimax',
      gender: 'female',
      age: '青年',
      resource_id: 'speech-02',
      accent: ['北京', '上海', '北京'],
      voice_feature: ['温柔', '清亮'],
      scenario: ['旁白'],
      category: ['有声书'],
      label: ['特色'],
      emotion: ['happy'],
      tag: ['收藏推荐'],
      favorites: false,
    }
    const filters = await getVoiceFilters(query)
    expect(filters.languages).toEqual(['zh'])
    expect(filters.providers).toEqual([])
    expect(filters.voice_features).toEqual(['温柔'])
    await listVoices({ ...query, limit: 20, offset: 40 })
    const filterUrl = new URL(String(fetcher.mock.calls[0][0]), window.location.origin)
    const listUrl = new URL(String(fetcher.mock.calls[1][0]), window.location.origin)
    expect(filterUrl.pathname).toBe('/api/v1/voices/filters')
    expect(filterUrl.searchParams.has('limit')).toBe(false)
    expect(filterUrl.searchParams.has('offset')).toBe(false)
    expect(listUrl.searchParams.get('offset')).toBe('40')
    listUrl.searchParams.delete('limit')
    listUrl.searchParams.delete('offset')
    expect([...filterUrl.searchParams]).toEqual([...listUrl.searchParams])
    expect(filterUrl.searchParams.getAll('accent')).toEqual(['北京', '上海'])
    expect(filterUrl.searchParams.getAll('voice_feature')).toEqual(['温柔', '清亮'])
    expect(filterUrl.searchParams.get('q')).toBe('旁白 & 角色')
    expect(filterUrl.searchParams.get('favorites')).toBe('false')
  })
  it('筛选选项拒绝畸形响应，空维度不生成虚构选项', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ languages: null }))
    vi.stubGlobal('fetch', fetcher)
    expect((await getVoiceFilters(context)).languages).toEqual([])
    for (const data of [null, [], { languages: 'zh' }, { emotions: [42] }]) {
      fetcher.mockImplementation(async () => response(data))
      await expect(getVoiceFilters(context)).rejects.toThrow('格式')
    }
    fetcher.mockClear()
    await expect(getVoiceFilters({ workspaceId: 0 })).rejects.toThrow('工作空间')
    await expect(getVoiceFilters({ ...context, modelVersionId: -1 })).rejects.toThrow('模型')
    expect(fetcher).not.toHaveBeenCalled()
  })
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
  it('创建省略空白可选字段，规范非空标签', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(voice))
    vi.stubGlobal('fetch', fetcher)
    await createVoice(context, {
      name: ' 男生 ',
      description: '',
      language: ' ',
      gender: '',
      tags: ['', ' '],
      sample_asset_id: 3230,
      consent_confirmed: true,
      idempotency_key: 'stable',
    })
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      name: '男生',
      sample_asset_id: 3230,
      consent_confirmed: true,
      idempotency_key: 'stable',
      workspace_id: 21,
    })
    await createVoice(context, {
      name: '男生',
      description: ' 旁白 ',
      language: ' zh ',
      gender: ' male ',
      tags: [' 温柔 ', '', '温柔'],
      sample_asset_id: 3230,
      consent_confirmed: true,
      idempotency_key: 'stable',
    })
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      description: '旁白',
      language: 'zh',
      gender: 'male',
      tags: ['温柔'],
    })
  })
  it('显式提交复刻供应商，MiniMax 不退回火山默认值', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(voice))
    vi.stubGlobal('fetch', fetcher)
    await createVoice(context, {
      provider: 'minimax',
      name: '你好',
      sample_asset_id: 3240,
      consent_confirmed: true,
      idempotency_key: 'uuid',
    })
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      provider: 'minimax',
      sample_asset_id: 3240,
      workspace_id: 21,
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
