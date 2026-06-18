// CreativeDraftHistoryDrawer — 草稿历史抽屉
// 侧边抽屉列出当前项目的所有已保存草稿，支持加载、删除草稿。
import { useEffect, useMemo, useState } from 'react'
import './CreativeDraftHistoryDrawer.css'

type DraftItem = Record<string, any>

interface CreativeDraftHistoryDrawerProps {
  open?: boolean
  loading?: boolean
  deleting?: boolean
  projects?: DraftItem[]
  currentWorkspaceId?: number | string
  currentProjectId?: number | string
  onClose?: () => void
  onSelect?: (item: DraftItem) => void
  onVersions?: (item: DraftItem) => void
  onDelete?: (item: DraftItem) => void
  onDeleteMany?: (items: DraftItem[]) => void
}

export default function CreativeDraftHistoryDrawer({
  open = false,
  loading = false,
  deleting = false,
  projects = [],
  currentWorkspaceId = 0,
  currentProjectId = 0,
  onClose,
  onSelect,
  onVersions,
  onDelete,
  onDeleteMany,
}: CreativeDraftHistoryDrawerProps) {
  const [keyword, setKeyword] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  // 打开时重置内部状态
  useEffect(() => {
    if (!open) return
    setKeyword('')
    setSelecting(false)
    setSelectedKeys(new Set())
  }, [open])

  // Esc 关闭
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose?.()
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  }, [open, onClose])

  function formatTime(value: any): string {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  function isCurrent(item: DraftItem): boolean {
    const ws = Number(item?.workspaceId || 0)
    const pid = Number(item?.id || 0)
    return (
      ws > 0 && pid > 0 && ws === Number(currentWorkspaceId || 0) && pid === Number(currentProjectId || 0)
    )
  }

  function getItemTime(item: DraftItem): number {
    return new Date(item?.updated_at || item?.updatedAt || item?.created_at || item?.createdAt || 0).getTime() || 0
  }

  const filtered = useMemo(() => {
    const list = Array.isArray(projects) ? projects : []
    const k = keyword.trim().toLowerCase()
    const base = k
      ? list.filter((item) => {
          const id = String(item?.id ?? '').toLowerCase()
          const name = String(item?.name ?? item?.title ?? '').toLowerCase()
          const ws = String(item?.workspaceName ?? '').toLowerCase()
          return id.includes(k) || name.includes(k) || ws.includes(k)
        })
      : list.slice()
    return base.slice().sort((a, b) => {
      const ac = isCurrent(a)
      const bc = isCurrent(b)
      if (ac !== bc) return ac ? -1 : 1
      return getItemTime(b) - getItemTime(a) || Number(b?.id || 0) - Number(a?.id || 0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, keyword, currentWorkspaceId, currentProjectId])

  const selectedCount = selectedKeys.size

  function toKey(item: DraftItem): string {
    return `${Number(item?.workspaceId || 0)}-${Number(item?.id || 0)}`
  }

  function isSelected(item: DraftItem): boolean {
    return selectedKeys.has(toKey(item))
  }

  function toggleSelected(item: DraftItem) {
    const key = toKey(item)
    if (!key.endsWith('-0')) {
      if (selectedKeys.has(key)) {
        const next = new Set(selectedKeys)
        next.delete(key)
        setSelectedKeys(next)
        return
      }
      setSelectedKeys(new Set([...selectedKeys, key]))
    }
  }

  function enterBatchDelete() {
    setSelecting(true)
    setSelectedKeys(new Set())
  }

  function cancelBatchDelete() {
    setSelecting(false)
    setSelectedKeys(new Set())
  }

  function toggleAll() {
    const list = filtered
    if (!list.length) return
    if (selectedKeys.size >= list.length) {
      setSelectedKeys(new Set())
      return
    }
    setSelectedKeys(new Set(list.map((item) => toKey(item))))
  }

  function submitBatchDelete() {
    if (!selectedKeys.size || deleting) return
    const list = filtered.filter((item) => selectedKeys.has(toKey(item)))
    cancelBatchDelete()
    onDeleteMany?.(list)
  }

  if (!open) return null

  return (
    <div className="dh-scrim" onClick={() => onClose?.()}>
      <aside
        className="dh-panel"
        role="dialog"
        aria-modal="true"
        aria-label="历史草稿"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dh-head">
          <div className="dh-head-left">
            <strong className="dh-title">历史草稿</strong>
            {selecting && <span className="dh-head-count">已选 {selectedCount}</span>}
          </div>
          <div className="dh-head-actions">
            {!selecting ? (
              <button
                type="button"
                className="dh-head-ghost"
                disabled={loading || deleting}
                onClick={enterBatchDelete}
              >
                批量删除
              </button>
            ) : (
              <>
                <button type="button" className="dh-head-ghost" disabled={loading || deleting} onClick={toggleAll}>
                  {selectedCount && selectedCount >= filtered.length ? '取消全选' : '全选'}
                </button>
                <button
                  type="button"
                  className="dh-head-danger"
                  disabled={!selectedCount || deleting}
                  onClick={submitBatchDelete}
                >
                  删除{selectedCount ? <span>({selectedCount})</span> : null}
                </button>
                <button type="button" className="dh-head-ghost" disabled={deleting} onClick={cancelBatchDelete}>
                  取消
                </button>
              </>
            )}
          </div>
          <button type="button" className="dh-close" aria-label="关闭" onClick={() => onClose?.()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="dh-search">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            type="text"
            disabled={loading}
            placeholder="搜索项目ID/名称/团队"
          />
        </div>

        <section className="dh-body">
          {loading ? (
            <p className="dh-muted">加载中…</p>
          ) : !filtered.length ? (
            <p className="dh-muted">暂无历史草稿</p>
          ) : (
            <ul className="dh-list">
              {filtered.map((item) => (
                <li
                  key={`${item?.workspaceId || 0}-${item?.id || ''}`}
                  className={`dh-item${isCurrent(item) ? ' is-current' : ''}`}
                >
                  <button
                    type="button"
                    className="dh-item-main"
                    onClick={() => (selecting ? toggleSelected(item) : onSelect?.(item))}
                  >
                    <div className="dh-item-title">
                      {selecting && (
                        <span
                          className={`dh-check${isSelected(item) ? ' checked' : ''}`}
                          aria-hidden="true"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSelected(item)
                          }}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M3.2 8.6l2.6 2.7L12.8 4.7" />
                          </svg>
                        </span>
                      )}
                      <strong>{item?.name || item?.title || `项目 #${item?.id || ''}`}</strong>
                      {isCurrent(item) && <span className="dh-tag dh-tag-current">当前</span>}
                      {item?.workspaceName && <span className="dh-tag">{item.workspaceName}</span>}
                    </div>
                    <div className="dh-item-meta">
                      {item?.updated_at || item?.updatedAt ? (
                        <span>{formatTime(item?.updated_at || item?.updatedAt)}</span>
                      ) : item?.created_at || item?.createdAt ? (
                        <span>{formatTime(item?.created_at || item?.createdAt)}</span>
                      ) : null}
                    </div>
                  </button>
                  {!selecting && (
                    <div className="dh-actions">
                      <button type="button" className="dh-open" onClick={() => onSelect?.(item)}>
                        继续编辑
                      </button>
                      <button type="button" className="dh-ghost" onClick={() => onVersions?.(item)}>
                        历史记录
                      </button>
                      <button
                        type="button"
                        className="dh-danger"
                        aria-label="删除草稿"
                        onClick={() => onDelete?.(item)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v9h-2v-9Zm4 0h2v9h-2v-9ZM7 10h2v9H7v-9ZM6 8h12l-1 13H7L6 8Z" />
                        </svg>
                        删除
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  )
}
