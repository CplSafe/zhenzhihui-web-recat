import { useEffect, useRef } from 'react'
import {
  clearCreativeWorkflowState,
  loadCreativeWorkflowState,
  saveCreativeWorkflowState,
} from '@/utils/creativeStorage'

const PERSIST_DEBOUNCE_MS = 400

interface UseWorkflowPersistenceOptions {
  getSnapshot: () => any
  applySnapshot: (snapshot: any) => void
}

// View-level snapshot persistence for the creative workflow.
//
// Caller passes:
//   - getSnapshot(): () => snapshot object to serialize into localStorage
//   - applySnapshot(snapshot): (snapshot) => void, restores state on mount
//
// Returns a debounced `persist` to use in deep watchers and an immediate
// `restore` / `clear` for explicit operations.
export function useWorkflowPersistence({ getSnapshot, applySnapshot }: UseWorkflowPersistenceOptions) {
  // 用 ref 保存最新回调，避免闭包捕获旧值。
  const getSnapshotRef = useRef(getSnapshot)
  const applySnapshotRef = useRef(applySnapshot)
  getSnapshotRef.current = getSnapshot
  applySnapshotRef.current = applySnapshot

  const pendingTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  // After `clear()` returns we treat the workflow as "wiped". Any persist()
  // call (e.g. from a deep watcher that fires reactively after refs are
  // reset) would otherwise immediately re-serialize the just-cleared state
  // back into localStorage and defeat the clear. The guard releases as soon
  // as `persist()` is explicitly re-enabled via `resume()` (called when a
  // new workflow run is starting).
  const cleared = useRef(false)

  // 用 ref 持有稳定的方法集，保证返回引用在多次渲染间不变。
  const apiRef = useRef<{
    persist: () => void
    restore: () => any
    clear: () => void
    resume: () => void
    flush: () => void
  } | null>(null)

  if (!apiRef.current) {
    function cancelTimer() {
      if (pendingTimer.current) {
        window.clearTimeout(pendingTimer.current)
        pendingTimer.current = null
      }
    }

    function writeNow() {
      try {
        saveCreativeWorkflowState(getSnapshotRef.current())
      } catch {
        /* ignore quota / serialization errors */
      }
    }

    function persist() {
      if (cleared.current) return
      cancelTimer()
      pendingTimer.current = window.setTimeout(() => {
        pendingTimer.current = null
        writeNow()
      }, PERSIST_DEBOUNCE_MS)
    }

    function flush() {
      if (!pendingTimer.current) return
      cancelTimer()
      if (!cleared.current) writeNow()
    }

    function restore() {
      const snapshot = loadCreativeWorkflowState()
      if (!snapshot || typeof snapshot !== 'object') return null
      cleared.current = false
      applySnapshotRef.current(snapshot)
      return snapshot
    }

    function clear() {
      cancelTimer()
      cleared.current = true
      clearCreativeWorkflowState()
    }

    function resume() {
      cleared.current = false
    }

    apiRef.current = { persist, restore, clear, resume, flush }
  }

  // onBeforeUnmount(flush)：卸载时把待写入的快照刷盘。
  useEffect(() => {
    return () => {
      apiRef.current?.flush()
    }
  }, [])

  const { persist, restore, clear, resume } = apiRef.current
  return { persist, restore, clear, resume }
}
