import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { deleteCanvas, duplicateCanvas, fetchAllCanvasElements, patchCanvas, type CanvasSummary } from '@/api/canvasApi'
import { getBusinessErrorMessage } from '@/api/business'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useRecentCanvases } from '@/composables/useRecentCanvases'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { pickCanvasCover, type CanvasCover } from '@/utils/canvasCover'
import { buildCanvasCopyTitle } from '@/utils/canvasCopyTitle'
import styles from './CanvasEmptyStateActions.module.css'
import { formatCredits } from '@/utils/creditsFormat'
import CanvasSettingsDialog from './CanvasSettingsDialog'

type Action = {
  label: string
  description: string
  icon: ReactNode
  onClick: () => void
}

const emptyCovers: Record<number, CanvasCover | null> = {}
const recentCanvasSelector = '[data-recent-canvas-id]'
const canvasTimestamp = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function layoutRecentProjects(grid: HTMLDivElement, cards: HTMLElement[]) {
  const width = grid.clientWidth
  if (!width) return
  const gap = width < 680 ? 10 : 20
  const columns = width < 304 ? 1 : width < 680 ? 2 : Math.max(2, Math.floor((width + gap) / (220 + gap)))
  const cardWidth = (width - gap * (columns - 1)) / columns
  const heights = Array.from({ length: columns }, () => 0)

  grid.style.setProperty('--recent-card-width', `${cardWidth}px`)
  grid.dataset.masonryReady = 'true'
  const cardHeights = cards.map((card) => card.offsetHeight)
  for (const [index, card] of cards.entries()) {
    const column = heights.indexOf(Math.min(...heights))
    card.style.setProperty('--recent-card-left', `${column * (cardWidth + gap)}px`)
    card.style.setProperty('--recent-card-top', `${heights[column]}px`)
    heights[column] += cardHeights[index] + gap
  }
  grid.style.height = `${Math.max(0, Math.max(...heights) - gap)}px`
}

function useRecentCanvasCovers(
  recent: CanvasSummary[],
  workspaceId: number,
  userId: number,
  gridRef: RefObject<HTMLDivElement>,
) {
  const scope = `${workspaceId}:${userId}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [record, setRecord] = useState({ scope, covers: emptyCovers })
  const covers = record.scope === scope ? record.covers : emptyCovers
  const [visible, setVisible] = useState<Set<number>>(() => new Set())
  const [settled, setSettled] = useState(0)
  const requestsRef = useRef({ scope, ids: new Set<number>(), active: 0 })
  const setCovers = useCallback(
    (update: SetStateAction<typeof emptyCovers>) => {
      if (scopeRef.current !== scope) return
      setRecord((current) => {
        const existing = current.scope === scope ? current.covers : emptyCovers
        return { scope, covers: typeof update === 'function' ? update(existing) : update }
      })
    },
    [scope],
  )

  useEffect(() => {
    const requests = { scope, ids: new Set<number>(), active: 0 }
    requestsRef.current = requests
    setVisible(new Set())
    return () => {
      if (requestsRef.current === requests) requestsRef.current = { scope: '', ids: new Set(), active: 0 }
    }
  }, [scope])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid || !recent.length) return
    const addVisible = (ids: number[]) => {
      if (!ids.length || scopeRef.current !== scope) return
      setVisible((current) => {
        const next = new Set([...current, ...ids])
        return current.size === next.size ? current : next
      })
    }
    if (typeof IntersectionObserver === 'undefined') {
      addVisible(recent.map(({ id }) => id))
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const ids: number[] = []
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          ids.push(Number((entry.target as HTMLElement).dataset.recentCanvasId))
        }
        addVisible(ids)
      },
      { root: grid.closest('.canvas-entry-main'), rootMargin: '240px 0px' },
    )
    grid.querySelectorAll(recentCanvasSelector).forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [gridRef, recent, scope])

  useEffect(() => {
    const requests = requestsRef.current
    if (!workspaceId || requests.scope !== scope) return
    const ready = recent
      .filter(({ id }) => visible.has(id) && !requests.ids.has(id) && covers[id] === undefined)
      .slice(0, Math.max(0, 3 - requests.active))
    for (const { id } of ready) {
      requests.ids.add(id)
      requests.active++
      void fetchAllCanvasElements({ workspaceId, canvasId: id, afterRevision: 0 })
        .then((page) => {
          if (requestsRef.current === requests)
            setCovers((current) => ({ ...current, [id]: pickCanvasCover(page.elements, workspaceId) }))
        })
        .catch(() => {
          if (requestsRef.current === requests) setCovers((current) => ({ ...current, [id]: null }))
        })
        .finally(() => {
          requests.active--
          if (requestsRef.current === requests) setSettled((current) => current + 1)
        })
    }
  }, [covers, recent, scope, setCovers, settled, visible, workspaceId])

  return { covers, setCovers }
}

function RecentCanvasCover({ cover, onError }: { cover: CanvasCover | null | undefined; onError: () => void }) {
  const [ratio, setRatio] = useState<number>()
  const measured = (width: number, height: number) => {
    if (width > 0 && height > 0) setRatio(Math.min(4 / 3, Math.max(9 / 16, width / height)))
  }
  return (
    <span
      className={styles.projectCover}
      data-recent-canvas-cover
      data-media-ready={ratio !== undefined}
      aria-hidden="true"
      style={ratio ? ({ '--recent-cover-ratio': ratio } as CSSProperties) : undefined}
    >
      {ratio === undefined && (
        <span className={styles.projectCoverStatus}>
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
          </svg>
          <span>{cover === null ? '暂无预览' : '正在加载预览…'}</span>
        </span>
      )}
      {cover?.kind === 'video' && (
        <video
          className={styles.projectCoverMedia}
          src={cover.url}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={({ currentTarget }) => measured(currentTarget.videoWidth, currentTarget.videoHeight)}
          onError={onError}
        />
      )}
      {cover?.kind === 'image' && (
        <img
          className={styles.projectCoverMedia}
          src={cover.url}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={({ currentTarget }) => measured(currentTarget.naturalWidth, currentTarget.naturalHeight)}
          onError={onError}
        />
      )}
    </span>
  )
}

function RecentCanvasMetadata({ item, descriptionId }: { item: CanvasSummary; descriptionId: string }) {
  const updated = new Date(item.updated_at ?? '')
  const hasUpdate = Number.isFinite(updated.getTime())
  const timestamp = hasUpdate ? updated : new Date(item.created_at ?? '')
  const hasTimestamp = Number.isFinite(timestamp.getTime())
  const hasCredits = item.usedCredits != null && Number.isFinite(item.usedCredits)

  return (
    <span className={styles.projectBody} data-recent-canvas-caption>
      <strong className={styles.projectTitle}>{item.title || '未命名画布'}</strong>
      <span className={styles.projectMetadata} id={descriptionId}>
        <span className={styles.projectCredits}>
          <span>累计消耗</span>
          {hasCredits ? <strong>{formatCredits(item.usedCredits, 3)} 积分</strong> : <span>暂无记录</span>}
        </span>
        <span className={styles.projectUpdated}>
          <span>{hasUpdate ? '更新于' : hasTimestamp ? '创建于' : '更新时间'}</span>
          {hasTimestamp ? (
            <time dateTime={timestamp.toISOString()}>{canvasTimestamp.format(timestamp)}</time>
          ) : (
            <span>暂无记录</span>
          )}
        </span>
      </span>
    </span>
  )
}

export default function CanvasEmptyStateActions() {
  const navigate = useNavigate()
  const cardDescriptionPrefix = useId()
  const workspaceId = useWorkspaceId()
  const currentUserId = Number(resolveUserId(useCurrentUser()) || 0)
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const { recent, setRecent, loading, loadingMore, canLoadMore, prefetchMore, loadMore, retry, error } =
    useRecentCanvases(workspaceId, currentUserId)
  const gridRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { covers, setCovers } = useRecentCanvasCovers(recent, Number(workspaceId || 0), currentUserId, gridRef)
  const [openMenuId, setOpenMenuId] = useState(0)
  const [settingsTarget, setSettingsTarget] = useState<{ ws: number; id: number; userId: number } | null>(null)
  const [renameTarget, setRenameTarget] = useState<CanvasSummary | null>(null)
  const [renameName, setRenameName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(0)
  const [duplicatingId, setDuplicatingId] = useState(0)
  const duplicateBusy = useRef(false)
  const mutationScope = `${workspaceId}:${currentUserId}`
  const mutationScopeRef = useRef(mutationScope)
  mutationScopeRef.current = mutationScope
  useEffect(() => {
    setOpenMenuId(0)
    setSettingsTarget(null)
    setRenameTarget(null)
    setSaving(false)
    setDeletingId(0)
    setDuplicatingId(0)
    duplicateBusy.current = false
  }, [mutationScope])
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || !recent.length || typeof ResizeObserver === 'undefined') return
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(recentCanvasSelector))
    let frame = 0
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => layoutRecentProjects(grid, cards))
    })
    layoutRecentProjects(grid, cards)
    resize.observe(grid)
    cards.forEach((card) => resize.observe(card))
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
    }
  }, [recent])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !canLoadMore || loadingMore || error || typeof IntersectionObserver === 'undefined') return
    const root = sentinel.closest('.canvas-entry-main')
    const prefetchObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) prefetchMore()
      },
      { root, rootMargin: '560px 0px' },
    )
    const appendObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { root, rootMargin: '160px 0px' },
    )
    prefetchObserver.observe(sentinel)
    appendObserver.observe(sentinel)
    return () => {
      prefetchObserver.disconnect()
      appendObserver.disconnect()
    }
  }, [canLoadMore, error, loadMore, loadingMore, prefetchMore, recent.length, workspaceId, currentUserId])
  useEffect(() => {
    if (!openMenuId) return
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('[data-recent-canvas-menu]')) setOpenMenuId(0)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [openMenuId])
  const begin = (initialCanvasAction: string) =>
    navigate('/canvas', { state: { createCanvasAction: initialCanvasAction } })
  const handleRename = async () => {
    const wsId = Number(workspaceId || 0)
    const title = renameName.trim()
    if (!wsId || !renameTarget?.id || !title || saving) return
    if (renameTarget.userId && currentUserId && renameTarget.userId !== currentUserId) {
      showToast('这是其他人的画布，无法重命名', 'info')
      setRenameTarget(null)
      return
    }
    if (title === (renameTarget.title || '')) {
      setRenameTarget(null)
      return
    }
    setSaving(true)
    try {
      await patchCanvas({ workspaceId: wsId, canvasId: renameTarget.id, title })
      if (mutationScopeRef.current !== mutationScope) return
      setRecent((items) => items.map((item) => (item.id === renameTarget.id ? { ...item, title } : item)))
      showToast('画布已重命名', 'success')
      setRenameTarget(null)
    } catch (error) {
      if (mutationScopeRef.current === mutationScope)
        showToast(getBusinessErrorMessage(error, '重命名失败,请稍后重试'), 'error')
    } finally {
      if (mutationScopeRef.current === mutationScope) setSaving(false)
    }
  }
  const handleDelete = async (item: CanvasSummary) => {
    const wsId = Number(workspaceId || 0)
    if (!wsId || !item.id || deletingId) return
    setOpenMenuId(0)
    if (!(await requestConfirm(`确定删除画布「${item.title || '未命名画布'}」吗?画布内容不可恢复。`))) return
    if (mutationScopeRef.current !== mutationScope) return
    setDeletingId(item.id)
    try {
      await deleteCanvas({ workspaceId: wsId, canvasId: item.id })
      if (mutationScopeRef.current !== mutationScope) return
      setRecent((items) => items.filter((canvas) => canvas.id !== item.id))
      setCovers((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      try {
        localStorage.removeItem(`zzh_canvas_draft_p${item.id}`)
      } catch {
        // 本地草稿清理失败不影响服务端删除结果。
      }
      showToast('画布已删除', 'success')
    } catch (error) {
      if (mutationScopeRef.current === mutationScope)
        showToast(getBusinessErrorMessage(error, '删除失败,请稍后重试'), 'error')
    } finally {
      if (mutationScopeRef.current === mutationScope) setDeletingId(0)
    }
  }
  const handleDuplicate = async (item: CanvasSummary) => {
    const wsId = Number(workspaceId || 0)
    if (!wsId || !item.id || duplicateBusy.current) return
    duplicateBusy.current = true
    setDuplicatingId(item.id)
    setOpenMenuId(0)
    const title = buildCanvasCopyTitle(
      item.title,
      recent.map((canvas) => canvas.title),
    )
    try {
      const created = await duplicateCanvas({ workspaceId: wsId, sourceCanvasId: item.id, title })
      if (mutationScopeRef.current !== mutationScope) return
      setRecent((items) => [
        {
          ...created,
          title: created.title || title,
          userId: created.userId || currentUserId || undefined,
          updated_at: created.updated_at || new Date().toISOString(),
        },
        ...items,
      ])
      setCovers((current) =>
        current[item.id] === undefined ? current : { ...current, [created.id]: current[item.id] },
      )
      showToast(`已创建副本「${title}」`, 'success')
    } catch (error) {
      if (mutationScopeRef.current === mutationScope)
        showToast(getBusinessErrorMessage(error, '创建副本失败,请稍后重试'), 'error')
    } finally {
      if (mutationScopeRef.current === mutationScope) {
        duplicateBusy.current = false
        setDuplicatingId(0)
      }
    }
  }
  const actions: Action[] = [
    {
      label: '创建脚本',
      description: '从创意生成分镜脚本',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 3.75h8l4 4v12.5H6z" />
          <path d="M14 3.75v4h4M9 12h6M9 15.5h6" />
        </svg>
      ),
      onClick: () => begin('script'),
    },
    {
      label: '图片生成',
      description: '创建图片生成节点',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.5" />
          <circle cx="9" cy="9.5" r="1.5" />
          <path d="m5 17 5-5 3.5 3.5 2.5-2.5 3 3" />
        </svg>
      ),
      onClick: () => begin('image'),
    },
    {
      label: '视频生成',
      description: '创建视频生成节点',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="m10 9 5 3-5 3z" />
        </svg>
      ),
      onClick: () => begin('video'),
    },
    {
      label: '导入素材',
      description: '添加本地图片或视频',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v5.25c0 .41.34.75.75.75h12.5a.75.75 0 0 0 .75-.75V14" />
        </svg>
      ),
      onClick: () => begin('import'),
    },
  ]

  return (
    <section className={`${styles.studio} nodrag nopan nowheel`} aria-label="开始创作">
      <header className={styles.intro}>
        <h1>开启你的漫剧创作</h1>
        <p>从剧本构思到分镜与视频，在无限画布中打造完整漫剧。</p>
      </header>
      <div className={styles.actions}>
        {actions.map((action) => (
          <button key={action.label} className={styles.action} type="button" onClick={action.onClick}>
            <span className={styles.icon}>{action.icon}</span>
            <strong>{action.label}</strong>
            <small>{action.description}</small>
          </button>
        ))}
      </div>
      <section className={styles.recent} aria-label="最近的漫剧项目">
        <div className={styles.recentHeader}>
          <h2>最近的项目</h2>
          <button type="button" onClick={() => navigate('/projects?flow=canvas')}>
            查看更多
          </button>
        </div>
        {loading ? (
          <p className={styles.recentHint} role="status">
            正在加载项目…
          </p>
        ) : recent.length ? (
          <div className={styles.recentGrid} ref={gridRef}>
            {recent.map((item) => {
              const cover = covers[item.id]
              const descriptionId = `${cardDescriptionPrefix}-${item.id}`
              const menuId = `${descriptionId}-menu`
              const menuOpen = openMenuId === item.id
              return (
                <article
                  key={item.id}
                  className={styles.projectSlot}
                  data-recent-canvas-id={item.id}
                  data-menu-open={menuOpen}
                >
                  <button
                    className={styles.projectCard}
                    type="button"
                    aria-label={`打开画布 ${item.title || '未命名画布'}`}
                    aria-describedby={descriptionId}
                    onClick={() => navigate(`/canvas/${item.id}`)}
                  >
                    <RecentCanvasCover
                      key={cover?.url ?? (cover === null ? 'empty' : 'waiting')}
                      cover={cover}
                      onError={() => setCovers((current) => ({ ...current, [item.id]: null }))}
                    />
                    <RecentCanvasMetadata item={item} descriptionId={descriptionId} />
                  </button>
                  <span
                    className={styles.projectActions}
                    data-recent-canvas-menu
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape' || !menuOpen) return
                      event.stopPropagation()
                      setOpenMenuId(0)
                      event.currentTarget.querySelector('button')?.focus()
                    }}
                  >
                    <button
                      type="button"
                      aria-label={`画布操作 ${item.title || '未命名画布'}`}
                      aria-expanded={menuOpen}
                      aria-controls={menuOpen ? menuId : undefined}
                      aria-describedby={menuOpen ? `${menuId}-stats` : undefined}
                      onClick={() => setOpenMenuId((id) => (id === item.id ? 0 : item.id))}
                    >
                      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                        <circle cx="4" cy="10" r="1.4" fill="currentColor" />
                        <circle cx="10" cy="10" r="1.4" fill="currentColor" />
                        <circle cx="16" cy="10" r="1.4" fill="currentColor" />
                      </svg>
                    </button>
                    {menuOpen && (
                      <span className={styles.projectMenu} id={menuId}>
                        <span className={styles.projectMenuStats} id={`${menuId}-stats`}>
                          <span>消耗时间</span>
                          <span>暂无记录</span>
                          <span>预估积分</span>
                          <span>暂无预估</span>
                        </span>
                        {item.userId && currentUserId && item.userId !== currentUserId ? (
                          <span className={styles.permissionHint}>仅创建者可重命名或删除此画布</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setRenameTarget(item)
                              setRenameName(item.title || '')
                              setOpenMenuId(0)
                            }}
                          >
                            重命名
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(duplicatingId)}
                          onClick={() => void handleDuplicate(item)}
                        >
                          {duplicatingId === item.id ? '创建中…' : '创建副本'}
                        </button>
                        {item.userId && currentUserId && item.userId === currentUserId && (
                          <>
                            <button
                              type="button"
                              disabled={item.status === 'archived'}
                              onClick={() => {
                                setOpenMenuId(0)
                                setSettingsTarget({ ws: Number(workspaceId), id: item.id, userId: currentUserId })
                              }}
                            >
                              设置画布
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === item.id}
                              onClick={() => void handleDelete(item)}
                            >
                              {deletingId === item.id ? '删除中…' : '删除画布'}
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </article>
              )
            })}
          </div>
        ) : (
          !error && <p className={styles.recentHint}>暂无历史项目</p>
        )}
        {error ? (
          <div className={styles.recentFooter}>
            <p className={styles.recentHint} role="status">
              {recent.length ? '更多项目加载失败' : '最近项目加载失败'}
            </p>
            <button type="button" onClick={retry}>
              重试
            </button>
          </div>
        ) : canLoadMore && recent.length > 0 ? (
          <div className={styles.recentFooter} data-recent-canvas-sentinel ref={sentinelRef}>
            {loadingMore ? (
              <p className={styles.recentHint} role="status">
                正在加载更多项目…
              </p>
            ) : typeof IntersectionObserver === 'undefined' ? (
              <button type="button" onClick={loadMore}>
                加载更多
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      {settingsTarget && settingsTarget.ws === Number(workspaceId) && settingsTarget.userId === currentUserId && (
        <CanvasSettingsDialog
          key={`${settingsTarget.ws}:${currentUserId}:${settingsTarget.id}`}
          workspaceId={settingsTarget.ws}
          canvasId={settingsTarget.id}
          currentUserId={currentUserId}
          onClose={() => setSettingsTarget(null)}
          onSaved={(changes) => {
            setRecent((items) => items.map((item) => (item.id === settingsTarget.id ? { ...item, ...changes } : item)))
          }}
        />
      )}
      {renameTarget &&
        createPortal(
          <div
            className={styles.renameBackdrop}
            onMouseDown={(event) => event.target === event.currentTarget && !saving && setRenameTarget(null)}
          >
            <section className={styles.renameDialog} role="dialog" aria-modal="true" aria-label="重命名画布">
              <h2>重命名画布</h2>
              <input
                autoFocus
                maxLength={80}
                aria-label="画布名称"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void handleRename()}
              />
              <div>
                <button type="button" disabled={saving} onClick={() => setRenameTarget(null)}>
                  取消
                </button>
                <button type="button" disabled={saving || !renameName.trim()} onClick={() => void handleRename()}>
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </section>
  )
}
