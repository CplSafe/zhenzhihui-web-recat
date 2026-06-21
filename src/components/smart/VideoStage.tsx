/**
 * VideoStage — 视频生成(2.1)。
 * 左:分镜列表(ShotList);中:完整视频(未生成时为空)+ 对整片提修改意见 + 总按钮;右:素材修改面板。
 * 视频是「整片」一次生成(所有分镜图+脚本+台词+字幕+音效 → seedance),非逐镜。
 */
import { useEffect, useState } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import ShotList from './ShotList'
import ShotEditPanel from './ShotEditPanel'
import './VideoStage.css'

interface VideoStageProps {
  shots: Shot[]
  /** 正在生成分镜图的镜头(右面板/左列表转圈) */
  generating?: Record<string | number, boolean>
  /** 当前整片视频 url */
  videoUrl?: string
  /** 整片生成中 */
  videoGenerating?: boolean
  /** 整片历史版本(点击切换) */
  videoVersions?: { url: string; assetId: number }[]
  onSwitchVideo?: (v: { url: string; assetId: number }) => void
  onShotsChange: (shots: Shot[]) => void
  onOpenElement?: (name: string) => void
  onRegenerateImage: (shot: Shot, opts: { editPrompt?: string; refUrls?: string[]; carryCurrent?: boolean }) => void
  /** 重新生成整片(note=对整片的修改意见) */
  onRegenerateVideo: (note?: string) => void
  /** 下载当前整片视频 */
  onDownloadVideo?: () => void
  onPrev?: () => void
  /** 调试:实际喂给视频模型的提示词/参考图/各分镜文本(开发可见,正式隐藏) */
  debug?: {
    prompt: string
    firstImage: string
    shots: { no: string; duration: string; desc?: string; line?: string; subtitle?: string; sfx?: string; image?: string }[]
  }
}

export default function VideoStage({
  shots,
  generating = {},
  videoUrl,
  videoGenerating,
  videoVersions = [],
  onSwitchVideo,
  onShotsChange,
  onOpenElement,
  onRegenerateImage,
  onRegenerateVideo,
  onDownloadVideo,
  onPrev,
  debug,
}: VideoStageProps) {
  const [selectedId, setSelectedId] = useState<string | number | null>(shots[0]?.id ?? null)
  const [note, setNote] = useState('')
  const [showDebug, setShowDebug] = useState(false)
  const debugEnabled = import.meta.env.DEV // 正式版自动隐藏
  useEffect(() => {
    if (!shots.some((s) => s.id === selectedId)) setSelectedId(shots[0]?.id ?? null)
  }, [shots, selectedId])

  const selected = shots.find((s) => s.id === selectedId) || null
  const patchSel = (patch: Partial<Shot>) => {
    if (!selected) return
    onShotsChange(shots.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)))
  }

  return (
    <div className="vstage">
      <ShotList
        shots={shots}
        selectedId={selectedId}
        onSelect={setSelectedId}
        generating={generating}
        onShotsChange={onShotsChange}
      />

      {/* 中:完整视频 + 修改意见 + 总按钮 */}
      <div className="vstage__center">
        <div className="vstage__title">
          视频内容修改
          {debugEnabled && debug && (
            <button type="button" className="vstage__debug-btn" onClick={() => setShowDebug(true)}>
              🐞 调试信息
            </button>
          )}
        </div>
        <div className="vstage__player">
          {videoGenerating ? (
            <div className="vstage__player-ph">
              <span className="vstage__spin" aria-hidden="true" />
              视频生成中…
            </div>
          ) : videoUrl ? (
            <video src={videoUrl} controls playsInline preload="metadata" />
          ) : (
            <div className="vstage__player-ph">暂无视频,点下方「重新生成视频」生成整片</div>
          )}
        </div>

        {videoVersions.length > 1 && (
          <div className="vstage__versions">
            <span className="vstage__versions-title">视频版本(点击切换)</span>
            <div className="vstage__versions-row">
              {videoVersions.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className={`vstage__ver${v.url === videoUrl ? ' is-active' : ''}`}
                  onClick={() => onSwitchVideo?.(v)}
                  title={`版本${i + 1}`}
                >
                  <video src={v.url} muted preload="metadata" playsInline />
                  <span className="vstage__ver-no">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="vstage__modify">
          <textarea
            className="vstage__note"
            value={note}
            placeholder="对这条视频提出修改意见(可选)…"
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="vstage__send"
            disabled={!!videoGenerating}
            title="按此意见重新生成整片"
            onClick={() => onRegenerateVideo(note.trim() || undefined)}
            aria-label="按修改意见重新生成"
          >
            ➤
          </button>
        </div>

        {/* 总按钮 */}
        <div className="vstage__actions">
          {onPrev && (
            <button type="button" className="vstage__btn vstage__btn--ghost" onClick={onPrev}>
              上一步
            </button>
          )}
          {onDownloadVideo && (
            <button
              type="button"
              className="vstage__btn vstage__btn--ghost"
              onClick={onDownloadVideo}
              disabled={!videoUrl || !!videoGenerating}
            >
              下载视频
            </button>
          )}
          <button
            type="button"
            className="vstage__btn vstage__btn--primary"
            onClick={() => onRegenerateVideo()}
            disabled={!!videoGenerating}
          >
            {videoGenerating ? '生成中…' : '重新生成视频'}
          </button>
        </div>
      </div>

      {/* 右:素材修改面板(无底部按钮,总控在中间) */}
      {selected ? (
        <ShotEditPanel
          shot={selected}
          compact
          regenerating={!!generating[selected.id]}
          onOpenElement={onOpenElement}
          onPatch={patchSel}
          onRegenerateImage={onRegenerateImage}
        />
      ) : (
        <div className="vstage__empty">请选择左侧分镜</div>
      )}

      {/* 调试弹框:实际喂给视频模型的内容(开发可见) */}
      {debugEnabled && showDebug && debug && (
        <div className="vdbg-mask" onClick={(e) => e.target === e.currentTarget && setShowDebug(false)}>
          <div className="vdbg" role="dialog" aria-label="视频生成调试信息">
            <div className="vdbg__head">
              <span>视频生成 · 调试信息</span>
              <button type="button" onClick={() => setShowDebug(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="vdbg__body">
              <div className="vdbg__sec-title">① 提示词(整片时间线,送给 seedance)</div>
              <pre className="vdbg__pre">{debug.prompt}</pre>

              <div className="vdbg__sec-title">② 参考帧(全部分镜图按镜头顺序送入图生视频)</div>
              {debug.shots.some((s) => s.image) ? (
                <div className="vdbg__imgrow">
                  {debug.shots.map((s, i) => (s.image ? <img key={i} className="vdbg__img" src={s.image} alt={s.no} /> : null))}
                </div>
              ) : (
                <div className="vdbg__muted">无</div>
              )}

              <div className="vdbg__sec-title">③ 各分镜(画面/台词/字幕/音效 + 分镜图)</div>
              {debug.shots.map((s, i) => (
                <div className="vdbg__shot" key={i}>
                  <div className="vdbg__shot-no">
                    {s.no} · {s.duration}
                  </div>
                  <div className="vdbg__shot-body">
                    {s.image ? <img src={s.image} alt="" /> : <div className="vdbg__noimg">无图</div>}
                    <div className="vdbg__shot-text">
                      <div><b>画面</b>:{s.desc || '—'}</div>
                      <div><b>台词</b>:{s.line || '—'}</div>
                      <div><b>字幕</b>:{s.subtitle || '—'}</div>
                      <div><b>音效</b>:{s.sfx || '—'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
