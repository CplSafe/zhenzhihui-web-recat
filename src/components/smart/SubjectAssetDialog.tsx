/**
 * SubjectAssetDialog — 单个主体(如 @闺蜜A)的素材统一管理。
 * 可编辑提示词重新生成、查看版本图、上传;选定某版本后由父级应用到所有同名主体。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fileToDataUrl } from '@/utils/imageFile'
import './SubjectAssetDialog.css'

interface SubjectAssetDialogProps {
  open: boolean
  name: string
  kind?: string
  currentImage?: string
  versions: string[]
  defaultPrompt: string
  /** 打开时若无版本则自动生成一次 */
  autoGen?: boolean
  /** 打开时把(原始意图)defaultPrompt 交本地 Qwen 润成干净画面提示词后回显;不传则原样显示 */
  refinePrompt?: (intent: string) => Promise<string>
  onClose: () => void
  onGenerate: (prompt: string) => Promise<void>
  onSelect: (url: string) => void
  onUpload: (url: string) => void
}

export default function SubjectAssetDialog({
  open,
  name,
  kind,
  currentImage,
  versions,
  defaultPrompt,
  autoGen,
  refinePrompt,
  onClose,
  onGenerate,
  onSelect,
  onUpload,
}: SubjectAssetDialogProps) {
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [generating, setGenerating] = useState(false)
  const [refining, setRefining] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const autoRef = useRef(false)

  // 打开时:先回显原始意图,若提供 refinePrompt 则用本地 Qwen 润成干净提示词后替换;
  // autoGen 且无版本则在(润色后的)提示词就绪后自动生成一次。
  useEffect(() => {
    if (!open) {
      autoRef.current = false
      return
    }
    let cancelled = false
    setPrompt(defaultPrompt)
    ;(async () => {
      let p = defaultPrompt
      if (refinePrompt) {
        setRefining(true)
        try {
          const out = await refinePrompt(defaultPrompt)
          if (out) p = out
        } catch {
          /* 润色失败保留原意图 */
        }
        if (cancelled) return
        setRefining(false)
        setPrompt(p)
      }
      if (autoGen && !autoRef.current && versions.length === 0) {
        autoRef.current = true
        void runGen(p)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const runGen = async (p: string) => {
    if (generating) return
    if (!p.trim()) return
    setGenerating(true)
    try {
      await onGenerate(p)
    } finally {
      setGenerating(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="sad-mask"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sad" role="dialog" aria-label="素材管理">
        <div className="sad__head">
          <span className="sad__title">
            素材 · {name}
            {kind && <span className="sad__kind">{kind}</span>}
          </span>
          <button type="button" className="sad__x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="sad__body">
          {/* 大图预览(当前选定) */}
          <div className="sad__preview">
            {generating ? (
              <div className="sad__preview-loading">
                <span className="sad__spin" aria-hidden="true" />
                生成中…
              </div>
            ) : currentImage ? (
              <img src={currentImage} alt="" />
            ) : (
              <span className="sad__preview-ph">还没有素材,输入提示词生成,或上传</span>
            )}
          </div>

          {/* 提示词 */}
          <label className="sad__label">
            生成提示词(可修改)
            {refining && <span className="sad__refining"> · AI 优化提示词中…</span>}
          </label>
          <textarea
            className="sad__prompt"
            rows={3}
            value={refining ? '' : prompt}
            disabled={refining}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={refining ? '正在把生成意图优化为更干净的画面提示词…' : '描述这个主体的样子…'}
          />
          <div className="sad__actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) fileToDataUrl(f).then(onUpload).catch(() => {})
                e.target.value = ''
              }}
            />
            <button type="button" className="sad__btn sad__btn--ghost" onClick={() => fileRef.current?.click()}>
              上传素材
            </button>
            <button
              type="button"
              className="sad__btn sad__btn--primary"
              onClick={() => runGen(prompt)}
              disabled={generating || refining}
            >
              {generating ? '生成中…' : refining ? '优化中…' : versions.length ? '重新生成' : '生成'}
            </button>
          </div>

          {/* 版本图 */}
          {versions.length > 0 && (
            <>
              <label className="sad__label">版本图(点击选用,同名主体将同步更新)</label>
              <div className="sad__versions">
                {versions.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`sad__ver${url === currentImage ? ' is-active' : ''}`}
                    onClick={() => onSelect(url)}
                    title={`版本 ${i + 1}`}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="sad__foot">
          <button type="button" className="sad__btn sad__btn--primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
