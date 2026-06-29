/**
 * VideoStage — 第四步「生成视频」(2.1 改版,Figma 441-5139)。
 *
 * 本步仅支持对【整片视频的具体帧】做修改,不再支持改分镜(增/删/改分镜均已移除)。
 * 布局:左 = 视频播放器 + 时间轴(时间刻度按视频真实秒数 + 帧缩略条);右 = 片段/整段修改框。
 * 交互:
 *  - 在时间轴上拖选(或点选某分镜片段)得到一段「具体帧」;选区蓝色描边 + 居中铅笔「修改」按钮。
 *    点铅笔在右侧新增一个【片段N修改】框(标题带该段秒数),最多 5 个,含 AI一键润色。
 *  - 片段框下方是「整段视频修改」框(含 AI一键润色,无提交按钮)。
 *  - 底部总按钮:上一步 / 保存视频 / 重新生成视频。重新生成把所有片段修改 + 整段修改合并成一段说明整片重生成。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import { polishText } from '@/api/aiPolish'
import { useToast } from '@/composables/useToast'
import VideoLoading from './VideoLoading'
import styles from './VideoStage.module.less'

// 帧缩略图缓存(模块级):key = `${videoUrl}::${帧数}`。
// 切步骤再回来 / 切视频版本再切回 时直接复用,避免重复逐秒抓帧(很慢)。
// 视频较多时限制条目数,避免内存膨胀(超出后淘汰最早的)。
const FRAME_THUMB_CACHE = new Map<string, string[]>()
const FRAME_THUMB_CACHE_MAX = 16
const frameThumbKey = (url: string, count: number) => `${url}::${count}`
function putFrameThumbCache(key: string, thumbs: string[]) {
  if (FRAME_THUMB_CACHE.has(key)) FRAME_THUMB_CACHE.delete(key)
  FRAME_THUMB_CACHE.set(key, thumbs)
  while (FRAME_THUMB_CACHE.size > FRAME_THUMB_CACHE_MAX) {
    const oldest = FRAME_THUMB_CACHE.keys().next().value
    if (oldest === undefined) break
    FRAME_THUMB_CACHE.delete(oldest)
  }
}

// 等待时轮播的「视频制作小技巧」
const VIDEO_TIPS = [
  '分镜图越清晰、主体越一致,成片的人物/产品就越稳定。',
  '台词、字幕、音效都会一起送进生成,先补全文案再出片效果更好。',
  '镜头时长建议 2–5 秒,节奏更紧凑、更适合短视频平台。',
  '想换风格?回到分镜编排调整提示词与素材,再重新生成整片。',
  '生成的视频会进入项目「历史版本」,可随时切换。',
  '选中时间轴上的片段,可以只对这一段提修改意见,描述越具体越好。',
]

interface VideoStageProps {
  shots: Shot[]
  /** 当前整片视频 url */
  videoUrl?: string
  /** 整片生成中 */
  videoGenerating?: boolean
  /** 生成中的阶段文案(如「人脸脱敏 2/9…」),缺省显示「视频生成中…」 */
  videoStatusText?: string
  /** 生成开始时间戳(ms,持久化):传给加载动效做进度锚点,切页面/刷新回来续算而非重头 */
  videoStartedAt?: number
  /** 加载动效主标题覆盖(缺省「视频生成中」);如爆款复制传「爆款复制生成中…」 */
  loadingTitle?: string
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
  /**
   * 重新生成 / 确认修改整片。
   * note=对整片/各片段的修改意见(合并成一段);opts.edit=true 表示「确认修改」——
   * 父级应基于原视频做修改(而非从分镜图重出整片)。
   */
  onRegenerateVideo: (note?: string, opts?: { edit?: boolean }) => void
  /** 下载当前整片视频(由父级弹本地保存位置后下载) */
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

const parseDur = (d: string): number => {
  const n = parseFloat(String(d || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 5
}
// 秒 → "0:05" 播放时间;一位小数 → "2.5s" 片段范围
const fmtClock = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
const fmtSec = (s: number) => `${s.toFixed(1)}s`

export default function VideoStage({
  shots,
  videoUrl,
  videoGenerating,
  videoStatusText,
  videoStartedAt,
  loadingTitle,
  faceBlurDebug,
  videoVersions = [],
  onSwitchVideo,
  onRegenerateVideo,
  onDownloadVideo,
  onPrev,
  debug,
}: VideoStageProps) {
  const { showToast } = useToast()
  const [overallNote, setOverallNote] = useState('')
  // 片段修改:固定两个框,各自独立保存「自己选中的帧范围 + 修改文案」(互不同步)
  const [frameSlots, setFrameSlots] = useState<{ start: number | null; end: number | null; text: string }[]>([
    { start: null, end: null, text: '' },
    { start: null, end: null, text: '' },
  ])
  // 视频修改描述:按「视频版本 url」记忆——每条历史版本各自带自己的修改说明,切换历史时跟着走
  const [noteByUrl, setNoteByUrl] = useState<Record<string, string>>({})
  // 本次点击「确认修改/生成」时的描述:点下立即显示,生成中也显示;生成完成后绑定到新版本 url
  const [pendingNote, setPendingNote] = useState('')
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null) // 时间轴待确认选区(秒)
  const [playSec, setPlaySec] = useState(0) // 播放头位置(秒)
  const [dur, setDur] = useState(0) // 视频真实时长(秒),0=未知
  const [frameThumbs, setFrameThumbs] = useState<string[] | null>(null) // 逐秒抓取的帧缩略图(CORS 失败则 null,回退占位)
  const [tipIdx, setTipIdx] = useState(0)
  const [showDebug, setShowDebug] = useState(false)
  const [showBlurDebug, setShowBlurDebug] = useState(false)
  const debugEnabled = import.meta.env.DEV // 正式版自动隐藏

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ s0: number } | null>(null)

  // 时长:优先视频真实时长;未知时回退分镜时长之和
  const shotsTotal = useMemo(
    () => shots.filter((s) => s.includeInVideo !== false).reduce((a, s) => a + parseDur(s.duration), 0),
    [shots],
  )
  const total = dur || shotsTotal || 10
  // 帧条:按视频真实时长「1 帧/秒」切分(15s 视频 = 15 帧),封顶 60 帧
  const frameCount = Math.max(1, Math.min(60, Math.round(total)))
  // 每帧覆盖 1 秒:[i, i+1)(末帧裁到总时长);缩略图来自逐秒抓帧,失败则显示秒标占位
  const frames = useMemo(
    () =>
      Array.from({ length: frameCount }, (_, i) => ({
        i,
        start: i,
        end: Math.min(i + 1, total),
        thumb: frameThumbs?.[i] || '',
      })),
    [frameCount, total, frameThumbs],
  )

  // 时间刻度(整秒;过长时按步长抽稀,约 10 个标签)
  const ticks = useMemo(() => {
    const step = total <= 12 ? 1 : Math.ceil(total / 10)
    const out: number[] = []
    for (let t = 0; t <= total + 0.001; t += step) out.push(Math.round(t))
    return out
  }, [total])

  // 生成等待时轮播小技巧
  useEffect(() => {
    if (!videoGenerating) return
    const t = window.setInterval(() => setTipIdx((i) => (i + 1) % VIDEO_TIPS.length), 4500)
    return () => window.clearInterval(t)
  }, [videoGenerating])
  // 切换视频源 → 重置时长/选区/播放头(帧缩略图交由下面的抓帧 effect 按缓存处理,不在此清空)
  useEffect(() => {
    setDur(0)
    setSel(null)
    setPlaySec(0)
  }, [videoUrl])

  // 逐秒抓取视频帧(1 帧/秒)用独立隐藏 <video>,不打扰主播放器。
  // 跨域无 CORS 头时 crossOrigin 会导致 canvas 被污染/加载失败 → 保持 null,渲染秒标占位。
  // 命中模块级缓存(同一 url + 帧数)时直接复用,切步骤/切版本回来秒显,不再重抓。
  useEffect(() => {
    if (!videoUrl) {
      setFrameThumbs(null)
      return
    }
    const key = frameThumbKey(videoUrl, frameCount)
    const cached = FRAME_THUMB_CACHE.get(key)
    if (cached) {
      setFrameThumbs(cached)
      return
    }
    if (total <= 0) return
    setFrameThumbs(null)
    let cancelled = false
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.preload = 'auto'
    v.src = videoUrl
    const canvas = document.createElement('canvas')
    const thumbs: string[] = []
    const capture = async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          v.onloadeddata = () => resolve()
          v.onerror = () => reject(new Error('load'))
        })
        if (cancelled) return
        // 帧条缩略图无需高清:96px 宽 + 较低 jpeg 质量,抓取更快、内存与 dataURL 更省
        const W = 96
        const H = Math.max(1, Math.round((v.videoHeight / (v.videoWidth || 1)) * W)) || 54
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        for (let i = 0; i < frameCount; i++) {
          if (cancelled) return
          const t = Math.min(i + 0.5, Math.max(0, total - 0.05))
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              v.removeEventListener('seeked', onSeeked)
              resolve()
            }
            v.addEventListener('seeked', onSeeked)
            v.currentTime = t
          })
          if (cancelled) return
          ctx.drawImage(v, 0, 0, W, H)
          thumbs.push(canvas.toDataURL('image/jpeg', 0.5)) // canvas 被污染会抛错 → 落到 catch
          if (!cancelled) setFrameThumbs(thumbs.slice()) // 渐进显示
        }
        // 完整抓完才写入缓存,供切步骤/切版本回来复用
        if (!cancelled && thumbs.length === frameCount) putFrameThumbCache(key, thumbs.slice())
      } catch {
        if (!cancelled) setFrameThumbs(null) // CORS/解码失败 → 用秒标占位
      }
    }
    void capture()
    return () => {
      cancelled = true
      v.removeAttribute('src')
      v.load()
    }
  }, [videoUrl, total, frameCount])

  // 时间轴上的像素 → 秒(以视频真实时长为基准,做到「秒数一一对应」)
  const secFromEvent = (e: { clientX: number }) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return frac * total
  }
  const onTrackPointerDown = (e: React.PointerEvent) => {
    if (!videoUrl) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const s = secFromEvent(e)
    dragRef.current = { s0: s }
    setSel({ start: s, end: s })
  }
  const onTrackPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const s = secFromEvent(e)
    const { s0 } = dragRef.current
    setSel({ start: Math.min(s0, s), end: Math.max(s0, s) })
  }
  const onTrackPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const s = secFromEvent(e)
    const { s0 } = dragRef.current
    dragRef.current = null
    // 几乎没拖动 → 视为「点选」:选中光标所在的那一帧(1 秒)
    if (Math.abs(s - s0) < total * 0.012) {
      const i = Math.min(frameCount - 1, Math.max(0, Math.floor(s)))
      setSel({ start: i, end: Math.min(total, i + 1) })
      if (videoRef.current && Number.isFinite(videoRef.current.duration)) videoRef.current.currentTime = s
    } else {
      // 拖选 → 对齐到整秒(帧)边界
      const a = Math.max(0, Math.floor(Math.min(s0, s)))
      const b = Math.min(total, Math.ceil(Math.max(s0, s)))
      setSel({ start: a, end: b > a ? b : Math.min(total, a + 1) })
    }
  }

  // 时间轴上当前拖选的帧范围文案(供「框选这段」按钮提示用)
  const selRangeText = sel && sel.end > sel.start ? `${fmtSec(sel.start)} – ${fmtSec(sel.end)}` : ''

  // 单个片段框的范围文案
  const slotRangeText = (slot: { start: number | null; end: number | null }) =>
    slot.start != null && slot.end != null ? `${fmtSec(slot.start)} – ${fmtSec(slot.end)}` : '未选帧'

  // 把当前时间轴选区写入指定片段框(两个框各自独立,互不同步)
  const captureSelToSlot = (idx: number) => {
    if (!sel || sel.end <= sel.start) {
      showToast('请先在时间轴上拖选要修改的帧', 'info')
      return
    }
    setFrameSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, start: sel.start, end: sel.end } : s)))
    setSel(null)
  }

  // 合并所有修改为一段说明,送整片重生成
  const buildNote = (): string | undefined => {
    const parts: string[] = []
    frameSlots.forEach((s, i) => {
      const x = s.text.trim()
      if (!x) return
      const r = s.start != null && s.end != null ? `${fmtSec(s.start)} – ${fmtSec(s.end)}` : ''
      parts.push(r ? `【片段${i + 1} ${r}】${x}` : `【片段${i + 1}】${x}`)
    })
    const ov = overallNote.trim()
    if (ov) parts.push(`【整段视频】${ov}`)
    return parts.length ? parts.join('\n') : undefined
  }

  // 是否存在「片段/整段」修改:有则主按钮显示「确认修改」(基于原视频改),无则「重新生成视频」
  const hasMods = frameSlots.some((s) => s.text.trim()) || overallNote.trim().length > 0

  // 生成完成(videoUrl 变化且不在生成中)→ 把本次修改描述绑定到这条新版本上
  useEffect(() => {
    if (!videoUrl || videoGenerating || !pendingNote) return
    setNoteByUrl((prev) => (prev[videoUrl] === pendingNote ? prev : { ...prev, [videoUrl]: pendingNote }))
    setPendingNote('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, videoGenerating])

  // 左侧「视频修改描述」:生成中显示本次描述;否则显示当前版本(含切到的历史版本)绑定的描述
  const displayNote = videoGenerating ? pendingNote : videoUrl ? noteByUrl[videoUrl] || '' : ''

  // 生成中也展示时间轴/修改区/视频修改描述(基于上一版视频);仅首次无视频时隐藏
  const showTimeline = !!videoUrl
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / total) * 100))}%`

  return (
    <div className={styles.vstage}>
      {(debugEnabled && (debug || (faceBlurDebug && faceBlurDebug.length > 0)) && (
        <div className={styles.vstageDebugBar}>
          {debug && (
            <button type="button" className={styles.vstageDebugBtn} onClick={() => setShowDebug(true)}>
              🐞 调试信息
            </button>
          )}
          {faceBlurDebug && faceBlurDebug.length > 0 && (
            <button type="button" className={styles.vstageDebugBtn} onClick={() => setShowBlurDebug(true)}>
              🐞 脱敏调试
            </button>
          )}
        </div>
      )) ||
        null}

      <div className={styles.vstageMain}>
        {/* 左:视频播放器 + 时间轴 */}
        <div className={styles.vstageLeft}>
          <div className={styles.vstagePlayer}>
            {videoGenerating ? (
              <VideoLoading
                statusText={videoStatusText || '视频生成中'}
                title={loadingTitle}
                startedAt={videoStartedAt}
                note="视频生成耗时较长;生成后会自动保存,你现在可以新建一个项目继续创作。"
                tip={VIDEO_TIPS[tipIdx]}
              />
            ) : videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  // 修进度条 bug:部分 MP4 初始 duration=Infinity(moov 在文件尾),
                  // 跳到极大时间强制浏览器算出真实时长,再跳回 0。
                  const v = e.currentTarget
                  if (!Number.isFinite(v.duration)) {
                    const back = () => {
                      v.currentTime = 0
                      v.removeEventListener('timeupdate', back)
                    }
                    v.addEventListener('timeupdate', back)
                    v.currentTime = 1e7
                  } else {
                    setDur(v.duration)
                  }
                }}
                onDurationChange={(e) => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d) && d > 0) setDur(d)
                }}
                onTimeUpdate={(e) => setPlaySec(e.currentTarget.currentTime || 0)}
              />
            ) : (
              <div className={styles.vstagePlayerPh}>暂无视频,点下方「重新生成视频」生成整片</div>
            )}
          </div>

          {/* 时间轴:时间刻度(真实秒数)+ 帧缩略条 + 拖选/点选片段。
              生成中隐藏(避免显示旧视频的帧);生成完成后用新帧重新显示。 */}
          {showTimeline && !videoGenerating && (
            <div className={styles.vstageTimeline}>
              <div className={styles.vstageRuler}>
                {ticks.map((t) => (
                  <span key={t} className={styles.vstageTick} style={{ left: pct(t) }}>
                    <i className={styles.vstageTickMark} />
                    <em className={styles.vstageTickLabel}>{t}s</em>
                  </span>
                ))}
              </div>
              <div
                ref={trackRef}
                className={styles.vstageTrack}
                onPointerDown={onTrackPointerDown}
                onPointerMove={onTrackPointerMove}
                onPointerUp={onTrackPointerUp}
                title="拖动框选若干帧,或点击选中某一帧(1 秒)"
              >
                {frames.map((f) => (
                  <div
                    key={f.i}
                    className={styles.vstageFrame}
                    style={{ left: pct(f.start), width: pct(f.end - f.start) }}
                  >
                    {f.thumb ? <img src={f.thumb} alt="" draggable={false} /> : <span>{f.i}s</span>}
                  </div>
                ))}
                {/* 选区:蓝色描边 + 左右把手(拖选要修改的帧;修改意见填右侧「选中帧修改」框)*/}
                {sel && sel.end > sel.start && (
                  <div
                    className={styles.vstageSel}
                    style={{ left: pct(sel.start), width: pct(sel.end - sel.start) }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span className={`${styles.vstageSelHandle} ${styles.vstageSelHandleL}`} />
                    <span className={`${styles.vstageSelHandle} ${styles.vstageSelHandleR}`} />
                  </div>
                )}
                {/* 播放头 */}
                <span className={styles.vstagePlayhead} style={{ left: pct(playSec) }} />
              </div>
              <div className={styles.vstageTimeHint}>
                {selRangeText
                  ? `已选 ${selRangeText}(${Math.round((sel as { end: number; start: number }).end - (sel as { end: number; start: number }).start)} 帧),点右侧某个片段框的「框选这段」即可应用到该片段`
                  : `${fmtClock(playSec)} / ${fmtClock(total)} · 共 ${frameCount} 帧 · 拖选若干帧,再点右侧片段框的「框选这段」`}
              </div>
              {displayNote && (
                <div className={styles.vstageLastNote}>
                  <div className={styles.vstageLastNoteTitle}>视频修改描述</div>
                  <pre className={styles.vstageLastNoteBody}>{displayNote}</pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右:历史记录 + 整段视频修改 + 选中帧修改 */}
        <div className={styles.vstageRight}>
          {(videoVersions.length >= 1 || videoGenerating) && (
            <div className={styles.vstageVersions}>
              <span className={styles.vstageVersionsTitle}>历史生成</span>
              <div className={styles.vstageVersionsRow}>
                {videoVersions.map((v, i) => (
                  <button
                    key={i}
                    type="button"
                    // 生成中时高亮跟随「生成中」占位,旧版本不再显示选中边框
                    className={`${styles.vstageVer}${!videoGenerating && v.url === videoUrl ? ' ' + styles.active : ''}`}
                    onClick={() => onSwitchVideo?.(v)}
                    title={`版本${i + 1}`}
                  >
                    <video src={v.url} muted preload="metadata" playsInline />
                    <span className={styles.vstageVerNo}>{i + 1}</span>
                  </button>
                ))}
                {/* 正在重新生成的新版本:作为一个「生成中」占位,与历史版本一起展示,并高亮选中边框 */}
                {videoGenerating && (
                  <div className={`${styles.vstageVer} ${styles.vstageVerLoading} ${styles.active}`} title="生成中">
                    <span className={styles.vstageSpin} aria-hidden="true" />
                    <span className={styles.vstageVerNo}>{videoVersions.length + 1}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {showTimeline ? (
            <>
              <ModBox title="整段视频修改" value={overallNote} polishKind="generic" onChange={setOverallNote} />
              <ModBox
                title="片段1修改"
                range={slotRangeText(frameSlots[0])}
                value={frameSlots[0].text}
                polishKind="segment"
                onChange={(v) => setFrameSlots((prev) => prev.map((s, i) => (i === 0 ? { ...s, text: v } : s)))}
                onCapture={() => captureSelToSlot(0)}
                onRemove={
                  frameSlots[0].start != null
                    ? () =>
                        setFrameSlots((prev) => prev.map((s, i) => (i === 0 ? { ...s, start: null, end: null } : s)))
                    : undefined
                }
              />
              <ModBox
                title="片段2修改"
                range={slotRangeText(frameSlots[1])}
                value={frameSlots[1].text}
                polishKind="segment"
                onChange={(v) => setFrameSlots((prev) => prev.map((s, i) => (i === 1 ? { ...s, text: v } : s)))}
                onCapture={() => captureSelToSlot(1)}
                onRemove={
                  frameSlots[1].start != null
                    ? () =>
                        setFrameSlots((prev) => prev.map((s, i) => (i === 1 ? { ...s, start: null, end: null } : s)))
                    : undefined
                }
              />
              <div className={styles.vstageRightHint}>
                💡
                在时间轴上拖选要改的帧,点对应片段框的「框选这段」,再写修改意见;两个片段可分别选不同的帧。AI视频修改仍在优化中,局部细节可能不够精准。
              </div>
            </>
          ) : (
            <div className={styles.vstageRightHint}>视频生成后,可在此对整段或具体片段提修改意见。</div>
          )}
        </div>
      </div>

      {/* 底部总按钮:上一步 / 下载视频 / 重新生成视频|确认修改(复用镜头编排底栏 smart__btn 药丸样式,整组居中) */}
      <div className={styles.vstageActions}>
        {onPrev && (
          <button type="button" className="smart__nav-btn" onClick={onPrev} aria-label="上一步" data-tip="上一步">
            <svg width="26" height="21" viewBox="0 0 29 23" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M27.8881 22.0104L28.1187 21.8116C28.3625 21.6053 28.5088 21.4777 27.5336 17.4193C25.8513 10.3938 19.1616 5.85705 11.6728 5.18001V0L0 9.06596L11.6728 18.1319V12.95C16.5247 12.5824 20.7876 13.0063 23.6458 16.0708C25.0542 17.588 26.7515 20.585 27.1585 21.4684C27.2166 21.594 27.3217 21.8247 27.5786 21.911L27.8881 22.0104Z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
        {onDownloadVideo && (
          <button
            type="button"
            className="smart__btn smart__btn--ghost"
            onClick={onDownloadVideo}
            disabled={!videoUrl || !!videoGenerating}
          >
            下载视频
          </button>
        )}
        <button
          type="button"
          className="smart__btn smart__btn--primary"
          onClick={() => {
            const note = buildNote()
            // 点下立即把本次修改描述放到左侧;生成完成后会绑定到新版本上(切历史时跟随)
            setPendingNote(hasMods ? note || '' : '')
            onRegenerateVideo(note, { edit: hasMods })
          }}
          disabled={!!videoGenerating}
        >
          {videoGenerating ? '生成中…' : hasMods ? '确认修改' : '重新生成视频'}
        </button>
      </div>

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

/** 单个修改框:标题在上(片段框带秒数范围 + 移除);框内 自然语言输入 + 右侧 AI一键润色 */
function ModBox({
  title,
  range,
  value,
  polishKind,
  onChange,
  onRemove,
  onCapture,
}: {
  title: string
  range?: string
  value: string
  polishKind: 'segment' | 'generic'
  onChange: (v: string) => void
  onRemove?: () => void
  /** 片段框:点击把当前时间轴选区写入本框 */
  onCapture?: () => void
}) {
  const { showToast } = useToast()
  const [polishing, setPolishing] = useState(false)
  const doPolish = async () => {
    if (!value.trim() || polishing) return
    setPolishing(true)
    try {
      const out = await polishText(value, { kind: polishKind })
      if (out) onChange(out)
    } catch (e: any) {
      showToast(`AI 润色失败:${e?.message || '请稍后重试'}`, 'error')
    } finally {
      setPolishing(false)
    }
  }
  return (
    <div className={styles.vstageModItem}>
      <div className={styles.vstageModTitle}>
        <span>{title}</span>
        {range && <span className={styles.vstageModRange}>{range}</span>}
        {onCapture && (
          <button type="button" className={styles.vstageModCapture} onClick={onCapture}>
            框选这段
          </button>
        )}
        {onRemove && (
          <button type="button" className={styles.vstageModRemove} onClick={onRemove} aria-label="移除该片段修改">
            ×
          </button>
        )}
      </div>
      <div className={styles.vstageModBox}>
        <textarea
          className={styles.vstageModInput}
          value={value}
          placeholder={polishKind === 'segment' ? '输入对这一片段的视频修改描述...' : '输入对整段视频的修改描述...'}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className={styles.vstageModPolish}
          disabled={polishing || !value.trim()}
          onClick={doPolish}
        >
          {polishing ? '润色中…' : 'AI一键润色'}
        </button>
      </div>
    </div>
  )
}
