/**
 * 无限画布列表页
 *
 * 页面效果：展示当前工作空间的无限画布列表，支持新建、删除画布，
 * 点击画布卡片进入 /canvas/:id 编辑器。
 * 数据源：/api/v1/canvases 的 list / create / delete 接口（canvasApi）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '@/styles/project-management.css'
import './CanvasListView.css'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { getBusinessErrorMessage } from '@/api/business'
import { createCanvas, deleteCanvas, listCanvases, patchCanvas, type CanvasSummary } from '@/api/canvasApi'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useWorkspaceId } from '@/stores/workspaceSession'

/** 时间字段 → 可读格式（yyyy-MM-dd HH:mm），非法/缺失返回空串。 */
function formatTime(value?: string): string {
  if (!value) return ''
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`
}

/** 无限画布列表页主组件。 */
export default function CanvasListView() {
  const navigate = useNavigate()
  const handleNavigate = useSidebarNavigate()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const workspaceId = useWorkspaceId()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [canvases, setCanvases] = useState<CanvasSummary[]>([])
  // 数据归属 workspace 校验：切换空间期间不短暂显示上一个空间的画布
  const [canvasesWorkspaceId, setCanvasesWorkspaceId] = useState(0)
  const canvasesWorkspaceIdRef = useRef(0)
  const workspaceIdRef = useRef(0)
  const loadSequenceRef = useRef(0)
  const [openMenuId, setOpenMenuId] = useState(0)
  const [deletingId, setDeletingId] = useState(0)
  const [creating, setCreating] = useState(false)
  // 新建画布弹窗：可输入画布名称
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  // 编辑画布弹窗：重命名 + 状态（活动/归档）
  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CanvasSummary | null>(null)
  const [editName, setEditName] = useState('')
  const [editStatus, setEditStatus] = useState<'active' | 'archived'>('active')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    workspaceIdRef.current = Number(workspaceId || 0)
  }, [workspaceId])

  const activeWsId = Number(workspaceId || 0)
  const effectiveCanvases = canvasesWorkspaceId === activeWsId ? canvases : []

  // 拉取画布列表；请求序号 + workspace 快照共同阻止过期响应覆盖当前页面
  const loadCanvases = useCallback(async () => {
    const wsId = Number(workspaceIdRef.current || 0)
    const seq = ++loadSequenceRef.current
    const isCurrent = () => seq === loadSequenceRef.current && Number(workspaceIdRef.current || 0) === wsId
    if (!wsId) {
      canvasesWorkspaceIdRef.current = 0
      setCanvases([])
      setCanvasesWorkspaceId(0)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const items = await listCanvases({ workspaceId: wsId })
      if (!isCurrent()) return
      canvasesWorkspaceIdRef.current = wsId
      setCanvases(Array.isArray(items) ? items : [])
      setCanvasesWorkspaceId(wsId)
    } catch (error) {
      if (isCurrent()) {
        canvasesWorkspaceIdRef.current = wsId
        setCanvases([])
        setCanvasesWorkspaceId(wsId)
        showToast(getBusinessErrorMessage(error, '画布列表加载失败,请稍后重试'), 'error')
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [showToast])

  // workspace 切换时重置并重新加载
  useEffect(() => {
    loadSequenceRef.current += 1
    canvasesWorkspaceIdRef.current = 0
    setCanvases([])
    setCanvasesWorkspaceId(0)
    setOpenMenuId(0)
    setDeletingId(0)
    loadCanvases()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // 点击菜单外部关闭
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (openMenuId && !target.closest('.cl-menu-btn')) setOpenMenuId(0)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [openMenuId])

  // 新建画布：使用弹窗中输入的名称创建，成功后直接进入编辑器
  const handleCreate = useCallback(async () => {
    const wsId = Number(workspaceIdRef.current || 0)
    if (!wsId) {
      showToast('workspace_id 缺失,无法创建', 'error')
      return
    }
    if (creating) return
    const title = newName.trim()
    if (!title) {
      showToast('请输入画布名称', 'info')
      return
    }
    setCreating(true)
    try {
      const created = await createCanvas({ workspaceId: wsId, title })
      const newId = Number(created?.id || 0)
      if (Number(workspaceIdRef.current || 0) !== wsId) return
      if (!newId) throw new Error('创建画布失败')
      showToast('画布已创建', 'success')
      setCreateOpen(false)
      setNewName('')
      navigate(`/canvas/${newId}`)
    } catch (error) {
      if (Number(workspaceIdRef.current || 0) === wsId) {
        showToast(getBusinessErrorMessage(error, '创建失败,请稍后重试'), 'error')
      }
    } finally {
      setCreating(false)
    }
  }, [creating, newName, navigate, showToast])

  // 关闭新建弹窗：同时清空输入框，避免下次打开残留上次内容
  const closeCreateModal = useCallback(() => {
    setCreateOpen(false)
    setNewName('')
  }, [])

  useEffect(() => {
    if (!createOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) closeCreateModal()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeCreateModal, createOpen, creating])

  // 打开编辑弹窗：预填当前画布名称与状态
  const openEditModal = useCallback((item: CanvasSummary) => {
    setOpenMenuId(0)
    setEditTarget(item)
    setEditName(item.title || '')
    setEditStatus(item.status === 'archived' ? 'archived' : 'active')
    setEditOpen(true)
  }, [])

  // 关闭编辑弹窗：清空状态
  const closeEditModal = useCallback(() => {
    if (editing) return
    setEditOpen(false)
    setEditTarget(null)
    setEditName('')
    setEditStatus('active')
  }, [editing])

  // 保存编辑：调用 PATCH /canvases/{id} 更新画布标题与状态
  const handleEdit = useCallback(async () => {
    const wsId = Number(workspaceIdRef.current || 0)
    if (!wsId || !editTarget?.id) {
      showToast('workspace_id 缺失,无法编辑', 'error')
      return
    }
    if (editing) return
    // 名称与状态都未变化时直接关闭，不发无意义请求
    const title = editName.trim()
    const statusChanged = editStatus !== (editTarget.status === 'archived' ? 'archived' : 'active')
    const titleChanged = !!title && title !== (editTarget.title || '')
    if (!titleChanged && !statusChanged) {
      closeEditModal()
      return
    }
    setEditing(true)
    try {
      await patchCanvas({
        workspaceId: wsId,
        canvasId: editTarget.id,
        ...(titleChanged ? { title } : {}),
        ...(statusChanged ? { status: editStatus } : {}),
      })
      if (Number(workspaceIdRef.current || 0) !== wsId) return
      // 更新列表中的画布标题与状态
      setCanvases((prev) =>
        prev.map((c) =>
          Number(c?.id || 0) === editTarget.id
            ? { ...c, ...(titleChanged ? { title } : {}), ...(statusChanged ? { status: editStatus } : {}) }
            : c,
        ),
      )
      showToast('画布已更新', 'success')
      // 直接清状态关闭（此处 editing 仍为 true，不走 closeEditModal 的守卫）
      setEditOpen(false)
      setEditTarget(null)
      setEditName('')
      setEditStatus('active')
    } catch (error) {
      if (Number(workspaceIdRef.current || 0) === wsId) {
        showToast(getBusinessErrorMessage(error, '更新失败,请稍后重试'), 'error')
      }
    } finally {
      setEditing(false)
    }
  }, [editTarget, editName, editStatus, editing, closeEditModal, showToast])

  // 删除画布：二次确认后调用接口
  const handleDelete = useCallback(
    async (item: CanvasSummary) => {
      const wsId = Number(workspaceIdRef.current || 0)
      if (!item?.id || !wsId) {
        showToast('workspace_id 缺失,无法删除', 'error')
        return
      }
      if (deletingId) return
      setOpenMenuId(0)
      const confirmed = await requestConfirm(`确定删除画布「${item.title || '未命名画布'}」吗?画布内容不可恢复。`)
      if (!confirmed) return
      if (Number(workspaceIdRef.current || 0) !== wsId) return
      setDeletingId(item.id)
      try {
        await deleteCanvas({ workspaceId: wsId, canvasId: item.id })
        if (Number(workspaceIdRef.current || 0) !== wsId) return
        loadSequenceRef.current += 1
        setLoading(false)
        if (canvasesWorkspaceIdRef.current === wsId) {
          setCanvases((prev) => prev.filter((c) => Number(c?.id || 0) !== item.id))
        }
        // 删除画布后清理本机遗留：该画布的本地草稿 + 无 id 入口遗留的画布 id 记录，
        // 避免残留记录导致误恢复/误新建重复画布
        try {
          localStorage.removeItem(`zzh_canvas_draft_p${item.id}`)
        } catch {
          // 忽略清理失败
        }
        showToast('画布已删除', 'success')
      } catch (error) {
        if (Number(workspaceIdRef.current || 0) === wsId) {
          showToast(getBusinessErrorMessage(error, '删除失败,请稍后重试'), 'error')
        }
      } finally {
        setDeletingId(0)
      }
    },
    [deletingId, requestConfirm, showToast],
  )

  // 打开画布编辑器
  const openCanvas = useCallback(
    (item: CanvasSummary) => {
      if (!item?.id) return
      navigate(`/canvas/${item.id}`)
    },
    [navigate],
  )

  return (
    <div
      className="pm2-page"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', overflow: 'hidden' }}
    >
      <AppSidebar
        activeKey="canvas"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div
        className="pm2-shell"
        style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        <section
          className="pm2-main"
          aria-label="无限画布"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 36px 56px' }}
        >
          {/* 头部：标题 + 新建 */}
          <div className="pm2-head">
            <div className="pm2-head-titles">
              <h1 className="pm2-head-title">无限画布</h1>
              <p className="pm2-head-sub">用节点与连线组织 AI 生成流程</p>
            </div>
            <div className="pm2-head-actions">
              <button type="button" className="pm2-new-btn" onClick={() => setCreateOpen(true)}>
                ＋ 新建画布
              </button>
            </div>
          </div>

          {/* 画布卡片网格 */}
          <section className="pm2-section">
            {loading && !effectiveCanvases.length ? (
              <div className="pm2-hint">正在加载画布…</div>
            ) : !effectiveCanvases.length ? (
              <div className="pm2-hint">还没有画布，点右上角「新建画布」开始</div>
            ) : (
              <div className="pm2-card-grid">
                {effectiveCanvases.map((item) => (
                  <div
                    key={item.id}
                    className="pm2-pcard"
                    role="button"
                    tabIndex={0}
                    aria-label={`打开画布 ${item.title || '未命名画布'}`}
                    onClick={() => openCanvas(item)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      openCanvas(item)
                    }}
                  >
                    <div className="pm2-pcard-cover">
                      <span className="cl-cover" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                          <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
                          <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
                          <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
                          <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
                        </svg>
                      </span>
                    </div>
                    <div className="pm2-pcard-body">
                      <div className="pm2-pcard-head">
                        <span className="pm2-pcard-title" title={item.title || '未命名画布'}>
                          {item.title || '未命名画布'}
                        </span>
                        {item.status === 'archived' && (
                          <span className="cl-status-badge" title="已归档">
                            归档
                          </span>
                        )}
                        <button
                          type="button"
                          className="pm2-pcard-more cl-menu-btn"
                          aria-label="更多操作"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenMenuId((prev) => (prev === item.id ? 0 : Number(item.id)))
                          }}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true" width="18" height="18">
                            <circle cx="4" cy="10" r="1.4" fill="currentColor" />
                            <circle cx="10" cy="10" r="1.4" fill="currentColor" />
                            <circle cx="16" cy="10" r="1.4" fill="currentColor" />
                          </svg>
                          {openMenuId === item.id && (
                            <div className="pm2-folder-menu" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="pm2-folder-menu-item"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openEditModal(item)
                                }}
                              >
                                编辑画布
                              </button>
                              <button
                                type="button"
                                className="pm2-folder-menu-item is-danger"
                                disabled={deletingId === item.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDelete(item)
                                }}
                              >
                                {deletingId === item.id ? '删除中…' : '删除画布'}
                              </button>
                            </div>
                          )}
                        </button>
                      </div>
                      <div className="pm2-pcard-meta">
                        <span className="pm2-pcard-time">
                          {item.updated_at ? `更新于 ${formatTime(item.updated_at)}` : '暂无更新'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>

      {/* 创建画布：只收集名称，创建成功后进入空白画布自由添加节点。 */}
      {createOpen && (
        <div className="cl-brief-mask" onClick={() => !creating && closeCreateModal()}>
          <section
            className="cl-brief-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-brief-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="cl-brief-head">
              <div>
                <span className="cl-brief-kicker">创意画布</span>
                <h2 id="canvas-brief-title">创建新画布</h2>
                <p>为画布起一个便于识别的名称，创建后即可自由添加文本、图片和视频。</p>
              </div>
              <button
                type="button"
                className="cl-brief-close"
                aria-label="关闭"
                disabled={creating}
                onClick={closeCreateModal}
              >
                ×
              </button>
            </header>

            <div className="cl-brief-content">
              <label className="cl-brief-name">
                <span>画布名称</span>
                <input
                  value={newName}
                  autoFocus
                  maxLength={60}
                  placeholder="请输入画布名称"
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && newName.trim() && !creating) void handleCreate()
                  }}
                />
                <small>{newName.length}/60</small>
              </label>
            </div>

            <footer className="cl-brief-foot">
              <button type="button" className="cl-brief-cancel" disabled={creating} onClick={closeCreateModal}>
                取消
              </button>
              <button type="button" disabled={creating || !newName.trim()} onClick={handleCreate}>
                {creating ? '正在创建…' : '创建画布'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {/* 编辑画布弹窗：重命名画布 */}
      {editOpen && editTarget && (
        <div className="pm2-modal-mask" onClick={() => !editing && closeEditModal()}>
          <div className="pm2-modal" role="dialog" aria-label="编辑画布" onClick={(e) => e.stopPropagation()}>
            <div className="pm2-modal-head">
              编辑画布
              <button type="button" className="pm2-modal-close" aria-label="关闭" onClick={closeEditModal}>
                ×
              </button>
            </div>
            <div className="pm2-modal-body">
              <label className="pm2-modal-label">画布名称</label>
              <input
                className="pm2-modal-input"
                value={editName}
                placeholder="输入画布名称"
                autoFocus
                maxLength={60}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !editing && handleEdit()}
              />
              <label className="pm2-modal-label cl-edit-status-label">画布状态</label>
              <div className="cl-edit-status">
                <button
                  type="button"
                  className={`cl-edit-status__item${editStatus === 'active' ? ' is-active' : ''}`}
                  onClick={() => setEditStatus('active')}
                >
                  <span className="cl-edit-status__dot is-active-dot" aria-hidden="true" />
                  活动
                </button>
                <button
                  type="button"
                  className={`cl-edit-status__item${editStatus === 'archived' ? ' is-active' : ''}`}
                  onClick={() => setEditStatus('archived')}
                >
                  <span className="cl-edit-status__dot is-archive-dot" aria-hidden="true" />
                  归档
                </button>
              </div>
            </div>
            <div className="pm2-modal-foot">
              <button type="button" className="pm2-modal-btn" disabled={editing} onClick={closeEditModal}>
                取消
              </button>
              <button
                type="button"
                className="pm2-modal-btn pm2-modal-btn--primary"
                disabled={editing}
                onClick={handleEdit}
              >
                {editing ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
