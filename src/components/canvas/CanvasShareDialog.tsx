/**
 * 画布分享弹窗：查看当前分享状态、生成/重新生成链接、复制、关闭分享。
 *
 * 状态一律以后端为准（打开即拉一次 GET），不在前端缓存「已分享」这类判断——
 * 同一个画布可能在别的设备上已经被关掉分享了，前端记住的旧 token 会让用户
 * 把一条打不开的链接发出去。
 */
import { useCallback, useEffect, useState } from 'react'
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
  const [share, setShare] = useState<CanvasShareState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setShare(await getCanvasShare({ workspaceId, canvasId }))
    } catch (err) {
      // 「还没开启分享」在后端可能就是一个 404/业务错误，这里不把它当致命错误吞掉整个弹窗，
      // 而是显示为未分享 + 错误说明，用户仍可以点「生成链接」
      setShare({ token: '', url: '', expiresAt: '', status: '' })
      setError(String((err as Error)?.message || '分享状态读取失败'))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, canvasId])

  useEffect(() => {
    void load()
  }, [load])

  const shareUrl = share ? buildCanvasShareUrl(share) : ''

  const handleCreate = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await createCanvasShare({ workspaceId, canvasId })
      setShare(next)
      onToast?.(share?.token ? '已重新生成链接，原链接失效' : '分享已开启', 'success')
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
      <div className={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>分享画布</span>
          <button type="button" className={styles.close} aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <p className={styles.hint}>
          开启后，任何拿到链接的人都可以只读查看这块画布，无需登录。关闭分享后原链接立即失效。
        </p>

        {loading ? (
          <p className={styles.meta}>读取分享状态中…</p>
        ) : share?.token ? (
          <>
            <div className={styles.linkRow}>
              <input className={styles.link} readOnly value={shareUrl} aria-label="分享链接" />
              <button type="button" className={styles.copy} onClick={handleCopy} disabled={!shareUrl}>
                复制
              </button>
            </div>
            <p className={styles.meta}>{formatExpiry(share.expiresAt)}</p>
          </>
        ) : (
          <p className={styles.meta}>这块画布还没有分享链接。</p>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={handleCreate} disabled={busy || loading}>
            {share?.token ? '重新生成链接' : '生成链接'}
          </button>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            完成
          </button>
          {share?.token && (
            <button type="button" className={styles.danger} onClick={handleClose} disabled={busy}>
              关闭分享
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
