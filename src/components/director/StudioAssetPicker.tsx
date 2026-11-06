import { useEffect, useRef, useState } from 'react'
import { Dialog } from './StudioCards'
import type { StudioAPI, StudioAttachment } from './studio'
import styles from './DeepAgentStudio.module.css'

interface LibraryAsset {
  id: number
  name: string
  type: string
}
interface LibraryPage {
  items: LibraryAsset[]
  total: number
}

/** Selection registers existing IDs; upload and paid generation are separate operations. */
export function StudioAssetPicker({
  api,
  remaining,
  onSelect,
  onClose,
}: {
  api: StudioAPI
  remaining: number
  onSelect: (items: StudioAttachment[]) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState('image')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<LibraryPage>({ items: [], total: 0 })
  const [selected, setSelected] = useState<LibraryAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = useRef<AbortController | null>(null)
  useEffect(() => () => submit.current?.abort(), [])
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError('')
    setPage({ items: [], total: 0 })
    api
      .request<LibraryPage>(`/api/library?type=${kind}&offset=${offset}`, undefined, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setPage(value)
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '素材加载失败')
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [api, kind, offset])
  async function confirm() {
    if (submit.current || !selected.length) return
    const abort = new AbortController()
    submit.current = abort
    setBusy(true)
    setError('')
    try {
      const result = await api.request<{ attachments: StudioAttachment[] }>(
        '/api/attachments/library',
        { asset_ids: selected.map((item) => item.id) },
        abort.signal,
      )
      if (!abort.signal.aborted) onSelect(result.attachments)
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '素材添加失败')
    } finally {
      if (!abort.signal.aborted) {
        submit.current = null
        setBusy(false)
      }
    }
  }
  return (
    <Dialog title="从素材库选择" error={error} onClose={onClose}>
      <div className={styles.tabs}>
        {[
          ['image', '图片'],
          ['video', '视频'],
          ['audio', '音频'],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            disabled={busy}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value)
              setOffset(0)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? (
        <p role="status">正在加载素材…</p>
      ) : (
        <div className={styles.optionList}>
          {!page.items.length && !error && <p>暂无可用素材</p>}
          {page.items.map((item) => {
            const checked = selected.some((s) => s.id === item.id)
            return (
              <button
                type="button"
                key={item.id}
                aria-pressed={checked}
                disabled={busy || (!checked && selected.length >= remaining)}
                onClick={() => setSelected((old) => (checked ? old.filter((s) => s.id !== item.id) : [...old, item]))}
              >
                <strong>{item.name || '未命名素材'}</strong>
                <span>{checked ? '已选择' : '选择'}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          disabled={loading || busy || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          上一页
        </button>
        <button
          type="button"
          disabled={loading || busy || offset + 30 >= page.total}
          onClick={() => setOffset(offset + 30)}
        >
          下一页
        </button>
        <button type="button" disabled={busy || !selected.length} onClick={() => void confirm()}>
          {busy ? '正在添加…' : `添加所选素材（${selected.length}）`}
        </button>
      </div>
    </Dialog>
  )
}
