/**
 * 创作台历史流的状态管理：跨刷新累计展示过去的创作，并向上翻页加载更早的记录。
 *
 * 排列方式是「聊天式」——旧在上、新在下。首屏拉最近一页并停在底部，用户往上滚
 * 触发加载更早的历史（等价于移动端的下拉加载更多，只是方向朝上）。
 *
 * 之所以能安全用 offset 分页：新任务一律追加到**尾部**，不会插到头部把后面的
 * 记录整体挤位，所以往前翻页不会重复/漏项。即便如此仍按批次 id 去重兜底。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioResultBatch } from '@/components/studio/StudioResultFeed/StudioResultFeed'
import { fetchStudioHistoryPage } from '@/api/studioHistory'
import { prependHistoryBatches, toHistoryBatches } from '@/utils/studioHistory'

/** 每页拉取的任务数（按 operation 各取这么多条）。 */
const HISTORY_PAGE_SIZE = 12

/** 历史流对外暴露的状态与操作。 */
export interface StudioHistory {
  batches: StudioResultBatch[]
  setBatches: React.Dispatch<React.SetStateAction<StudioResultBatch[]>>
  /** 首屏历史是否仍在加载。 */
  loading: boolean
  /** 是否正在加载更早的历史。 */
  loadingMore: boolean
  /** 是否还有更早的历史可加载。 */
  hasMore: boolean
  /** 加载更早的一页；重复调用会复用进行中的请求。 */
  loadMore: () => Promise<void>
}

/**
 * 加载并维护某个工作空间的创作历史。
 *
 * 工作空间切换时整体重来：旧空间的历史不能留在列表里，迟到的响应也要丢弃。
 */
export function useStudioHistory(workspaceId: number): StudioHistory {
  const [batches, setBatches] = useState<StudioResultBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  // 下一页的 offset；每加载一页累加一个页长。
  const offsetRef = useRef(0)
  // 进行中的翻页请求，避免滚动抖动时并发拉同一页。
  const inFlightRef = useRef<Promise<void> | null>(null)
  // 工作空间切换的序号：迟到的响应凭它判断自己是否已过期。
  const scopeRef = useRef(0)
  const hasMoreRef = useRef(false)

  useEffect(() => {
    hasMoreRef.current = hasMore
  }, [hasMore])

  // 首屏：工作空间就绪或切换后重新拉最近一页。
  useEffect(() => {
    scopeRef.current += 1
    const scope = scopeRef.current
    offsetRef.current = 0
    inFlightRef.current = null
    setBatches([])
    setHasMore(false)

    if (!workspaceId) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    void (async () => {
      try {
        const page = await fetchStudioHistoryPage({
          workspaceId,
          offset: 0,
          limit: HISTORY_PAGE_SIZE,
          signal: controller.signal,
        })
        if (scopeRef.current !== scope) return
        setBatches(toHistoryBatches(page.items, workspaceId))
        setHasMore(page.hasMore)
        offsetRef.current = HISTORY_PAGE_SIZE
      } catch {
        // 历史加载失败不该挡住创作：保持空列表，用户照常可以生成。
        if (scopeRef.current === scope) setHasMore(false)
      } finally {
        if (scopeRef.current === scope) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [workspaceId])

  /** 往上翻一页，把更早的历史拼到列表前面。 */
  const loadMore = useCallback(async () => {
    if (!workspaceId || !hasMoreRef.current) return
    if (inFlightRef.current) return inFlightRef.current

    const scope = scopeRef.current
    const run = async () => {
      setLoadingMore(true)
      try {
        const page = await fetchStudioHistoryPage({
          workspaceId,
          offset: offsetRef.current,
          limit: HISTORY_PAGE_SIZE,
        })
        if (scopeRef.current !== scope) return
        const older = toHistoryBatches(page.items, workspaceId)
        setBatches((current) => prependHistoryBatches(current, older))
        setHasMore(page.hasMore)
        offsetRef.current += HISTORY_PAGE_SIZE
      } catch {
        // 失败时保留已加载的历史，用户可再次上滚重试同一 offset。
        if (scopeRef.current === scope) setHasMore(false)
      } finally {
        if (scopeRef.current === scope) setLoadingMore(false)
      }
    }

    // 先建好 promise 再挂清理：若在 IIFE 内部清 inFlightRef，同步抛错的请求会在
    // 赋值之前就把 ref 清成 null，随后又被赋上一个已 settle 的 promise——那之后
    // 每次 loadMore 都直接返回它，翻页从此静默失效。
    const promise = run().finally(() => {
      inFlightRef.current = null
    })
    inFlightRef.current = promise
    return promise
  }, [workspaceId])

  return { batches, setBatches, loading, loadingMore, hasMore, loadMore }
}
