/**
 * VideoStage — 视频生成(2.1)。
 * 左:分镜列表(ShotList);中:完整视频(未生成时为空)+ 对整片提修改意见 + 总按钮;右:素材修改面板。
 * 视频是「整片」一次生成(所有分镜图+脚本+台词+字幕+音效 → seedance),非逐镜。
 */
import { useEffect, useState } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import ShotList from '../ShotList'
import ShotEditPanel from '../ShotEditPanel'
import styles from './VideoStage.module.less'

// 等待时轮播的「视频制作小技巧」
const VIDEO_TIPS = [
  '分镜图越清晰、主体越一致,成片的人物/产品就越稳定。',
  '台词、字幕、音效都会一起送进生成,先补全文案再出片效果更好。',
  '不参与生成的分镜可在左侧取消勾选,聚焦核心镜头更快出片。',
  '镜头时长建议 2–5 秒,节奏更紧凑、更适合短视频平台。',
  '想换风格?回到分镜编排调整提示词与素材,再重新生成整片。',
  '生成的视频会进入项目「历史版本」,可随时切换、下载。',
  '人物镜头建议用同一张参考图,跨镜头形象更统一。',
]

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
    shots: {
      no: string
      duration: string
      desc?: string
      line?: string
      subtitle?: string
      sfx?: string
      image?: string
    }[]
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
  const [tipIdx, setTipIdx] = useState(0)
  const debugEnabled = import.meta.env.DEV // 正式版自动隐藏
  useEffect(() => {
    if (!shots.some((s) => s.id === selectedId)) setSelectedId(shots[0]?.id ?? null)
  }, [shots, selectedId])
  // 生成等待时轮播小技巧(等待较久,给用户一点收获)
  useEffect(() => {
    if (!videoGenerating) return
    const t = window.setInterval(() => setTipIdx((i) => (i + 1) % VIDEO_TIPS.length), 4500)
    return () => window.clearInterval(t)
  }, [videoGenerating])

  const selected = shots.find((s) => s.id === selectedId) || null
  const patchSel = (patch: Partial<Shot>) => {
    if (!selected) return
    onShotsChange(shots.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)))
  }

  return (
    <div className={styles.vstage}>
      <ShotList
        className={styles.colList}
        shots={shots}
        selectedId={selectedId}
        onSelect={setSelectedId}
        generating={generating}
        onShotsChange={onShotsChange}
        locked
        includeOf={(s) => s.includeInVideo !== false}
        onToggleInclude={(id) =>
          onShotsChange(shots.map((s) => (s.id === id ? { ...s, includeInVideo: !(s.includeInVideo !== false) } : s)))
        }
      />

      {/* 中:完整视频 + 修改意见 + 总按钮 */}
      <div className={styles.vstageCenter}>
        <div className={styles.vstageTitle}>
          视频内容修改
          {debugEnabled && debug && (
            <button type="button" className={styles.vstageDebugBtn} onClick={() => setShowDebug(true)}>
              🐞 调试信息
            </button>
          )}
          {debugEnabled && faceBlurDebug && faceBlurDebug.length > 0 && (
            <button type="button" className={styles.vstageDebugBtn} onClick={() => setShowBlurDebug(true)}>
              🐞 脱敏调试
            </button>
          )}
        </div>
        <div className={styles.vstagePlayer}>
          {videoGenerating ? (
            <div className={`${styles.vstagePlayerPh} ${styles.vstageWaiting}`}>
              <span className={styles.vstageSpin} aria-hidden="true" />
              <div className={styles.vstageWaitingStatus}>{videoStatusText || '视频生成中…'}</div>
              <div className={styles.vstageWaitingNote}>
                视频生成耗时较长;生成后会自动保存,你现在可以新建一个项目继续创作。
              </div>
              <div className={styles.vstageWaitingTip} key={tipIdx}>
                💡 {VIDEO_TIPS[tipIdx]}
              </div>
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
            <div className={styles.vstagePlayerPh}>暂无视频,点下方「重新生成视频」生成整片</div>
          )}
        </div>

        {videoVersions.length > 1 && (
          <div className={styles.vstageVersions}>
            <span className={styles.vstageVersionsTitle}>视频版本(点击切换)</span>
            <div className={styles.vstageVersionsRow}>
              {videoVersions.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className={`${styles.vstageVer}${v.url === videoUrl ? ' ' + styles.active : ''}`}
                  onClick={() => onSwitchVideo?.(v)}
                  title={`版本${i + 1}`}
                >
                  <video src={v.url} muted preload="metadata" playsInline />
                  <span className={styles.vstageVerNo}>{i + 1}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.vstageModify}>
          <textarea
            className={styles.vstageNote}
            value={note}
            placeholder="对这条视频提出修改意见(可选)…"
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className={styles.vstageSend}
            disabled={!!videoGenerating}
            title="按此意见重新生成整片"
            onClick={() => onRegenerateVideo(note.trim() || undefined)}
            aria-label="按修改意见重新生成"
          >
            ➤
          </button>
        </div>

        {/* 总按钮 */}
        <div className={styles.vstageActions}>
          {onPrev && (
            <button type="button" className={`${styles.vstageBtn} ${styles.vstageBtnGhost}`} onClick={onPrev}>
              上一步
            </button>
          )}
          {onDownloadVideo && (
            <button
              type="button"
              className={`${styles.vstageBtn} ${styles.vstageBtnGhost}`}
              onClick={onDownloadVideo}
              disabled={!videoUrl || !!videoGenerating}
            >
              下载视频
            </button>
          )}
          <button
            type="button"
            className={`${styles.vstageBtn} ${styles.vstageBtnPrimary}`}
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
          className={styles.colEdit}
          shot={selected}
          compact
          regenerating={!!generating[selected.id]}
          projectImages={projectImages}
          onOpenElement={onOpenElement}
          onPatch={patchSel}
          onRegenerateImage={onRegenerateImage}
        />
      ) : (
        <div className={styles.vstageEmpty}>请选择左侧分镜</div>
      )}

      {/* 调试弹框:实际喂给视频模型的内容(开发可见) */}
      {debugEnabled && showDebug && debug && (
        <div className={styles.vdbgMask} onClick={(e) => e.target === e.currentTarget && setShowDebug(false)}>
          <div className={styles.vdbg} role="dialog" aria-label="视频生成调试信息">
            <div className={styles.vdbgHead}>
              <span>视频生成 · 调试信息</span>
              <button type="button" onClick={() => setShowDebug(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className={styles.vdbgBody}>
              <div className={styles.vdbgSecTitle}>① 提示词(整片时间线,送给 seedance)</div>
              <pre className={styles.vdbgPre}>{debug.prompt}</pre>

              <div className={styles.vdbgSecTitle}>② 参考帧(全部分镜图按镜头顺序送入图生视频)</div>
              {debug.shots.some((s) => s.image) ? (
                <div className={styles.vdbgImgrow}>
                  {debug.shots.map((s, i) =>
                    s.image ? <img key={i} className={styles.vdbgImg} src={s.image} alt={s.no} /> : null,
                  )}
                </div>
              ) : (
                <div className={styles.vdbgMuted}>无</div>
              )}

              <div className={styles.vdbgSecTitle}>③ 各分镜(画面/台词/字幕/音效 + 分镜图)</div>
              {debug.shots.map((s, i) => (
                <div className={styles.vdbgShot} key={i}>
                  <div className={styles.vdbgShotNo}>
                    {s.no} · {s.duration}
                  </div>
                  <div className={styles.vdbgShotBody}>
                    {s.image ? <img src={s.image} alt="" /> : <div className={styles.vdbgNoimg}>无图</div>}
                    <div className={styles.vdbgShotText}>
                      <div>
                        <b>画面</b>:{s.desc || '—'}
                      </div>
                      <div>
                        <b>台词</b>:{s.line || '—'}
                      </div>
                      <div>
                        <b>字幕</b>:{s.subtitle || '—'}
                      </div>
                      <div>
                        <b>音效</b>:{s.sfx || '—'}
                      </div>
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
        <div className={styles.vdbgMask} onClick={(e) => e.target === e.currentTarget && setShowBlurDebug(false)}>
          <div className={styles.vdbg} role="dialog" aria-label="人脸脱敏调试信息">
            <div className={styles.vdbgHead}>
              <span>人脸脱敏 · 调试信息</span>
              <button type="button" onClick={() => setShowBlurDebug(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className={styles.vdbgBody}>
              <div className={styles.vdbgSecTitle}>
                能力 image.face_detect · 共 {faceBlurDebug.length} 张 · 成功 {faceBlurDebug.filter((b) => b.ok).length}{' '}
                张
              </div>
              {faceBlurDebug.map((b, i) => (
                <div className={styles.vdbgShot} key={i}>
                  <div className={styles.vdbgShotNo}>
                    {b.no || `图${i + 1}`} · {b.ok ? (b.cached ? '✓ 复用缓存' : '✓ 脱敏成功') : '✗ 失败(回退原图)'}
                  </div>
                  <div className={styles.vdbgShotBody}>
                    {b.outUrl ? <img src={b.outUrl} alt="" /> : <div className={styles.vdbgNoimg}>无图</div>}
                    <div className={styles.vdbgShotText}>
                      <div>
                        <b>模型ID</b>:{b.model || '—'}
                      </div>
                      <div>
                        <b>原图 asset</b>:{b.srcAssetId || '—'}
                      </div>
                      <div>
                        <b>脱敏 asset</b>:{b.outAssetId || '—'}
                      </div>
                      <div>
                        <b>任务状态</b>:{b.status || '—'}
                      </div>
                      {b.error ? (
                        <div>
                          <b>错误</b>:{b.error}
                        </div>
                      ) : null}
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
