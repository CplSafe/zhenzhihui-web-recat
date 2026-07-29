import {
  addRealPersonAsset,
  createRealPerson,
  deleteRealPerson,
  deleteRealPersonAsset,
  getRealPerson,
  listRealPeople,
  restartRealPersonVerification,
  syncRealPerson,
  syncRealPersonAsset,
} from '@/api/realPeople'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestPath(input: RequestInfo | URL): string {
  const url = new URL(String(input), window.location.origin)
  return `${url.pathname}${url.search}`
}

function requestBody(init?: RequestInit): unknown {
  return JSON.parse(String(init?.body || '{}'))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('realPeople API contract', () => {
  it('lists real people with only the required workspace query', async () => {
    const people = [{ id: 3, name: '小美', status: 'verified', assets: [] }]
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: people }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRealPeople({ workspaceId: 21 })).resolves.toEqual(people)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(requestPath(fetchMock.mock.calls[0]![0])).toBe('/api/v1/real-people?workspace_id=21')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include' })
  })

  it('creates a person with authorization confirmation and returns the KYC session', async () => {
    const session = {
      h5_link: 'https://verify.example.test/session',
      expires_at: '2026-07-28T12:00:00Z',
      person: { id: 9, name: '小帅', status: 'pending', assets: [] },
    }
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: session }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createRealPerson({
        workspaceId: 21,
        name: ' 小帅 ',
        consentConfirmed: true,
        description: ' 已取得本人授权 ',
      }),
    ).resolves.toEqual(session)

    expect(requestPath(fetchMock.mock.calls[0]![0])).toBe('/api/v1/real-people')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(requestBody(fetchMock.mock.calls[0]![1])).toEqual({
      workspace_id: 21,
      name: '小帅',
      consent_confirmed: true,
      description: '已取得本人授权',
    })
  })

  it('recovers a KYC session that returns person_id instead of an embedded person', async () => {
    const session = {
      h5_link: 'https://verify.example.test/session',
      expires_at: '2026-07-28T12:00:00Z',
      person_id: 9,
    }
    const person = { id: 9, name: '小帅', status: 'pending', assets: [] }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: session }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: person }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createRealPerson({
        workspaceId: 21,
        name: '小帅',
        consentConfirmed: true,
      }),
    ).resolves.toEqual({ ...session, person })

    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual([
      '/api/v1/real-people',
      '/api/v1/real-people/9?workspace_id=21',
    ])
  })

  it('gets and deletes a person using the documented path and workspace query', async () => {
    const person = { id: 9, name: '小帅', assets: [] }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: person }))
      .mockResolvedValueOnce(jsonResponse({ data: null }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getRealPerson({ workspaceId: 21, personId: 9 })).resolves.toEqual(person)
    await expect(deleteRealPerson({ workspaceId: 21, personId: 9 })).resolves.toBeUndefined()

    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual([
      '/api/v1/real-people/9?workspace_id=21',
      '/api/v1/real-people/9?workspace_id=21',
    ])
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include' })
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: 'DELETE',
      credentials: 'include',
    })
  })

  it('adds a local asset to a person using the required JSON body', async () => {
    const mapping = {
      id: 17,
      real_person_id: 9,
      local_asset_id: 44,
      asset_type: 'image',
      status: 'pending',
    }
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: mapping }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      addRealPersonAsset({
        workspaceId: 21,
        personId: 9,
        assetId: 44,
        name: ' 正面照 ',
      }),
    ).resolves.toEqual(mapping)

    expect(requestPath(fetchMock.mock.calls[0]![0])).toBe('/api/v1/real-people/9/assets')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(requestBody(fetchMock.mock.calls[0]![1])).toEqual({
      workspace_id: 21,
      asset_id: 44,
      name: '正面照',
    })
  })

  it('deletes and syncs assets by mapping ID rather than local asset ID', async () => {
    const synced = { id: 17, local_asset_id: 44, status: 'ready' }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ data: synced }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteRealPersonAsset({ workspaceId: 21, personId: 9, assetId: 17 })).resolves.toBeUndefined()
    await expect(syncRealPersonAsset({ workspaceId: 21, personId: 9, assetId: 17 })).resolves.toEqual(synced)

    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual([
      '/api/v1/real-people/9/assets/17?workspace_id=21',
      '/api/v1/real-people/9/assets/17/sync?workspace_id=21',
    ])
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' })
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[1]![1]?.body).toBeUndefined()
  })

  it('syncs person KYC status with workspace_id in the query', async () => {
    const person = { id: 9, status: 'verified', verified_at: '2026-07-28T12:00:00Z', assets: [] }
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: person }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(syncRealPerson({ workspaceId: 21, personId: 9 })).resolves.toEqual(person)

    expect(requestPath(fetchMock.mock.calls[0]![0])).toBe('/api/v1/real-people/9/sync?workspace_id=21')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    })
    expect(fetchMock.mock.calls[0]![1]?.body).toBeUndefined()
  })

  it('restarts verification with workspace_id in the request body', async () => {
    const session = {
      h5_link: 'https://verify.example.test/retry',
      person: { id: 9, status: 'pending', assets: [] },
    }
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: session }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(restartRealPersonVerification({ workspaceId: 21, personId: 9 })).resolves.toEqual(session)

    expect(requestPath(fetchMock.mock.calls[0]![0])).toBe('/api/v1/real-people/9/verification-session')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(requestBody(fetchMock.mock.calls[0]![1])).toEqual({ workspace_id: 21 })
  })

  it('inherits the shared cookie and single-refresh 401 retry behavior', async () => {
    const people = [{ id: 3, name: '小美', assets: [] }]
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code_string: 'UNAUTHORIZED', message: 'session expired' }, 401))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ data: people }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRealPeople({ workspaceId: 21 })).resolves.toEqual(people)

    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual([
      '/api/v1/real-people?workspace_id=21',
      '/api/v1/auth/refresh',
      '/api/v1/real-people?workspace_id=21',
    ])
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true)
  })

  it('fails closed when the backend returns a malformed list or KYC session', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { items: [] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { h5_link: 'https://verify.example.test/missing-person' } }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRealPeople({ workspaceId: 21 })).rejects.toThrow('真人素材列表返回格式不正确')
    await expect(
      createRealPerson({
        workspaceId: 21,
        name: '小帅',
        consentConfirmed: true,
      }),
    ).rejects.toThrow('真人认证会话档案 ID 必须是正整数')
  })

  it('rejects records without a valid server ID instead of issuing broken follow-up requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: [{ name: '缺少 ID 的档案' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRealPeople({ workspaceId: 21 })).rejects.toThrow('真人档案 ID 必须是正整数')
  })

  it('rejects a malformed nested asset collection instead of hiding server data', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ data: [{ id: 9, name: '小帅', assets: { id: 17 } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRealPeople({ workspaceId: 21 })).rejects.toThrow('真人档案素材列表返回格式不正确')
  })

  it('rejects invalid identifiers before issuing a request', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRealPeople({ workspaceId: 0 })).rejects.toThrow('工作空间 ID 必须是正整数')
    await expect(getRealPerson({ workspaceId: 21, personId: -1 })).rejects.toThrow('真人档案 ID 必须是正整数')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
