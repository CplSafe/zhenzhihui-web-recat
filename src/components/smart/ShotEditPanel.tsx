/**
 * ShotEditPanel — 右侧「素材修改」面板(镜头编排 / 视频生成 两页共用)。
 *
 * 逻辑(对齐 2.0 + 设计图):
 *  - 素材 = 该镜的各个独立元素(人物/产品/场景…),逐个列出;每个元素可上传替换 / 点开管理版本。
 *  - 分镜图 = 这些元素组合生成出来的画面;「素材历史(点击切换)」= 该镜分镜图的多个版本。
 *  - 「描述 / 修改建议」+ 提交 = 用当前元素 + 这句意见重新组合生成新分镜图(进素材历史)。
 *  - 台词 / 字幕 / 音效 = 各 textarea + 提交。
 * 受控:shot + 各回调;自身只持有"输入框草稿"本地态(切换分镜时重置)。
 */
import { useEffect, useRef, useState } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import './ShotEditPanel.css'

interface ShotEditPanelProps {
  shot: Shot
  /** 分镜图重组生成中 */
  regenerating?: boolean
  /** 点元素 → 打开版本管理(SubjectAssetDialog) */
  onOpenElement?: (name: string) => void
  /** 上传替换某元素 */
  onUploadElement?: (name: string, file: File) => void
  /** 素材历史:切换该镜分镜图版本 */
  onSwitchImageVersion: (url: string) => void
  /** 描述/修改建议 → 重组生成新分镜图 */
  onRegenerateImage: (shot: Shot, feedback: string) => void
  /** 台词/字幕/音效 提交 */
  onSubmitField: (field: 'line' | 'subtitle' | 'sfx', value: string) => void
}

const stripAt = (t: string) => String(t || '').replace(/^@/, '').trim()

export default function ShotEditPanel({
  shot,
  regenerating,
  onOpenElement,
  onUploadElement,
  onSwitchImageVersion,
  onRegenerateImage,
  onSubmitField,
}: ShotEditPanelProps) {
  const uploadFor = useRef<string>('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  // 输入框草稿(切换分镜时重置)
  const [feedback, setFeedback] = useState('')
  const [line, setLine] = useState(shot.line || '')
  const [subtitle, setSubtitle] = useState(shot.subtitle || '')
  const [sfx, setSfx] = useState(shot.sfx || '')
  useEffect(() => {
    setFeedback('')
    setLine(shot.line || '')
    setSubtitle(shot.subtitle || '')
    setSfx(shot.sfx || '')
  }, [shot.id, shot.line, shot.subtitle, shot.sfx])

  const current = shot.image || ''
  const versions = shot.imageVersions || []

  const triggerUpload = (name: string) => {
    uploadFor.current = name
    fileRef.current?.click()
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
                  <button type="button" className="sedit__el-upload" onClick={() => triggerUpload(name)}>
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

      {/* 素材历史(点击切换)= 该镜分镜图的多个版本 */}
      {versions.length > 0 && (
        <>
          <div className="sedit__hist-title">素材历史（点击切换）</div>
          <div className="sedit__hist-row">
            {versions.map((url, i) => (
              <button
                key={i}
                type="button"
                className={`sedit__hist${url === current ? ' is-active' : ''}`}
                onClick={() => onSwitchImageVersion(url)}
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

      {/* 描述 / 修改建议 → 用元素 + 当前画面重新组合生成分镜图 */}
      <div className="sedit__field">
        <textarea
          className="sedit__ta"
          value={feedback}
          maxLength={500}
          placeholder="请输入素材的描述或修改建议…(据此重新组合元素生成分镜图)"
          onChange={(e) => setFeedback(e.target.value)}
        />
        <div className="sedit__field-foot">
          <span className="sedit__count">{feedback.length}/500</span>
          <button
            type="button"
            className="sedit__submit"
            disabled={!!regenerating}
            onClick={() => onRegenerateImage(shot, feedback.trim())}
          >
            {regenerating ? '生成中…' : '提交'}
          </button>
        </div>
      </div>

      {/* 台词 / 字幕 / 音效 */}
      <FieldBlock
        title="台词"
        value={line}
        placeholder={`${shot.no}中识别到的台词文本…`}
        onChange={setLine}
        onSubmit={() => onSubmitField('line', line.trim())}
      />
      <FieldBlock
        title="字幕"
        value={subtitle}
        placeholder={`${shot.no}中识别到的字幕文本…`}
        onChange={setSubtitle}
        onSubmit={() => onSubmitField('subtitle', subtitle.trim())}
      />
      <FieldBlock
        title="音效"
        value={sfx}
        placeholder={`${shot.no}中识别到的音效文本…`}
        onChange={setSfx}
        onSubmit={() => onSubmitField('sfx', sfx.trim())}
      />

      <input
        ref={fileRef}
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
    </div>
  )
}

function FieldBlock({
  title,
  value,
  placeholder,
  onChange,
  onSubmit,
}: {
  title: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  onSubmit: () => void
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
      <div className="sedit__field-foot">
        <span className="sedit__count">{value.length}/500</span>
        <button type="button" className="sedit__submit" onClick={onSubmit}>
          提交
        </button>
      </div>
    </div>
  )
}
