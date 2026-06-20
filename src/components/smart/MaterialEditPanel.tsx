/**
 * MaterialEditPanel — 选中分镜的「素材修改」面板(镜头编排 / 视频生成 复用)。
 * 素材预览 + 上传素材 + 素材历史(点击切换)+ 素材描述 / 台词 / 字幕 / 音效。
 * 每个修改框无提交按钮、改动即时回写(自动保存),并带 AI 润色(EditField)。
 */
import { useRef } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import EditField from './EditField'
import './MaterialEditPanel.css'

interface MaterialEditPanelProps {
  shot: Shot
  /** 可切换的素材历史(objectURL) */
  materials: string[]
  onPatch: (patch: Partial<Shot>) => void
}

export default function MaterialEditPanel({ shot, materials, onPatch }: MaterialEditPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const current = shot.image || shot.subjects.find((s) => s.image)?.image || ''
  // 历史 = 已有素材 ∪ 当前(去重)
  const history = Array.from(new Set([...(materials || []), ...shot.subjects.map((s) => s.image).filter(Boolean) as string[], current].filter(Boolean)))

  const onFile = (files: FileList | null) => {
    if (!files?.length) return
    onPatch({ image: URL.createObjectURL(files[0]) })
  }

  return (
    <div className="medit">
      <div className="medit__head">素材</div>

      <div className="medit__mat">
        <div className="medit__main">
          {current ? <img src={current} alt="" /> : <span className="medit__main-ph">暂无素材</span>}
        </div>
        <button type="button" className="medit__upload" onClick={() => fileRef.current?.click()}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M5 20h14" />
          </svg>
          上传素材
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            onFile(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="medit__history">
          <div className="medit__history-title">素材历史（点击切换）</div>
          <div className="medit__history-row">
            {history.length ? (
              history.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  className={`medit__hist${url === current ? ' is-active' : ''}`}
                  onClick={() => onPatch({ image: url })}
                >
                  <img src={url} alt="" />
                </button>
              ))
            ) : (
              <span className="medit__history-empty">暂无</span>
            )}
          </div>
        </div>
      </div>

      <EditField
        label="素材描述"
        value={shot.matDesc || ''}
        onChange={(v) => onPatch({ matDesc: v })}
        kind="generic"
        placeholder="请输入素材的描述或修改建议…"
        rows={2}
      />
      <EditField
        label="台词"
        value={shot.line || ''}
        onChange={(v) => onPatch({ line: v })}
        kind="line"
        placeholder={`${shot.no}中识别到的台词文本…`}
      />
      <EditField
        label="字幕"
        value={shot.subtitle || ''}
        onChange={(v) => onPatch({ subtitle: v })}
        kind="subtitle"
        placeholder={`${shot.no}中识别到的字幕文本…`}
      />
      <EditField
        label="音效"
        value={shot.sfx || ''}
        onChange={(v) => onPatch({ sfx: v })}
        kind="sound"
        placeholder={`${shot.no}中识别到的音效文本…`}
      />
    </div>
  )
}
