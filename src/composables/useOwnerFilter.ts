/**
 * useOwnerFilter — 团队空间成员筛选的按空间记忆值。
 * 切换空间时重新从 localStorage 读取；改值时同步写回。失效值的回退由 resolveEffectiveOwnerFilter 负责。
 */
import { useCallback, useEffect, useState } from 'react'
import { readOwnerFilter, writeOwnerFilter, type OwnerFilterStorageScope } from '@/utils/memberOwnerFilter'

/** 返回当前空间记忆的成员筛选值（'' = 全部成员）与写回函数。 */
export function useOwnerFilter(
  scope: OwnerFilterStorageScope,
  workspaceId: number,
): [ownerFilter: string, changeOwnerFilter: (value: string) => void] {
  const activeWorkspaceId = Number(workspaceId || 0)
  const [ownerFilter, setOwnerFilter] = useState(() => readOwnerFilter(scope, activeWorkspaceId))

  useEffect(() => {
    setOwnerFilter(readOwnerFilter(scope, activeWorkspaceId))
  }, [scope, activeWorkspaceId])

  const changeOwnerFilter = useCallback(
    (value: string) => {
      const next = String(value || '')
      setOwnerFilter(next)
      writeOwnerFilter(scope, activeWorkspaceId, next)
    },
    [scope, activeWorkspaceId],
  )

  return [ownerFilter, changeOwnerFilter]
}
