/**
 * 项目与素材访问过滤：解析不同接口结构中的项目归属，并按项目权限隐藏关联素材。
 * 权限列表尚未加载时默认不展示有项目归属的素材，避免短暂越权泄露。
 */
import { isCreativeProjectRestrictedForUser, resolveUserId } from '@/utils/creativeDraftMetadata'

/** 不可信接口对象的通用键值结构。 */
type UnknownRecord = Record<string, unknown>

/** 将未知值收敛为普通记录。 */
function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as UnknownRecord
}

/** 兼容解析对象或 JSON 字符串形式的记录。 */
function parseRecord(value: unknown): UnknownRecord | null {
  const record = asRecord(value)
  if (record) return record
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

/** 将候选标识规范化为正整数。 */
function positiveInteger(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/** 返回候选列表中的第一个有效正整数。 */
function firstPositiveInteger(values: unknown[]): number {
  for (const value of values) {
    const id = positiveInteger(value)
    if (id) return id
  }
  return 0
}

/** 从项目响应的多种兼容字段中解析项目 ID。 */
export function resolveCreativeProjectId(project: unknown): number {
  const record = asRecord(project)
  const data = asRecord(record?.data)
  const nestedProject = asRecord(record?.project)
  return firstPositiveInteger([
    record?.id,
    record?.project_id,
    record?.projectId,
    record?.creative_project_id,
    record?.creativeProjectId,
    nestedProject?.id,
    nestedProject?.project_id,
    nestedProject?.projectId,
    data?.id,
    data?.project_id,
    data?.projectId,
  ])
}

/** 从素材、元数据或嵌套响应中解析所属项目 ID。 */
export function resolveAssetProjectId(asset: unknown): number {
  const record = asRecord(asset)
  const meta = parseRecord(record?.meta_json ?? record?.metaJson)
  const data = asRecord(record?.data)
  return firstPositiveInteger([
    record?.project_id,
    record?.projectId,
    record?.creative_project_id,
    record?.creativeProjectId,
    meta?.project_id,
    meta?.projectId,
    meta?.creative_project_id,
    meta?.creativeProjectId,
    data?.project_id,
    data?.projectId,
    data?.creative_project_id,
    data?.creativeProjectId,
  ])
}

/** 构建当前用户可访问的项目 ID 白名单。 */
export function getAccessibleProjectIds(projects: readonly unknown[], currentUserId: unknown): Set<number> {
  const accessibleIds = new Set<number>()
  const userId = resolveUserId(currentUserId)
  // Project restrictions are user-specific. Until the authenticated identity is
  // known, no project can be safely placed on the allowlist.
  if (!userId) return accessibleIds
  for (const project of projects) {
    if (isCreativeProjectRestrictedForUser(project, userId)) continue
    const id = resolveCreativeProjectId(project)
    if (id) accessibleIds.add(id)
  }
  return accessibleIds
}

/** 按当前用户访问权限过滤项目列表。 */
export function filterProjectsByAccess<T>(projects: readonly T[], currentUserId: unknown): T[] {
  const accessibleIds = getAccessibleProjectIds(projects, currentUserId)
  return projects.filter((project) => {
    const projectId = resolveCreativeProjectId(project)
    return projectId > 0 && accessibleIds.has(projectId)
  })
}

/** 判断素材是否无项目归属或属于已加载的可访问项目。 */
export function isAssetAccessibleByProject(
  asset: unknown,
  accessibleProjectIds: ReadonlySet<number>,
  projectPermissionsLoaded: boolean,
): boolean {
  const projectId = resolveAssetProjectId(asset)
  if (!projectId) return true
  return projectPermissionsLoaded && accessibleProjectIds.has(projectId)
}

/** 使用项目白名单过滤素材列表。 */
export function filterAssetsByProjectAccess<T>(
  assets: readonly T[],
  accessibleProjectIds: ReadonlySet<number>,
  projectPermissionsLoaded: boolean,
): T[] {
  return assets.filter((asset) => isAssetAccessibleByProject(asset, accessibleProjectIds, projectPermissionsLoaded))
}
