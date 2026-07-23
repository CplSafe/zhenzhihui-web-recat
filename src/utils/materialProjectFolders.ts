/**
 * 素材按创意项目分组工具：兼容解析项目草稿中的素材引用并建立文件夹视图。
 * 仅把当前可访问项目中的素材归组，其余素材保留在未归类集合中。
 */
import { resolveAssetProjectId, resolveCreativeProjectId } from '@/utils/projectAssetAccess'

/** 项目草稿解析使用的通用对象结构。 */
type UnknownRecord = Record<string, unknown>

/** 单个项目文件夹及其包含的素材。 */
export interface MaterialProjectGroup<TMaterial = any, TProject = any> {
  project: TProject
  projectId: number
  materials: TMaterial[]
}

/** 素材按项目分组后的文件夹列表和未归类列表。 */
export interface GroupMaterialsByProjectResult<TMaterial = any, TProject = any> {
  groups: MaterialProjectGroup<TMaterial, TProject>[]
  unclassified: TMaterial[]
}

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

/** 从不同素材响应结构中解析素材 ID。 */
export function resolveMaterialAssetId(material: unknown): number {
  const record = asRecord(material)
  const serverAsset = asRecord(record?.serverAsset)
  return positiveInteger(record?.assetId ?? record?.asset_id ?? serverAsset?.id ?? record?.id)
}

/** 从素材本身或其元数据中解析所属项目 ID。 */
export function resolveMaterialProjectId(material: unknown): number {
  const record = asRecord(material)
  const serverAsset = asRecord(record?.serverAsset)
  return resolveAssetProjectId(serverAsset || record)
}

/** 判断字段名是否表示素材 ID。 */
function isAssetIdKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, '').toLowerCase()
  if (!normalized.includes('asset')) return false
  return normalized.endsWith('assetid') || normalized.endsWith('assetids')
}

/** 递归收集草稿内引用的素材 ID，并通过 visited 防止循环引用。 */
function collectAssetIds(value: unknown, key: string, target: Set<number>, visited: WeakSet<object>): void {
  if (Array.isArray(value)) {
    if (isAssetIdKey(key)) {
      for (const item of value) {
        const id = positiveInteger(item)
        if (id) target.add(id)
      }
      return
    }
    for (const item of value) collectAssetIds(item, '', target, visited)
    return
  }

  const record = asRecord(value)
  if (!record || visited.has(record)) return
  visited.add(record)

  for (const [childKey, childValue] of Object.entries(record)) {
    if (isAssetIdKey(childKey) && !Array.isArray(childValue)) {
      const id = positiveInteger(childValue)
      if (id) target.add(id)
      continue
    }
    collectAssetIds(childValue, childKey, target, visited)
  }
}

/** 汇总创意项目对象及其草稿内引用的全部素材 ID。 */
export function collectCreativeProjectAssetIds(project: unknown): Set<number> {
  const record = asRecord(project)
  const draft =
    parseRecord(record?.draft_json) ||
    parseRecord(record?.draftJson) ||
    parseRecord(record?.draft) ||
    parseRecord(asRecord(record?.data)?.draft_json)
  const ids = new Set<number>()
  if (draft) collectAssetIds(draft, '', ids, new WeakSet())
  return ids
}

/** 显式 project_id 最权威；缺失时按项目草稿引用的稳定素材 ID 归组，未命中素材保持未归类。 */
export function groupMaterialsByProject<TMaterial, TProject>(
  materials: readonly TMaterial[],
  projects: readonly TProject[],
): GroupMaterialsByProjectResult<TMaterial, TProject> {
  const groups = projects
    .map((project) => ({
      project,
      projectId: resolveCreativeProjectId(project),
      materials: [] as TMaterial[],
      draftAssetIds: collectCreativeProjectAssetIds(project),
    }))
    .filter((group) => group.projectId > 0)
  const groupByProjectId = new Map(groups.map((group) => [group.projectId, group]))
  const unclassified: TMaterial[] = []

  for (const material of materials) {
    const explicitProjectId = resolveMaterialProjectId(material)
    if (explicitProjectId) {
      const explicitGroup = groupByProjectId.get(explicitProjectId)
      if (explicitGroup) explicitGroup.materials.push(material)
      else unclassified.push(material)
      continue
    }

    const assetId = resolveMaterialAssetId(material)
    const matchingGroups = assetId ? groups.filter((group) => group.draftAssetIds.has(assetId)) : []
    if (!matchingGroups.length) {
      unclassified.push(material)
      continue
    }
    for (const group of matchingGroups) group.materials.push(material)
  }

  return {
    groups: groups.map(({ draftAssetIds: _draftAssetIds, ...group }) => group),
    unclassified,
  }
}
