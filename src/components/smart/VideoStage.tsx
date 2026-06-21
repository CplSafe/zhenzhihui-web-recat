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
  /** 生成中的阶段文案(如「人脸脱敏 2/9…」),缺省显示「视频生成中…」 */
  videoStatusText?: string
  /** 人脸脱敏调试:每镜的输入/输出/模型/状态(开发可见) */
  faceBlurDebug?: {
    no?: string
    srcAssetId?: number
    outAssetId?: number
    outUrl?: string
    model?: number
    status?: string
    error?: string
    ok?: boolean
    cached?: boolean
  }[]
  /** 整片历史版本(点击切换) */
  videoVersions?: { url: string; assetId: number }[]
  onSwitchVideo?: (v: { url: string; assetId: number }) => void
  onShotsChange: (shots: Shot[]) => void
  onOpenElement?: (name: string) => void
  projectImages?: { url: string; source: 'ai' | 'upload' }[]
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
  videoStatusText,
  faceBlurDebug,
  videoVersions = [],
  onSwitchVideo,
  onShotsChange,
  onOpenElement,
  projectImages,
  onRegenerateImage,
  onRegenerateVideo,
  onDownloadVideo,
  onPrev,
  debug,
}: VideoStageProps) {
  const [selectedId, setSelectedId] = useState<string | number | null>(shots[0]?.id ?? null)
  const [note, setNote] = useState('')
  const [showDebug, setShowDebug] = useState(false)
  const [showBlurDebug, setShowBlurDebug] = useState(false)
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
          {debugEnabled && faceBlurDebug && faceBlurDebug.length > 0 && (
            <button type="button" className="vstage__debug-btn" onClick={() => setShowBlurDebug(true)}>
              🐞 脱敏调试
            </button>
          )}
        </div>
        <div className="vstage__player">
          {videoGenerating ? (
            <div className="vstage__player-ph">
              <span className="vstage__spin" aria-hidden="true" />
              {videoStatusText || '视频生成中…'}
            </div>
          ) : videoUrl ? (
            <video
              src={videoUrl}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                // 修进度条 bug:部分 MP4 初始 duration=Infinity(moov 在文件尾),
                // 进度条会从中间窜到结尾。跳到极大时间强制浏览器算出真实时长,再跳回 0。
                const v = e.currentTarget
                if (!Number.isFinite(v.duration)) {
                  const back = () => {
                    v.currentTime = 0
                    v.removeEventListener('timeupdate', back)
                  }
                  v.addEventListener('timeupdate', back)
                  v.currentTime = 1e7
                }
              }}
            />
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
          projectImages={projectImages}
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

      {/* 脱敏调试弹框:正式出视频前对每张分镜图的人脸脱敏结果(开发可见) */}
      {debugEnabled && showBlurDebug && faceBlurDebug && faceBlurDebug.length > 0 && (
        <div className="vdbg-mask" onClick={(e) => e.target === e.currentTarget && setShowBlurDebug(false)}>
          <div className="vdbg" role="dialog" aria-label="人脸脱敏调试信息">
            <div className="vdbg__head">
              <span>人脸脱敏 · 调试信息</span>
              <button type="button" onClick={() => setShowBlurDebug(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="vdbg__body">
              <div className="vdbg__sec-title">
                能力 image.face_detect · 共 {faceBlurDebug.length} 张 · 成功{' '}
                {faceBlurDebug.filter((b) => b.ok).length} 张
              </div>
              {faceBlurDebug.map((b, i) => (
                <div className="vdbg__shot" key={i}>
                  <div className="vdbg__shot-no">
                    {b.no || `图${i + 1}`} · {b.ok ? (b.cached ? '✓ 复用缓存' : '✓ 脱敏成功') : '✗ 失败(回退原图)'}
                  </div>
                  <div className="vdbg__shot-body">
                    {b.outUrl ? <img src={b.outUrl} alt="" /> : <div className="vdbg__noimg">无图</div>}
                    <div className="vdbg__shot-text">
                      <div><b>模型ID</b>:{b.model || '—'}</div>
                      <div><b>原图 asset</b>:{b.srcAssetId || '—'}</div>
                      <div><b>脱敏 asset</b>:{b.outAssetId || '—'}</div>
                      <div><b>任务状态</b>:{b.status || '—'}</div>
                      {b.error ? <div><b>错误</b>:{b.error}</div> : null}
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
