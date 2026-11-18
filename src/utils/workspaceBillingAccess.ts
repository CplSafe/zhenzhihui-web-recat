import { resolveWorkspaceRole } from './creativeDraftMetadata'

/** 身份由当前工作空间的会话选择器提供。 */
export function isWorkspaceBillingManager(
  workspace: { owner_user_id?: number | string; ownerUserId?: number | string } | null,
  member: unknown,
  currentUserId: number,
): boolean {
  const ownerId = Number(workspace?.owner_user_id || workspace?.ownerUserId || 0)
  return (
    (ownerId > 0 && ownerId === currentUserId) || ['owner', 'creator', 'admin'].includes(resolveWorkspaceRole(member))
  )
}
