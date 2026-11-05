import type { Location } from 'react-router-dom'
import { useUnsavedEntryLeaveGuard } from '@/composables/useHotCopyLeaveGuard'

/** 独立挂载，避免创作界面热更新时重复注册路由拦截器。 */
export default function UnsavedEntryLeaveGuard({
  dirty,
  discard,
  allowNavigation,
}: {
  dirty: boolean
  discard: () => void
  allowNavigation?: (nextLocation: Location) => boolean
}) {
  useUnsavedEntryLeaveGuard(dirty, discard, allowNavigation)
  return null
}
