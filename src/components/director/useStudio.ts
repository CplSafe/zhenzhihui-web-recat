import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyStudioFrame, createStudioAPI, StudioHTTPError } from './studio'
import type { StudioCatalog, StudioRun, StudioState } from './studio'

export function useStudio(base: string, workspaceId?: number, canvasId?: number, business = false) {
  const api = useMemo(
    () => createStudioAPI(base, business ? { workspaceId: workspaceId!, canvasId: canvasId! } : undefined),
    [base, workspaceId, canvasId, business],
  )
  const activeAPI = useRef(api)
  activeAPI.current = api
  const [state, setState] = useState<StudioState>({ connected: false, runs: [] })
  const [catalog, setCatalog] = useState<StudioCatalog>({ models: [], skills: [] })
  const [current, setCurrentState] = useState<string | null>(null)
  const conversationKey = useRef<string | null>(null)
  const conversationChoice = useRef(0)
  const setCurrent = useCallback((id: string | null) => {
    conversationChoice.current++
    setCurrentState(id)
    if (!conversationKey.current) return
    try {
      if (id) sessionStorage.setItem(conversationKey.current, id)
      else sessionStorage.removeItem(conversationKey.current)
    } catch { /* Browser storage may be disabled. */ }
  }, [])
  const [run, setRun] = useState<StudioRun | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [streamState, setStreamState] = useState('')
  const [connectionEpoch, setConnectionEpoch] = useState(0)
  const currentRef = useRef(current)
  currentRef.current = current
  const generation = useRef(0)
  const mismatch = !!(state.connected && workspaceId && state.workspace_id !== workspaceId)

  const refreshHistory = useCallback(
    async (offset = 0, signal?: AbortSignal) => {
      const next = await api.request<StudioState>('/api/state' + (offset ? '?offset=' + offset : ''), undefined, signal)
      if (activeAPI.current !== api || signal?.aborted) return next
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
      const choice = conversationChoice.current
      try {
        await api.bootstrap(signal)
        const next = await refreshHistory(0, signal)
        if (activeAPI.current !== api || signal?.aborted) return
        const key = next.connected && next.session_scope && (!workspaceId || next.workspace_id === workspaceId)
          ? 'dodo-conversation:' + JSON.stringify([base, next.session_scope, canvasId ?? null]) : null
        if (conversationKey.current !== key) {
          conversationKey.current = key
          let saved = null
          try {
            if (key) {
              if (choice === conversationChoice.current) saved = sessionStorage.getItem(key)
              else sessionStorage.removeItem(key) // New was clicked while connecting.
            }
          } catch { /* Continue without persistence. */ }
          setCurrentState(saved)
        }
        setError('')
        if (next.connected && (!workspaceId || next.workspace_id === workspaceId)) {
          try {
            const value = await api.request<StudioCatalog>('/api/catalog', undefined, signal)
            if (activeAPI.current !== api || signal?.aborted) return
            setCatalog(value)
          } catch (e) {
            if (activeAPI.current !== api || signal?.aborted) return
            setError(e instanceof Error ? e.message : '读取模型列表失败')
          }
        }
        setConnectionEpoch((value) => value + 1)
      } catch (e) {
        if (activeAPI.current === api && !signal?.aborted) {
          setState({ connected: false, runs: [] })
          setCatalog({ models: [], skills: [] })
          conversationKey.current = null
          setCurrentState(null)
          setRun(null)
          setError(e instanceof Error ? e.message : '连接失败')
        }
      } finally {
        if (activeAPI.current === api && !signal?.aborted) setLoading(false)
      }
    },
    [api, refreshHistory, workspaceId, base, canvasId],
  )
  useEffect(() => {
    const controller = new AbortController()
    conversationKey.current = null
    setCurrentState(null)
    setRun(null)
    setState({ connected: false, runs: [] })
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
      delay = 1000,
      recovering = false,
      authRetries = 0,
      authWindowStarted = 0
    const controller = new AbortController()
    const recoverLogin = async () => {
      if (disposed || recovering) return
      recovering = true
      if (socket) {
        socket.onclose = null
        socket.onmessage = null
        socket.close()
      }
      setStreamState('正在重新验证登录，已有任务继续执行')
      try {
        const now = Date.now()
        if (now - authWindowStarted >= 60_000) {
          authRetries = 0
          authWindowStarted = now
        }
        if (++authRetries > 3) throw new Error('登录状态持续变化，请重新检查业务登录。')
        // HTTP uses the browser's latest cookie, unlike the old WS handshake.
        // Reading this run also confirms the renewed user still owns it.
        const snapshot = await api.request<StudioRun>(
          '/api/runs/' + encodeURIComponent(current),
          undefined,
          controller.signal,
        )
        if (disposed) return
        cursor = snapshot.cursor
        setRun(snapshot)
        setError('')
        recovering = false
        open()
      } catch (e) {
        if (disposed) return
        disposed = true
        setState({ connected: false, runs: [] })
        setCatalog({ models: [], skills: [] })
        setRun(null)
        setStreamState('连接已断开')
        setError(e instanceof Error ? e.message : '业务登录已失效，请重新登录。')
      }
    }
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
          if (business && frame.data?.code === 'AUTH_CHANGED') {
            void recoverLogin()
            return
          }
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
        if (disposed || recovering) return
        if (business && event.code === 1008) {
          void recoverLogin()
          return
        }
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
        if (disposed) return
        if (e instanceof StudioHTTPError && (e.status === 403 || e.status === 404)) {
          setCurrent(null)
          setError('原会话已不可访问，可以新建对话或从历史记录中选择。')
        } else setError(e instanceof Error ? e.message : '读取会话失败')
      })
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
      socket?.close()
    }
  }, [api, current, mismatch, business, connectionEpoch, setCurrent])
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
