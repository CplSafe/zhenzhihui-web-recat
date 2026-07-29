/**
 * 真人素材 API 客户端。
 * 严格对应后端 /api/v1/real-people 契约，所有请求复用 business.ts 的统一鉴权和错误处理。
 */
import { BusinessApiError, requestBusinessJson } from './business'

/** 真人档案下的一条图片或视频素材映射。 */
export interface RealPersonAsset {
  /** 真人素材映射 ID，用于同步和删除接口的路径参数。 */
  id: number
  real_person_id?: number
  workspace_id?: number
  local_asset_id?: number
  name?: string
  asset_type?: string
  provider?: string
  status?: string
  last_error?: string
  created_at?: string
  updated_at?: string
}

/** 真人档案及其 KYC 状态。 */
export interface RealPerson {
  /** 真人档案 ID。 */
  id: number
  user_id?: number
  workspace_id?: number
  name?: string
  description?: string
  provider?: string
  status?: string
  last_error?: string
  consent_confirmed_at?: string
  verification_expires_at?: string
  verified_at?: string
  created_at?: string
  updated_at?: string
  assets?: RealPersonAsset[]
}

/** 创建或重新发起真人 KYC 后返回的认证会话。 */
export interface RealPersonSession {
  h5_link?: string
  expires_at?: string
  person: RealPerson
}

interface SignalOptions {
  signal?: AbortSignal
}

export interface ListRealPeopleParams extends SignalOptions {
  workspaceId: number
}

export interface CreateRealPersonParams extends SignalOptions {
  workspaceId: number
  name: string
  consentConfirmed: true
  description?: string
}

export interface GetRealPersonParams extends SignalOptions {
  workspaceId: number
  personId: number
}

export interface DeleteRealPersonParams extends SignalOptions {
  workspaceId: number
  personId: number
}

export interface AddRealPersonAssetParams extends SignalOptions {
  workspaceId: number
  personId: number
  /** 素材中心的本地 asset ID。 */
  assetId: number
  name?: string
}

export interface DeleteRealPersonAssetParams extends SignalOptions {
  workspaceId: number
  personId: number
  /** 真人档案与本地素材之间的映射 ID，不是 local_asset_id。 */
  assetId: number
}

export interface SyncRealPersonAssetParams extends SignalOptions {
  workspaceId: number
  personId: number
  /** 真人档案与本地素材之间的映射 ID，不是 local_asset_id。 */
  assetId: number
}

export interface SyncRealPersonParams extends SignalOptions {
  workspaceId: number
  personId: number
}

export interface RestartRealPersonVerificationParams extends SignalOptions {
  workspaceId: number
  personId: number
}

function requirePositiveInteger(value: number, fieldName: string): number {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new BusinessApiError(`${fieldName} 必须是正整数`)
  }
  return normalized
}

function requireName(value: string): string {
  const normalized = String(value || '').trim()
  if (!normalized) {
    throw new BusinessApiError('真人名称不能为空')
  }
  return normalized
}

function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BusinessApiError(`${fieldName}返回格式不正确`)
  }
  return value as Record<string, unknown>
}

function normalizeAsset(value: unknown): RealPersonAsset {
  const record = requireObject(value, '真人素材')
  return {
    ...record,
    id: requirePositiveInteger(Number(record.id), '真人素材映射 ID'),
  } as RealPersonAsset
}

function normalizePerson(value: unknown): RealPerson {
  const record = requireObject(value, '真人档案')
  if (record.assets != null && !Array.isArray(record.assets)) {
    throw new BusinessApiError('真人档案素材列表返回格式不正确')
  }
  return {
    ...record,
    id: requirePositiveInteger(Number(record.id), '真人档案 ID'),
    assets: Array.isArray(record.assets) ? record.assets.map(normalizeAsset) : [],
  } as RealPerson
}

async function normalizeSession(value: unknown, workspaceId: number, signal?: AbortSignal): Promise<RealPersonSession> {
  const record = requireObject(value, '真人认证会话')
  let person: RealPerson
  if (record.person) {
    person = normalizePerson(record.person)
  } else {
    const personId = requirePositiveInteger(Number(record.person_id || record.real_person_id), '真人认证会话档案 ID')
    person = await getRealPerson({ workspaceId, personId, signal })
  }
  return {
    ...record,
    person,
  } as RealPersonSession
}

function workspaceQuery(workspaceId: number): string {
  const query = new URLSearchParams({
    workspace_id: String(requirePositiveInteger(workspaceId, '工作空间 ID')),
  })
  return query.toString()
}

function jsonRequest(body: Record<string, unknown>, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  }
}

/** 列出当前用户在指定工作空间可访问的全部真人档案。 */
export async function listRealPeople({ workspaceId, signal }: ListRealPeopleParams): Promise<RealPerson[]> {
  const response = await requestBusinessJson<unknown>(`/api/v1/real-people?${workspaceQuery(workspaceId)}`, {
    ...(signal ? { signal } : {}),
  })
  if (!Array.isArray(response)) {
    throw new BusinessApiError('真人素材列表返回格式不正确')
  }
  return response.map(normalizePerson)
}

/** 创建真人档案并发起 KYC，返回可跳转的 H5 认证会话。 */
export async function createRealPerson({
  workspaceId,
  name,
  consentConfirmed,
  description,
  signal,
}: CreateRealPersonParams): Promise<RealPersonSession> {
  if (consentConfirmed !== true) {
    throw new BusinessApiError('创建真人档案前必须确认已获得本人授权')
  }

  const body: Record<string, unknown> = {
    workspace_id: requirePositiveInteger(workspaceId, '工作空间 ID'),
    name: requireName(name),
    consent_confirmed: true,
  }
  const normalizedDescription = String(description || '').trim()
  if (normalizedDescription) {
    body.description = normalizedDescription
  }

  return normalizeSession(
    await requestBusinessJson<unknown>('/api/v1/real-people', jsonRequest(body, signal)),
    workspaceId,
    signal,
  )
}

/** 获取指定真人档案详情。 */
export async function getRealPerson({ workspaceId, personId, signal }: GetRealPersonParams): Promise<RealPerson> {
  const id = requirePositiveInteger(personId, '真人档案 ID')
  return normalizePerson(
    await requestBusinessJson<unknown>(`/api/v1/real-people/${id}?${workspaceQuery(workspaceId)}`, {
      ...(signal ? { signal } : {}),
    }),
  )
}

/** 删除指定真人档案。 */
export async function deleteRealPerson({ workspaceId, personId, signal }: DeleteRealPersonParams): Promise<void> {
  const id = requirePositiveInteger(personId, '真人档案 ID')
  await requestBusinessJson(`/api/v1/real-people/${id}?${workspaceQuery(workspaceId)}`, {
    method: 'DELETE',
    ...(signal ? { signal } : {}),
  })
}

/** 将素材中心的一条本地图片或视频添加到真人档案。 */
export async function addRealPersonAsset({
  workspaceId,
  personId,
  assetId,
  name,
  signal,
}: AddRealPersonAssetParams): Promise<RealPersonAsset> {
  const id = requirePositiveInteger(personId, '真人档案 ID')
  const body: Record<string, unknown> = {
    workspace_id: requirePositiveInteger(workspaceId, '工作空间 ID'),
    asset_id: requirePositiveInteger(assetId, '本地素材 ID'),
  }
  const normalizedName = String(name || '').trim()
  if (normalizedName) {
    body.name = normalizedName
  }

  return normalizeAsset(
    await requestBusinessJson<unknown>(`/api/v1/real-people/${id}/assets`, jsonRequest(body, signal)),
  )
}

/** 删除真人档案中的一条素材映射。 */
export async function deleteRealPersonAsset({
  workspaceId,
  personId,
  assetId,
  signal,
}: DeleteRealPersonAssetParams): Promise<void> {
  const id = requirePositiveInteger(personId, '真人档案 ID')
  const mappingId = requirePositiveInteger(assetId, '真人素材映射 ID')
  await requestBusinessJson(`/api/v1/real-people/${id}/assets/${mappingId}?${workspaceQuery(workspaceId)}`, {
    method: 'DELETE',
    ...(signal ? { signal } : {}),
  })
}

/** 主动同步一条真人素材映射在服务商侧的最新状态。 */
export async function syncRealPersonAsset({
  workspaceId,
  personId,
  assetId,
  signal,
}: SyncRealPersonAssetParams): Promise<RealPersonAsset> {
  const id = requirePositiveInteger(personId, '真人档案 ID')
  const mappingId = requirePositiveInteger(assetId, '真人素材映射 ID')
  return normalizeAsset(
    await requestBusinessJson<unknown>(
      `/api/v1/real-people/${id}/assets/${mappingId}/sync?${workspaceQuery(workspaceId)}`,
      {
        method: 'POST',
        ...(signal ? { signal } : {}),
      },
    ),
  )
}

/** 主动同步真人档案的 KYC 状态。 */
export async function syncRealPerson({ workspaceId, personId, signal }: SyncRealPersonParams): Promise<RealPerson> {
  const id = requirePositiveInteger(personId, '真人档案 ID')
  return normalizePerson(
    await requestBusinessJson<unknown>(`/api/v1/real-people/${id}/sync?${workspaceQuery(workspaceId)}`, {
      method: 'POST',
      ...(signal ? { signal } : {}),
    }),
  )
}

/** 为已有真人档案重新创建 KYC 认证会话。 */
export async function restartRealPersonVerification({
  workspaceId,
  personId,
  signal,
}: RestartRealPersonVerificationParams): Promise<RealPersonSession> {
  const id = requirePositiveInteger(personId, '真人档案 ID')
  return normalizeSession(
    await requestBusinessJson<unknown>(
      `/api/v1/real-people/${id}/verification-session`,
      jsonRequest(
        {
          workspace_id: requirePositiveInteger(workspaceId, '工作空间 ID'),
        },
        signal,
      ),
    ),
    workspaceId,
    signal,
  )
}
