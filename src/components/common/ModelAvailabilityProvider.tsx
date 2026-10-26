import { createContext, useContext, type ReactNode } from 'react'

export const ModelAvailabilityContext = createContext({ canPurchase: false, team: false })
export const useModelAvailabilityAccess = () => useContext(ModelAvailabilityContext)

export default function ModelAvailabilityProvider({
  children,
  workspace,
  member,
  user,
}: {
  children: ReactNode
  workspace: any
  member: any
  user: any
}) {
  const team = Boolean(workspace?.type) && String(workspace.type).toLowerCase() !== 'personal'
  const ownerId = workspace?.owner_user_id ?? workspace?.ownerUserId
  const userId = user?.user_id ?? user?.id
  const canPurchase =
    Boolean(workspace) &&
    (!team ||
      String(member?.role || '').toLowerCase() === 'owner' ||
      (Boolean(ownerId) && Boolean(userId) && String(ownerId) === String(userId)))
  return <ModelAvailabilityContext.Provider value={{ canPurchase, team }}>{children}</ModelAvailabilityContext.Provider>
}
