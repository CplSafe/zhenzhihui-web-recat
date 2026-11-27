import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getAuthRequestScope, isAuthRequestScopeCurrent } from '@/api/authRequestScope'
import { getBusinessErrorMessage } from '@/api/business'
import { listCanvasesPage, type CanvasSummary } from '@/api/canvasApi'

const PAGE_SIZE = 100
const MAX_PAGES_WITHOUT_PROGRESS = 3

type CanvasListState = {
  items: CanvasSummary[]
  loading: boolean
  error: string
}

const EMPTY: CanvasListState = { items: [], loading: false, error: '' }
const LOADING: CanvasListState = { ...EMPTY, loading: true }

type CanvasListBinding = { workspaceId: number; actor: string }

type CanvasListRequest = {
  binding: CanvasListBinding
  authScope: number
  state: CanvasListState
  offset: number
  finished: boolean
  pagesWithoutProgress: number
  deletedIds: Set<number>
  controller: AbortController | null
  update: (patch: Partial<CanvasListState>) => void
}

/** Load the current workspace’s editable and archived canvas list, preserving confirmed pages on retry. */
export function useProjectManagementCanvases(
  workspaceId: string | number | null | undefined,
  userId: string | number | null | undefined,
) {
  const wsId = Number(workspaceId || 0)
  const actor = String(userId ?? '').trim()
  const binding = useMemo<CanvasListBinding | null>(
    () => (Number.isSafeInteger(wsId) && wsId > 0 && actor && actor !== '0' ? { workspaceId: wsId, actor } : null),
    [wsId, actor],
  )
  const active = useRef<CanvasListRequest | null>(null)
  const [view, setView] = useState<{ binding: CanvasListBinding | null; state: CanvasListState }>({
    binding: null,
    state: EMPTY,
  })

  const load = useCallback(async (request: CanvasListRequest) => {
    if (request.controller || request.finished || !isAuthRequestScopeCurrent(request.authScope)) return

    const controller = new AbortController()
    request.controller = controller
    const isCurrent = () =>
      active.current === request &&
      request.controller === controller &&
      !controller.signal.aborted &&
      isAuthRequestScopeCurrent(request.authScope)

    request.update({ loading: true, error: '' })
    try {
      while (!request.finished && isCurrent()) {
        const page = await listCanvasesPage({
          workspaceId: request.binding.workspaceId,
          includeArchived: true,
          limit: PAGE_SIZE,
          offset: request.offset,
          signal: controller.signal,
        })
        if (!isCurrent()) return

        const knownIds = new Set(request.state.items.map(({ id }) => id))
        const items = page.items.filter(({ id }) => {
          if (knownIds.has(id) || request.deletedIds.has(id)) return false
          knownIds.add(id)
          return true
        })
        request.finished = page.count < PAGE_SIZE
        if (!request.finished && items.length === 0) {
          request.pagesWithoutProgress += 1
          if (request.pagesWithoutProgress >= MAX_PAGES_WITHOUT_PROGRESS) {
            throw new Error('画布列表未返回新的记录，请重试')
          }
        } else {
          request.pagesWithoutProgress = 0
        }
        // The raw response count includes rows removed by CanvasSummary normalization.
        request.offset += page.count
        if (items.length) request.update({ items: [...request.state.items, ...items] })
      }
      if (isCurrent()) request.update({ loading: false })
    } catch (error) {
      if (isCurrent())
        request.update({ loading: false, error: getBusinessErrorMessage(error, '画布列表加载失败，请重试') })
    } finally {
      if (request.controller === controller) request.controller = null
    }
  }, [])

  useEffect(() => {
    if (!binding) {
      setView({ binding: null, state: EMPTY })
      return
    }

    const request: CanvasListRequest = {
      binding,
      authScope: getAuthRequestScope(),
      state: LOADING,
      offset: 0,
      finished: false,
      pagesWithoutProgress: 0,
      deletedIds: new Set(),
      controller: null,
      update(patch) {
        request.state = { ...request.state, ...patch }
        setView({ binding, state: request.state })
      },
    }
    active.current = request
    void load(request)

    return () => {
      active.current = null
      request.controller?.abort()
    }
  }, [binding, load])

  const setItems = useCallback<Dispatch<SetStateAction<CanvasSummary[]>>>(
    (value) => {
      const request = active.current
      if (!request || request.binding !== binding || !isAuthRequestScopeCurrent(request.authScope)) return
      const previous = request.state.items
      const next = typeof value === 'function' ? value(previous) : value
      const byId = new Map<number, CanvasSummary>()
      for (const item of next) {
        if (!byId.has(item.id)) byId.set(item.id, item)
        request.deletedIds.delete(item.id)
      }
      const deleted = previous.filter(({ id }) => !byId.has(id))
      for (const { id } of deleted) request.deletedIds.add(id)
      request.update({ items: [...byId.values()] })
      if (request.finished || !deleted.length) return
      // A server-side deletion moves later rows toward the beginning of the list.
      request.offset = Math.max(0, request.offset - deleted.length)
      request.pagesWithoutProgress = 0
      if (request.controller) {
        request.controller.abort()
        request.controller = null
        void load(request)
      }
    },
    [binding, load],
  )

  const retry = useCallback(() => {
    const request = active.current
    if (request && request.binding === binding && request.state.error) void load(request)
  }, [binding, load])

  const state = view.binding === binding ? view.state : binding ? LOADING : EMPTY
  return { ...state, setItems, retry }
}
