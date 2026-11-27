import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { listCanvasesPage, type CanvasListPage, type CanvasSummary } from '@/api/canvasApi'

const PAGE_SIZE = 10

type RecentState = {
  recent: CanvasSummary[]
  loading: boolean
  loadingMore: boolean
  canLoadMore: boolean
  error: boolean
}

const EMPTY: RecentState = { recent: [], loading: false, loadingMore: false, canLoadMore: false, error: false }
const INITIAL: RecentState = { ...EMPTY, loading: true, canLoadMore: true }

type RecentFeed = {
  key: string
  workspaceId: number
  state: RecentState
  offset: number
  request: AbortController | null
  bufferedPage: CanvasListPage | null
  revealPage: boolean
  update: (patch: Partial<RecentState>) => void
}

function updatedTime(item: CanvasSummary) {
  return new Date(item.updated_at || item.created_at || '').getTime() || item.id
}

function appendPage(feed: RecentFeed, page: CanvasListPage) {
  const seen = new Set(feed.state.recent.map(({ id }) => id))
  const items: CanvasSummary[] = []
  for (const item of page.items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  items.sort((a, b) => updatedTime(b) - updatedTime(a) || b.id - a.id)

  feed.bufferedPage = null
  feed.revealPage = false
  feed.offset += page.count
  feed.update({
    recent: [...feed.state.recent, ...items],
    loading: false,
    loadingMore: false,
    canLoadMore: page.count >= PAGE_SIZE && items.length > 0,
  })
}

function requestPage(feed: RecentFeed, reveal: boolean) {
  if (!feed.state.canLoadMore || feed.state.error) return
  if (feed.bufferedPage) {
    if (reveal) appendPage(feed, feed.bufferedPage)
    return
  }
  if (reveal) {
    feed.revealPage = true
    if (!feed.state.loading && !feed.state.loadingMore) {
      feed.update({ loadingMore: true })
    }
  }
  if (feed.request) return

  const controller = new AbortController()
  feed.request = controller
  void listCanvasesPage({
    workspaceId: feed.workspaceId,
    includeArchived: true,
    limit: PAGE_SIZE,
    offset: feed.offset,
    signal: controller.signal,
  })
    .then((page) => {
      if (feed.request !== controller) return
      feed.request = null
      if (feed.revealPage) appendPage(feed, page)
      else feed.bufferedPage = page
    })
    .catch(() => {
      if (feed.request !== controller) return
      feed.request = null
      // 提前请求失败时，等用户滚到加载位置再重试。
      if (feed.revealPage) {
        feed.revealPage = false
        feed.update({ loading: false, loadingMore: false, error: true })
      }
    })
}

export function useRecentCanvases(
  workspaceId: string | number | null | undefined,
  userId: string | number | null | undefined,
) {
  const wsId = Number(workspaceId || 0)
  const key = wsId > 0 ? `${userId || 0}:${wsId}` : ''
  const active = useRef<RecentFeed | null>(null)
  const [view, setView] = useState({ key: '', state: EMPTY })

  useEffect(() => {
    if (!key) {
      setView({ key: '', state: EMPTY })
      return
    }

    const feed: RecentFeed = {
      key,
      workspaceId: wsId,
      state: INITIAL,
      offset: 0,
      request: null,
      bufferedPage: null,
      revealPage: false,
      update(patch) {
        feed.state = { ...feed.state, ...patch }
        setView({ key, state: feed.state })
      },
    }
    active.current = feed
    setView({ key, state: INITIAL })
    requestPage(feed, true)

    return () => {
      active.current = null
      feed.request?.abort()
      feed.request = null
    }
  }, [key, wsId])

  const prefetchMore = useCallback(() => {
    const feed = active.current
    if (feed?.key === key && !feed.state.loading) requestPage(feed, false)
  }, [key])

  const loadMore = useCallback(() => {
    const feed = active.current
    if (feed?.key === key) requestPage(feed, true)
  }, [key])

  const retry = useCallback(() => {
    const feed = active.current
    if (feed?.key !== key || !feed.state.error) return
    feed.update({ error: false, loading: feed.state.recent.length === 0 })
    requestPage(feed, true)
  }, [key])

  const setRecent = useCallback(
    (value: SetStateAction<CanvasSummary[]>) => {
      const feed = active.current
      if (feed?.key !== key) return
      const recent = typeof value === 'function' ? value(feed.state.recent) : value
      const changeInCount = recent.length - feed.state.recent.length
      feed.update({ recent })
      if (!changeInCount) return

      // 删除会让后面的行提前。新增时保留一个重叠位置，追加时按 ID 去重。
      feed.offset = Math.max(0, feed.offset + Math.min(0, changeInCount))
      feed.bufferedPage = null
      feed.request?.abort()
      feed.request = null
      if (feed.revealPage) requestPage(feed, true)
    },
    [key],
  )

  const state = view.key === key ? view.state : key ? INITIAL : EMPTY
  return { ...state, setRecent, prefetchMore, loadMore, retry }
}
