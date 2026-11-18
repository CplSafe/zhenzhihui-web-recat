import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestBusinessJson } from '@/api/business'

interface Holder {
  user_id: number
  name: string
  editing: boolean
}
interface Snapshot {
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
          return [[id, writers.length ? `${names} 正在编辑` : `${names} 正在引用`]] as [string, string][]
        }),
      ),
    [holders, userId],
  )
  const labels = useMemo(
    () =>
      new Map(
        Object.entries(holders).map(([id, owners]) => [
          id,
          blocked.get(id) || (owners.some((h) => h.editing) ? '你正在编辑' : '你正在引用'),
        ]),
      ),
    [holders, blocked],
  )
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const reason = useCallback((id?: string | null) => (id ? blockedRef.current.get(id) : undefined), [])
  return {
    agentOwner: reply?.scope === scope ? reply.state.agent_owner : undefined,
    blocked,
    labels,
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
