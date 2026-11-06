import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyStudioFrame, createStudioAPI } from './studio'
import type { StudioCatalog, StudioRun, StudioState } from './studio'

export function useStudio(base: string, workspaceId?: number) {
  const api = useMemo(() => createStudioAPI(base), [base])
  const [state, setState] = useState<StudioState>({ connected: false, runs: [] })
  const [catalog, setCatalog] = useState<StudioCatalog>({ models: [], skills: [] })
  const [current, setCurrent] = useState<string | null>(null)
  const [run, setRun] = useState<StudioRun | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [streamState, setStreamState] = useState('')
  const currentRef = useRef(current)
  currentRef.current = current
  const generation = useRef(0)
  const mismatch = !!(state.connected && workspaceId && state.workspace_id !== workspaceId)

  const refreshHistory = useCallback(
    async (offset = 0, signal?: AbortSignal) => {
      const next = await api.request<StudioState>('/api/state' + (offset ? '?offset=' + offset : ''), undefined, signal)
      setState((old) => ({
        ...next,
        runs: offset
          ? [...old.runs, ...next.runs.filter((item) => !old.runs.some((r) => r.id === item.id))]
          : next.runs,
      }))
      return next
    },
    [api],
  )
  const initialize = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        await api.bootstrap(signal)
        const next = await refreshHistory(0, signal)
        if (next.connected && (!workspaceId || next.workspace_id === workspaceId))
          setCatalog(await api.request<StudioCatalog>('/api/catalog', undefined, signal))
        setError('')
      } catch (e) {
        if (!signal?.aborted) setError(e instanceof Error ? e.message : '连接失败')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [api, refreshHistory, workspaceId],
  )
  useEffect(() => {
    const controller = new AbortController()
    setCurrent(null)
    setRun(null)
    setCatalog({ models: [], skills: [] })
    void initialize(controller.signal)
    return () => controller.abort()
  }, [initialize])

  const runId = run?.id,
    runStatus = run?.status
  useEffect(() => {
    if (!state.connected || mismatch || !runId || runStatus === 'running' || catalog.models.length) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (attempt = 0) => {
      try {
        const value = await api.request<StudioCatalog>('/api/catalog', undefined, controller.signal)
        if (!controller.signal.aborted) setCatalog(value)
      } catch {
        if (!controller.signal.aborted && attempt < 3) timer = setTimeout(() => void load(attempt + 1), 1000)
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [api, state.connected, mismatch, runId, runStatus, catalog.models.length])

  const reload = useCallback(async () => {
    const id = currentRef.current,
      version = ++generation.current
    if (!id) return
    const snapshot = await api.request<StudioRun>('/api/runs/' + encodeURIComponent(id))
    if (currentRef.current === id && generation.current === version) {
      setRun((old) => (old?.id === id && old.cursor > snapshot.cursor ? old : snapshot))
    }
  }, [api])
  useEffect(() => {
    if (!current || mismatch) {
      setRun(null)
      setStreamState('')
      return
    }
    let disposed = false,
      socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout> | undefined
    let cursor = 0,
      retries = 0,
      delay = 1000
    const controller = new AbortController()
    const open = () => {
      if (disposed) return
      setStreamState(retries ? '正在重连，已有任务继续执行' : '正在连接实时更新')
      socket = new WebSocket(api.socketURL(current, cursor))
      socket.onopen = () => {
        if (!disposed) setStreamState('实时更新')
      }
      socket.onmessage = (message) => {
        if (disposed) return
        let frame
        try {
          frame = JSON.parse(message.data)
        } catch {
          setError('实时更新格式无效，请重新打开会话。')
          return
        }
        if (frame.event === 'stream_error') {
          disposed = true
          socket?.close()
          setStreamState('连接已断开')
          setError(frame.data?.message || '授权已改变，请重新连接工作空间。')
          return
        }
        retries = 0
        delay = 1000
        setRun((old) => {
          if (!old || old.id !== current) return old
          const next = applyStudioFrame(old, frame)
          cursor = next.cursor
          return next
        })
      }
      socket.onclose = (event) => {
        if (disposed) return
        if (event.code === 1008 || ++retries > 5) {
          setStreamState('连接已断开')
          setError(
            event.code === 1008
              ? '授权已失效，请重新连接工作空间。'
              : '实时连接中断，请重新打开会话；已有任务不会重复提交。',
          )
          return
        }
        setStreamState('正在重连，已有任务继续执行')
        timer = setTimeout(open, delay)
        delay = Math.min(delay * 2, 15000)
      }
    }
    setRun(null)
    const version = ++generation.current
    api
      .request<StudioRun>('/api/runs/' + encodeURIComponent(current), undefined, controller.signal)
      .then((snapshot) => {
        if (disposed || generation.current !== version) return
        setRun(snapshot)
        cursor = snapshot.cursor
        open()
      })
      .catch((e) => {
        if (!disposed) setError(e instanceof Error ? e.message : '读取会话失败')
      })
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
      socket?.close()
    }
  }, [api, current, mismatch])
  return {
    api,
    state,
    catalog,
    current,
    run,
    setCurrent,
    error,
    setError,
    loading,
    streamState,
    mismatch,
    reload,
    refreshHistory,
    initialize,
  }
}
