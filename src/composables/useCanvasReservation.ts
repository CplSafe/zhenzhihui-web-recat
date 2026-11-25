import { createContext, useContext } from 'react'

interface CanvasReservation {
  blockedReason: string | undefined
  persist: (nodeId: string, key: string, patch?: Record<string, unknown>) => Promise<void>
  trackSubmission?: (nodeId: string, key: string) => () => void
}
export const CanvasReservationContext = createContext<CanvasReservation | undefined>(undefined)
export function useCanvasReservation() {
  return useContext(CanvasReservationContext)
}

/** 自动保存会吸收网络错误；付费提交必须另外核对成功保存的基线。 */
export async function verifySavedReservation(flush: () => Promise<void>, savedKey: () => unknown, key: string) {
  await flush()
  if (!key || savedKey() !== key) throw new Error('节点尚未保存成功，请稍后重试；本次未提交生成')
}
