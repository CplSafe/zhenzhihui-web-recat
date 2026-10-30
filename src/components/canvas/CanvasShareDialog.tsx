/**
 * 画布分享弹窗：查看当前分享状态、生成/重新生成链接、复制、关闭分享。
 *
 * 状态一律以后端为准（打开即拉一次 GET），不在前端缓存「已分享」这类判断——
 * 同一个画布可能在别的设备上已经被关掉分享了，前端记住的旧 token 会让用户
 * 把一条打不开的链接发出去。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './CanvasShareDialog.module.css'
import {
  buildCanvasShareUrl,
  createCanvasShare,
  deleteCanvasShare,
  getCanvasShare,
  type CanvasShareState,
} from '@/api/canvasShare'

interface CanvasShareDialogProps {
  workspaceId: number
  canvasId: number
  onClose: () => void
  /** 复制成功/失败等提示交给画布页统一的 toast，弹窗自己不造轮子。 */
  onToast?: (message: string, type?: 'success' | 'error') => void
}

/** 把后端的时间字符串转成本地可读文案；解析不了就原样显示，不吞掉信息。 */
function formatExpiry(expiresAt: string): string {
  if (!expiresAt) return '长期有效'
  const time = new Date(expiresAt)
  if (Number.isNaN(time.getTime())) return expiresAt
  return `${time.toLocaleString()} 到期`
}

export default function CanvasShareDialog({ workspaceId, canvasId, onClose, onToast }: CanvasShareDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        ) || [],
      )
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('keydown', keyboard, true)
      previous?.focus()
    }
  }, [])
  const [share, setShare] = useState<CanvasShareState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expiryDays, setExpiryDays] = useState('7')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setShare(await getCanvasShare({ workspaceId, canvasId }))
    } catch (err) {
      // 查询失败不能等同于未分享，否则用户会误点重新生成，让已有链接失效。
      setShare(null)
      setError(String((err as Error)?.message || '分享状态读取失败'))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, canvasId])

  useEffect(() => {
    void load()
  }, [load])

  const shareUrl = share ? buildCanvasShareUrl(share) : ''
  const hasShare = Boolean(shareUrl)

  const handleCreate = async () => {
    setBusy(true)
    setError('')
    try {
      const expiresAt = expiryDays ? new Date(Date.now() + Number(expiryDays) * 24 * 60 * 60 * 1000).toISOString() : ''
      const next = await createCanvasShare({ workspaceId, canvasId, expiresAt })
      setShare(next)
      onToast?.(hasShare ? '已重新生成链接，原链接失效' : '分享已开启', 'success')
    } catch (err) {
      setError(String((err as Error)?.message || '开启分享失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleClose = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteCanvasShare({ workspaceId, canvasId })
      setShare({ token: '', url: '', expiresAt: '', status: '' })
      onToast?.('分享已关闭', 'success')
    } catch (err) {
      setError(String((err as Error)?.message || '关闭分享失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      onToast?.('链接已复制', 'success')
    } catch {
      // 剪贴板在非安全上下文（http 局域网调试）里不可用；此时提示用户手动复制，
      // 而不是假装成功——他以为复制到了，粘贴出来却是上一次的内容
      onToast?.('当前环境不支持自动复制，请手动选中链接复制', 'error')
    }
  }

  return (
    <div className={styles.mask} role="dialog" aria-modal="true" aria-label="分享画布" onClick={onClose}>
      <div ref={dialogRef} className={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>分享画布</span>
          <button type="button" className={styles.close} aria-label="关闭分享弹窗" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
              <path d="M5 5L19 19M19 5L5 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className={styles.hint}>
          开启后，任何拿到链接的人都可以只读查看这块画布，无需登录。关闭分享后原链接立即失效。
        </p>

        {loading ? (
          <p className={styles.meta}>读取分享状态中…</p>
        ) : hasShare ? (
          <>
            <div className={styles.linkRow}>
              <input className={styles.link} readOnly value={shareUrl} aria-label="分享链接" />
              <button type="button" className={styles.copy} onClick={handleCopy} disabled={!shareUrl}>
                复制
              </button>
            </div>
            <p className={styles.meta}>{formatExpiry(share.expiresAt)}</p>
          </>
        ) : share ? (
          <p className={styles.meta}>这块画布还没有分享链接。</p>
        ) : null}

        {!loading && share && !hasShare && (
          <label className={styles.expiryRow}>
            <span>链接有效期</span>
            <select
              aria-label="分享链接有效期"
              className={styles.expirySelect}
              value={expiryDays}
              onChange={(event) => setExpiryDays(event.target.value)}
              disabled={busy}
            >
              <option value="1">1 天</option>
              <option value="7">7 天（默认）</option>
              <option value="30">30 天</option>
              <option value="">长期有效</option>
            </select>
          </label>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          {!loading && !share ? (
            <button type="button" className={styles.primary} onClick={() => void load()}>
              重新读取分享状态
            </button>
          ) : (
            <button type="button" className={styles.primary} onClick={handleCreate} disabled={busy || loading}>
              {hasShare ? '重新生成链接' : '生成链接'}
            </button>
          )}
          {hasShare && (
            <button type="button" className={styles.danger} onClick={handleClose} disabled={busy}>
              关闭分享
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
