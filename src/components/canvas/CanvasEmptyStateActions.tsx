import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  deleteCanvas,
  duplicateCanvas,
  fetchAllCanvasElements,
  listCanvases,
  patchCanvas,
  type CanvasSummary,
} from '@/api/canvasApi'
import { getBusinessErrorMessage } from '@/api/business'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { pickCanvasCover, type CanvasCover } from '@/utils/canvasCover'
import { buildCanvasCopyTitle } from '@/utils/canvasCopyTitle'
import styles from './CanvasEmptyStateActions.module.css'

type Action = {
  label: string
  description: string
  icon: ReactNode
  onClick: () => void
}

export default function CanvasEmptyStateActions() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const currentUserId = Number(resolveUserId(useCurrentUser()) || 0)
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const [recent, setRecent] = useState<CanvasSummary[]>([])
  const [covers, setCovers] = useState<Record<number, CanvasCover | null>>({})
  const [loading, setLoading] = useState(false)
  const [openMenuId, setOpenMenuId] = useState(0)
  const [renameTarget, setRenameTarget] = useState<CanvasSummary | null>(null)
  const [renameName, setRenameName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(0)
  const [duplicatingId, setDuplicatingId] = useState(0)
  const duplicateBusy = useRef(false)
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  useEffect(() => {
    if (!workspaceId) {
      setRecent([])
      setCovers({})
      return
    }
    let cancelled = false
    const wsId = Number(workspaceId)
    setLoading(true)
    setCovers({})
    void listCanvases({ workspaceId: wsId, includeArchived: true, limit: 100, offset: 0 })
      .then((items) => {
        if (cancelled) return
        const latest = [...items]
          .sort((a, b) => {
            const date = (item: CanvasSummary) =>
              new Date(item.updated_at || item.created_at || '').getTime() || item.id
            return date(b) - date(a)
          })
          .slice(0, 10)
        setRecent(latest)

        // 与画布列表共用封面解析：从每张画布最新的图片/视频节点生成稳定预览地址。
        // 最近项目最多 10 张，限制为 3 路并发，避免空状态一次性打满元素接口。
        void (async () => {
          const queue = [...latest]
          const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
            while (!cancelled && queue.length) {
              const item = queue.shift()
              if (!item) continue
              try {
                const page = await fetchAllCanvasElements({
                  workspaceId: wsId,
                  canvasId: Number(item.id),
                  afterRevision: 0,
                })
                if (cancelled) return
                setCovers((current) => ({
                  ...current,
                  [Number(item.id)]: pickCanvasCover(page.elements, wsId),
                }))
              } catch {
                if (!cancelled) setCovers((current) => ({ ...current, [Number(item.id)]: null }))
              }
            }
          })
          await Promise.all(workers)
        })()
      })
      .catch(() => {
        if (!cancelled) setRecent([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])
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
      setRecent((items) => items.map((item) => (item.id === renameTarget.id ? { ...item, title } : item)))
      showToast('画布已重命名', 'success')
      setRenameTarget(null)
    } catch (error) {
      showToast(getBusinessErrorMessage(error, '重命名失败,请稍后重试'), 'error')
    } finally {
      setSaving(false)
    }
  }
  const handleDelete = async (item: CanvasSummary) => {
    const wsId = Number(workspaceId || 0)
    if (!wsId || !item.id || deletingId) return
    setOpenMenuId(0)
    if (!(await requestConfirm(`确定删除画布「${item.title || '未命名画布'}」吗?画布内容不可恢复。`))) return
    setDeletingId(item.id)
    try {
      await deleteCanvas({ workspaceId: wsId, canvasId: item.id })
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
      showToast(getBusinessErrorMessage(error, '删除失败,请稍后重试'), 'error')
    } finally {
      setDeletingId(0)
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
      if (Number(workspaceIdRef.current) !== wsId) return
      setRecent((items) =>
        [
          {
            ...created,
            title: created.title || title,
            userId: created.userId || currentUserId || undefined,
            updated_at: created.updated_at || new Date().toISOString(),
          },
          ...items,
        ].slice(0, 10),
      )
      setCovers((current) => ({ ...current, [created.id]: current[item.id] ?? null }))
      showToast(`已创建副本「${title}」`, 'success')
    } catch (error) {
      if (Number(workspaceIdRef.current) === wsId)
        showToast(getBusinessErrorMessage(error, '创建副本失败,请稍后重试'), 'error')
    } finally {
      duplicateBusy.current = false
      setDuplicatingId(0)
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
          <p className={styles.recentHint}>正在加载项目…</p>
        ) : recent.length ? (
          <div className={styles.recentGrid}>
            {recent.map((item) => (
              <div
                role="button"
                tabIndex={0}
                key={item.id}
                className={styles.projectCard}
                aria-label={`打开画布 ${item.title || '未命名画布'}`}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return
                  navigate(`/canvas/${item.id}`)
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                  event.preventDefault()
                  navigate(`/canvas/${item.id}`)
                }}
              >
                <span className={styles.projectCover} aria-hidden="true">
                  {covers[Number(item.id)] ? (
                    covers[Number(item.id)]!.kind === 'video' ? (
                      <video
                        className={styles.projectCoverMedia}
                        src={covers[Number(item.id)]!.url}
                        preload="metadata"
                        muted
                        playsInline
                        onError={() => setCovers((current) => ({ ...current, [Number(item.id)]: null }))}
                      />
                    ) : (
                      <img
                        className={styles.projectCoverMedia}
                        src={covers[Number(item.id)]!.url}
                        alt=""
                        loading="lazy"
                        onError={() => setCovers((current) => ({ ...current, [Number(item.id)]: null }))}
                      />
                    )
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none">
                        <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
                        <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
                        <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
                        <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
                      </svg>
                      <span>{covers[Number(item.id)] === null ? '暂无预览' : '正在加载预览…'}</span>
                    </>
                  )}
                </span>
                <span className={styles.projectActions} data-recent-canvas-menu>
                  <button
                    type="button"
                    aria-label={`画布操作 ${item.title || '未命名画布'}`}
                    aria-expanded={openMenuId === item.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenMenuId((id) => (id === item.id ? 0 : item.id))
                    }}
                  >
                    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                      <circle cx="4" cy="10" r="1.4" fill="currentColor" />
                      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
                      <circle cx="16" cy="10" r="1.4" fill="currentColor" />
                    </svg>
                  </button>
                  {openMenuId === item.id && (
                    <span className={styles.projectMenu} onClick={(event) => event.stopPropagation()}>
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
                        <button type="button" disabled={deletingId === item.id} onClick={() => void handleDelete(item)}>
                          {deletingId === item.id ? '删除中…' : '删除画布'}
                        </button>
                      )}
                    </span>
                  )}
                </span>
                <span className={styles.projectBody}>
                  <strong title={item.title || '未命名画布'}>{item.title || '未命名画布'}</strong>
                  <small>
                    更新于{' '}
                    {item.updated_at || item.created_at
                      ? new Date(item.updated_at || item.created_at || '').toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '时间未知'}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.recentHint}>暂无历史项目</p>
        )}
      </section>
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
