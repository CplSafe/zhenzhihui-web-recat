/**
 * 创意项目草稿元数据工具：解析项目拥有者、成员角色与受限成员列表。
 * 合并并发保存结果时仅同步权限等元数据，避免覆盖当前页面的创作内容。
 */
/** 可兼容后端扩展字段的创意草稿对象。 */
export type CreativeDraftRecord = Record<string, any>

/** 安全判断对象是否直接拥有指定字段。 */
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

/** 将对象或 JSON 字符串解析为普通值，非法输入返回 null。 */
export function toPlainObject(value: unknown): any {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** 将未知输入规范化为数组。 */
export function normalizeArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value : []
}

/** 将可能的标识值规范化为正整数。 */
function toPositiveInteger(value: unknown): number {
  const id = Math.floor(Number(value) || 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

/** 从认证与工作区成员接口的多种用户结构中解析用户 ID。 */
export function resolveUserId(value: unknown): number {
  const record = value as any
  if (record == null || typeof record !== 'object') return toPositiveInteger(record)
  const candidates = [
    record?.user_id,
    record?.userId,
    record?.account_id,
    record?.accountId,
    record?.uid,
    record?.user?.id,
    record?.user?.user_id,
    record?.user?.userId,
    record?.account?.id,
    record?.data?.user_id,
    record?.data?.userId,
    record?.data?.account_id,
    record?.data?.accountId,
    record?.data?.uid,
    record?.data?.user?.id,
    record?.data?.id,
    record?.id,
  ]
  for (const candidate of candidates) {
    const id = toPositiveInteger(candidate)
    if (id) return id
  }
  return 0
}

/** 兼容项目接口历代拥有者字段，保证列表、详情、编辑器与权限页判定一致。 */
export function resolveCreativeProjectOwnerId(project: unknown): number {
  const record = project as any
  const candidates = [
    record?.user_id,
    record?.userId,
    record?.creator_user_id,
    record?.creatorUserId,
    record?.owner_user_id,
    record?.ownerUserId,
    record?.owner_id,
    record?.ownerId,
    record?.created_by_user_id,
    record?.createdByUserId,
    record?.data?.user_id,
    record?.data?.userId,
    record?.data?.creator_user_id,
    record?.data?.creatorUserId,
    record?.data?.owner_user_id,
    record?.data?.ownerUserId,
    record?.data?.owner_id,
    record?.data?.ownerId,
    record?.user?.id,
    record?.creator?.id,
    record?.owner?.id,
  ]
  for (const candidate of candidates) {
    const id = toPositiveInteger(candidate)
    if (id) return id
  }
  return 0
}

/** 从工作区或成员响应的多种字段命名中解析角色。 */
export function resolveWorkspaceRole(value: unknown): string {
  const record = value as any
  return String(
    record?.workspace_role ??
      record?.workspaceRole ??
      record?.member_role ??
      record?.memberRole ??
      record?.membership?.role ??
      record?.data?.workspace_role ??
      record?.data?.workspaceRole ??
      record?.data?.member_role ??
      record?.data?.memberRole ??
      record?.data?.role ??
      record?.role ??
      '',
  )
    .trim()
    .toLowerCase()
}

/** 判断当前操作者是否有权限制目标成员访问该项目。 */
export function canRestrictWorkspaceMember({
  actorRole,
  targetRole,
  targetUserId,
  projectOwnerId,
}: {
  actorRole: unknown
  targetRole: unknown
  targetUserId: unknown
  projectOwnerId: unknown
}): boolean {
  const normalizedTargetId = resolveUserId(targetUserId)
  if (!normalizedTargetId) return false
  if (normalizedTargetId === resolveUserId(projectOwnerId)) return false

  const actor = String(actorRole || '')
    .trim()
    .toLowerCase()
  const target = String(targetRole || '')
    .trim()
    .toLowerCase()
  // Space owners are never removable from a project. Only a space owner may
  // restrict an administrator; project creators with member role cannot.
  if (target === 'owner') return false
  if (target === 'admin' && actor !== 'owner') return false
  return actor === 'owner' || actor === 'admin' || actor === 'member'
}

/** 将未知值收敛为可用草稿记录。 */
function toDraftRecord(value: unknown): CreativeDraftRecord | null {
  const parsed = toPlainObject(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as CreativeDraftRecord) : null
}

/** 从项目响应或草稿值本身提取草稿，并统一迁移期间出现的多种字段结构。 */
export function getCreativeProjectDraft(payload: unknown): CreativeDraftRecord | null {
  const value = payload as any
  const candidates = [
    value?.draft_json,
    value?.draftJson,
    value?.draft,
    value?.data?.draft_json,
    value?.data?.draftJson,
    value?.data?.draft,
  ]
  for (const candidate of candidates) {
    const parsed = toDraftRecord(candidate)
    if (parsed) return parsed
  }
  return toDraftRecord(payload)
}

/** 规范化受限成员 ID，过滤无效值并去重。 */
export function normalizeRestrictedMemberIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => Math.floor(Number(item) || 0)).filter((id) => Number.isFinite(id) && id > 0))]
}

/** 从项目或草稿的兼容字段中读取受限成员 ID。 */
export function getRestrictedMemberIds(projectOrDraft: unknown): number[] {
  const draft = getCreativeProjectDraft(projectOrDraft)
  if (!draft) return []
  return normalizeRestrictedMemberIds(draft.restrictedMemberIds ?? draft.restricted_member_ids)
}

/** 判断指定用户是否被当前项目的访问规则限制。 */
export function isCreativeProjectRestrictedForUser(projectOrDraft: unknown, userId: unknown): boolean {
  const normalizedUserId = resolveUserId(userId)
  if (!normalizedUserId) return false
  const ownerId = resolveCreativeProjectOwnerId(projectOrDraft)
  if (ownerId > 0 && ownerId === normalizedUserId) return false
  return getRestrictedMemberIds(projectOrDraft).includes(normalizedUserId)
}

/** 合并最新的权限与视频归类元数据，防止旧编辑页重建草稿时擦除其他页面的修改。 */
export function mergeLatestProjectMetadata<T extends CreativeDraftRecord>(
  snapshot: T,
  latestProjectOrDraft: unknown,
): T {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return snapshot
  const latest = getCreativeProjectDraft(latestProjectOrDraft)
  if (!latest) return snapshot

  const next: CreativeDraftRecord = { ...snapshot }
  if (hasOwn(latest, 'projectVideoStore')) {
    next.projectVideoStore = latest.projectVideoStore
  }

  const hasRestrictedMembers = hasOwn(latest, 'restrictedMemberIds') || hasOwn(latest, 'restricted_member_ids')
  if (hasRestrictedMembers) {
    next.restrictedMemberIds = getRestrictedMemberIds(latest)
    delete next.restricted_member_ids
  }
  return next as T
}
