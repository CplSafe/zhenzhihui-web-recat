import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestBusinessJson } from '@/api/business'

interface Holder {
  user_id: number
  name: string
  editing: boolean
}
export interface CanvasAgentLock {
  id: string
  owner_id: number
  owner: string
  running: boolean
  can_unlock: boolean
}
interface Snapshot {
  agent_lock?: CanvasAgentLock
  agent_owner?: string
  nodes: Record<string, Holder[]>
  granted: boolean
}
const noHolders: Snapshot['nodes'] = {}
export function useCanvasNodeLocks(
  workspaceId: number,
  canvasId: number,
  userId: number,
  enabled: boolean,
  selection: string[],
  referenceSourceIds: ReadonlySet<string>,
) {
  const selectionKey = JSON.stringify([...new Set(selection)].sort())
  const [reply, setReply] = useState<{ key: string; scope: string; state: Snapshot } | null>(null)
  const scope = enabled ? `${workspaceId}/${canvasId}/${userId}` : ''
  const desired = useRef(selectionKey)
  desired.current = selectionKey
  const wake = useRef<() => void>()
  useEffect(() => {
    if (!scope) return
    const session = crypto.randomUUID()
    const path = `/api/v1/canvases/${canvasId}/node-locks?workspace_id=${workspaceId}`
    const post = (nodes: string[]) =>
      requestBusinessJson<Snapshot>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, nodes }),
        timeoutMs: 6000,
      })
    let stopped = false,
      busy = false,
      timer: ReturnType<typeof setTimeout>,
      held = false
    async function refresh() {
      clearTimeout(timer)
      if (stopped || busy) return
      busy = true
      const key = desired.current
      try {
        const data = await post(JSON.parse(key))
        held = data.granted && key !== '[]'
        if (!stopped && key === desired.current)
          setReply((old) =>
            old?.key === key && old.scope === scope && JSON.stringify(old.state) === JSON.stringify(data)
              ? old
              : { key, scope, state: data },
          )
      } catch {
        if (!stopped)
          setReply((old) =>
            old && old.scope === scope ? { ...old, key: '', state: { ...old.state, granted: false } } : null,
          )
      } finally {
        busy = false
        if (stopped) {
          if (held) void post([]).catch(() => {})
        } else {
          timer = setTimeout(refresh, key === desired.current ? 2500 : 0)
        }
      }
    }
    wake.current = refresh
    void refresh()
    return () => {
      stopped = true
      wake.current = undefined
      clearTimeout(timer)
      if (held && !busy) void post([]).catch(() => {})
    }
  }, [scope, workspaceId, canvasId])
  useEffect(() => {
    wake.current?.()
  }, [selectionKey])
  const holders = reply?.scope === scope ? (reply?.state.nodes ?? noHolders) : noHolders
  const blocked = useMemo(
    () =>
      new Map(
        Object.entries(holders).flatMap(([id, owners]) => {
          if (owners.some((h) => h.user_id === userId && h.editing)) return []
          const other = owners.filter((h) => h.user_id !== userId)
          if (!other.length) return []
          const writers = other.filter((h) => h.editing)
          const names = (writers.length ? writers : other).map((h) => h.name).join('、')
          const status = writers.length ? '正在编辑' : referenceSourceIds.has(id) ? '正在引用' : '暂时占用'
          return [[id, `${names} ${status}`]] as const
        }),
      ),
    [holders, referenceSourceIds, userId],
  )
  const labels = useMemo(
    () =>
      new Map(
        Object.entries(holders).flatMap<readonly [string, string]>(([id, owners]) => {
          const otherLabel = blocked.get(id)
          if (otherLabel) return [[id, otherLabel]] as const
          const own = owners.filter((holder) => holder.user_id === userId)
          if (own.some((holder) => holder.editing)) return [[id, '你正在编辑']] as const
          // 协作服务返回的是持有状态。引用标签还要有画布里实际存在的素材连线。
          if (own.length && referenceSourceIds.has(id)) return [[id, '你正在引用']] as const
          return []
        }),
      ),
    [holders, blocked, referenceSourceIds, userId],
  )
  // Derive the color from server-owned identity, not name, viewer or response order.
  // A writer takes precedence over shared readers; ties use the lowest user ID.
  const hues = useMemo(
    () =>
      new Map(
        Object.entries(holders).flatMap(([id, owners]) => {
          const owner = [...owners].sort((a, b) => Number(b.editing) - Number(a.editing) || a.user_id - b.user_id)[0]
          return owner ? [[id, (owner.user_id * 137.508) % 360] as const] : []
        }),
      ),
    [holders],
  )
  const agentOwner = reply?.scope === scope ? reply.state.agent_owner : undefined
  const agentLock = reply?.scope === scope ? reply.state.agent_lock : undefined
  const agentOwnerRef = useRef(agentOwner)
  agentOwnerRef.current = agentOwner
  const unlockAgent = useCallback(
    async (lockId: string) => {
      await requestBusinessJson(`/api/v1/canvases/${canvasId}/agent-lock/unlock?workspace_id=${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lock_id: lockId }),
      })
      wake.current?.()
    },
    [workspaceId, canvasId],
  )
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const reason = useCallback(
    (id?: string | null) =>
      agentOwnerRef.current ? `${agentOwnerRef.current} 已锁定画布` : id ? blockedRef.current.get(id) : undefined,
    [],
  )
  return {
    agentOwner,
    agentLock,
    unlockAgent,
    blocked,
    labels,
    hues,
    reason,
    granted: !enabled || (reply?.scope === scope && reply.key === selectionKey && reply.state.granted),
    denied: !!(
      selection.length &&
      scope &&
      reply?.scope === scope &&
      reply.key === selectionKey &&
      !reply.state.granted
    ),
  }
}
