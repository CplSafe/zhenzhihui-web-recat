/**
 * 镜头编排右侧面板:编辑选中分镜的「分镜图」(成片画面)+ 画面描述 + 台词/字幕/音效。
 * 分镜图 = 用画面描述 + 素材生成;此处可预览、切换历史版本、上传替换、重新生成。
 * 每个修改框无提交、改动即时保存,并带 AI 润色。
 */
import { useRef } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import EditField from './EditField'
import './MaterialEditPanel.css'

interface MaterialEditPanelProps {
  shot: Shot
  onPatch: (patch: Partial<Shot>) => void
  onRegenerate?: (shot: Shot) => void
  regenerating?: boolean
}

export default function MaterialEditPanel({ shot, onPatch, onRegenerate, regenerating }: MaterialEditPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const current = shot.image || ''
  const history = shot.imageVersions || []

  const onFile = (files: FileList | null) => {
    if (!files?.length) return
    const url = URL.createObjectURL(files[0])
    onPatch({ image: url, imageVersions: [...history, url] })
  }

  return (
    <div className="medit">
      <div className="medit__head">分镜图</div>

      <div className="medit__mat">
        <div className="medit__main">
          {regenerating ? (
            <span className="medit__main-ph">生成中…</span>
          ) : current ? (
            <img src={current} alt="" />
          ) : (
            <span className="medit__main-ph">暂无分镜图</span>
          )}
        </div>
        <div className="medit__frame-actions">
          <button type="button" className="medit__upload" onClick={() => fileRef.current?.click()}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
            </svg>
            上传替换
          </button>
          <button
            type="button"
            className="medit__regen"
            onClick={() => onRegenerate?.(shot)}
            disabled={!!regenerating}
          >
            {regenerating ? '生成中…' : '重新生成'}
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
        </div>
        {history.length > 1 && (
          <div className="medit__history">
            <div className="medit__history-title">历史版本（点击切换）</div>
            <div className="medit__history-row">
              {history.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  className={`medit__hist${url === current ? ' is-active' : ''}`}
                  onClick={() => onPatch({ image: url })}
                >
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <EditField
        label="画面描述"
        value={shot.desc || ''}
        onChange={(v) => onPatch({ desc: v })}
        kind="script"
        placeholder="这一镜头的画面、运镜、节奏…(改后可重新生成分镜图)"
        rows={3}
      />
      <EditField
        label="台词"
        value={shot.line || ''}
        onChange={(v) => onPatch({ line: v })}
        kind="line"
        placeholder={`${shot.no}的台词/旁白…`}
      />
      <EditField
        label="字幕"
        value={shot.subtitle || ''}
        onChange={(v) => onPatch({ subtitle: v })}
        kind="subtitle"
        placeholder={`${shot.no}的字幕…`}
      />
      <EditField
        label="音效"
        value={shot.sfx || ''}
        onChange={(v) => onPatch({ sfx: v })}
        kind="sound"
        placeholder={`${shot.no}的音效…`}
      />
    </div>
  )
}
