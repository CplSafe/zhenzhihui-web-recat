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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import { polishText } from '@/api/aiPolish'
import { useToast } from '@/composables/useToast'
import { openMemberCenter } from '@/stores/ui'
import {
  createEmptyVideoModificationDraft,
  normalizeVideoModificationDraft,
  type VideoFrameModification,
  type VideoModificationDraft,
} from '@/utils/videoModificationDraft'
import { seekVideoToDecodedFrame } from '@/utils/videoFrameCapture'
import VideoLoading from './VideoLoading'
import styles from './VideoStage.module.less'

/** 一次视频生成或编辑的积分预估与余额可支付状态。 */
export interface VideoCostEstimate {
  estimatedCost: number
  balance: number
  canAfford: boolean
}

// 帧缩略图缓存(模块级):key = `${视频地址}::${帧数}::${抓帧实现版本}`。
// 切步骤再回来 / 切视频版本再切回 时直接复用,避免重复逐秒抓帧(很慢)。
// 视频较多时限制条目数,避免内存膨胀(超出后淘汰最早的)。
const FRAME_THUMB_CACHE = new Map<string, string[]>()
/** 时间轴帧缓存允许保留的视频条目数。 */
const FRAME_THUMB_CACHE_MAX = 16

/** 抓帧实现版本；算法变化时递增以使旧缓存键自动失效。 */
const FRAME_THUMB_CAPTURE_VERSION = 3

/** 一次交给浏览器绘制的帧缩略图数量，避免长任务阻塞主线程。 */
const FRAME_THUMB_RENDER_BATCH_SIZE = 5
/** 把视频地址、帧数和实现版本组合成不会误复用旧算法结果的缓存键。 */
const frameThumbKey = (url: string, count: number) => `${url}::${count}::v${FRAME_THUMB_CAPTURE_VERSION}`
/** 写入时间轴帧缓存，并按最旧插入顺序限制内存条目数。 */
function putFrameThumbCache(key: string, thumbs: string[]) {
  if (FRAME_THUMB_CACHE.has(key)) FRAME_THUMB_CACHE.delete(key)
  FRAME_THUMB_CACHE.set(key, thumbs)
  while (FRAME_THUMB_CACHE.size > FRAME_THUMB_CACHE_MAX) {
    const oldest = FRAME_THUMB_CACHE.keys().next().value
    if (oldest === undefined) break
    FRAME_THUMB_CACHE.delete(oldest)
  }
}

// 播放器封面单独保留高清首帧，避免把 96px 的时间轴缩略图放大后显示模糊。
const VIDEO_POSTER_CACHE = new Map<string, string>()
/** 高清播放器封面的最大缓存条目数。 */
const VIDEO_POSTER_CACHE_MAX = 8
/** 缓存播放器高清封面，并淘汰最旧视频条目。 */
function putVideoPosterCache(url: string, poster: string) {
  if (VIDEO_POSTER_CACHE.has(url)) VIDEO_POSTER_CACHE.delete(url)
  VIDEO_POSTER_CACHE.set(url, poster)
  while (VIDEO_POSTER_CACHE.size > VIDEO_POSTER_CACHE_MAX) {
    const oldest = VIDEO_POSTER_CACHE.keys().next().value
    if (oldest === undefined) break
    VIDEO_POSTER_CACHE.delete(oldest)
  }
}

/**
 * 同步释放原生播放器资源。Firefox 可能持续重试已卸载节点的旧 URL；切换工作空间时主动清空 src，
 * 可防止卸载后仍发出携带旧 workspace_id 的媒体请求。
 */
function releaseVideoPlayer(player: HTMLVideoElement) {
  try {
    player.pause()
  } catch {
    // 节点可能已经脱离文档或处于浏览器特定错误状态，暂停失败不影响后续清理。
  }
  player.removeAttribute('src')
  try {
    player.load()
  } catch {
    // 即使 load() 不可用，移除 src 也足以断开旧媒体资源。
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

/** 视频生成舞台的镜头、历史版本、生成队列、修改草稿、估价和页面动作。 */
interface VideoStageProps {
  shots: Shot[]
  /** 当前整片视频 url */
  videoUrl?: string
  /** 当前整片视频的稳定资产 ID；用于让修改说明不依赖会刷新的签名 URL。 */
  videoAssetId?: number
  /** 整片生成中 */
  videoGenerating?: boolean
  /** 生成中的阶段文案(如「人脸脱敏 2/9…」),缺省显示「视频生成中…」 */
  videoStatusText?: string
  /** 生成开始时间戳(ms,持久化):传给加载动效做进度锚点,切页面/刷新回来续算而非重头 */
  videoStartedAt?: number
  /** 加载动效主标题覆盖(缺省「视频生成中」);如爆款复制传「爆款复制生成中…」 */
  loadingTitle?: string
  /** 提交前积分预估(estimate-cost):展示「预计消耗 X 积分 · 余额 Y」。缺省不显示 */
  costEstimate?: VideoCostEstimate | null
  costLoading?: boolean
  costError?: string
  /**
   * video.edit 的真实后端估价。编辑态不复用 video.generate 估价；
   * 估价失败时确认按钮保持禁用，避免用户在不知实际预估积分时提交。
   */
  onEstimateEditCost?: (note?: string) => Promise<VideoCostEstimate>
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
    noFace?: boolean
  }[]
  /** 整片历史版本(点击切换) */
  videoVersions?: { url: string; assetId: number }[]
  /** 历史生成里的失败记录(无视频可播,仅展示失败态与原因) */
  failedGenerations?: { id: string; note?: string; error?: string; createdAt?: number }[]
  /** 历史生成里的 processing 记录:支持点选切到对应生成中/排队中的占位 */
  pendingGenerations?: { id: string; createdAt?: number; running?: boolean }[]
  /** 仍处于 processing 的历史生成占位数量 */
  pendingVideoCount?: number
  /** 未提交的修改框、范围和各历史版本说明；父级传入后会随项目草稿持久化。 */
  modificationDraft?: VideoModificationDraft
  onModificationDraftChange?: Dispatch<SetStateAction<VideoModificationDraft>>
  onSwitchVideo?: (v: { url: string; assetId: number }) => void
  /**
   * 主播放器地址失效时刷新当前视频的临时访问地址。
   * 返回新地址后播放器会直接重载；未返回或刷新失败时降级为原地址的缓存破坏重试。
   */
  onRefreshVideo?: (video: { url: string; assetId: number }) => Promise<{ url: string; assetId: number } | void>
  /**
   * 重新生成 / 确认修改整片。
   * note=对整片/各片段的修改意见(合并成一段);opts.edit=true 表示「确认修改」——
   * 父级应基于原视频做修改(而非从分镜图重出整片)。
   */
  onRegenerateVideo: (note?: string, opts?: { edit?: boolean }) => void
  /** 生成多个视频:允许在当前仍有视频生成时继续追加到历史记录队列 */
  onGenerateMultipleVideos?: (note?: string, opts?: { edit?: boolean }, count?: number) => void
  /** 下载当前整片视频(由父级弹本地保存位置后下载) */
  onDownloadVideo?: () => void
  onPrev?: () => void
  /** 「重新生成视频/确认修改」按钮的数量选择(与智能成片底栏 split 按钮同样式) */
  regenCount?: number
  regenCountOptions?: number[]
  onRegenCountChange?: (n: number) => void
  /** 父级显式要求把视图切到最新一条生成中的历史占位 */
  pendingFocusToken?: number
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

/** 历史区一条排队中或执行中的视频生成占位。 */
type PendingGenerationItem = { id: string; createdAt?: number; running?: boolean }

type StageVideo = { url: string; assetId: number }

/** 主播放器的两次自动恢复采用短退避，避免同一个媒体错误连续打满接口。 */
const VIDEO_AUTO_RETRY_DELAYS_MS = [400, 1200] as const
/** 超过后交给用户显式重试，避免错误媒体无限请求。 */
const VIDEO_AUTO_RETRY_LIMIT = VIDEO_AUTO_RETRY_DELAYS_MS.length

/** 资产 ID 是稳定标识；仅在任一侧没有资产 ID 时才退回比较 URL。 */
function isSameStageVideo(left: StageVideo, right: StageVideo) {
  const leftAssetId = Number(left.assetId || 0)
  const rightAssetId = Number(right.assetId || 0)
  if (leftAssetId > 0 && rightAssetId > 0) return leftAssetId === rightAssetId
  return Boolean(left.url && right.url && left.url === right.url)
}

/** 用稳定资产 ID 标识逻辑视频；无资产 ID 时才让 URL 决定是否真的切源。 */
function stageVideoIdentity(video: StageVideo) {
  const assetId = Number(video.assetId || 0)
  return assetId > 0 ? `asset:${assetId}` : video.url ? `url:${video.url}` : ''
}

/** 给同一媒体地址增加一次性查询参数，强制浏览器绕过失败的媒体缓存。 */
function withVideoRetryToken(url: string, attempt: number) {
  if (!url || /^(blob:|data:)/i.test(url)) return url
  const hashIndex = url.indexOf('#')
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : ''
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}__vstage_retry=${attempt}-${Date.now()}${hash}`
}

/** 将镜头时长文案解析为正秒数，无效时回退 5 秒。 */
const parseDur = (d: string): number => {
  const n = parseFloat(String(d || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 5
}
// 秒 → "0:05" 播放时间;一位小数 → "2.5s" 片段范围
const fmtClock = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
/** 将帧选区秒数统一显示为一位小数。 */
const fmtSec = (s: number) => `${s.toFixed(1)}s`

/**
 * 播放当前成片、抓取时间轴帧、切换历史版本并收集帧区间/整段修改，提交前执行真实积分估价。
 */
export default function VideoStage({
  shots,
  videoUrl,
  videoAssetId = 0,
  videoGenerating,
  videoStatusText,
  videoStartedAt,
  loadingTitle,
  costEstimate,
  costLoading,
  costError,
  onEstimateEditCost,
  faceBlurDebug,
  videoVersions = [],
  failedGenerations = [],
  pendingGenerations = [],
  pendingVideoCount = 0,
  modificationDraft,
  onModificationDraftChange,
  onSwitchVideo,
  onRefreshVideo,
  onRegenerateVideo,
  onGenerateMultipleVideos,
  onDownloadVideo,
  onPrev,
  regenCount,
  regenCountOptions,
  onRegenCountChange,
  pendingFocusToken = 0,
  debug,
}: VideoStageProps) {
  const { showToast } = useToast()
  const [localModificationDraft, setLocalModificationDraft] = useState(createEmptyVideoModificationDraft)
  const activeModificationDraft = normalizeVideoModificationDraft(modificationDraft ?? localModificationDraft)
  const updateModificationDraft = useCallback(
    (updater: SetStateAction<VideoModificationDraft>) => {
      const dispatch = onModificationDraftChange || setLocalModificationDraft
      dispatch((previous) => {
        const normalized = normalizeVideoModificationDraft(previous)
        return typeof updater === 'function'
          ? (updater as (value: VideoModificationDraft) => VideoModificationDraft)(normalized)
          : normalizeVideoModificationDraft(updater)
      })
    },
    [onModificationDraftChange],
  )
  const overallNote = activeModificationDraft.overallNote
  const frameSlots = activeModificationDraft.frameSlots
  const noteByVersion = activeModificationDraft.noteByVersion
  const pendingNote = activeModificationDraft.pendingNote
  const setOverallNote = useCallback(
    (value: string) => updateModificationDraft((previous) => ({ ...previous, overallNote: value })),
    [updateModificationDraft],
  )
  const setFrameSlots = useCallback(
    (updater: (previous: VideoFrameModification[]) => VideoFrameModification[]) =>
      updateModificationDraft((previous) => ({ ...previous, frameSlots: updater(previous.frameSlots) })),
    [updateModificationDraft],
  )
  const setPendingNote = useCallback(
    (value: string) => updateModificationDraft((previous) => ({ ...previous, pendingNote: value })),
    [updateModificationDraft],
  )
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null) // 时间轴待确认选区(秒)
  const [dur, setDur] = useState(0) // 视频真实时长(秒),0=未知
  const [frameThumbs, setFrameThumbs] = useState<string[] | null>(null) // 逐秒抓取的帧缩略图(CORS 失败则 null,回退占位)
  const [videoPosterSource, setVideoPosterSource] = useState<{ ownerUrl: string; src: string }>({
    ownerUrl: '',
    src: '',
  })
  const [timelineCaptureReadyUrl, setTimelineCaptureReadyUrl] = useState('')
  const [tipIdx, setTipIdx] = useState(0)
  const [showDebug, setShowDebug] = useState(false)
  const [showBlurDebug, setShowBlurDebug] = useState(false)
  const [selectedPendingId, setSelectedPendingId] = useState<string>('')
  const [pendingFocusArmed, setPendingFocusArmed] = useState(false)
  const [playbackUrl, setPlaybackUrl] = useState(videoUrl || '')
  const [playbackReloadKey, setPlaybackReloadKey] = useState(0)
  const [mediaError, setMediaError] = useState('')
  const debugEnabled = import.meta.env.DEV // 正式版自动隐藏
  const videoPosterUrl = videoPosterSource.ownerUrl === (videoUrl || '') ? videoPosterSource.src : undefined

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sourceIdentity = stageVideoIdentity({ url: videoUrl || '', assetId: videoAssetId })
  const sourceIdentityRef = useRef(sourceIdentity)
  const mediaRetryCountRef = useRef(0)
  const mediaRetryTimerRef = useRef<number | null>(null)
  const mediaRefreshInFlightRef = useRef(false)
  const mediaRefreshRequestRef = useRef(0)
  const previousVideoUrlRef = useRef(videoUrl || '')
  const onRefreshVideoRef = useRef(onRefreshVideo)
  onRefreshVideoRef.current = onRefreshVideo
  const clearMediaRetryTimer = useCallback(() => {
    if (mediaRetryTimerRef.current == null) return
    window.clearTimeout(mediaRetryTimerRef.current)
    mediaRetryTimerRef.current = null
  }, [])
  const bindVideoRef = useCallback((player: HTMLVideoElement | null) => {
    const previousPlayer = videoRef.current
    if (previousPlayer && previousPlayer !== player) releaseVideoPlayer(previousPlayer)
    videoRef.current = player
  }, [])
  // 播放进度属于高频瞬时值；直接同步两个展示节点，避免每次 timeupdate 重渲染整个生成步骤。
  const playSecRef = useRef(0)
  const playheadRef = useRef<HTMLSpanElement | null>(null)
  const playbackTimeRef = useRef<HTMLSpanElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ s0: number } | null>(null)
  const pendingTimelineSeekRef = useRef<number | null>(null)
  const timelineCaptureScheduleRef = useRef<(() => void) | null>(null)
  const [regenSplitOpen, setRegenSplitOpen] = useState(false)
  const regenSplitRef = useRef<HTMLSpanElement | null>(null)
  // 生成/重新生成按钮 10s 防抖:点一次后锁 10 秒,防手抖连点重复提交(视频生成很贵)。
  const [genCooldown, setGenCooldown] = useState(false)
  const genCooldownTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (genCooldownTimerRef.current) window.clearTimeout(genCooldownTimerRef.current)
    },
    [],
  )
  const startGenCooldown = () => {
    setGenCooldown(true)
    if (genCooldownTimerRef.current) window.clearTimeout(genCooldownTimerRef.current)
    genCooldownTimerRef.current = window.setTimeout(() => setGenCooldown(false), 10000)
  }

  useEffect(() => {
    if (!regenSplitOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const el = regenSplitRef.current
      if (!el) return
      const target = e.target as HTMLElement
      if (!el.contains(target)) setRegenSplitOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [regenSplitOpen])
  useEffect(() => {
    if (!pendingFocusToken) return
    setPendingFocusArmed(true)
  }, [pendingFocusToken])
  useEffect(() => {
    if (!pendingFocusArmed || !pendingGenerations.length) return
    const running = pendingGenerations.find((g) => g.running)
    const newest = [...pendingGenerations].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)).pop()
    const candidate = running || newest || pendingGenerations[0]
    if (!candidate) return
    setSelectedPendingId(candidate.id)
    setPendingFocusArmed(false)
  }, [pendingFocusArmed, pendingGenerations])

  // 时长:优先视频真实时长;未知时回退分镜时长之和
  const shotsTotal = useMemo(
    () => shots.filter((s) => s.includeInVideo !== false).reduce((a, s) => a + parseDur(s.duration), 0),
    [shots],
  )
  const total = dur || shotsTotal || 10
  // 帧条:按视频真实时长「1 帧/秒」切分(15s 视频 = 15 帧),封顶 60 帧
  const frameCount = Math.max(1, Math.min(60, Math.round(total)))
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / total) * 100))}%`
  const syncPlaybackProgress = (seconds: number) => {
    const next = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
    playSecRef.current = next
    if (playheadRef.current) playheadRef.current.style.left = pct(next)
    if (playbackTimeRef.current) {
      playbackTimeRef.current.textContent = `${fmtClock(next)} / ${fmtClock(total)} · 共 ${frameCount} 帧 · 拖选若干帧,再点右侧片段框的「框选这段」`
    }
  }
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
  const displayPendingGenerations = useMemo(() => {
    const base: PendingGenerationItem[] = pendingGenerations.length
      ? pendingGenerations
      : Array.from({ length: Math.max(0, pendingVideoCount) }).map((_, i) => ({
          id: `pending-${i}`,
          createdAt: 0,
          running: false,
        }))
    const sorted = [...base].sort((a, b) => {
      const runningDiff = Number(Boolean(b.running)) - Number(Boolean(a.running))
      if (runningDiff !== 0) return runningDiff
      return Number(a.createdAt || 0) - Number(b.createdAt || 0)
    })
    return sorted
  }, [pendingGenerations, pendingVideoCount])
  const historyItems = useMemo(() => {
    const failedGens = failedGenerations.map((g) => ({
      kind: 'failed' as const,
      id: g.id,
      createdAt: Number(g.createdAt || 0),
      error: g.error,
    }))
    const pendingGens = displayPendingGenerations.map((g) => ({
      kind: 'pending' as const,
      id: g.id,
      createdAt: Number(g.createdAt || 0),
      running: !!g.running,
    }))
    const mergedGenItems = [...failedGens, ...pendingGens].sort(
      (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
    )
    return {
      publishedVersions: [...videoVersions].map((v, i) => ({
        kind: 'published' as const,
        id: `video-${i}-${v.assetId || v.url}`,
        orderNo: i + 1,
        video: v,
      })),
      mergedGenItems,
    }
  }, [displayPendingGenerations, failedGenerations, videoVersions])
  const currentStageVideo = { url: videoUrl || '', assetId: videoAssetId }
  const activePublishedVersion = historyItems.publishedVersions.find((item) =>
    isSameStageVideo(item.video, currentStageVideo),
  )
  const activeHistoryVersionId = activePublishedVersion?.id || ''
  const publishedVersionSignature = historyItems.publishedVersions
    .map((item) => `${stageVideoIdentity(item.video)}:${item.video.url}`)
    .join('|')
  const historySyncAttemptRef = useRef('')

  // 当前主视频是受控数据：历史卡只按 assetId/URL 的真实匹配高亮。
  // 若草稿主视频已经脱离历史列表，则把最新历史版本同步回父层，而不是只画一个“已选中”边框。
  useEffect(() => {
    const publishedVersions = historyItems.publishedVersions
    if (!publishedVersions.length) {
      historySyncAttemptRef.current = ''
      return
    }

    if (activePublishedVersion) {
      if (videoUrl || !activePublishedVersion.video.url || !onSwitchVideo) {
        historySyncAttemptRef.current = ''
        return
      }
      const hydrateKey = `hydrate:${stageVideoIdentity(activePublishedVersion.video)}:${activePublishedVersion.video.url}`
      if (historySyncAttemptRef.current === hydrateKey) return
      historySyncAttemptRef.current = hydrateKey
      onSwitchVideo(activePublishedVersion.video)
      return
    }

    const latest = publishedVersions[publishedVersions.length - 1]
    if (!latest || !onSwitchVideo) return
    const syncKey = `${sourceIdentity || 'empty'}=>${stageVideoIdentity(latest.video)}:${latest.video.url}`
    if (historySyncAttemptRef.current === syncKey) return
    historySyncAttemptRef.current = syncKey
    setSelectedPendingId('')
    onSwitchVideo(latest.video)
  }, [
    activeHistoryVersionId,
    activePublishedVersion,
    historyItems.publishedVersions,
    onSwitchVideo,
    publishedVersionSignature,
    sourceIdentity,
    videoUrl,
  ])

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
  // 切换视频源 → 重置时长/选区/播放头；缓存命中时下面的抓帧 effect 会在同一轮恢复缩略图。
  useEffect(() => {
    const identityChanged = sourceIdentityRef.current !== sourceIdentity
    const urlChanged = previousVideoUrlRef.current !== (videoUrl || '')
    sourceIdentityRef.current = sourceIdentity
    previousVideoUrlRef.current = videoUrl || ''
    setPlaybackUrl(videoUrl || '')
    if (!identityChanged && !urlChanged) return

    clearMediaRetryTimer()
    mediaRefreshRequestRef.current += 1
    mediaRefreshInFlightRef.current = false
    setMediaError('')
    if (identityChanged) mediaRetryCountRef.current = 0
  }, [clearMediaRetryTimer, sourceIdentity, videoUrl])
  useEffect(
    () => () => {
      clearMediaRetryTimer()
      mediaRefreshRequestRef.current += 1
      mediaRefreshInFlightRef.current = false
    },
    [clearMediaRetryTimer],
  )
  useEffect(() => {
    timelineCaptureScheduleRef.current?.()
    timelineCaptureScheduleRef.current = null
    setDur(0)
    setSel(videoUrl ? { start: 0, end: 1 } : null)
    playSecRef.current = 0
    if (playheadRef.current) playheadRef.current.style.left = '0%'
    setFrameThumbs(null)
    setTimelineCaptureReadyUrl('')
    pendingTimelineSeekRef.current = null
    return () => {
      timelineCaptureScheduleRef.current?.()
      timelineCaptureScheduleRef.current = null
    }
  }, [videoUrl])
  useEffect(() => {
    if (!selectedPendingId) return
    if (!pendingGenerations.some((g) => g.id === selectedPendingId)) setSelectedPendingId('')
  }, [pendingGenerations, selectedPendingId])

  // 主播放器直接使用媒体地址，让浏览器通过 Range 请求尽快显示首帧；不再等待完整 Blob 下载。
  // 封面从已经加载好的主播放器画面生成，避免为同一视频再启动一次高优先级下载。
  useEffect(() => {
    const ownerUrl = videoUrl || ''
    if (!ownerUrl) {
      setVideoPosterSource({ ownerUrl: '', src: '' })
      return
    }
    const cached = VIDEO_POSTER_CACHE.get(ownerUrl)
    if (cached) {
      setVideoPosterSource({ ownerUrl, src: cached })
      return
    }
    setVideoPosterSource({ ownerUrl, src: '' })
  }, [videoUrl])

  const capturePosterFromPlayer = (video: HTMLVideoElement) => {
    const ownerUrl = videoUrl || ''
    if (!ownerUrl || VIDEO_POSTER_CACHE.has(ownerUrl)) return
    try {
      const sourceWidth = video.videoWidth
      const sourceHeight = video.videoHeight
      if (!sourceWidth || !sourceHeight) return
      const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight))
      const width = Math.max(1, Math.round(sourceWidth * scale))
      const height = Math.max(1, Math.round(sourceHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(video, 0, 0, width, height)
      const poster = canvas.toDataURL('image/jpeg', 0.92)
      putVideoPosterCache(ownerUrl, poster)
      setVideoPosterSource({ ownerUrl, src: poster })
    } catch {
      // 跨域视频无法写入 canvas 时不设置 poster，让浏览器显示原始视频首帧。
    }
  }

  const scheduleTimelineCapture = (ownerUrl: string) => {
    if (!ownerUrl || timelineCaptureReadyUrl === ownerUrl || timelineCaptureScheduleRef.current) return
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const ready = () => {
      timelineCaptureScheduleRef.current = null
      setTimelineCaptureReadyUrl(ownerUrl)
    }
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(ready, { timeout: 1500 })
      timelineCaptureScheduleRef.current = () => idleWindow.cancelIdleCallback?.(handle)
      return
    }
    const handle = window.setTimeout(ready, 350)
    timelineCaptureScheduleRef.current = () => window.clearTimeout(handle)
  }

  // 逐秒抓取视频帧(1 帧/秒)用独立隐藏 <video>,不打扰主播放器。
  // 主播放器首帧出现后再空闲抓取；原地址无法 seek/写 canvas 时才后台完整下载 Blob 降级。
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
    if (timelineCaptureReadyUrl !== videoUrl || total <= 0) return
    setFrameThumbs(null)
    let cancelled = false
    let fallbackObjectUrl = ''
    const abortController = new AbortController()
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    const canvas = document.createElement('canvas')
    const thumbs: string[] = []

    const loadCaptureVideo = async (src: string) =>
      new Promise<void>((resolve, reject) => {
        if (/^(blob:|data:)/i.test(src)) v.removeAttribute('crossorigin')
        else v.crossOrigin = 'anonymous'
        const cleanup = () => {
          v.removeEventListener('loadeddata', onLoaded)
          v.removeEventListener('error', onError)
        }
        const onLoaded = () => {
          cleanup()
          resolve()
        }
        const onError = () => {
          cleanup()
          reject(new Error('load'))
        }
        v.addEventListener('loadeddata', onLoaded)
        v.addEventListener('error', onError)
        v.src = src
        v.load()
      })
    const seekTo = (time: number) => seekVideoToDecodedFrame(v, time, { signal: abortController.signal })
    const captureFromSource = async (src: string) => {
      thumbs.length = 0
      await loadCaptureVideo(src)
      if (cancelled) return
      // 帧条缩略图无需高清:96px 宽 + 较低 jpeg 质量,抓取更快、内存与 dataURL 更省
      const W = 96
      const H = Math.max(1, Math.round((v.videoHeight / (v.videoWidth || 1)) * W)) || 54
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const captureDuration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : total
      for (let i = 0; i < frameCount; i++) {
        if (cancelled) return
        const t = Math.min(i + 0.5, Math.max(0, captureDuration - 0.05))
        await seekTo(t)
        if (cancelled) return
        ctx.drawImage(v, 0, 0, W, H)
        thumbs.push(canvas.toDataURL('image/jpeg', 0.5)) // canvas 被污染会抛错 → 触发 Blob 降级
        // UI 每帧提交会让整块 VideoStage 最多重渲染 60 次。按批渐进展示，
        // 保留反馈的同时减少 React commit 与图片布局次数。
        if (!cancelled && thumbs.length % FRAME_THUMB_RENDER_BATCH_SIZE === 0) {
          setFrameThumbs(thumbs.slice())
        }
      }
      if (!cancelled) {
        const completedThumbs = thumbs.slice()
        setFrameThumbs(completedThumbs)
        // 完整抓完才写入缓存,供切步骤/切版本回来复用
        if (completedThumbs.length === frameCount) putFrameThumbCache(key, completedThumbs)
      }
    }
    const releaseCaptureResources = () => {
      v.removeAttribute('src')
      v.load()
      if (fallbackObjectUrl) {
        URL.revokeObjectURL(fallbackObjectUrl)
        fallbackObjectUrl = ''
      }
    }
    const capture = async () => {
      try {
        try {
          await captureFromSource(videoUrl)
          return
        } catch {
          if (cancelled || /^(blob:|data:)/i.test(videoUrl)) {
            if (!cancelled) setFrameThumbs(null)
            return
          }
        }
        try {
          // 仅时间轴直读失败时才完整下载，且不会替换或阻塞正在播放的主视频。
          setFrameThumbs(null)
          const response = await fetch(videoUrl, {
            credentials: 'include',
            signal: abortController.signal,
          })
          if (!response.ok) throw new Error(`video ${response.status}`)
          const rawBlob = await response.blob()
          const blob = rawBlob.type.startsWith('video/') ? rawBlob : rawBlob.slice(0, rawBlob.size, 'video/mp4')
          fallbackObjectUrl = URL.createObjectURL(blob)
          await captureFromSource(fallbackObjectUrl)
        } catch {
          if (!cancelled && !abortController.signal.aborted) setFrameThumbs(null) // 解码/CORS 失败 → 秒标占位
        }
      } finally {
        releaseCaptureResources()
      }
    }
    void capture()
    return () => {
      cancelled = true
      abortController.abort()
      releaseCaptureResources()
    }
  }, [videoUrl, timelineCaptureReadyUrl, total, frameCount])

  // 时间轴上的像素 → 秒(以视频真实时长为基准,做到「秒数一一对应」)
  const secFromEvent = (e: { clientX: number }) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return frac * total
  }
  const clampPlayerTime = (video: HTMLVideoElement | null, seconds: number) => {
    const mediaDuration = video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : total
    return Math.min(Math.max(0, mediaDuration - 0.01), Math.max(0, seconds))
  }
  const applyPlayerSeek = (video: HTMLVideoElement, seconds: number) => {
    if (video.readyState < 1) return false
    const target = clampPlayerTime(video, seconds)
    try {
      video.currentTime = target
      syncPlaybackProgress(target)
      return true
    } catch {
      return false
    }
  }
  // 时间轴缩略图抓取于每秒中点(i + 0.5s);点击该格时主视频也跳到同一时刻，保证画面对得上。
  const seekPlayerToTimelineFrame = (frameIndex: number) => {
    const target = Math.min(frameIndex + 0.5, Math.max(0, total - 0.05))
    const video = videoRef.current
    const clamped = clampPlayerTime(video, target)
    pendingTimelineSeekRef.current = clamped
    syncPlaybackProgress(clamped)
    if (!video) return
    video.pause()
    if (applyPlayerSeek(video, clamped)) pendingTimelineSeekRef.current = null
  }
  const flushPendingTimelineSeek = (video: HTMLVideoElement) => {
    const pending = pendingTimelineSeekRef.current
    if (pending == null) return
    if (applyPlayerSeek(video, pending)) pendingTimelineSeekRef.current = null
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
      seekPlayerToTimelineFrame(i)
    } else {
      // 拖选 → 对齐到整秒(帧)边界
      const a = Math.max(0, Math.floor(Math.min(s0, s)))
      const b = Math.min(total, Math.ceil(Math.max(s0, s)))
      setSel({ start: a, end: b > a ? b : Math.min(total, a + 1) })
      seekPlayerToTimelineFrame(Math.min(frameCount - 1, Math.floor(a)))
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
  const editRequestSignature = JSON.stringify({
    videoAssetId,
    videoUrl,
    overallNote: overallNote.trim(),
    frameSlots: frameSlots.map((slot) => ({ start: slot.start, end: slot.end, text: slot.text.trim() })),
  })
  const estimateEditCostRef = useRef(onEstimateEditCost)
  estimateEditCostRef.current = onEstimateEditCost
  const [editCost, setEditCost] = useState<{
    loading: boolean
    error: string
    estimate: VideoCostEstimate | null
  }>({ loading: false, error: '', estimate: null })
  const [editCostRetry, setEditCostRetry] = useState(0)

  useEffect(() => {
    if (!hasMods || videoGenerating) {
      setEditCost({ loading: false, error: '', estimate: null })
      return
    }
    const request = estimateEditCostRef.current
    if (!request || !videoAssetId) {
      setEditCost({ loading: false, error: '暂时无法获取视频编辑积分估价，当前不能提交', estimate: null })
      return
    }

    let alive = true
    setEditCost({ loading: true, error: '', estimate: null })
    const timer = window.setTimeout(() => {
      request(buildNote())
        .then((estimate) => {
          if (!alive) return
          const estimatedCost = Number(estimate?.estimatedCost)
          const balance = Number(estimate?.balance)
          if (!Number.isFinite(estimatedCost) || estimatedCost < 0 || !Number.isFinite(balance)) {
            throw new Error('后端未返回有效的视频编辑积分估价')
          }
          setEditCost({
            loading: false,
            error: '',
            estimate: { estimatedCost, balance, canAfford: estimate?.canAfford === true },
          })
        })
        .catch((error: any) => {
          if (!alive) return
          setEditCost({
            loading: false,
            error: error?.message || '视频编辑积分估价失败，当前不能提交',
            estimate: null,
          })
        })
    }, 400)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // editRequestSignature 包含所有会改变编辑请求的字段，避免依赖每次 normalize 新建的数组导致重复估价。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCostRetry, editRequestSignature, hasMods, videoAssetId, videoGenerating])

  const reloadPlaybackSource = useCallback(
    async (attempt: number) => {
      if (mediaRefreshInFlightRef.current) return
      const expectedIdentity = sourceIdentity
      const requestId = mediaRefreshRequestRef.current + 1
      mediaRefreshRequestRef.current = requestId
      mediaRefreshInFlightRef.current = true
      let refreshedVideo: StageVideo | undefined
      try {
        const refresh = onRefreshVideoRef.current
        if (refresh) {
          try {
            const refreshed = await refresh({ url: videoUrl || playbackUrl, assetId: videoAssetId })
            if (refreshed) refreshedVideo = refreshed
          } catch {
            // 刷新临时地址失败时仍可对现有地址做一次浏览器级重载。
          }
        }
        if (mediaRefreshRequestRef.current !== requestId || sourceIdentityRef.current !== expectedIdentity) return

        const baseUrl = refreshedVideo?.url || videoUrl || playbackUrl
        if (!baseUrl) {
          setMediaError('没有可用的视频地址，请稍后重新加载')
          return
        }
        const nextUrl =
          refreshedVideo?.url && refreshedVideo.url !== (videoUrl || playbackUrl)
            ? refreshedVideo.url
            : withVideoRetryToken(baseUrl, attempt)
        setMediaError('')
        setPlaybackUrl(nextUrl)
        setPlaybackReloadKey((key) => key + 1)
      } finally {
        if (mediaRefreshRequestRef.current === requestId) mediaRefreshInFlightRef.current = false
      }
    },
    [playbackUrl, sourceIdentity, videoAssetId, videoUrl],
  )

  const handleMediaError = useCallback(() => {
    if (mediaRefreshInFlightRef.current || mediaRetryTimerRef.current != null) return
    const nextAttempt = mediaRetryCountRef.current + 1
    if (nextAttempt > VIDEO_AUTO_RETRY_LIMIT) {
      setMediaError('视频加载失败，请检查网络后重新加载')
      return
    }
    mediaRetryCountRef.current = nextAttempt
    const delay = VIDEO_AUTO_RETRY_DELAYS_MS[nextAttempt - 1]
    mediaRetryTimerRef.current = window.setTimeout(() => {
      mediaRetryTimerRef.current = null
      void reloadPlaybackSource(nextAttempt)
    }, delay)
  }, [reloadPlaybackSource])

  const handleMediaMetadata = useCallback(() => {
    setMediaError('')
  }, [])

  const handleMediaCanPlay = useCallback(() => {
    clearMediaRetryTimer()
    mediaRetryCountRef.current = 0
    setMediaError('')
  }, [clearMediaRetryTimer])

  const handleManualMediaReload = useCallback(() => {
    clearMediaRetryTimer()
    mediaRetryCountRef.current = 0
    setMediaError('')
    void reloadPlaybackSource(1)
  }, [clearMediaRetryTimer, reloadPlaybackSource])

  const currentVersionKey = videoAssetId > 0 ? `asset:${videoAssetId}` : videoUrl ? `url:${videoUrl}` : ''

  // 左侧「视频修改描述」:生成中显示本次描述;否则显示当前版本(含切到的历史版本)绑定的描述
  const displayNote = videoGenerating ? pendingNote : currentVersionKey ? noteByVersion[currentVersionKey] || '' : ''

  const hasExplicitHistorySelection = !!activeHistoryVersionId && !selectedPendingId
  // 生成中若已有上一版视频,仍允许继续播放/查看历史;仅在未手动切到某个已生成视频时,默认显示当前生成中的占位。
  const activePendingGeneration =
    pendingGenerations.find((g) => g.id === selectedPendingId) ||
    (!hasExplicitHistorySelection && videoGenerating ? pendingGenerations.find((g) => g.running) || null : null)
  const showingPendingGeneration = !!activePendingGeneration
  const showLoadingView = showingPendingGeneration || (!videoUrl && !!videoGenerating)
  const hasPlayableVideo = !!videoUrl && !showingPendingGeneration
  const showTimeline = hasPlayableVideo
  const hasSelectedHistoryVideo = hasExplicitHistorySelection
  const isHotCopyMode = shots.length === 0
  const lockSingleActions = showingPendingGeneration
  const lockRegenerateAction = lockSingleActions || (isHotCopyMode && videoGenerating)
  const editCostInsufficient =
    !!editCost.estimate &&
    (editCost.estimate.canAfford === false || editCost.estimate.estimatedCost > editCost.estimate.balance)
  const editCostUnavailable = hasMods && (editCost.loading || !!editCost.error || !editCost.estimate)
  const inlinePrevWithActions = !!onPrev && shots.length === 0
  const canChooseMultiRegen =
    !!onGenerateMultipleVideos &&
    !!onRegenCountChange &&
    Array.isArray(regenCountOptions) &&
    regenCountOptions.length > 0
  const triggerSingleRegenerate = () => {
    if (genCooldown) return // 10s 防抖:防连点重复提交
    if (hasMods && (editCostUnavailable || editCostInsufficient)) {
      showToast(editCostInsufficient ? '积分不足，无法提交视频修改' : '请等待视频编辑积分估价完成', 'info')
      return
    }
    startGenCooldown()
    const note = buildNote()
    setPendingNote(hasMods ? note || '' : '')
    setPendingFocusArmed(true)
    onRegenerateVideo(note, { edit: hasMods })
  }
  const triggerMultiGenerate = () => {
    if (!onGenerateMultipleVideos) return
    if (genCooldown) return // 10s 防抖:防连点重复追加多批
    const multiEstimatedCost = Number(editCost.estimate?.estimatedCost || 0) * Math.max(1, Number(regenCount || 1))
    if (
      hasMods &&
      (editCostUnavailable || editCostInsufficient || multiEstimatedCost > Number(editCost.estimate?.balance || 0))
    ) {
      showToast('请先确认视频编辑估价及积分余额', 'info')
      return
    }
    startGenCooldown()
    const note = buildNote()
    setPendingNote(hasMods ? note || '' : '')
    setPendingFocusArmed(true)
    onGenerateMultipleVideos(note, { edit: hasMods }, regenCount ?? 1)
  }

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
            {showLoadingView ? (
              <VideoLoading
                statusText={
                  activePendingGeneration?.running
                    ? videoStatusText || '视频生成中'
                    : activePendingGeneration
                      ? '排队中'
                      : '视频生成中'
                }
                title={loadingTitle}
                startedAt={
                  activePendingGeneration?.running
                    ? videoStartedAt || activePendingGeneration?.createdAt
                    : activePendingGeneration?.createdAt || videoStartedAt
                }
                note="视频生成耗时较长;生成后会自动保存,你现在可以新建一个项目继续创作。"
                tip={VIDEO_TIPS[tipIdx]}
              />
            ) : mediaError ? (
              <div className={styles.vstagePlayerError} role="alert">
                <span className={styles.vstagePlayerErrorTitle}>视频暂时无法播放</span>
                <span className={styles.vstagePlayerErrorText}>{mediaError}</span>
                <button type="button" className={styles.vstagePlayerRetry} onClick={handleManualMediaReload}>
                  重新加载
                </button>
              </div>
            ) : playbackUrl ? (
              <video
                key={`${sourceIdentity}:${playbackReloadKey}`}
                ref={bindVideoRef}
                src={playbackUrl}
                poster={videoPosterUrl}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  // 能读取容器元数据不代表视频帧可解码；仅 canplay 才恢复自动重试额度。
                  handleMediaMetadata()
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d) && d > 0) setDur(d)
                  flushPendingTimelineSeek(e.currentTarget)
                  scheduleTimelineCapture(videoUrl || '')
                }}
                onLoadedData={(e) => {
                  capturePosterFromPlayer(e.currentTarget)
                  scheduleTimelineCapture(videoUrl || '')
                }}
                onCanPlay={handleMediaCanPlay}
                onError={handleMediaError}
                onDurationChange={(e) => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d) && d > 0) setDur(d)
                  flushPendingTimelineSeek(e.currentTarget)
                }}
                onPlay={(e) => {
                  const v = e.currentTarget
                  const upperBound = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : total
                  if (!Number.isFinite(v.currentTime) || v.currentTime > upperBound + 1) v.currentTime = 0
                }}
                onTimeUpdate={(e) => syncPlaybackProgress(e.currentTarget.currentTime || 0)}
              />
            ) : videoUrl ? (
              <div className={styles.vstagePlayerPh}>视频加载中...</div>
            ) : (
              <div className={styles.vstagePlayerPh}>暂无视频,点下方「重新生成视频」生成整片</div>
            )}
          </div>

          {/* 时间轴:时间刻度(真实秒数)+ 帧缩略条 + 拖选/点选片段。
              若已存在上一版视频,生成中也允许继续查看/播放它;切到新版本后会自动重算帧条。 */}
          {showTimeline && (
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
                    {f.thumb ? (
                      <span className={styles.vstageFrameVisual}>
                        <img
                          className={styles.vstageFrameBackdrop}
                          src={f.thumb}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                        <img className={styles.vstageFrameImage} src={f.thumb} alt="" draggable={false} />
                      </span>
                    ) : (
                      <span className={styles.vstageFramePlaceholder}>{f.i}s</span>
                    )}
                  </div>
                ))}
                {/* 选区:蓝色描边 + 左右把手(拖选要修改的帧;修改意见填右侧「选中帧修改」框)*/}
                {sel && sel.end > sel.start && (
                  <div className={styles.vstageSel} style={{ left: pct(sel.start), width: pct(sel.end - sel.start) }}>
                    <span className={`${styles.vstageSelHandle} ${styles.vstageSelHandleL}`} />
                    <span className={`${styles.vstageSelHandle} ${styles.vstageSelHandleR}`} />
                  </div>
                )}
                {/* 播放头 */}
                <span
                  ref={playheadRef}
                  className={styles.vstagePlayhead}
                  style={{ left: pct(playSecRef.current) }}
                  aria-hidden="true"
                />
              </div>
              <div className={styles.vstageTimeHint}>
                {selRangeText ? (
                  `已选 ${selRangeText}(${Math.round((sel as { end: number; start: number }).end - (sel as { end: number; start: number }).start)} 帧),点右侧某个片段框的「框选这段」即可应用到该片段`
                ) : (
                  <span ref={playbackTimeRef}>
                    {`${fmtClock(playSecRef.current)} / ${fmtClock(total)} · 共 ${frameCount} 帧 · 拖选若干帧,再点右侧片段框的「框选这段」`}
                  </span>
                )}
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
          {(videoVersions.length >= 1 || failedGenerations.length > 0 || pendingVideoCount > 0 || videoGenerating) && (
            <div className={styles.vstageVersions}>
              <span className={styles.vstageVersionsTitle}>历史生成</span>
              <div className={styles.vstageVersionsRow}>
                {historyItems.publishedVersions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.vstageVer}${
                      !selectedPendingId && activeHistoryVersionId === item.id ? ' ' + styles.active : ''
                    }`}
                    onClick={() => {
                      setSelectedPendingId('')
                      onSwitchVideo?.(item.video)
                    }}
                    aria-label={`版本${item.orderNo}`}
                    aria-pressed={!selectedPendingId && activeHistoryVersionId === item.id}
                    title={`版本${item.orderNo}`}
                  >
                    {/* #t=0.1 媒体片段:让浏览器 seek 到首帧并渲染成静态预览,否则无 poster 时显示黑帧 */}
                    <video
                      src={item.video.url ? `${item.video.url}#t=0.1` : item.video.url}
                      muted
                      preload="metadata"
                      playsInline
                    />
                    <span className={styles.vstageVerNo}>{item.orderNo}</span>
                  </button>
                ))}
                {historyItems.mergedGenItems.map((item, i) =>
                  item.kind === 'failed' ? (
                    <div
                      key={item.id}
                      className={`${styles.vstageVer} ${styles.vstageVerFailed}`}
                      title={item.error || '生成失败'}
                    >
                      <div className={styles.vstageVerFailedBody}>
                        <span className={styles.vstageVerFailedTitle}>生成失败</span>
                        <span className={styles.vstageVerFailedReason}>{item.error || '请重试'}</span>
                      </div>
                      <span className={styles.vstageVerNo}>{historyItems.publishedVersions.length + i + 1}</span>
                    </div>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      className={`${styles.vstageVer} ${styles.vstageVerLoading} ${styles.vstageVerPending}${
                        activePendingGeneration?.id === item.id ||
                        (!selectedPendingId && !hasSelectedHistoryVideo && !!item.running)
                          ? ' ' + styles.active
                          : ''
                      }`}
                      title={item.running ? '生成中' : '排队中'}
                      aria-label={`版本${historyItems.publishedVersions.length + i + 1}${item.running ? '生成中' : '排队中'}`}
                      aria-pressed={activePendingGeneration?.id === item.id}
                      onClick={() => {
                        setSelectedPendingId(item.id)
                      }}
                    >
                      <span className={styles.vstageVerPendingBody}>
                        <span className={styles.vstageSpin} aria-hidden="true" />
                        <span className={styles.vstageVerPendingText}>{item.running ? '生成中' : '排队中'}</span>
                      </span>
                      <span className={styles.vstageVerNo}>{historyItems.publishedVersions.length + i + 1}</span>
                    </button>
                  ),
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

      {/* 编辑态使用 video.edit 自身的后端 estimate-cost，不复用 video.generate 估价。 */}
      {!videoGenerating && hasMods && editCost.loading && (
        <div className={styles.vstageCost}>
          <span>正在获取视频编辑积分估价…</span>
        </div>
      )}
      {!videoGenerating && hasMods && editCost.error && (
        <div className={styles.vstageCost}>
          <span className={styles.vstageCostErr}>{editCost.error}</span>
          <button type="button" className={styles.vstageCostRecharge} onClick={() => setEditCostRetry((n) => n + 1)}>
            重新估价
          </button>
        </div>
      )}
      {!videoGenerating && hasMods && editCost.estimate && (
        <div className={styles.vstageCost}>
          <span className={editCostInsufficient ? styles.vstageCostErr : undefined}>
            后端预计消耗 {editCost.estimate.estimatedCost} 积分 · 余额 {editCost.estimate.balance} 积分
            {editCostInsufficient && ' · 积分不足'}
          </span>
          <span>最终以任务结算为准；后端可能按最低计费时长结算。</span>
          {editCostInsufficient && (
            <button type="button" className={styles.vstageCostRecharge} onClick={openMemberCenter}>
              前往充值积分
            </button>
          )}
        </div>
      )}
      {/* 提交前积分预估:加载中 / 出错也给出反馈(此前 costLoading/costError 被丢弃,只在估到价时才有显示) */}
      {!videoGenerating && !hasMods && costLoading && !costEstimate && (
        <div className={styles.vstageCost}>
          <span>积分预估中…</span>
        </div>
      )}
      {!videoGenerating && !hasMods && costError && !costEstimate && (
        <div className={styles.vstageCost}>
          <span className={styles.vstageCostErr}>{costError}</span>
        </div>
      )}
      {/* 提交前积分预估:仅在真正估到价时显示;估不出来不显示 */}
      {!videoGenerating &&
        !hasMods &&
        costEstimate &&
        (() => {
          const insufficient = costEstimate.canAfford === false || costEstimate.estimatedCost > costEstimate.balance
          return (
            <div className={styles.vstageCost}>
              <span className={insufficient ? styles.vstageCostErr : undefined}>
                预计消耗 {costEstimate.estimatedCost} 积分 · 余额 {costEstimate.balance} 积分
                {insufficient && (
                  <>
                    {' · 积分不足,'}
                    <button type="button" className={styles.vstageCostRecharge} onClick={openMemberCenter}>
                      请前往充值积分
                    </button>
                  </>
                )}
              </span>
            </div>
          )
        })()}

      {/* 底部总按钮:上一步 / 下载视频 / 重新生成视频|确认修改(复用镜头编排底栏 smart__btn 药丸样式,整组居中) */}
      <div
        className={`${styles.vstageActions}${!onPrev || inlinePrevWithActions ? ` ${styles.vstageActionsNoPrev}` : ''}`}
      >
        {onPrev && !inlinePrevWithActions && (
          <button type="button" className="smart__nav-btn" onClick={onPrev} aria-label="上一步" data-tip="上一步">
            <svg width="26" height="21" viewBox="0 0 29 23" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M27.8881 22.0104L28.1187 21.8116C28.3625 21.6053 28.5088 21.4777 27.5336 17.4193C25.8513 10.3938 19.1616 5.85705 11.6728 5.18001V0L0 9.06596L11.6728 18.1319V12.95C16.5247 12.5824 20.7876 13.0063 23.6458 16.0708C25.0542 17.588 26.7515 20.585 27.1585 21.4684C27.2166 21.594 27.3217 21.8247 27.5786 21.911L27.8881 22.0104Z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
        <div className={styles.vstageActionButtons}>
          {inlinePrevWithActions && (
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
              className={`smart__btn smart__btn--ghost ${styles.vstageDownloadButton}`}
              onClick={onDownloadVideo}
              disabled={!videoUrl || lockSingleActions}
            >
              下载视频
            </button>
          )}
          <button
            type="button"
            className="smart__btn smart__btn--primary"
            onClick={triggerSingleRegenerate}
            disabled={lockRegenerateAction || genCooldown || (hasMods && (editCostUnavailable || editCostInsufficient))}
          >
            {showingPendingGeneration ? '生成中…' : hasMods ? '确认修改' : '重新生成视频'}
          </button>
          {canChooseMultiRegen && (
            <span className={`smart__btn-split ${styles.vstageMultiSplit}`} ref={regenSplitRef}>
              <button
                type="button"
                className={`smart__btn-split--main ${styles.vstageMultiSplitMain}`}
                onClick={triggerMultiGenerate}
                disabled={genCooldown || (hasMods && (editCostUnavailable || editCostInsufficient))}
              >
                生成多个视频
              </button>
              <span className="smart__btn-split--sep" aria-hidden="true" />
              <button
                type="button"
                className={`smart__btn-split--count ${styles.vstageMultiSplitCount}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setRegenSplitOpen((prev) => !prev)
                }}
              >
                <span>{regenCount ?? 1}个</span>
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 4 }}>
                  <path
                    d="M3 4.5L6 7.5L9 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {regenSplitOpen && (
                <span className="smart__btn-split--dropdown">
                  {regenCountOptions.map((n: number) => (
                    <button
                      key={n}
                      type="button"
                      className={`smart__btn-split--option${n === (regenCount ?? 1) ? ' is-active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRegenCountChange(n)
                        setRegenSplitOpen(false)
                      }}
                    >
                      {n}个
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
        </div>
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
                    {b.no || `图${i + 1}`} ·{' '}
                    {b.noFace
                      ? b.cached
                        ? '✓ 复用无人脸结果'
                        : '✓ 未检测到人脸，使用原图'
                      : b.ok
                        ? b.cached
                          ? '✓ 复用脱敏结果'
                          : '✓ 脱敏成功'
                        : '✗ 检测失败，已停止生成'}
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
/** 单个片段或整段视频的修改意见框，支持 AI 润色和可选删除。 */
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
