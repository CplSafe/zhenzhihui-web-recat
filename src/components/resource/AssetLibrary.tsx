import { useEffect, useState, type FormEvent } from 'react'
import { Button, Empty, Modal, Skeleton } from 'antd'
import {
  imageCategories,
  listAssetLibrary,
  removeAssetLibraryEntry,
  saveAssetLibraryEntry,
  type LibraryCategory,
  type LibraryEntry,
  type LibraryType,
} from '@/api/assetLibrary'
import { getBusinessErrorMessage } from '@/api/business'
import { useCurrentMember, useCurrentWorkspace } from '@/stores/workspaceSession'
import { assetStreamUrl } from '@/utils/assetUrl'
import { listAssetPage } from '@/utils/businessPagination'
import { resolveWorkspaceRole } from '@/utils/creativeDraftMetadata'
import './AssetLibrary.css'

type Editor = { entry?: LibraryEntry }

function AssetLibraryEditor({
  workspaceId,
  type,
  category,
  entry,
  onClose,
  onSaved,
}: {
  workspaceId: number
  type: LibraryType
  category: LibraryCategory
  entry?: LibraryEntry
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(entry?.name ?? '')
  const [selectedCategory, setSelectedCategory] = useState<LibraryCategory>(entry?.category ?? category)
  const [assetId, setAssetId] = useState(0)
  const [choices, setChoices] = useState<{ id: number; name: string }[]>([])
  const [request, setRequest] = useState({ offset: 0 })
  const [nextOffset, setNextOffset] = useState(0)
  const [loading, setLoading] = useState(!entry)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (entry) return
    let current = true
    void listAssetPage({ workspaceId, type, offset: request.offset, pageSize: 30, isCurrent: () => current })
      .then((page) => {
        if (!current) return
        const available = page.items
          .filter((item) => item.source === 'upload' || item.source === 'generated')
          .map((item) => ({ id: Number(item.id), name: String(item.name) }))
        setChoices((previous) => {
          const merged = new Map(previous.map((item) => [item.id, item]))
          available.forEach((item) => merged.set(item.id, item))
          return Array.from(merged.values())
        })
        setNextOffset(page.hasMore ? page.nextOffset : 0)
      })
      .catch((err: unknown) => {
        if (!current) return
        setLoadError(getBusinessErrorMessage(err, '原素材加载失败，请重试'))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [entry, request, type, workspaceId])

  function loadMore() {
    setRequest({ offset: loadError ? request.offset : nextOffset })
    setLoadError('')
    setLoading(true)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || (!entry && !assetId) || (type === 'image' && !selectedCategory)) return
    setSaving(true)
    setError('')
    try {
      await saveAssetLibraryEntry(
        workspaceId,
        { name: name.trim(), category: selectedCategory },
        entry ? { entryId: entry.id } : { assetId },
      )
      onSaved()
    } catch (err) {
      setError(getBusinessErrorMessage(err, '保存资产失败，请重试'))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={entry ? '编辑资产' : '添加已有素材'}
      open
      footer={null}
      onCancel={onClose}
      closable={!saving}
      keyboard={!saving}
      maskClosable={!saving}
    >
      <form className="asset-library-form" onSubmit={submit}>
        {!entry && (
          <>
            <label>
              原素材
              <select required value={assetId || ''} onChange={(event) => setAssetId(Number(event.target.value))}>
                <option value="" disabled>
                  {loading && !choices.length ? '正在加载素材…' : '请选择已有素材'}
                </option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name}（#{choice.id}）
                  </option>
                ))}
              </select>
            </label>
            {loadError && <p role="alert">{loadError}</p>}
            {!loading && !loadError && !choices.length && !nextOffset && <p>当前空间还没有可入库的素材。</p>}
            {(nextOffset > 0 || loadError) && (
              <Button htmlType="button" onClick={loadMore} loading={loading}>
                {loadError ? '重试加载素材' : '加载更多素材'}
              </Button>
            )}
          </>
        )}
        <label>
          资产名称
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={255}
            placeholder={entry ? undefined : '留空时使用原素材名称'}
            required={Boolean(entry)}
          />
        </label>
        {type === 'image' && (
          <label>
            图片分类
            <select
              required
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value as LibraryCategory)}
            >
              <option value="" disabled>
                请选择图片分类
              </option>
              {imageCategories.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="asset-library-actions">
          <Button htmlType="button" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function AssetLibraryResults({
  workspaceId,
  type,
  category,
  canManage,
  onEdit,
  onRemove,
}: {
  workspaceId: number
  type: LibraryType
  category: LibraryCategory
  canManage: boolean
  onEdit: (entry: LibraryEntry) => void
  onRemove: (entry: LibraryEntry) => void
}) {
  const [items, setItems] = useState<LibraryEntry[]>([])
  const [nextCursor, setNextCursor] = useState(0)
  const [request, setRequest] = useState({ cursor: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void listAssetLibrary(workspaceId, type, category, request.cursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setItems((previous) => (request.cursor ? [...previous, ...page.items] : page.items))
        setNextCursor(page.next_cursor ?? 0)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(getBusinessErrorMessage(err, '资产库加载失败，请重试'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [category, request, type, workspaceId])

  function load(cursor: number) {
    setError('')
    setLoading(true)
    setRequest({ cursor })
  }

  return (
    <div aria-busy={loading}>
      {items.length > 0 && (
        <ul className="asset-library-grid">
          {items.map((item) => {
            const url = assetStreamUrl(item.asset_id, workspaceId)
            return (
              <li className="asset-library-card" key={item.id}>
                {type === 'image' ? (
                  <img src={url} alt={item.name} loading="lazy" />
                ) : (
                  <audio aria-label={item.name} controls preload="none" src={url} />
                )}
                <div className="asset-library-card-body">
                  <strong>{item.name}</strong>
                  {item.category && <span>{imageCategories.find(({ value }) => value === item.category)?.label}</span>}
                  {canManage && (
                    <div className="asset-library-actions">
                      <Button size="small" onClick={() => onEdit(item)}>
                        编辑
                      </Button>
                      <Button size="small" onClick={() => onRemove(item)}>
                        移除
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {loading && !items.length && <Skeleton active aria-label="正在加载资产库" />}
      {!items.length && !loading && !error && <Empty description="此分类暂无资产" />}
      {error && <p role="alert">{error}</p>}
      {(nextCursor > 0 || error) && (
        <Button loading={loading} onClick={() => load(error ? request.cursor : nextCursor)}>
          {error ? '重试' : '加载更多'}
        </Button>
      )}
    </div>
  )
}

export default function AssetLibrary({ workspaceId }: { workspaceId: number }) {
  const member = useCurrentMember()
  const workspace = useCurrentWorkspace()
  const role = resolveWorkspaceRole(member) || resolveWorkspaceRole(workspace)
  const canManage = role === 'owner' || role === 'admin'
  const [type, setType] = useState<LibraryType>('image')
  const [category, setCategory] = useState<LibraryCategory>('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removing, setRemoving] = useState<LibraryEntry | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)

  async function remove() {
    if (!removing || busy) return
    setBusy(true)
    setRemoveError('')
    try {
      await removeAssetLibraryEntry(workspaceId, removing.id)
      setRemoving(null)
      setRevision((value) => value + 1)
    } catch (err) {
      setRemoveError(getBusinessErrorMessage(err, '移除资产失败，请重试'))
    } finally {
      setBusy(false)
    }
  }

  if (!workspaceId) return <Empty description="请先选择工作空间" />

  return (
    <section aria-label="资产库">
      <div className="asset-library-toolbar">
        <div className="rm2-subs" role="group" aria-label="资产类型">
          {(['image', 'audio'] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              className={`rm2-sub${kind === type ? ' is-active' : ''}`}
              aria-pressed={kind === type}
              onClick={() => {
                setType(kind)
                setCategory('')
              }}
            >
              {kind === 'image' ? '图片' : '音频'}
            </button>
          ))}
        </div>
        {canManage && (
          <Button type="primary" onClick={() => setEditor({})}>
            添加资产
          </Button>
        )}
      </div>
      {type === 'image' && (
        <div className="rm2-subs asset-library-categories" role="group" aria-label="图片分类">
          {[{ value: '' as const, label: '全部图片' }, ...imageCategories].map(({ value, label }) => (
            <button
              type="button"
              key={value}
              className={`rm2-sub${category === value ? ' is-active' : ''}`}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <AssetLibraryResults
        key={`${type}:${category}:${revision}`}
        workspaceId={workspaceId}
        type={type}
        category={category}
        canManage={canManage}
        onEdit={(entry) => setEditor({ entry })}
        onRemove={(entry) => {
          setRemoveError('')
          setRemoving(entry)
        }}
      />
      {editor && (
        <AssetLibraryEditor
          workspaceId={workspaceId}
          type={type}
          category={category}
          entry={editor.entry}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            setRevision((value) => value + 1)
          }}
        />
      )}
      {removing && (
        <Modal
          title="移除资产"
          open
          onCancel={() => setRemoving(null)}
          onOk={() => void remove()}
          okText="移除"
          cancelText="取消"
          confirmLoading={busy}
          closable={!busy}
          maskClosable={!busy}
          keyboard={!busy}
          cancelButtonProps={{ disabled: busy }}
        >
          <p>将“{removing.name}”移出资产库？原素材仍可在已有项目中使用。</p>
          {removeError && <p role="alert">{removeError}</p>}
        </Modal>
      )}
    </section>
  )
}
