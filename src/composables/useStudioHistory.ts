/**
 * 创作台历史流的状态管理：跨刷新累计展示过去的创作，并向上翻页加载更早的记录。
 *
 * 排列方式是「聊天式」——旧在上、新在下。首屏拉最近一页并停在底部，用户往上滚
 * 触发加载更早的历史（等价于移动端的下拉加载更多，只是方向朝上）。
 *
 * 失败的 operation 保留当前偏移，并在结果流提示重试。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioResultBatch } from '@/components/studio/StudioResultFeed/StudioResultFeed'
import {
  FIRST_STUDIO_HISTORY_OFFSETS,
  fetchStudioHistoryPage,
  type StudioHistoryOffsets,
  type StudioOperation,
} from '@/api/studioHistory'
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
  historyError: boolean
  /** 加载更早的一页；重复调用会复用进行中的请求。 */
  loadMore: () => Promise<void>
}

/**
 * 加载并维护某个工作空间的创作历史。
 *
 * 工作空间切换时整体重来：旧空间的历史不能留在列表里，迟到的响应也要丢弃。
 */
export function useStudioHistory(workspaceId: number, ownerId?: number): StudioHistory {
  const [batches, setBatches] = useState<StudioResultBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [historyError, setHistoryError] = useState(false)

  const offsetsRef = useRef<StudioHistoryOffsets>({})
  const failedRef = useRef<StudioOperation[]>([])
  const inFlightRef = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null)

  const loadPage = useCallback(
    (initial = false) => {
      if (inFlightRef.current) return inFlightRef.current.promise
      if (!workspaceId || ownerId === 0 || !Object.keys(offsetsRef.current).length) return Promise.resolve()
      const failed = failedRef.current
      const requested = failed.length
        ? (Object.fromEntries(
            failed.map((operation) => [operation, offsetsRef.current[operation]]),
          ) as StudioHistoryOffsets)
        : offsetsRef.current
      const controller = new AbortController()
      const setBusy = initial ? setLoading : setLoadingMore
      setBusy(true)
      const promise = (async () => {
        try {
          const page = await fetchStudioHistoryPage({
            workspaceId,
            offsets: requested,
            limit: HISTORY_PAGE_SIZE,
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          const next = { ...offsetsRef.current }
          for (const operation of Object.keys(requested) as StudioOperation[]) delete next[operation]
          offsetsRef.current = { ...next, ...page.nextOffsets }
          failedRef.current = page.failedOperations
          setHistoryError(page.failedOperations.length > 0)
          setHasMore(Object.keys(offsetsRef.current).length > 0)
          const incoming = toHistoryBatches(page.items, workspaceId)
          setBatches((current) => prependHistoryBatches(current, incoming))
        } catch {
          if (controller.signal.aborted) return
          failedRef.current = Object.keys(requested) as StudioOperation[]
          setHistoryError(true)
          setHasMore(true)
        } finally {
          if (!controller.signal.aborted) setBusy(false)
        }
      })().finally(() => {
        if (inFlightRef.current?.controller === controller) inFlightRef.current = null
      })
      inFlightRef.current = { controller, promise }
      return promise
    },
    [ownerId, workspaceId],
  )

  useEffect(() => {
    offsetsRef.current = FIRST_STUDIO_HISTORY_OFFSETS
    failedRef.current = []
    setBatches([])
    setHasMore(false)
    setHistoryError(false)
    setLoading(false)
    setLoadingMore(false)
    void loadPage(true)
    return () => {
      inFlightRef.current?.controller.abort()
      inFlightRef.current = null
    }
  }, [loadPage])

  const loadMore = useCallback(() => loadPage(), [loadPage])
  return { batches, setBatches, loading, loadingMore, hasMore, historyError, loadMore }
}
