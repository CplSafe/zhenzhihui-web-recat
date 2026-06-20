/**
 * ShotEditPanel — 右侧「素材修改」面板(镜头编排 / 视频生成 两页共用)。
 *
 * 逻辑(对齐 2.0 + 设计图):
 *  - 素材 = 该镜各独立元素(人物/产品/场景…),逐个列出;每个可上传替换 / 点开管理版本。
 *  - 分镜图 = 元素组合生成;「素材历史」= 该镜分镜图的多个版本(点击切换)。
 *  - 改分镜图两种方式:
 *      方式1:看到/编辑「生成提示词」→ 重新生成。
 *      方式2:基于现有分镜图,用「文字 + 参考图」修改。
 *  - 台词 / 字幕 / 音效:即时自动保存(无提交按钮)。
 */
import { useEffect, useRef, useState } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import { fileToDataUrl } from '@/utils/imageFile'
import './ShotEditPanel.css'

interface ShotEditPanelProps {
  shot: Shot
  regenerating?: boolean
  onOpenElement?: (name: string) => void
  onUploadElement?: (name: string, file: File) => void
  /** 即时保存某些字段(台词/字幕/音效/生成提示词/切换分镜图版本) */
  onPatch: (patch: Partial<Shot>) => void
  /** 重新生成分镜图;方式1 传 editPrompt,方式2 传 feedback+extraRefUrls */
  onRegenerateImage: (shot: Shot, opts: { feedback?: string; editPrompt?: string; extraRefUrls?: string[] }) => void
}

const stripAt = (t: string) => String(t || '').replace(/^@/, '').trim()

export default function ShotEditPanel({
  shot,
  regenerating,
  onOpenElement,
  onUploadElement,
  onPatch,
  onRegenerateImage,
}: ShotEditPanelProps) {
  const uploadFor = useRef<string>('')
  const elFileRef = useRef<HTMLInputElement | null>(null)
  const refFileRef = useRef<HTMLInputElement | null>(null)

  // 本地草稿:生成提示词(可编辑)、修改建议、额外参考图(切换分镜时重置)
  const [imgPrompt, setImgPrompt] = useState(shot.imagePrompt || '')
  const [feedback, setFeedback] = useState('')
  const [refImgs, setRefImgs] = useState<string[]>([])
  useEffect(() => {
    setImgPrompt(shot.imagePrompt || '')
    setFeedback('')
    setRefImgs([])
  }, [shot.id, shot.imagePrompt])

  const current = shot.image || ''
  const versions = shot.imageVersions || []

  const triggerElUpload = (name: string) => {
    uploadFor.current = name
    elFileRef.current?.click()
  }
  const addRefImg = async (f: File) => {
    const url = await fileToDataUrl(f).catch(() => '')
    if (url) setRefImgs((a) => [...a, url])
  }

  return (
    <div className="sedit">
      {/* ── 素材:逐个列出该镜全部元素 ── */}
      <div className="sedit__sec-title">素材</div>
      <div className="sedit__elements">
        {shot.subjects.length ? (
          shot.subjects.map((su, i) => {
            const name = stripAt(su.tag)
            return (
              <div className="sedit__el" key={`${su.tag}-${i}`}>
                <button
                  type="button"
                  className="sedit__el-thumb"
                  title="管理该元素版本"
                  onClick={() => onOpenElement?.(name)}
                >
                  {su.image ? <img src={su.image} alt={name} /> : <span>+</span>}
                </button>
                <div className="sedit__el-meta">
                  <span className="sedit__el-name">{name || '元素'}</span>
                  {su.kind && <span className="sedit__el-kind">{su.kind}</span>}
                </div>
                {onUploadElement && (
                  <button type="button" className="sedit__el-upload" onClick={() => triggerElUpload(name)}>
                    上传
                  </button>
                )}
              </div>
            )
          })
        ) : (
          <div className="sedit__el-empty">该分镜暂无识别到的元素</div>
        )}
      </div>

      {/* ── 当前分镜图(本页核心,中等尺寸,不霸屏)── */}
      <div className="sedit__sec-title">分镜图</div>
      <div className="sedit__cur">
        {regenerating ? (
          <span className="sedit__cur-ph">
            <span className="sedit__spin" aria-hidden="true" />
            生成中…
          </span>
        ) : current ? (
          <img src={current} alt="" />
        ) : (
          <span className="sedit__cur-ph">暂无分镜图</span>
        )}
      </div>

      {/* ── 素材历史(点击切换)= 该镜分镜图版本 ── */}
      {versions.length > 0 && (
        <>
          <div className="sedit__hist-title">素材历史（点击切换）</div>
          <div className="sedit__hist-row">
            {versions.map((url, i) => (
              <button
                key={i}
                type="button"
                className={`sedit__hist${url === current ? ' is-active' : ''}`}
                onClick={() => onPatch({ image: url })}
              >
                <img src={url} alt="" />
              </button>
            ))}
            {regenerating && (
              <span className="sedit__hist sedit__hist--gen">
                <span className="sedit__spin" aria-hidden="true" />
              </span>
            )}
          </div>
        </>
      )}

      {/* ── 方式1:生成提示词(可编辑)→ 重新生成 ── */}
      <div className="sedit__sec-title">生成提示词</div>
      <textarea
        className="sedit__ta"
        value={imgPrompt}
        placeholder="该分镜图的生成提示词(可修改后重新生成)…"
        onChange={(e) => setImgPrompt(e.target.value)}
        onBlur={() => imgPrompt !== (shot.imagePrompt || '') && onPatch({ imagePrompt: imgPrompt })}
      />
      <div className="sedit__field-foot">
        <button
          type="button"
          className="sedit__submit"
          disabled={!!regenerating}
          onClick={() => {
            onPatch({ imagePrompt: imgPrompt })
            onRegenerateImage(shot, { editPrompt: imgPrompt.trim() || undefined })
          }}
        >
          {regenerating ? '生成中…' : '按提示词重新生成'}
        </button>
      </div>

      {/* ── 方式2:文字 + 参考图 修改现有分镜图 ── */}
      <div className="sedit__sec-title">文字 + 图 修改</div>
      <textarea
        className="sedit__ta"
        value={feedback}
        maxLength={500}
        placeholder="基于当前分镜图,描述要怎么改…(可同时添加参考图)"
        onChange={(e) => setFeedback(e.target.value)}
      />
      <div className="sedit__refrow">
        {refImgs.map((u, i) => (
          <div className="sedit__ref" key={i}>
            <img src={u} alt="" />
            <button type="button" onClick={() => setRefImgs((a) => a.filter((_, j) => j !== i))} aria-label="移除">
              ×
            </button>
          </div>
        ))}
        <button type="button" className="sedit__ref-add" onClick={() => refFileRef.current?.click()}>
          + 添加参考图
        </button>
      </div>
      <div className="sedit__field-foot">
        <button
          type="button"
          className="sedit__submit"
          disabled={!!regenerating || (!feedback.trim() && !refImgs.length)}
          onClick={() => onRegenerateImage(shot, { feedback: feedback.trim() || undefined, extraRefUrls: refImgs })}
        >
          {regenerating ? '生成中…' : '按修改生成'}
        </button>
      </div>

      {/* ── 台词 / 字幕 / 音效:即时自动保存,无提交按钮 ── */}
      <AutoField title="台词" value={shot.line || ''} placeholder={`${shot.no}的台词/旁白…`} onChange={(v) => onPatch({ line: v })} />
      <AutoField title="字幕" value={shot.subtitle || ''} placeholder={`${shot.no}的字幕…`} onChange={(v) => onPatch({ subtitle: v })} />
      <AutoField title="音效" value={shot.sfx || ''} placeholder={`${shot.no}的音效…`} onChange={(v) => onPatch({ sfx: v })} />

      <input
        ref={elFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && uploadFor.current) onUploadElement?.(uploadFor.current, f)
          e.target.value = ''
          uploadFor.current = ''
        }}
      />
      <input
        ref={refFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void addRefImg(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// 即时自动保存的文本块(无提交按钮)
function AutoField({
  title,
  value,
  placeholder,
  onChange,
}: {
  title: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="sedit__field">
      <div className="sedit__sec-title">{title}</div>
      <textarea
        className="sedit__ta"
        value={value}
        maxLength={500}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
