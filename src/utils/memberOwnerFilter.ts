/**
 * 团队空间「按成员筛选」的共享纯逻辑：项目管理页与任务管理抽屉共用同一口径。
 *
 * - 选项 = 全部成员 / 我（n）/ 其他有产出的成员按数量降序；
 * - 「我」优先按后端 mine=true 判定出的项目 id 集合，拉不到时回退前端按创作者 / 归属人比对；
 * - 记忆值可能失效（成员退出团队、产出清零），失效时回退「全部」，避免下拉显示全部、列表却被过滤成空。
 */
import { resolveUserId } from '@/utils/creativeDraftMetadata'

/** 一个成员筛选选项；value 为空串表示「全部成员」。 */
export interface OwnerFilterOption {
  value: string
  label: string
}

/** 各页面各自记忆，但 key 走同一处生成，避免拼写漂移。 */
export type OwnerFilterStorageScope = 'pm' | 'taskCenter'

/** 成员筛选的按空间记忆 key。 */
export function ownerFilterStorageKey(scope: OwnerFilterStorageScope, workspaceId: number): string {
  return `zzh.${scope}.ownerFilter.${Math.max(0, Math.floor(Number(workspaceId) || 0))}`
}

/** 读取记忆的成员筛选；隐私模式等读不到时按未记忆处理。 */
export function readOwnerFilter(scope: OwnerFilterStorageScope, workspaceId: number): string {
  if (!(Number(workspaceId) > 0)) return ''
  try {
    return localStorage.getItem(ownerFilterStorageKey(scope, workspaceId)) || ''
  } catch {
    return ''
  }
}

/** 写入成员筛选记忆；写不进去时筛选仍生效，只是不记忆。 */
export function writeOwnerFilter(scope: OwnerFilterStorageScope, workspaceId: number, value: string): void {
  if (!(Number(workspaceId) > 0)) return
  try {
    const key = ownerFilterStorageKey(scope, workspaceId)
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* 隐私模式等场景写不进去:筛选仍生效,只是不记忆 */
  }
}

/** 个人空间只有一个人，成员筛选没有意义；未知类型按团队处理，宁可多显示控件也不漏掉筛选。 */
export function isTeamWorkspace(workspace: unknown): boolean {
  const record = workspace as any
  return String(record?.type || '').toLowerCase() !== 'personal'
}

/** 兼容成员对象的多种命名字段，取展示名。 */
export function memberDisplayName(member: any): string {
  return (
    String(
      member?.nickname || member?.name || member?.user?.nickname || member?.user?.name || member?.username || '',
    ).trim() || `成员 ${resolveUserId(member) || ''}`.trim()
  )
}

/**
 * 构建成员下拉选项：全部成员 / 我（n）/ 其他有产出的成员按数量降序。
 * `countsByUserId` 是按创作者 / 归属人统计的产出数；`mineCount` 单独传入，
 * 因为「我」的数量按 mine 集合算，与按归属人统计的数字可能不同（协作项目）。
 */
export function buildOwnerFilterOptions({
  countsByUserId,
  mineCount,
  members,
  currentUserId,
}: {
  countsByUserId: ReadonlyMap<number, number>
  mineCount: number
  members: readonly any[]
  currentUserId: number
}): OwnerFilterOption[] {
  const others = (Array.isArray(members) ? members : [])
    .map((member: any) => ({ id: resolveUserId(member), name: memberDisplayName(member) }))
    .filter((member) => member.id > 0 && member.id !== currentUserId && (countsByUserId.get(member.id) || 0) > 0)
    .sort((a, b) => (countsByUserId.get(b.id) || 0) - (countsByUserId.get(a.id) || 0))
  return [
    { value: '', label: '全部成员' },
    { value: String(currentUserId), label: `我（${Math.max(0, Math.floor(mineCount) || 0)}）` },
    ...others.map((member) => ({
      value: String(member.id),
      label: `${member.name}（${countsByUserId.get(member.id)}）`,
    })),
  ]
}

/** 生效的成员筛选：非团队空间恒为「全部」；记忆值不在当前选项里时回退「全部」。 */
export function resolveEffectiveOwnerFilter({
  isTeamSpace,
  ownerFilter,
  options,
}: {
  isTeamSpace: boolean
  ownerFilter: string
  options: readonly OwnerFilterOption[]
}): string {
  if (!isTeamSpace || !ownerFilter) return ''
  return options.some((option) => option.value === ownerFilter) ? ownerFilter : ''
}

/**
 * 判断一条记录是否命中成员筛选。
 * 「我」优先按后端 mine=true 的项目 id 集合判定（协作 / 归属字段差异都以后端为准）；
 * 集合缺失（个人空间 / 请求失败）时回退按创作者比对。其他成员始终按创作者比对。
 */
export function matchesOwnerFilter({
  ownerFilter,
  currentUserId,
  myProjectIds,
  projectId,
  creatorUserId,
}: {
  ownerFilter: string
  currentUserId: number
  myProjectIds: ReadonlySet<number> | null
  projectId: number
  creatorUserId: number
}): boolean {
  const ownerId = Number(ownerFilter || 0) || 0
  if (!ownerId) return true
  if (ownerId === currentUserId && myProjectIds) return myProjectIds.has(Number(projectId || 0) || 0)
  return (Number(creatorUserId || 0) || 0) === ownerId
}
