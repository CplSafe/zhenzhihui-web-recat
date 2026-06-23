/**
 * ShotImageDialog — 镜头编排「上传素材」入口的完整弹窗(沿用准备素材弹窗 SubjectAssetDialog 的交互/视觉,
 * 但作用对象是「分镜图」而非主体素材):可改提示词 / 加参考图 / 携带当前图 / 重新生成,
 * 新生成(或上传/替换)的图片替换当前分镜图,并进入「历史生成」。
 *
 * 自包含:不直接改 shots,所有落库经回调交父级(onGenerate→重生成、onPickVersion→切版本、
 * onUseImage→设为当前、onUpload→上传成新版本)。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fileToDataUrl } from '@/utils/imageFile'
import AiBadge from '@/components/common/AiBadge'
import styles from './ShotImageDialog.module.less'

export interface ShotImageVersion {
  url: string
  assetId?: number
  prompt?: string
  refs?: string[]
}

interface ShotImageDialogProps {
  open: boolean
  /** 镜头标题,如「镜头1」,用于区分这是镜头编排的分镜图 */
  shotNo: string
  currentImage?: string
  /** 历史生成版本(= shot.imageVersions) */
  versions: ShotImageVersion[]
  /** 默认提示词(shot.imagePrompt || shot.desc) */
  defaultPrompt: string
  /** 本镜素材(主体):自动参与出图,弹窗内只展示不可移除 */
  subjects: { name: string; url?: string }[]
  /** 当前项目所有图(供「添加参考图 / 替换」从项目里选) */
  projectImages?: { url: string; source: 'ai' | 'upload'; assetId?: number }[]
  /** 正在生成分镜图(转圈、禁用按钮) */
  generating?: boolean
  onClose: () => void
  /** 重新生成:提示词 + 参考图(主体 + 额外)+ 是否携带当前图 */
  onGenerate: (prompt: string, opts: { refUrls: string[]; carryCurrent: boolean }) => void
  /** 点历史版本:切换当前分镜图(并还原其提示词/素材) */
  onPickVersion: (v: ShotImageVersion) => void
  /** 从项目选一张图设为当前分镜图(并进历史生成) */
  onUseImage: (url: string, assetId: number) => void
  /** 上传本地图设为当前分镜图(直传后端成 asset,并进历史生成) */
  onUpload: (file: File) => void
}

export default function ShotImageDialog({
  open,
  shotNo,
  currentImage,
  versions,
  defaultPrompt,
  subjects,
  projectImages = [],
  generating,
  onClose,
  onGenerate,
  onPickVersion,
  onUseImage,
  onUpload,
}: ShotImageDialogProps) {
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [carryCurrent, setCarryCurrent] = useState(false)
  const [extraRefs, setExtraRefs] = useState<string[]>([]) // 额外参考图(dataURL / http)
  const [picker, setPicker] = useState<null | 'ref' | 'use'>(null) // 项目图片选择器目标
  const fileRef = useRef<HTMLInputElement | null>(null)
  const uploadModeRef = useRef<'version' | 'ref'>('version')

  // 本镜素材图(主体,自动参与出图)
  const subjectUrls = Array.from(new Set(subjects.map((s) => s.url).filter(Boolean))) as string[]

  // 打开时按当前分镜重置本地态
  useEffect(() => {
    if (!open) return
    setPrompt(defaultPrompt)
    setEditingPrompt(false)
    setCarryCurrent(!!currentImage)
    setExtraRefs([])
    setPicker(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const triggerUpload = (mode: 'version' | 'ref') => {
    uploadModeRef.current = mode
    fileRef.current?.click()
  }
  // 项目图片选择器选中:ref→额外参考图;use→设为当前分镜图
  const pickProjectImage = (url: string, assetId: number) => {
    if (picker === 'ref') setExtraRefs((r) => (r.includes(url) ? r : [...r, url]))
    else if (picker === 'use') onUseImage(url, assetId)
    setPicker(null)
  }
  const doGenerate = () => {
    if (generating) return
    onGenerate(prompt, { refUrls: [...subjectUrls, ...extraRefs], carryCurrent })
  }

  return createPortal(
    <div
      className={styles.sidMask}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.sid} role="dialog" aria-label="分镜图管理">
        <div className={styles.sidHead}>
          <span className={styles.sidTitle}>
            分镜图 · {shotNo}
            <span className={styles.sidScene}>镜头编排</span>
          </span>
          <button type="button" className={styles.sidX} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.sidBody}>
          {/* 当前分镜图预览;hover 显示 替换/上传 */}
          <div className={styles.sidPreview}>
            {generating ? (
              <div className={styles.sidPreviewLoading}>
                <span className={styles.sidSpin} aria-hidden="true" />
                生成中…
              </div>
            ) : currentImage ? (
              <img src={currentImage} alt="" />
            ) : (
              <span className={styles.sidPreviewPh}>还没有分镜图,输入提示词生成,或上传/替换</span>
            )}
            <div className={styles.sidImgActions}>
              <button type="button" onClick={() => setPicker('use')}>
                替换
              </button>
              <button type="button" onClick={() => triggerUpload('version')}>
                上传
              </button>
            </div>
          </div>

          {/* 生成提示词(可修改) */}
          <label className={styles.sidLabel}>生成提示词(可修改)</label>
          {editingPrompt ? (
            <textarea
              className={`${styles.sidPrompt} ${styles.sidPromptEditing}`}
              rows={3}
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => setEditingPrompt(false)}
              placeholder="描述这个分镜的画面…"
            />
          ) : (
            <div
              className={`${styles.sidPrompt} ${styles.sidPromptView}`}
              role="button"
              tabIndex={0}
              title="点击修改提示词"
              onClick={() => setEditingPrompt(true)}
              onKeyDown={(e) => e.key === 'Enter' && setEditingPrompt(true)}
            >
              {prompt ? prompt : <span className={styles.sidPromptPh}>描述这个分镜的画面…</span>}
              <span className={styles.sidPromptEdit} aria-hidden="true">
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
            </div>
          )}

          {/* 素材:本镜主体(自动参与)+ 额外参考图(项目选/上传) */}
          <label className={styles.sidLabel}>素材(参与出图)</label>
          <div className={styles.sidRefs}>
            {subjectUrls.map((url, i) => (
              <div className={styles.sidRefThumb} key={`sub-${i}`} title="本镜主体素材(自动参与)">
                <img src={url} alt="" />
                <span className={styles.sidRefTagSubject}>主体</span>
              </div>
            ))}
            {extraRefs.map((url, i) => (
              <div className={styles.sidRefThumb} key={`ext-${i}`} title="额外参考图">
                <img src={url} alt="" />
                <button
                  type="button"
                  onClick={() => setExtraRefs((r) => r.filter((u) => u !== url))}
                  aria-label="移除参考图"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className={styles.sidRefAdd} onClick={() => setPicker('ref')}>
              + 添加参考图
            </button>
          </div>
          <span className={styles.sidRefHint}>主体素材自动参与出图;可再从项目里选图或上传作为额外参考</span>

          {/* 携带当前图:勾上=在当前分镜图基础上修改;不勾=重新生成 */}
          {currentImage && (
            <label className={styles.sidCarry}>
              <input type="checkbox" checked={carryCurrent} onChange={(e) => setCarryCurrent(e.target.checked)} />
              携带当前图(在此基础上修改;不勾则重新生成)
            </label>
          )}

          <div className={styles.sidActions}>
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
                      .then((url) => setExtraRefs((r) => (r.includes(url) ? r : [...r, url])))
                      .catch(() => {})
                  else onUpload(f) // 上传成新版本(后端 asset)+ 设为当前
                }
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={`${styles.sidBtn} ${styles.sidBtnPrimary}`}
              onClick={doGenerate}
              disabled={generating}
            >
              {generating ? '生成中…' : carryCurrent ? '修改生成' : versions.length ? '重新生成' : '生成'}
            </button>
          </div>

          {/* 历史生成:点击切换版本(新生成/上传/替换都会进这里) */}
          {versions.length > 0 && (
            <>
              <label className={styles.sidLabel}>历史生成(点击切换版本)</label>
              <div className={styles.sidVersions}>
                {versions
                  .slice()
                  .reverse()
                  .map((v, ri) => {
                    const i = versions.length - 1 - ri
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`${styles.sidVer}${v.url === currentImage ? ' ' + styles.active : ''}`}
                        onClick={() => onPickVersion(v)}
                        title={`版本 ${i + 1}`}
                      >
                        <img src={v.url} alt="" />
                        <span className={styles.sidVerLabel}>V{i + 1}</span>
                      </button>
                    )
                  })}
              </div>
            </>
          )}

          {/* 项目图片选择器(添加参考图 / 替换) */}
          {picker && (
            <div className={styles.sidPicker}>
              <div className={styles.sidPickerHead}>
                {picker === 'ref' ? '选择参考图' : '选择要用作分镜图的图'}
                <button type="button" onClick={() => setPicker(null)} aria-label="关闭">
                  ×
                </button>
              </div>
              <div className={styles.sidPickerGrid}>
                <button
                  type="button"
                  className={styles.sidPickerUp}
                  onClick={() => triggerUpload(picker === 'ref' ? 'ref' : 'version')}
                >
                  ↑<br />
                  上传
                </button>
              </div>
              {(['upload', 'ai'] as const).map((src) => {
                const list = projectImages.filter((p) => p.source === src)
                if (!list.length) return null
                return (
                  <div key={src} className={styles.sidPickerGroup}>
                    <div className={styles.sidPickerGroupTitle}>{src === 'upload' ? '我上传的图' : 'AI 生成的图'}</div>
                    <div className={styles.sidPickerGrid}>
                      {list.map((p, i) => (
                        <button
                          key={i}
                          type="button"
                          className={styles.sidPickerItem}
                          onClick={() => pickProjectImage(p.url, p.assetId || 0)}
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
                <span className={styles.sidPickerEmpty}>项目里暂无可选图片,可点上方「上传」</span>
              )}
            </div>
          )}
        </div>

        <div className={styles.sidFoot}>
          <button type="button" className={`${styles.sidBtn} ${styles.sidBtnPrimary}`} onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
