import { useCallback, useRef } from 'react'

// Tracks AbortControllers for long-running AI tasks so a view can cancel
// all in-flight work at once (reset, unmount, restart).
//
// IMPORTANT: instantiate this ONCE per view (or app scope). Each call creates
// a fresh, isolated Set of controllers. Child hooks that need to register
// abort controllers should receive `createTaskAbortController`,
// `releaseTaskAbortController`, and `abortAllPendingTasks` via `deps` injection
// from the single owning view — calling `useTaskAbort()` from inside a child
// hook creates a disconnected registry that the view's
// `abortAllPendingTasks()` cannot reach.

export function useTaskAbort() {
  // 用 ref 持有一个跨渲染稳定的 Set
  const controllersRef = useRef<Set<AbortController>>(new Set())

  const createTaskAbortController = useCallback(() => {
    const controller = new AbortController()
    controllersRef.current.add(controller)
    return controller
  }, [])

  const releaseTaskAbortController = useCallback((controller: AbortController) => {
    controllersRef.current.delete(controller)
  }, [])

  const abortAllPendingTasks = useCallback(() => {
    controllersRef.current.forEach((c) => c.abort())
    controllersRef.current.clear()
  }, [])

  return {
    createTaskAbortController,
    releaseTaskAbortController,
    abortAllPendingTasks,
  }
}
