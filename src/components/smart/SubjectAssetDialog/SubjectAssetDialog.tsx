/**
 * SubjectAssetDialog — 单个主体(如 @闺蜜A)的素材统一管理。
 * 可编辑提示词重新生成、查看版本图、上传;选定某版本后由父级应用到所有同名主体。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fileToDataUrl } from '@/utils/imageFile'
import AiBadge from '@/components/common/AiBadge'
import styles from './SubjectAssetDialog.module.less'

interface SubjectAssetDialogProps {
  open: boolean
  name: string
  kind?: string
  currentImage?: string
  versions: string[]
  /** 已选参考图:主推产品锚定的上传素材(只读展示,可多张)。本产品按它们抠图保真生成,重新生成会沿用。 */
  anchorRefImages?: string[]
  defaultPrompt: string
  /** 打开时若无版本则自动生成一次 */
  autoGen?: boolean
  /** 打开时把(原始意图)defaultPrompt 交本地 Qwen 润成干净画面提示词后回显;不传则原样显示 */
  refinePrompt?: (intent: string) => Promise<string>
  /** 当前项目内所有图(带来源):供"添加参考图/替换"从项目里选,按上传/AI生成分组 */
  projectImages?: { url: string; source: 'ai' | 'upload' }[]
  onClose: () => void
  /** 生成:prompt + 选项(refImageUrl 参考图;carryCurrent 携带当前图=修改/不带=重新生成) */
  onGenerate: (prompt: string, opts: { refImageUrl?: string; carryCurrent?: boolean }) => Promise<void>
  onSelect: (url: string) => void
  /** 上传素材:直接交 File,由父级经后端 uploadAssetFile 存服务器取 asset_id。
   *  不传 → 视为「用户上传已下线」,弹窗内不显示任何「上传」入口,仅 AI 生成 / 从项目选。 */
  onUpload?: (file: File) => void
}

export default function SubjectAssetDialog({
  open,
  name,
  kind,
  currentImage,
  versions,
  anchorRefImages,
  defaultPrompt,
  autoGen,
  refinePrompt,
  projectImages = [],
  onClose,
  onGenerate,
  onSelect,
  onUpload,
}: SubjectAssetDialogProps) {
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [refining, setRefining] = useState(false)
  const [refImage, setRefImage] = useState('') // 参考图(产品真实照片)dataURL
  const [carryCurrent, setCarryCurrent] = useState(false) // 携带当前图(修改)/ 不带(重新生成)
  const [picker, setPicker] = useState<null | 'ref' | 'use'>(null) // 项目图片选择器目标
  const fileRef = useRef<HTMLInputElement | null>(null)
  const uploadModeRef = useRef<'version' | 'ref'>('version')
  const autoRef = useRef(false)

  // 触发文件上传:mode=version → onUpload(新版本);mode=ref → 设为参考图
  const triggerUpload = (mode: 'version' | 'ref') => {
    uploadModeRef.current = mode
    fileRef.current?.click()
  }
  // 项目图片选择器选中某图:ref→参考图;use→设为当前版本(同名联动)
  const pickProjectImage = (url: string) => {
    if (picker === 'ref') setRefImage(url)
    else if (picker === 'use') onSelect(url)
    setPicker(null)
  }

  // 打开时:先回显原始意图,若提供 refinePrompt 则用本地 Qwen 润成干净提示词后替换;
  // autoGen 且无版本则在(润色后的)提示词就绪后自动生成一次。
  useEffect(() => {
    if (!open) {
      autoRef.current = false
      return
    }
    let cancelled = false
    setPrompt(defaultPrompt)
    setRefImage('')
    setCarryCurrent(false)
    setPicker(null)
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
      await onGenerate(p, { refImageUrl: refImage || undefined, carryCurrent })
    } finally {
      setGenerating(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className={styles.sadMask}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.sad} role="dialog" aria-label="素材管理">
        <div className={styles.sadHead}>
          <span className={styles.sadTitle}>
            素材 · {name}
            {kind && <span className={styles.sadKind}>{kind}</span>}
          </span>
          <button type="button" className={styles.sadX} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.sadBody}>
          {/* 大图预览(当前选定);hover 显示 替换/上传 */}
          <div className={styles.sadPreview}>
            {generating ? (
              <div className={styles.sadPreviewLoading}>
                <span className={styles.sadSpin} aria-hidden="true" />
                生成中…
              </div>
            ) : currentImage ? (
              <img src={currentImage} alt="" />
            ) : (
              <span className={styles.sadPreviewPh}>还没有素材,输入提示词生成,或上传/替换</span>
            )}
            <div className={styles.sadImgActions}>
              <button type="button" onClick={() => setPicker('use')}>
                替换
              </button>
              {onUpload && (
                <button type="button" onClick={() => triggerUpload('version')}>
                  上传
                </button>
              )}
            </div>
          </div>

          {/* 提示词 */}
          <label className={styles.sadLabel}>
            生成提示词(可修改)
            {refining && <span className={styles.sadRefining}> · AI 优化提示词中…</span>}
          </label>
          {editingPrompt && !refining ? (
            <textarea
              className={`${styles.sadPrompt} ${styles.sadPromptEditing}`}
              rows={3}
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => setEditingPrompt(false)}
              placeholder="描述这个主体的样子…"
            />
          ) : (
            <div
              className={`${styles.sadPrompt} ${styles.sadPromptView}`}
              role="button"
              tabIndex={0}
              title={refining ? '' : '点击修改提示词'}
              onClick={() => !refining && setEditingPrompt(true)}
              onKeyDown={(e) => e.key === 'Enter' && !refining && setEditingPrompt(true)}
            >
              {refining ? (
                <span className={styles.sadPromptPh}>正在把生成意图优化为更干净的画面提示词…</span>
              ) : prompt ? (
                prompt
              ) : (
                <span className={styles.sadPromptPh}>描述这个主体的样子…</span>
              )}
              {!refining && (
                <span className={styles.sadPromptEdit} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </span>
              )}
            </div>
          )}
          {/* 已选参考图:主推产品锚定的上传素材(只读,可多张)。本产品就是按它们抠图保真生成的 */}
          {anchorRefImages && anchorRefImages.length > 0 && (
            <div className={styles.sadAnchor}>
              <div className={styles.sadAnchorThumbs}>
                {anchorRefImages.map((url, i) => (
                  <div className={styles.sadRefThumb} key={`${url}-${i}`}>
                    <img src={url} alt={`已选参考图${i + 1}`} />
                  </div>
                ))}
              </div>
              <span className={styles.sadAnchorText}>
                <b>已选参考图{anchorRefImages.length > 1 ? `(${anchorRefImages.length}张)` : ''}</b>:来自你上传的素材
                <br />
                本产品按它{anchorRefImages.length > 1 ? '们' : ''}抠图保真生成,重新生成会继续沿用
              </span>
            </div>
          )}
          {/* 参考图:从项目选 或 上传;AI 据此优化提示词并图生图(保证用你的产品) */}
          <div className={styles.sadRef}>
            {refImage ? (
              <div className={styles.sadRefThumb}>
                <img src={refImage} alt="参考图" />
                <button type="button" onClick={() => setRefImage('')} aria-label="移除参考图">
                  ×
                </button>
              </div>
            ) : (
              <button type="button" className={styles.sadRefAdd} onClick={() => setPicker('ref')}>
                + 添加参考图
              </button>
            )}
            <span className={styles.sadRefHint}>可从项目里选图或上传;按其产品外观优化提示词并图生图</span>
          </div>

          {/* 携带当前图:勾上=在当前图基础上「修改」;不勾=「重新生成」(可带参考图) */}
          {currentImage && (
            <label className={styles.sadCarry}>
              <input type="checkbox" checked={carryCurrent} onChange={(e) => setCarryCurrent(e.target.checked)} />
              携带当前图(在此基础上修改;不勾则重新生成)
            </label>
          )}

          <div className={styles.sadActions}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  if (uploadModeRef.current === 'ref')
                    fileToDataUrl(f)
                      .then(setRefImage)
                      .catch(() => {})
                  else onUpload(f) // 上传成新版本(后端 asset)
                }
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={`${styles.sadBtn} ${styles.sadBtnPrimary}`}
              onClick={() => runGen(prompt)}
              disabled={generating || refining}
            >
              {generating
                ? '生成中…'
                : refining
                  ? '优化中…'
                  : carryCurrent
                    ? '修改生成'
                    : versions.length
                      ? '重新生成'
                      : '生成'}
            </button>
          </div>

          {/* 版本图:直接点击选用(上传/替换在上方大图预览处统一处理,此处不再重复) */}
          {versions.length > 0 && (
            <>
              <label className={styles.sadLabel}>版本图(点击选用,同名主体将同步更新)</label>
              <div className={styles.sadVersions}>
                {versions.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`${styles.sadVer}${url === currentImage ? ' ' + styles.active : ''}`}
                    onClick={() => onSelect(url)}
                    title={`版本 ${i + 1}`}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 项目图片选择器(添加参考图 / 替换) */}
          {picker && (
            <div className={styles.sadPicker}>
              <div className={styles.sadPickerHead}>
                {picker === 'ref' ? '选择参考图' : '选择要使用的图'}
                <button type="button" onClick={() => setPicker(null)} aria-label="关闭">
                  ×
                </button>
              </div>
              {onUpload && (
                <div className={styles.sadPickerGrid}>
                  <button
                    type="button"
                    className={styles.sadPickerUp}
                    onClick={() => triggerUpload(picker === 'ref' ? 'ref' : 'version')}
                  >
                    ↑<br />
                    上传
                  </button>
                </div>
              )}
              {(['upload', 'ai'] as const).map((src) => {
                const list = projectImages.filter((p) => p.source === src)
                if (!list.length) return null
                return (
                  <div key={src} className={styles.sadPickerGroup}>
                    <div className={styles.sadPickerGroupTitle}>{src === 'upload' ? '我上传的图' : 'AI 生成的图'}</div>
                    <div className={styles.sadPickerGrid}>
                      {list.map((p, i) => (
                        <button
                          key={i}
                          type="button"
                          className={styles.sadPickerItem}
                          onClick={() => pickProjectImage(p.url)}
                        >
                          <img src={p.url} alt="" />
                          {src === 'ai' && <AiBadge size={15} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {!projectImages.length && (
                <span className={styles.sadPickerEmpty}>项目里暂无可选图片,可点上方「上传」</span>
              )}
            </div>
          )}
        </div>

        <div className={styles.sadFoot}>
          <button type="button" className={`${styles.sadBtn} ${styles.sadBtnPrimary}`} onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
