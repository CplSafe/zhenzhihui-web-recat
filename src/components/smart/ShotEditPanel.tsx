/**
 * ShotEditPanel — 右侧「素材修改」面板(镜头编排 / 视频生成 两页共用)。
 *
 * 布局:
 *  - 上半「分镜图修改区」分两栏:
 *      左栏 = 当前分镜图(大) + 历史版本(点击切换/高亮)
 *      右栏 = 素材(元素:点选参与出图 / 上传新增) + 生成提示词(可编辑) + 携带当前分镜图 + 生成按钮
 *  - 下半「台词 / 字幕 / 音效」全宽,即时自动保存(无提交按钮),带图标区分。
 *
 * 统一出图:提示词 + 选中的素材(refUrls) + 是否携带当前分镜图(carryCurrent) → onRegenerateImage。
 */
import { useEffect, useRef, useState } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import { fileToDataUrl } from '@/utils/imageFile'
import './ShotEditPanel.css'

interface ShotEditPanelProps {
  shot: Shot
  regenerating?: boolean
  onOpenElement?: (name: string) => void
  /** 即时保存字段(台词/字幕/音效/生成提示词/切换分镜图版本) */
  onPatch: (patch: Partial<Shot>) => void
  /** 出图:editPrompt 提示词 + refUrls 选中素材 + carryCurrent 是否带当前图 */
  onRegenerateImage: (shot: Shot, opts: { editPrompt?: string; refUrls?: string[]; carryCurrent?: boolean }) => void
}

const stripAt = (t: string) => String(t || '').replace(/^@/, '').trim()

export default function ShotEditPanel({ shot, regenerating, onOpenElement, onPatch, onRegenerateImage }: ShotEditPanelProps) {
  const refFileRef = useRef<HTMLInputElement | null>(null)

  const current = shot.image || ''
  const versions = shot.imageVersions || []
  const elUrls = Array.from(new Set(shot.subjects.map((s) => s.image).filter(Boolean))) as string[]

  // 本地草稿(切换分镜时重置):提示词 / 选中的素材 / 额外上传素材 / 是否携带当前图
  const [imgPrompt, setImgPrompt] = useState(shot.imagePrompt || '')
  const [selected, setSelected] = useState<Set<string>>(new Set(elUrls))
  const [extraRefs, setExtraRefs] = useState<string[]>([])
  const [carry, setCarry] = useState(!!current)
  useEffect(() => {
    setImgPrompt(shot.imagePrompt || '')
    setSelected(new Set(Array.from(new Set(shot.subjects.map((s) => s.image).filter(Boolean))) as string[]))
    setExtraRefs([])
    setCarry(!!shot.image)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id])

  const toggle = (url: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(url)) n.delete(url)
      else n.add(url)
      return n
    })
  const addExtra = async (f: File) => {
    const url = await fileToDataUrl(f).catch(() => '')
    if (url) {
      setExtraRefs((a) => [...a, url])
      setSelected((s) => new Set(s).add(url))
    }
  }
  const doGenerate = () => {
    const refUrls = [...elUrls.filter((u) => selected.has(u)), ...extraRefs.filter((u) => selected.has(u))]
    onPatch({ imagePrompt: imgPrompt })
    onRegenerateImage(shot, { editPrompt: imgPrompt.trim() || undefined, refUrls, carryCurrent: carry })
  }

  return (
    <div className="sedit">
      {/* ── 分镜图修改区(两栏)── */}
      <div className="sedit__editrow">
        {/* 左:当前分镜图 + 历史版本 */}
        <div className="sedit__left">
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
          {versions.length > 0 && (
            <>
              <div className="sedit__sub">历史版本（点击切换）</div>
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
              </div>
            </>
          )}
        </div>

        {/* 右:素材 + 提示词 + 携带 + 生成 */}
        <div className="sedit__right">
          <div className="sedit__sub">素材（点选参与出图）</div>
          <div className="sedit__els">
            {elUrls.length === 0 && shot.subjects.length === 0 && (
              <div className="sedit__el-empty">该分镜暂无元素</div>
            )}
            {shot.subjects.map((su, i) => {
              const name = stripAt(su.tag)
              const url = su.image || ''
              const on = !!url && selected.has(url)
              return (
                <div className="sedit__el" key={`${su.tag}-${i}`}>
                  <button
                    type="button"
                    className={`sedit__el-thumb${on ? ' is-on' : ''}`}
                    title={url ? '点选/取消参与出图' : '生成/上传该元素'}
                    onClick={() => (url ? toggle(url) : onOpenElement?.(name))}
                  >
                    {url ? <img src={url} alt={name} /> : <span>+</span>}
                    {on && <span className="sedit__el-check">✓</span>}
                  </button>
                  <div className="sedit__el-meta">
                    <span className="sedit__el-name">{name || '元素'}</span>
                    {su.kind && <span className="sedit__el-kind">{su.kind}</span>}
                  </div>
                  <button type="button" className="sedit__el-mng" onClick={() => onOpenElement?.(name)}>
                    管理
                  </button>
                </div>
              )
            })}
            {/* 额外上传素材 */}
            {extraRefs.map((u, i) => (
              <div className="sedit__el" key={`extra-${i}`}>
                <button
                  type="button"
                  className={`sedit__el-thumb${selected.has(u) ? ' is-on' : ''}`}
                  onClick={() => toggle(u)}
                  title="点选/取消参与出图"
                >
                  <img src={u} alt="" />
                  {selected.has(u) && <span className="sedit__el-check">✓</span>}
                </button>
                <div className="sedit__el-meta">
                  <span className="sedit__el-name">上传</span>
                </div>
                <button
                  type="button"
                  className="sedit__el-mng"
                  onClick={() => setExtraRefs((a) => a.filter((_, j) => j !== i))}
                >
                  移除
                </button>
              </div>
            ))}
            <button type="button" className="sedit__el-add" onClick={() => refFileRef.current?.click()}>
              <span>+</span>
              上传素材
            </button>
          </div>

          <div className="sedit__sub">生成提示词</div>
          <textarea
            className="sedit__ta sedit__ta--prompt"
            value={imgPrompt}
            placeholder="该分镜图的生成提示词,可修改…"
            onChange={(e) => setImgPrompt(e.target.value)}
            onBlur={() => imgPrompt !== (shot.imagePrompt || '') && onPatch({ imagePrompt: imgPrompt })}
          />

          <label className="sedit__carry">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
            携带当前分镜图(在现有画面上修改)
          </label>

          <button type="button" className="sedit__gen" disabled={!!regenerating} onClick={doGenerate}>
            {regenerating ? '生成中…' : '✦ 生成分镜图'}
          </button>
        </div>
      </div>

      {/* ── 台词 / 字幕 / 音效(全宽,即时自动保存)── */}
      <div className="sedit__texts">
        <TextField
          icon={ICON.line}
          title="台词"
          value={shot.line || ''}
          placeholder={`${shot.no}的台词/旁白…`}
          onChange={(v) => onPatch({ line: v })}
        />
        <TextField
          icon={ICON.subtitle}
          title="字幕"
          value={shot.subtitle || ''}
          placeholder={`${shot.no}的字幕…`}
          onChange={(v) => onPatch({ subtitle: v })}
        />
        <TextField
          icon={ICON.sfx}
          title="音效"
          value={shot.sfx || ''}
          placeholder={`${shot.no}的音效…`}
          onChange={(v) => onPatch({ sfx: v })}
        />
      </div>

      <input
        ref={refFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void addExtra(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

const ICON = {
  line: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9 9 0 0 1-4-1L3 20l1-3.5a8.38 8.38 0 0 1-1-4A8.5 8.5 0 0 1 21 11.5z" />
    </svg>
  ),
  subtitle: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 14h4M14 14h3M7 11h3M13 11h4" />
    </svg>
  ),
  sfx: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
    </svg>
  ),
}

function TextField({
  icon,
  title,
  value,
  placeholder,
  onChange,
}: {
  icon: React.ReactNode
  title: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="sedit__tf">
      <div className="sedit__tf-head">
        <span className="sedit__tf-icon">{icon}</span>
        {title}
      </div>
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
