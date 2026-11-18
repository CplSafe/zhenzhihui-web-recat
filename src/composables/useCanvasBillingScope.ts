import { createContext, useContext } from 'react'

export const CanvasBillingContext = createContext<{ workspaceId: number; canvasId: number } | undefined>(undefined)

export function useCanvasBillingScope() {
  return useContext(CanvasBillingContext)
}
