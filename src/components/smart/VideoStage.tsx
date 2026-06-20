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
  onShotsChange: (shots: Shot[]) => void
  onOpenElement?: (name: string) => void
  onUploadElement?: (name: string, file: File) => void
  onRegenerateImage: (shot: Shot, opts: { feedback?: string; editPrompt?: string; extraRefUrls?: string[] }) => void
  /** 重新生成整片(note=对整片的修改意见) */
  onRegenerateVideo: (note?: string) => void
  /** 保存视频到项目管理 */
  onSaveVideo: () => void
  savingVideo?: boolean
  onPrev?: () => void
}

export default function VideoStage({
  shots,
  generating = {},
  videoUrl,
  videoGenerating,
  onShotsChange,
  onOpenElement,
  onUploadElement,
  onRegenerateImage,
  onRegenerateVideo,
  onSaveVideo,
  savingVideo,
  onPrev,
}: VideoStageProps) {
  const [selectedId, setSelectedId] = useState<string | number | null>(shots[0]?.id ?? null)
  const [note, setNote] = useState('')
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
        <div className="vstage__title">视频内容修改</div>
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
          <button
            type="button"
            className="vstage__btn vstage__btn--ghost"
            onClick={onSaveVideo}
            disabled={!!savingVideo}
          >
            {savingVideo ? '保存中…' : '保存视频'}
          </button>
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
          regenerating={!!generating[selected.id]}
          onOpenElement={onOpenElement}
          onUploadElement={onUploadElement}
          onPatch={patchSel}
          onRegenerateImage={onRegenerateImage}
        />
      ) : (
        <div className="vstage__empty">请选择左侧分镜</div>
      )}
    </div>
  )
}
