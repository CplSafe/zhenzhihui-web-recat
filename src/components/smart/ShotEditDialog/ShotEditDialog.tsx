/**
 * ShotEditDialog — 分镜「编辑 / 新增 / 插入」统一弹框(按 Figma 还原)。
 * 内容:标题 + 分镜图修改描述输入 + 上传素材 + AI一键润色 + 生成分镜。
 *
 * 关键交互(对齐产品逻辑):
 *  - 编辑/新增/插入都把「描述 + 上传素材」交给后端,后端只更新当前这一个分镜;
 *  - 「生成分镜」点击即关闭弹框,生成在后台进行(分镜列表对应镜头显示「生成中」,出图后自动回填);
 *    失败由全局 toast 提示,不再阻塞弹框。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '@/composables/useToast'
import styles from './ShotEditDialog.module.less'

/** 分镜弹窗模式与上传、润色、生成、关闭异步回调。 */
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

/**
 * 收集单镜修改描述和参考素材；通过生命周期序号阻止弹窗关闭后旧上传/润色结果回写新会话。
 */
export default function ShotEditDialog({ open, mode, onUpload, onPolish, onGenerate, onClose }: ShotEditDialogProps) {
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [uploads, setUploads] = useState<{ url: string; assetId?: number }[]>([])
  const [polishing, setPolishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const lifecycleRef = useRef(0)
  const openRef = useRef(open)
  const polishingRef = useRef(false)
  const uploadingRef = useRef(false)
  const generatingRef = useRef(false)
  openRef.current = open

  const closeDialog = useCallback(() => {
    lifecycleRef.current += 1
    openRef.current = false
    polishingRef.current = false
    uploadingRef.current = false
    onClose()
  }, [onClose])

  // 每次打开重置输入(编辑/插入都从空描述开始,placeholder 提示)
  useEffect(() => {
    lifecycleRef.current += 1
    polishingRef.current = false
    uploadingRef.current = false
    generatingRef.current = false
    if (open) {
      setText('')
      setUploads([])
      setPolishing(false)
      setUploading(false)
    }
    return () => {
      lifecycleRef.current += 1
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeDialog()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDialog, open])

  if (!open) return null

  const canGenerate = (text.trim().length > 0 || uploads.length > 0) && !uploading
  const isCurrentSession = (scope: number) => openRef.current && lifecycleRef.current === scope

  // 文件串行上传以保持用户选择顺序，并在弹窗关闭或重开后停止接收旧会话结果。
  const pickFiles = async (files: FileList | null) => {
    if (!files?.length || !onUpload || uploadingRef.current) return
    const scope = lifecycleRef.current
    uploadingRef.current = true
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        if (!isCurrentSession(scope)) break
        const r = await onUpload(f).catch(() => null)
        if (!isCurrentSession(scope)) break
        if (r?.url) setUploads((prev) => [...prev, { url: r.url, assetId: r.assetId }])
        else showToast('素材上传失败,请重试', 'error')
      }
    } finally {
      if (isCurrentSession(scope)) {
        uploadingRef.current = false
        setUploading(false)
      }
    }
  }

  const doPolish = async () => {
    if (!onPolish || !text.trim() || polishingRef.current) return
    const scope = lifecycleRef.current
    polishingRef.current = true
    setPolishing(true)
    try {
      // 带上本次上传的素材图 → 润色时 VL 读图理解诉求(如「把产品换成这张图里的」)
      const out = await onPolish(
        text,
        uploads.map((u) => u.url),
      )
      if (out && isCurrentSession(scope)) setText(out)
    } catch (e: any) {
      if (isCurrentSession(scope)) showToast(`AI 润色失败:${e?.message || '请稍后重试'}`, 'error')
    } finally {
      if (isCurrentSession(scope)) {
        polishingRef.current = false
        setPolishing(false)
      }
    }
  }

  const doGenerate = () => {
    if (!canGenerate || generatingRef.current) return
    generatingRef.current = true
    // 触发生成后立即关闭弹框:生成在后台进行,分镜列表对应镜头显示「生成中」,出图后自动回填。
    void onGenerate(
      text.trim(),
      uploads.map((u) => u.url),
    )
    closeDialog()
  }

  return createPortal(
    <div
      className={styles.mask}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDialog()
      }}
    >
      <div
        className={styles.dlg}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'insert' ? '新增分镜' : '编辑分镜'}
      >
        <button type="button" className={styles.x} onClick={closeDialog} aria-label="关闭">
          ×
        </button>

        <h2 className={styles.title}>
          {mode === 'insert' ? '你想要新增一个什么样的分镜？' : '你想要把这个分镜改成什么样？'}
        </h2>

        <textarea
          className={styles.input}
          value={text}
          aria-label="分镜描述"
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
              aria-label="上传素材文件"
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
              生成分镜
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
