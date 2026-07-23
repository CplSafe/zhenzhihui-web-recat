/**
 * 业务列表分页工具：统一拉取项目与素材分页数据，并在工作区切换时及时终止旧请求。
 * 同时通过最大页数和去重键防止异常分页接口造成死循环或重复数据。
 */
import { extractAssetPage, listAssets, listCreativeProjects } from '@/api/business'

/** 单次请求的默认分页大小。 */
const DEFAULT_PAGE_SIZE = 100
/** 全量拉取允许遍历的最大页数，避免后端分页异常时无限请求。 */
const DEFAULT_MAX_PAGES = 100

/** 工作区已切换、当前分页请求结果不再有效时抛出的专用错误。 */
export class PaginationScopeChangedError extends Error {
  constructor() {
    super('分页请求作用域已失效')
    this.name = 'PaginationScopeChangedError'
  }
}

/** 分页请求共用的作用域校验与安全上限。 */
interface PaginationSafetyOptions {
  /** Called before and after every request so a workspace switch cannot leak stale pages. */
  isCurrent?: () => boolean
  /** Safety valve for a backend that ignores offset or never returns a short page. */
  maxPages?: number
  pageSize?: number
}

/** 拉取当前工作区全部创意项目所需的参数。 */
export interface ListAllCreativeProjectsOptions extends PaginationSafetyOptions {
  workspaceId: number
}

/** 拉取当前工作区素材时可用的筛选条件。 */
export interface ListAllAssetsOptions extends PaginationSafetyOptions {
  workspaceId: number
  type?: string
  status?: string
  source?: string
}

/** 拉取单页素材时额外携带的偏移量。 */
export interface ListAssetPageOptions extends Omit<ListAllAssetsOptions, 'maxPages'> {
  offset?: number
}

/** 标准化后的素材分页结果。 */
export interface AssetPageResult {
  items: any[]
  limit: number
  offset: number
  nextOffset: number
  total: number
  totalKnown: boolean
  hasMore: boolean
}

/** 将外部输入收敛为有上限的正整数。 */
function positiveInteger(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = Math.floor(Number(value) || 0)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, maximum)
}

/** 将外部输入收敛为非负整数。 */
function nonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** 在每次请求前后确认调用仍属于当前工作区，防止旧空间数据串入新空间。 */
function assertCurrent(isCurrent?: () => boolean): void {
  if (isCurrent && !isCurrent()) throw new PaginationScopeChangedError()
}

/** 为分页项生成稳定去重键，优先使用后端主键。 */
function itemKey(item: unknown): string {
  const record = item as any
  const id = Number(
    record?.id ??
      record?.project_id ??
      record?.projectId ??
      record?.asset_id ??
      record?.assetId ??
      record?.data?.id ??
      0,
  )
  if (Number.isFinite(id) && id > 0) return `id:${Math.floor(id)}`

  try {
    return `value:${JSON.stringify(item)}`
  } catch {
    return `value:${String(item)}`
  }
}

/** 把当前页中尚未出现的记录追加到结果集，并返回新增数量。 */
function appendUnique(target: any[], seen: Set<string>, page: any[]): number {
  let added = 0
  for (const item of page) {
    const key = itemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    target.push(item)
    added += 1
  }
  return added
}

/** 仅加载一页素材，使页面可先展示首屏，后续分页失败也不丢弃已加载数据。 */
export async function listAssetPage({
  workspaceId,
  type = '',
  status = 'active',
  source = '',
  pageSize = DEFAULT_PAGE_SIZE,
  offset = 0,
  isCurrent,
}: ListAssetPageOptions): Promise<AssetPageResult> {
  const wsId = positiveInteger(workspaceId, 0)
  const limit = positiveInteger(pageSize, DEFAULT_PAGE_SIZE, 200)
  const requestedOffset = nonNegativeInteger(offset)
  if (!wsId) {
    return {
      items: [],
      limit,
      offset: requestedOffset,
      nextOffset: requestedOffset,
      total: 0,
      totalKnown: true,
      hasMore: false,
    }
  }

  assertCurrent(isCurrent)
  const payload = await listAssets({
    workspaceId: wsId,
    type,
    status,
    source,
    offset: requestedOffset,
    limit,
  })
  assertCurrent(isCurrent)

  const page = extractAssetPage(payload)
  const items = Array.isArray(page.items) ? page.items : []
  const responseOffset = nonNegativeInteger(page.offset, requestedOffset)
  const normalizedOffset = responseOffset >= requestedOffset ? responseOffset : requestedOffset
  const nextOffset = normalizedOffset + items.length
  const totalKnown =
    payload != null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Number.isFinite(Number((payload as any).total))
  const explicitTotal = Math.max(0, nonNegativeInteger(page.total))
  const hasMore = items.length > 0 && (!totalKnown || nextOffset < explicitTotal)
  const total = totalKnown ? explicitTotal : nextOffset + (hasMore ? limit : 0)

  return {
    items,
    limit,
    offset: normalizedOffset,
    nextOffset,
    total,
    totalKnown,
    hasMore,
  }
}

/** 拉取全部创意项目页，并防护重复页、无限分页及请求中的工作区切换。 */
export async function listAllCreativeProjects({
  workspaceId,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  isCurrent,
}: ListAllCreativeProjectsOptions): Promise<any[]> {
  const wsId = positiveInteger(workspaceId, 0)
  if (!wsId) return []

  const limit = positiveInteger(pageSize, DEFAULT_PAGE_SIZE, 200)
  const pageLimit = positiveInteger(maxPages, DEFAULT_MAX_PAGES, 1000)
  const result: any[] = []
  const seen = new Set<string>()
  let offset = 0

  for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
    assertCurrent(isCurrent)
    const payload = await listCreativeProjects({ workspaceId: wsId, offset, limit })
    assertCurrent(isCurrent)
    const items = Array.isArray(payload) ? payload : []
    if (!items.length) break

    const added = appendUnique(result, seen, items)
    if (!added) break
    offset += items.length
  }

  return result
}

/** 拉取全部素材页；优先使用分页元数据，并兼容旧接口的短页、空页和重复页。 */
export async function listAllAssets({
  workspaceId,
  type = '',
  status = 'active',
  source = '',
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  isCurrent,
}: ListAllAssetsOptions): Promise<any[]> {
  const wsId = positiveInteger(workspaceId, 0)
  if (!wsId) return []

  const limit = positiveInteger(pageSize, DEFAULT_PAGE_SIZE, 200)
  const pageLimit = positiveInteger(maxPages, DEFAULT_MAX_PAGES, 1000)
  const result: any[] = []
  const seen = new Set<string>()
  let offset = 0

  for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
    assertCurrent(isCurrent)
    const payload = await listAssets({
      workspaceId: wsId,
      type,
      status,
      source,
      offset,
      limit,
    })
    assertCurrent(isCurrent)

    const page = extractAssetPage(payload)
    const items = Array.isArray(page.items) ? page.items : []
    if (!items.length) break

    const added = appendUnique(result, seen, items)
    const responseOffset = Number(page.offset)
    const nextOffset =
      Number.isFinite(responseOffset) && responseOffset >= offset
        ? Math.floor(responseOffset) + items.length
        : offset + items.length
    const total = Number(page.total)
    const hasExplicitTotal =
      payload != null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      Number.isFinite(Number((payload as any).total))

    if (!added) break
    offset = nextOffset
    if (hasExplicitTotal && total >= 0 && offset >= total) break
  }

  return result
}
