import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { useConfirmDialog } from './useToast'

/** 未提交入口只保留在当前页面；已提交任务由各流程原有恢复链路负责。 */
export function useUnsavedEntryLeaveGuard(dirty: boolean, discard: () => void) {
  const { requestConfirm } = useConfirmDialog()
  const discardRef = useRef(discard)
  discardRef.current = discard
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let active = true
    void requestConfirm('离开后数据将不保存，是否确认离开？', {
      title: '确认离开',
      confirmLabel: '确认离开',
      cancelLabel: '继续编辑',
    }).then((confirmed) => {
      if (!active) return
      if (confirmed) {
        discardRef.current()
        blocker.proceed()
      } else blocker.reset()
    })
    return () => {
      active = false
    }
  }, [blocker, requestConfirm])

  useEffect(() => {
    if (!dirty) return
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])
}

/** 爆款复刻的兼容导出。 */
export const useHotCopyLeaveGuard = useUnsavedEntryLeaveGuard
