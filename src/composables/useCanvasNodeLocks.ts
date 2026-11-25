import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getAccountSwitchId } from '@/api/accountSwitch'
import { requestBusinessJson } from '@/api/business'
import { connectCanvasLockSocket } from './canvasLockSocket'

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
export interface CanvasOnlineMember {
  user_id: number
  name: string
  avatar_url?: string
}
interface Snapshot {
  online_members?: CanvasOnlineMember[]
  agent_lock?: CanvasAgentLock
  agent_owner?: string
  nodes: Record<string, Holder[]>
  granted: boolean
}
interface LockTarget {
  scope: string
  key: string
}
interface LockReply {
  target: LockTarget
  state: Snapshot | null
  requestFailed: boolean
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
  const scope = enabled ? `${workspaceId}/${canvasId}/${userId}` : ''
  // Returning to the same selection still requires a fresh grant if another selection intervened.
  const target = useMemo<LockTarget>(() => ({ scope, key: selectionKey }), [scope, selectionKey])
  const [reply, setReply] = useState<LockReply | null>(null)
  const [presence, setPresence] = useState<{ scope: string; members?: CanvasOnlineMember[] } | null>(null)
  const desired = useRef(target)
  useLayoutEffect(() => {
    desired.current = target
  }, [target])
  const wake = useRef<() => void>()
  useEffect(() => {
    if (!scope) return
    const session = crypto.randomUUID()
    const base = `/api/v1/canvases/${canvasId}/node-locks`
    const query = `workspace_id=${workspaceId}`
    const lockSocket = getAccountSwitchId()
      ? undefined
      : connectCanvasLockSocket<Snapshot>(`${base}/socket?${query}&user_id=${userId}`, () => {
          if (stopped || desired.current.scope !== scope) return
          if (writing || (observing && desired.current.key === '[]')) changedWhileBusy = true
          else void refresh(true)
        })
    const post = (nodes: string[], observe = false, heartbeat = false) => {
      // Older servers interpret an empty selection as release. Observation
      // uses a different session and stays independent of socket writes.
      const body = JSON.stringify({ session: observe ? `${session}-observer` : session, nodes, observe, heartbeat })
      const overSocket = !observe && !stopped ? lockSocket?.send(body) : undefined
      return (
        overSocket ??
        requestBusinessJson<Snapshot>(`${base}?${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          timeoutMs: 6000,
        })
      )
    }
    let stopped = false
    let writing = false
    let observing = false
    let needsRelease = false
    let changedWhileBusy = false
    let lastHeartbeat = 0
    let timer: ReturnType<typeof setTimeout>
    function schedule(delay: number) {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(true), delay)
    }
    async function refresh(background = false) {
      const requested = desired.current
      if (stopped || writing || requested.scope !== scope) return
      const nodes: string[] = JSON.parse(requested.key)
      const observe = nodes.length === 0 && !needsRelease
      if (observe && observing) return
      clearTimeout(timer)
      if (observe) observing = true
      else {
        writing = true
        if (nodes.length) needsRelease = true
      }
      changedWhileBusy = false
      const heartbeat = observe || (background && Date.now() - lastHeartbeat >= 2000)
      if (heartbeat) lastHeartbeat = Date.now()
      try {
        const data = await post(nodes, observe, heartbeat)
        if (typeof data?.granted !== 'boolean') throw new Error('Invalid canvas node lock response')
        if (!observe && data.granted && !nodes.length) needsRelease = false
        if (!stopped && requested === desired.current) {
          if (heartbeat)
            setPresence((old) =>
              old?.scope === scope && JSON.stringify(old.members) === JSON.stringify(data.online_members)
                ? old
                : { scope, members: data.online_members },
            )
          setReply((old) =>
            old?.target === requested && !old.requestFailed && JSON.stringify(old.state) === JSON.stringify(data)
              ? old
              : { target: requested, state: data, requestFailed: false },
          )
        }
      } catch {
        if (!stopped && requested === desired.current) {
          if (heartbeat) setPresence(null)
          setReply((old) =>
            old?.target === requested && old.requestFailed
              ? old
              : {
                  target: requested,
                  state: old?.target.scope === scope ? old.state : null,
                  requestFailed: true,
                },
          )
        }
      } finally {
        if (observe) observing = false
        else writing = false
        if (stopped) {
          if (!observe && needsRelease) void post([]).catch(() => {})
        } else if (!observe || (!writing && desired.current.key === '[]' && !needsRelease)) {
          schedule(requested === desired.current && !changedWhileBusy ? 2500 : 0)
        }
      }
    }
    wake.current = refresh
    void refresh()
    return () => {
      stopped = true
      lockSocket?.close()
      wake.current = undefined
      clearTimeout(timer)
      if (needsRelease && !writing) void post([]).catch(() => {})
    }
  }, [scope, workspaceId, canvasId, userId])
  useEffect(() => {
    wake.current?.()
  }, [target])
  const snapshot = reply?.target.scope === scope ? reply.state : null
  const currentReply = reply?.target === target ? reply : null
  // Keep the last collaborator/Agent snapshot while a retry is pending, without trusting it for edits.
  const confirmed = currentReply && !currentReply.requestFailed ? currentReply.state : null
  const granted = !enabled || confirmed?.granted === true
  const holders = snapshot?.nodes ?? noHolders
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
          if (own.some((holder) => holder.editing)) {
            return granted || !selection.includes(id) ? ([[id, '你正在编辑']] as const) : []
          }
          // 协作服务返回的是持有状态。引用标签还要有画布里实际存在的素材连线。
          if (own.length && referenceSourceIds.has(id)) return [[id, '你正在引用']] as const
          return []
        }),
      ),
    [holders, blocked, granted, referenceSourceIds, selection, userId],
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
  const agentOwner = snapshot?.agent_owner
  const agentLock = snapshot?.agent_lock
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
    onlineMembers: presence?.scope === scope ? presence.members : undefined,
    agentOwner,
    agentLock,
    unlockAgent,
    blocked,
    labels,
    hues,
    reason,
    granted,
    denied: selection.length > 0 && confirmed?.granted === false,
    requestFailed: selection.length > 0 && currentReply?.requestFailed === true,
  }
}
