/** This registration context is deliberately separate from referral storage. */
export function getHierarchyInvite(): string {
  return new URLSearchParams(window.location.search).get('hierarchy_invite')?.trim() || ''
}
