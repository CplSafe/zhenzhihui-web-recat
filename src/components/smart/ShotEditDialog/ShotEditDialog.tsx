/**
 * ShotEditDialog — 分镜「编辑 / 新增 / 插入」统一弹框(按 Figma 还原)。
 * 内容:标题 + 分镜图修改描述输入 + 上传素材 + AI一键润色 + 生成分镜。
 *
 * 关键交互(对齐产品逻辑):
 *  - 编辑/新增/插入都把「描述 + 上传素材」交给后端,后端只更新当前这一个分镜;
 *  - 「生成分镜」点击后进入 loading,等后端真正返回成功后才关闭弹框(失败保持打开,可重试)。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '@/composables/useToast'
import styles from './ShotEditDialog.module.less'

export interface ShotEditDialogProps {
  open: boolean
  /** edit=编辑现有分镜;insert=新增/插入分镜 */
  mode: 'edit' | 'insert'
  /** 上传素材:直传后端取 http url + asset_id(失败回退本地 dataURL 由父级处理) */
  onUpload?: (file: File) => Promise<{ url: string; assetId?: number }>
  /** AI一键润色:润色当前描述文本,返回润色后的文本 */
  onPolish?: (text: string, uploadRefUrls: string[]) => Promise<string>
  /** 生成分镜:把描述 + 上传素材 url 交给父级出图;返回 true=成功(随后关闭弹框) */
  onGenerate: (text: string, uploadRefUrls: string[]) => Promise<boolean>
  onClose: () => void
}

export default function ShotEditDialog({ open, mode, onUpload, onPolish, onGenerate, onClose }: ShotEditDialogProps) {
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [uploads, setUploads] = useState<{ url: string; assetId?: number }[]>([])
  const [generating, setGenerating] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // 每次打开重置输入(编辑/插入都从空描述开始,placeholder 提示)
  useEffect(() => {
    if (open) {
      setText('')
      setUploads([])
      setGenerating(false)
      setPolishing(false)
      setUploading(false)
    }
  }, [open])

  if (!open) return null

  const canGenerate = (text.trim().length > 0 || uploads.length > 0) && !generating && !uploading

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length || !onUpload) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        const r = await onUpload(f).catch(() => null)
        if (r?.url) setUploads((prev) => [...prev, { url: r.url, assetId: r.assetId }])
        else showToast('素材上传失败,请重试', 'error')
      }
    } finally {
      setUploading(false)
    }
  }

  const doPolish = async () => {
    if (!onPolish || !text.trim() || polishing) return
    setPolishing(true)
    try {
      // 带上本次上传的素材图 → 润色时 VL 读图理解诉求(如「把产品换成这张图里的」)
      const out = await onPolish(
        text,
        uploads.map((u) => u.url),
      )
      if (out) setText(out)
    } catch (e: any) {
      showToast(`AI 润色失败:${e?.message || '请稍后重试'}`, 'error')
    } finally {
      setPolishing(false)
    }
  }

  const doGenerate = async () => {
    if (!canGenerate) return
    setGenerating(true)
    try {
      const ok = await onGenerate(
        text.trim(),
        uploads.map((u) => u.url),
      )
      if (ok) onClose() // 后端真正返回成功后才关闭
    } finally {
      setGenerating(false)
    }
  }

  return createPortal(
    <div
      className={styles.mask}
      onClick={(e) => {
        // 生成中禁止点遮罩关闭,避免中断
        if (e.target === e.currentTarget && !generating) onClose()
      }}
    >
      <div className={styles.dlg} role="dialog" aria-label={mode === 'insert' ? '新增分镜' : '编辑分镜'}>
        <button type="button" className={styles.x} onClick={onClose} disabled={generating} aria-label="关闭">
          ×
        </button>

        <h2 className={styles.title}>
          {mode === 'insert' ? '你想要新增一个什么样的分镜？' : '你想要把这个分镜改成什么样？'}
        </h2>

        <textarea
          className={styles.input}
          value={text}
          placeholder="输入你的分镜图片修改描述…"
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doGenerate()
          }}
        />

        <div className={styles.toolbar}>
          {/* 左下:上传素材 + 已传缩略图 */}
          <div className={styles.uploads}>
            {uploads.map((u, i) => (
              <div className={styles.thumb} key={u.url + i}>
                <img src={u.url} alt="" />
                <button
                  type="button"
                  className={styles.thumbX}
                  onClick={() => setUploads((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="移除"
                >
                  ×
                </button>
              </div>
            ))}
            {onUpload && (
              <button
                type="button"
                className={styles.uploadBtn}
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="上传素材"
              >
                {uploading ? (
                  <span className={styles.spin} aria-hidden="true" />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 16V4M7 9l5-5 5 5" />
                    <path d="M5 20h14" />
                  </svg>
                )}
                <span>上传素材</span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                pickFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>

          {/* 右下:AI一键润色 + 生成分镜 */}
          <div className={styles.actions}>
            {onPolish && (
              <button type="button" className={styles.polish} onClick={doPolish} disabled={polishing || !text.trim()}>
                {polishing ? '润色中…' : 'AI一键润色'}
              </button>
            )}
            <button type="button" className={styles.gen} onClick={doGenerate} disabled={!canGenerate}>
              {generating ? '生成中…' : '生成分镜'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
