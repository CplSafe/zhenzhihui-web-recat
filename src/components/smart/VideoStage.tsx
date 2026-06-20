/**
 * 生成视频步骤:左=分镜列表(每镜的分镜图 + 视频状态),右=选中镜头的视频预览 + 修改/重生成。
 * 每镜视频由该镜分镜图(图生视频)生成。
 */
import { useEffect, useState } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import './VideoStage.css'

interface VideoStageProps {
  shots: Shot[]
  /** 正在生成视频的镜头(键为 shot.id) */
  generating?: Record<string | number, boolean>
  onRegenerateClip?: (shot: Shot, note?: string) => void
}

export default function VideoStage({ shots, generating = {}, onRegenerateClip }: VideoStageProps) {
  const [selectedId, setSelectedId] = useState<string | number | null>(shots[0]?.id ?? null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!shots.some((s) => s.id === selectedId)) setSelectedId(shots[0]?.id ?? null)
  }, [shots, selectedId])

  const selected = shots.find((s) => s.id === selectedId) || null

  return (
    <div className="vstage">
      {/* 左:分镜列表 */}
      <div className="vstage__list">
        <div className="vstage__title">分镜列表</div>
        {shots.map((s) => {
          const thumb = s.image || s.subjects.find((x) => x.image)?.image
          return (
            <button
              key={s.id}
              type="button"
              className={`vstage__card${s.id === selectedId ? ' is-active' : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              <div className="vstage__info">
                <span className="vstage__no">{s.no}</span>
                <span className="vstage__badge">
                  {generating[s.id] ? '生成中…' : s.videoUrl ? '✓ 已生成' : '待生成'}
                </span>
              </div>
              <div className="vstage__thumb">
                {thumb ? <img src={thumb} alt="" /> : <span className="vstage__thumb-ph">{s.no}</span>}
                {generating[s.id] && (
                  <div className="vstage__gen">
                    <span className="vstage__gen-spin" aria-hidden="true" />
                  </div>
                )}
              </div>
            </button>
          )
        })}
        {!shots.length && <div className="vstage__empty">暂无分镜</div>}
      </div>

      {/* 右:视频预览 + 修改 */}
      <div className="vstage__main">
        {selected ? (
          <>
            <div className="vstage__title">
              视频预览 <span className="vstage__hint">（{selected.no}）</span>
            </div>
            <div className="vstage__player">
              {generating[selected.id] ? (
                <div className="vstage__player-ph">
                  <span className="vstage__gen-spin" aria-hidden="true" />
                  视频生成中…
                </div>
              ) : selected.videoUrl ? (
                <video src={selected.videoUrl} controls playsInline preload="metadata" />
              ) : (
                <div className="vstage__player-ph">暂无视频,点下方「重新生成此镜」</div>
              )}
            </div>

            <div className="vstage__meta">
              {selected.line && <div><b>台词</b>:{selected.line}</div>}
              {selected.subtitle && <div><b>字幕</b>:{selected.subtitle}</div>}
              {selected.sfx && <div><b>音效</b>:{selected.sfx}</div>}
            </div>

            <div className="vstage__modify">
              <textarea
                className="vstage__note"
                value={note}
                placeholder="对该镜视频提出修改意见(可选)…"
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                className="vstage__btn"
                disabled={!!generating[selected.id]}
                onClick={() => onRegenerateClip?.(selected, note.trim() || undefined)}
              >
                {generating[selected.id] ? '生成中…' : '重新生成此镜'}
              </button>
            </div>
          </>
        ) : (
          <div className="vstage__empty">请选择左侧分镜</div>
        )}
      </div>
    </div>
  )
}
