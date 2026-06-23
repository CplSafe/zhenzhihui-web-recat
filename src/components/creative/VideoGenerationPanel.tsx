/**
 * VideoGenerationPanel — 视频生成面板
 * 管理 Seedance 视频生成：生成任务提交、历史记录展示、视频预览播放（Plyr）、
 * 下载与发布操作。
 *
 * React 迁移说明：播放器由 plyr-react 的 Plyr 组件承载，通过 ref 拿到底层 plyr
 * 实例配置 controls / 事件，与原 Vue 版 new Plyr(...) 行为一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Plyr from 'plyr-react'
import 'plyr/dist/plyr.css'
import './VideoGenerationPanel.css'
import videoHistoryImg from '@/assets/creative/video-history.png'
import videoPreview from '@/assets/creative/video-preview.png'
import downloadVideoIcon from '@/img/image copy 4.png'
import publishVideoIcon from '@/img/image copy 5.png'
import { getCopyableVideoLink, hasCopyableVideoLink } from '@/utils/videoPublish'

// 外部传入的视频生成状态与历史数据。
// 这个组件负责把视频生成结果、历史版本、预览播放器和发布入口组织成一个完整面板。
export interface VideoGenerationPanelProps {
  panelStyle: CSSProperties
  videoUrl?: string
  isGenerating?: boolean
  generationProgress?: number
  taskStatus?: string
  selectedDuration?: string
  selectedRatio?: string
  selectedPlatform?: string
  selectedStyleText?: string
  creativePrompt?: string
  projectName?: string
  videoHistory?: any[]
  activeHistoryId?: string
  // 对父级暴露的视频操作事件（原 defineEmits → onXxx 回调）。
  onRegenerate?: () => void
  onSaveDraft?: () => void
  onSaveVideo?: () => void
  onDownloadVideo?: (payload: { url: string; name: string }) => void
  onPublishVideo?: (platform: string) => void
  onModifyVideo?: (prompt: string) => void
  onSelectHistory?: (history: any) => void
  onDeleteHistory?: (history: any) => void
  onNotify?: (payload: { type: string; message: string }) => void
}

// 静态展示数据。
// 当父级没有返回真实视频历史时，会回退到这组默认演示数据。
const histories = [
  { id: 'history-1', name: '版本 01', src: videoHistoryImg },
  { id: 'history-2', name: '版本 02', src: videoHistoryImg },
  { id: 'history-3', name: '版本 03', src: videoHistoryImg },
]
const styleOptions = ['生活种草', '科技风格', '商业广告', '真实口播']
const publishPlatforms = [
  { id: 'wechat-video', name: '视频号', desc: '分享到微信视频号', icon: 'wechat' },
  { id: 'douyin', name: '抖音', desc: '分享到抖音短视频', icon: 'douyin' },
  { id: 'xiaohongshu', name: '小红书', desc: '分享到小红书', icon: 'xiaohongshu' },
  { id: 'bilibili', name: 'blibli哔哩哔哩', desc: '分享到哔哩哔哩', icon: 'bilibili' },
  { id: 'kuaishou', name: '快手', desc: '分享到快手', icon: 'kuaishou' },
]
const miniClips = [
  { id: 'clip-1', left: 0, width: 78, label: '钩子起势' },
  { id: 'clip-2', left: 78, width: 144, label: '支付成功+成功释然' },
  { id: 'clip-3', left: 222, width: 97, label: '交付信任' },
  { id: 'clip-4', left: 322, width: 78, label: 'CTA闭环' },
]
const rulerLabels = [
  { label: '0s', left: 0 },
  { label: '1s', left: 39 },
  { label: '2s', left: 78, active: true },
  { label: '3s', left: 118 },
  { label: '4s', left: 158 },
  { label: '5s', left: 198 },
  { label: '5.5s', left: 213, active: true, wide: true },
  { label: '6s', left: 238 },
  { label: '7s', left: 278 },
  { label: '8s', left: 317 },
  { label: '9s', left: 355 },
  { label: '10s', left: 391, wide: true },
]
const rulerTicks = [0, 23, 41, 61, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 339, 358, 377, 399]

const RATIO_MAP: Record<string, [number, number]> = {
  '9:16': [9, 16],
  '16:9': [16, 9],
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '21:9': [21, 9],
}

const STAGE_MAX_WIDTH = 720
const STAGE_MAX_HEIGHT = 560

// 任务状态文本与终态集合。
// 用于统一映射不同生成阶段的 loading 文案和进度条表现。
const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled']
const STATUS_LABEL: Record<string, string> = {
  submitting: '正在提交任务',
  submitted: '任务已提交',
  queued: '排队中',
  running: '模型生成中',
  processing: '画面合成中',
  succeeded: '生成完成',
  failed: '生成失败',
  cancelled: '已取消',
}
const STATUS_PROGRESS: Record<string, number> = {
  submitting: 5,
  submitted: 12,
  queued: 22,
  running: 55,
  processing: 80,
  succeeded: 100,
  failed: 100,
  cancelled: 100,
}

export default function VideoGenerationPanel(props: VideoGenerationPanelProps) {
  const {
    panelStyle,
    videoUrl = '',
    isGenerating = false,
    generationProgress = 0,
    taskStatus = '',
    selectedDuration = '15s',
    selectedRatio = '9:16',
    selectedPlatform = '抖音',
    selectedStyleText = '',
    creativePrompt = '',
    projectName = '',
    videoHistory = [],
    activeHistoryId = '',
    onRegenerate,
    onSaveDraft,
    onSaveVideo,
    onDownloadVideo,
    onPublishVideo,
    onModifyVideo,
    onSelectHistory,
    onDeleteHistory,
    onNotify,
  } = props

  // 本地 UI 状态。
  // 这里保存的是播放器、下拉面板、全屏态以及局部输入框等只属于当前组件的状态。
  const [videoPrompt, setVideoPrompt] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState('clip-2')
  const [selectedStyle, setSelectedStyle] = useState('生活种草')
  const [selectedPublishPlatform, setSelectedPublishPlatform] = useState('抖音')
  const [styleMenuOpen, setStyleMenuOpen] = useState(false)
  const [publishPanelOpen, setPublishPanelOpen] = useState(false)

  const plyrRef = useRef<any>(null)
  // 记录已绑定播放事件的 Plyr 实例,确保每个实例只绑定一次(避免重复累积,且不依赖 .off)。
  const boundPlyrRef = useRef<any>(null)
  const videoPromptElement = useRef<HTMLTextAreaElement | null>(null)

  // 当前是否已有可预览/可复制的视频地址。
  const hasVideoUrl = useMemo(() => hasCopyableVideoLink(videoUrl), [videoUrl])

  // 根据当前视频比例动态计算播放器卡片宽高。
  // 这里优先保证视频不会超出舞台最大宽高，同时尽量保留实际画幅比例。
  const playerCardStyle = useMemo<CSSProperties>(() => {
    const ratioKey = (selectedRatio || '9:16').replace(/\s/g, '')
    const [rw, rh] = RATIO_MAP[ratioKey] || [9, 16]
    let width = STAGE_MAX_HEIGHT * (rw / rh)
    let height = STAGE_MAX_HEIGHT
    if (width > STAGE_MAX_WIDTH) {
      width = STAGE_MAX_WIDTH
      height = STAGE_MAX_WIDTH * (rh / rw)
    }
    // No Math.round — keep sub-pixel precision, overflow:hidden clips any 0.5px bar
    return {
      width: `${width}px`,
      height: `${height}px`,
    }
  }, [selectedRatio])

  // 只要当前还没有视频成品，且任务仍在执行中，就展示生成中的遮罩层。
  const showLoadingOverlay = useMemo(() => {
    if (hasVideoUrl) return false
    if (isGenerating) return true
    if (!taskStatus) return false
    return !TERMINAL_STATUSES.includes(taskStatus)
  }, [hasVideoUrl, isGenerating, taskStatus])

  // 顶部 loading 文案。
  const loadingTitle = useMemo(() => {
    if (taskStatus === 'failed') return '生成失败'
    if (taskStatus === 'cancelled') return '已取消'
    return 'Seedance 2.0 生成中'
  }, [taskStatus])

  // 副标题优先展示后端状态映射，没有的话再回退到通用提示。
  const loadingSubtitle = useMemo(() => {
    if (taskStatus && STATUS_LABEL[taskStatus]) {
      return STATUS_LABEL[taskStatus]
    }
    return '通常需要 30~120 秒，请稍候'
  }, [taskStatus])

  // 视频生成进度。
  // 优先使用 composable 推进的动态进度，取不到时再使用静态状态映射兜底。
  const loadingProgress = useMemo(() => {
    if (hasVideoUrl) return 100
    // 优先使用 composable 的假进度（0→99→100 动画），回退到静态映射
    if (generationProgress > 0) return generationProgress
    const pct = STATUS_PROGRESS[taskStatus]
    if (typeof pct === 'number') return pct
    return isGenerating ? 8 : 0
  }, [hasVideoUrl, generationProgress, taskStatus, isGenerating])

  // 某些阶段没有精确进度时，改用不确定态进度条。
  const isIndeterminateProgress = useMemo(() => {
    return !STATUS_PROGRESS[taskStatus] && isGenerating
  }, [taskStatus, isGenerating])

  // 将父级传入的视频历史统一整理成渲染层结构。
  const visibleHistories = useMemo(() => {
    if (videoHistory.length) {
      return videoHistory.map((item, idx) => ({
        id: item.id || `h-${idx}`,
        name: item.name || `版本 ${String(idx + 1).padStart(2, '0')}`,
        src: item.url || item.src || '',
        raw: item,
      }))
    }
    return histories.map((item) => ({
      id: item.id,
      name: item.name,
      src: item.src,
      raw: item,
    }))
  }, [videoHistory])

  // 当前激活的历史视频。
  const selectedHistoryId = useMemo(() => {
    if (activeHistoryId) return activeHistoryId
    return visibleHistories[0]?.id || ''
  }, [activeHistoryId, visibleHistories])

  // 右侧文案区的创意摘要与项目名称展示。
  const outlineText = useMemo(() => {
    const value = (creativePrompt || '').trim()
    return value || '尚未生成创意提示词'
  }, [creativePrompt])

  const projectTitle = useMemo(() => projectName || '当前创意项目', [projectName])

  const syncVideoPromptHeight = useCallback(() => {
    // 等待 DOM 更新后再测量高度（原 nextTick）
    requestAnimationFrame(() => {
      const el = videoPromptElement.current
      if (!el) return
      el.style.height = '45px'
      el.style.height = `${Math.min(el.scrollHeight, 64)}px`
    })
  }, [])

  // 取底层 video 元素，用于停止/复位播放与 Plyr 控制。
  function getVideoEl(): HTMLVideoElement | null {
    return (plyrRef.current?.plyr?.media as HTMLVideoElement) || null
  }

  // 切换历史或重新加载视频前，先把播放状态重置回初始态。
  const resetPlaybackState = useCallback(() => {
    setIsPlaying(false)
    const el = getVideoEl()
    if (el) {
      el.pause()
      try {
        el.currentTime = 0
      } catch {
        // Some browsers reject seeking before metadata is ready.
      }
    }
  }, [])

  // 选择历史版本时，先停掉当前播放，再把选中结果交给父级。
  function selectHistory(history: any) {
    resetPlaybackState()
    onSelectHistory?.(history)
  }

  // 删除某条历史记录。
  function removeHistory(history: any) {
    onDeleteHistory?.(history)
  }

  // 提交“修改视频”输入框内容。
  // 这里只负责把描述文本交给父级，不直接处理视频生成逻辑。
  function applyVideoPrompt() {
    const prompt = videoPrompt.trim()
    if (!prompt) {
      onNotify?.({ type: 'error', message: '请输入修改描述' })
      return
    }
    onModifyVideo?.(prompt)
    setVideoPrompt('')
    syncVideoPromptHeight()
  }

  function selectStyle(style: string) {
    setSelectedStyle(style)
    setStyleMenuOpen(false)
    onNotify?.({ type: 'success', message: `视频风格已切换为${style}` })
  }

  function togglePublishPanel() {
    setPublishPanelOpen((v) => !v)
  }

  function closePublishPanel() {
    setPublishPanelOpen(false)
  }

  function selectPublishPlatform(platform: any) {
    setSelectedPublishPlatform(platform.name)
  }

  function publish(platform: string = selectedPublishPlatform) {
    setPublishPanelOpen(false)
    onPublishVideo?.(platform)
  }

  async function copyPublishLink() {
    const link = getCopyableVideoLink(videoUrl)

    if (!link) {
      onNotify?.({ type: 'error', message: '暂无可复制的视频链接' })
      return
    }

    try {
      await navigator.clipboard.writeText(link)
      onNotify?.({ type: 'success', message: '发布链接已复制' })
    } catch {
      onNotify?.({ type: 'error', message: '复制链接失败，请稍后再试' })
    }
  }

  // 播放事件处理函数：使用稳定引用，便于在 configurePlyr 中先解绑再重新绑定。
  const handlePlyrPlay = useCallback(() => setIsPlaying(true), [])
  const handlePlyrPause = useCallback(() => setIsPlaying(false), [])
  const handlePlyrEnded = useCallback(() => setIsPlaying(false), [])

  // 配置 Plyr 实例：注册播放事件、强制非静音满音量。
  const configurePlyr = useCallback(() => {
    const instance = plyrRef.current?.plyr
    if (!instance) return
    try {
      instance.muted = false
      instance.volume = 1
    } catch {
      /* swallow */
    }
    const el = getVideoEl()
    if (el) {
      el.muted = false
      el.volume = 1
    }
    // 每个 Plyr 实例只绑定一次事件：configurePlyr 会随 videoUrl 变化多次执行，但若复用同一实例
    // 则跳过重复绑定，避免监听器累积；换了新实例才重新绑定。
    // （不用 instance.off：该实例在某些时机/版本下并无 .off 方法，调用会抛 TypeError。）
    if (boundPlyrRef.current !== instance && typeof instance.on === 'function') {
      boundPlyrRef.current = instance
      instance.on('play', handlePlyrPlay)
      instance.on('pause', handlePlyrPause)
      instance.on('ended', handlePlyrEnded)
    }
  }, [handlePlyrPlay, handlePlyrPause, handlePlyrEnded])

  // 视频地址变化时：复位播放状态、重新配置 Plyr、后台预热缓存。
  useEffect(() => {
    resetPlaybackState()
  }, [videoUrl, resetPlaybackState])

  useEffect(() => {
    // 首次挂载同步输入框高度
    syncVideoPromptHeight()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // videoPrompt 变化时同步高度
  useEffect(() => {
    syncVideoPromptHeight()
  }, [videoPrompt, syncVideoPromptHeight])

  // 有视频地址时配置 Plyr（等待 Plyr 组件挂载底层 video）
  useEffect(() => {
    if (hasVideoUrl) {
      const id = requestAnimationFrame(configurePlyr)
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [hasVideoUrl, videoUrl, configurePlyr])

  // 预加载：视频生成完成后在后台拉取数据，预热浏览器缓存，消除首播卡顿
  useEffect(() => {
    if (!videoUrl) return undefined
    const controller = new AbortController()
    const { signal } = controller
    fetch(videoUrl, { signal, cache: 'default' })
      .then((res) => {
        if (!signal.aborted) return res.arrayBuffer()
      })
      .catch(() => {
        // 静默失败，不影响正常播放
      })
    return () => controller.abort()
  }, [videoUrl])

  return (
    <section
      className={`video-generation${publishPanelOpen ? ' publish-panel-open' : ''}`}
      style={panelStyle}
      aria-label="视频生成"
    >
      <div className="video-design-stage">
        <div className="video-player-center">
          <article
            className={`video-player-card${isPlaying ? ' is-playing' : ''}${
              showLoadingOverlay ? ' is-loading' : ''
            }${hasVideoUrl ? ' has-video' : ''}`}
            style={playerCardStyle}
          >
            {hasVideoUrl ? (
              <div className="video-player-stage">
                <Plyr
                  ref={plyrRef as any}
                  source={{
                    type: 'video',
                    sources: [{ src: videoUrl }],
                  }}
                  options={{
                    controls: [
                      'play-large',
                      'play',
                      'progress',
                      'current-time',
                      'duration',
                      'mute',
                      'volume',
                      'fullscreen',
                    ],
                    autoplay: false,
                    muted: false,
                    volume: 1,
                    hideControls: true,
                    keyboard: { focused: true, global: false },
                    tooltips: { controls: false, seek: true },
                    settings: [],
                    invertTime: false,
                    storage: { enabled: false },
                  } as any}
                />
              </div>
            ) : showLoadingOverlay ? (
              <div className="video-loading-overlay" role="status" aria-live="polite">
                <div className="video-loading-orb">
                  <span className="orb-ring orb-ring-1"></span>
                  <span className="orb-ring orb-ring-2"></span>
                  <span className="orb-ring orb-ring-3"></span>
                  <span className="orb-core"></span>
                </div>
                <div className="video-loading-text">
                  <span className="video-loading-title">{loadingTitle}</span>
                  <span className="video-loading-sub">{loadingSubtitle}</span>
                </div>
                <div
                  className={`video-loading-progress${isIndeterminateProgress ? ' is-indeterminate' : ''}`}
                  aria-hidden="true"
                >
                  <span className="video-loading-progress-track">
                    <span
                      className="video-loading-progress-fill"
                      style={{ width: `${loadingProgress}%` }}
                    ></span>
                  </span>
                  {!isIndeterminateProgress && (
                    <span className="video-loading-progress-text">{loadingProgress}%</span>
                  )}
                </div>
              </div>
            ) : (
              <img src={videoPreview} alt="视频预览" draggable={false} />
            )}
            {!hasVideoUrl && <span className="video-player-dim"></span>}
          </article>
        </div>
      </div>

      <aside className="video-side-panel" aria-label="视频生成详情">
        <section className="video-side-section video-side-summary">
          <span className="video-side-eyebrow">视频概览</span>
          <div className="video-project-title">
            <span>项目名称</span>
            <b>{projectTitle}</b>
          </div>
          <div className="video-project-meta">
            <span>
              <b>时长</b>
              {selectedDuration}
            </span>
            <span>
              <b>比例</b>
              {selectedRatio}
            </span>
            <span>
              <b>投放平台</b>
              {selectedPlatform}
            </span>
            <span className="wide">
              <b>风格标签</b>
              {selectedStyleText || selectedStyle}
            </span>
          </div>
        </section>

        <section className="video-side-section video-outline">
          <h3>创意大纲</h3>
          <p>{outlineText}</p>
        </section>

        <section className="video-side-section video-side-history">
          <h3>历史生成</h3>
          <div className="video-side-history-row" aria-label="历史生成">
            {visibleHistories.map((history) => (
              <div
                key={history.id}
                className={`video-side-history-thumb${selectedHistoryId === history.id ? ' selected' : ''}`}
              >
                <button
                  type="button"
                  className="video-side-history-select"
                  aria-label={history.name}
                  onClick={() => selectHistory({ ...history.raw, id: history.id })}
                >
                  {history.src ? (
                    <video src={history.src} muted playsInline preload="metadata"></video>
                  ) : (
                    <img src={videoHistoryImg} alt="" draggable={false} />
                  )}
                </button>
                <button
                  type="button"
                  className="video-side-history-delete"
                  aria-label={`删除${history.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeHistory({ ...history.raw, id: history.id })
                  }}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2.46967 1.53033C2.17678 1.23744 1.7019 1.23744 1.40901 1.53033C1.11612 1.82322 1.11612 2.2981 1.40901 2.59099L4.81802 6L1.40901 9.40901C1.11612 9.7019 1.11612 10.1768 1.40901 10.4697C1.7019 10.7626 2.17678 10.7626 2.46967 10.4697L5.87868 7.06066L9.28769 10.4697C9.58058 10.7626 10.0555 10.7626 10.3483 10.4697C10.6412 10.1768 10.6412 9.7019 10.3483 9.40901L6.93934 6L10.3483 2.59099C10.6412 2.2981 10.6412 1.82322 10.3483 1.53033C10.0555 1.23744 9.58058 1.23744 9.28769 1.53033L5.87868 4.93934L2.46967 1.53033Z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="video-side-section video-mini-timeline">
          <h3>时间轴</h3>
          <div className="video-mini-timeline-card">
            <div className="video-mini-clips" aria-label="视频时间轴">
              {miniClips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  className={`video-mini-clip${selectedClipId === clip.id ? ' selected' : ''}`}
                  style={{ left: `${clip.left}px`, width: `${clip.width}px` }}
                  onClick={() => setSelectedClipId(clip.id)}
                >
                  <span>{clip.label}</span>
                </button>
              ))}
              <svg
                className="video-mini-trim"
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path d="M8.24265 9.39238V10.5643H4.83542V13.624L1.62566 10.4143C1.51581 10.3044 1.4541 10.1554 1.4541 10C1.4541 9.84463 1.51581 9.69562 1.62566 9.58574L4.83542 6.37598V9.39238H8.24265ZM11.7583 9.39238H15.005V6.21543L18.3753 9.58574C18.4851 9.69562 18.5468 9.84463 18.5468 10C18.5468 10.1554 18.4851 10.3044 18.3753 10.4143L15.0044 13.7852V10.5648H11.7583V9.39297V9.39238ZM10.5864 17.616C10.5864 17.7714 10.5247 17.9205 10.4148 18.0303C10.3049 18.1402 10.1559 18.202 10.0005 18.202C9.84506 18.202 9.69602 18.1402 9.58614 18.0303C9.47626 17.9205 9.41452 17.7714 9.41452 17.616V2.46777C9.41452 2.31237 9.47626 2.16334 9.58614 2.05345C9.69602 1.94357 9.84506 1.88184 10.0005 1.88184C10.1559 1.88184 10.3049 1.94357 10.4148 2.05345C10.5247 2.16334 10.5864 2.31237 10.5864 2.46777V17.616Z" />
              </svg>
            </div>
            <div className="video-mini-ruler">
              <span className="video-mini-ruler-line"></span>
              <span className="video-mini-ruler-active"></span>
              {rulerTicks.map((tick) => (
                <span
                  key={tick}
                  className={`video-mini-tick${tick === 80 || tick === 220 ? ' active' : ''}`}
                  style={{ left: `${tick}px` }}
                ></span>
              ))}
              {rulerLabels.map((label) => (
                <span
                  key={label.label}
                  className={`video-mini-label${label.active ? ' active' : ''}${label.wide ? ' wide' : ''}`}
                  style={{ left: `${label.left}px` }}
                >
                  {label.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="video-side-section video-modify-box">
          <div className="video-modify-head">
            <h3>快速调整</h3>
            <div className="video-style-select">
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M4.14043 6.45836C4.10323 6.31416 4.02807 6.18256 3.92277 6.07726C3.81747 5.97196 3.68588 5.8968 3.54168 5.85961L0.985432 5.20044C0.94182 5.18806 0.903436 5.16179 0.876104 5.12562C0.848772 5.08945 0.833984 5.04536 0.833984 5.00002C0.833984 4.95469 0.848772 4.91059 0.876104 4.87442C0.903436 4.83825 0.94182 4.81198 0.985432 4.79961L3.54168 4.14002C3.68583 4.10286 3.81739 4.02776 3.92268 3.92254C4.02798 3.81732 4.10317 3.68581 4.14043 3.54169L4.7996 0.985439C4.81185 0.941655 4.83809 0.903081 4.87432 0.875603C4.91054 0.848126 4.95476 0.833252 5.00022 0.833252C5.04569 0.833252 5.08991 0.848126 5.12613 0.875603C5.16236 0.903081 5.1886 0.941655 5.20085 0.985439L5.8596 3.54169C5.8968 3.68589 5.97196 3.81748 6.07726 3.92278C6.18256 4.02808 6.31415 4.10324 6.45835 4.14044L9.0146 4.79919C9.05856 4.81131 9.09732 4.83753 9.12495 4.8738C9.15258 4.91008 9.16754 4.95442 9.16754 5.00002C9.16754 5.04562 9.15258 5.08996 9.12495 5.12624C9.09732 5.16252 9.05856 5.18873 9.0146 5.20086L6.45835 5.85961C6.31415 5.8968 6.18256 5.97196 6.07726 6.07726C5.97196 6.18256 5.8968 6.31416 5.8596 6.45836L5.20043 9.01461C5.18818 9.05839 5.16194 9.09696 5.12572 9.12444C5.08949 9.15192 5.04527 9.16679 4.99981 9.16679C4.95434 9.16679 4.91012 9.15192 4.8739 9.12444C4.83768 9.09696 4.81144 9.05839 4.79918 9.01461L4.14043 6.45836Z" />
              </svg>
              <span>风格调整</span>
              <button type="button" onClick={() => setStyleMenuOpen((v) => !v)}>
                {selectedStyle}
              </button>
              <button
                type="button"
                className="video-style-arrow"
                aria-label="展开风格"
                onClick={() => setStyleMenuOpen((v) => !v)}
              >
                <svg viewBox="0 0 8 8" aria-hidden="true">
                  <path d="M7.39833 2.9092L4.36001 6.23167C4.31513 6.28273 4.25989 6.32364 4.19796 6.35166C4.13602 6.37969 4.06883 6.39418 4.00085 6.39418C3.93287 6.39419 3.86567 6.37969 3.80373 6.35167C3.74179 6.32365 3.68654 6.28274 3.64166 6.23167L0.603335 2.9092C0.455015 2.75254 0.409179 2.5242 0.485835 2.32253C0.562492 2.12086 0.747499 1.98003 0.962507 1.96088H7.03668C7.25251 1.97921 7.43833 2.1192 7.51501 2.32171C7.59251 2.52421 7.54668 2.7517 7.39833 2.9092Z" />
                </svg>
              </button>
              {styleMenuOpen && (
                <div className="video-style-menu">
                  {styleOptions.map((style) => (
                    <button
                      key={style}
                      type="button"
                      className={selectedStyle === style ? 'active' : undefined}
                      onClick={() => selectStyle(style)}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <textarea
            ref={videoPromptElement}
            value={videoPrompt}
            aria-label="视频修改描述"
            placeholder="输入你的视频修改描述..."
            rows={2}
            wrap="soft"
            onChange={(e) => setVideoPrompt(e.target.value)}
            onInput={syncVideoPromptHeight}
          ></textarea>
          <button
            type="button"
            className="video-modify-send"
            aria-label="提交视频修改"
            onClick={applyVideoPrompt}
          >
            <svg viewBox="0 0 26 26" aria-hidden="true">
              <path d="M13 0C20.1797 0 26 5.8203 26 13C26 20.1797 20.1797 26 13 26C5.8203 26 0 20.1797 0 13C5.15406e-07 5.8203 5.8203 5.15422e-07 13 0ZM15.21 7.7998C14.6214 7.80935 14.1477 8.28845 14.1475 8.87793V11.6543H4.75684C3.85325 11.6545 3.12109 12.3874 3.12109 13.291C3.12135 14.1944 3.85339 14.9266 4.75684 14.9268H14.1475V17.5625C14.1475 17.8282 14.2453 18.0846 14.4229 18.2822C14.8214 18.7255 15.5049 18.7628 15.9492 18.3652L20.8008 14.0234C20.8299 13.9974 20.8577 13.9695 20.8838 13.9404C21.2824 13.4971 21.2451 12.8157 20.8008 12.418L15.9492 8.0752C15.7508 7.89785 15.4937 7.79976 15.2275 7.7998H15.21Z" />
            </svg>
          </button>
        </section>

        <section className="video-side-section video-side-footer">
          <div className="video-side-actions">
            <button
              type="button"
              className="video-action-link"
              disabled={isGenerating}
              onClick={() => onRegenerate?.()}
            >
              重新刷新
            </button>
            <button type="button" className="video-action-link" onClick={() => onSaveDraft?.()}>
              保存草稿
            </button>
            <button type="button" className="video-action-link" onClick={() => onSaveVideo?.()}>
              保存视频
            </button>
          </div>
          {!publishPanelOpen && (
            <div className="video-publish-row">
              <button
                type="button"
                className="video-publish-main video-download-main"
                disabled={!videoUrl || isGenerating}
                onClick={() => onDownloadVideo?.({ url: videoUrl, name: projectName })}
              >
                <img src={downloadVideoIcon} alt="" aria-hidden="true" />
                下载视频
              </button>
              <div className="video-publish">
                <button
                  type="button"
                  className="video-publish-main"
                  onClick={() => (publishPanelOpen ? publish() : togglePublishPanel())}
                >
                  <img src={publishVideoIcon} alt="" aria-hidden="true" />
                  一键发布
                </button>
                <button
                  type="button"
                  className="video-publish-arrow"
                  aria-label={publishPanelOpen ? '收起发布平台' : '选择发布平台'}
                  onClick={togglePublishPanel}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    {publishPanelOpen ? (
                      <path d="M15.5651 10.8727L8.80146 3.47652C8.70157 3.36285 8.57858 3.27179 8.44071 3.20941C8.30284 3.14704 8.15325 3.11477 8.00193 3.11478C7.69584 3.11478 7.40459 3.24649 7.20239 3.47652L0.438797 10.8727C0.108594 11.2214 0.00656467 11.7297 0.177231 12.1787C0.347898 12.6276 0.759724 12.9411 1.23833 12.9838H14.76C15.2404 12.943 15.6541 12.6313 15.8248 12.1805C15.9973 11.7297 15.8953 11.2233 15.5651 10.8727Z" />
                    ) : (
                      <path d="M15.5651 5.12725L8.80146 12.5234C8.70157 12.6371 8.57858 12.7281 8.44071 12.7905C8.30284 12.8529 8.15325 12.8852 8.00193 12.8852C7.69584 12.8852 7.40459 12.7534 7.20239 12.5234L0.438797 5.12725C0.108594 4.77849 0.00656467 4.2702 0.177231 3.82128C0.347898 3.37235 0.759724 3.05884 1.23833 3.01617H14.76C15.2404 3.05699 15.6541 3.36864 15.8248 3.81942C15.9973 4.2702 15.8953 4.77664 15.5651 5.12725Z" />
                    )}
                  </svg>
                </button>
              </div>
            </div>
          )}
        </section>
      </aside>

      {publishPanelOpen && (
        <div className="video-publish-overlay" aria-label="选择发布平台">
          <button
            type="button"
            className="video-publish-backdrop"
            aria-label="关闭发布平台"
            onClick={closePublishPanel}
          ></button>
          <section className="video-publish-panel" aria-label="发布平台">
            <h3>发布视频到</h3>
            <p className="video-publish-tip">
              <span>将视频发布到以下平台</span>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 11.25C4.60761 11.25 3.27226 10.6969 2.28769 9.71231C1.30312 8.72774 0.75 7.39239 0.75 6C0.75 4.60761 1.30312 3.27226 2.28769 2.28769C3.27226 1.30312 4.60761 0.75 6 0.75C7.39239 0.75 8.72774 1.30312 9.71231 2.28769C10.6969 3.27226 11.25 4.60761 11.25 6C11.25 7.39239 10.6969 8.72774 9.71231 9.71231C8.72774 10.6969 7.39239 11.25 6 11.25ZM6 1.8C5.44845 1.8 4.9023 1.90864 4.39273 2.11971C3.88316 2.33078 3.42016 2.64015 3.03015 3.03015C2.64015 3.42016 2.33078 3.88316 2.11971 4.39273C1.90864 4.9023 1.8 5.44845 1.8 6C1.8 6.55155 1.90864 7.0977 2.11971 7.60727C2.33078 8.11684 2.64015 8.57984 3.03015 8.96985C3.42016 9.35985 3.88316 9.66922 4.39273 9.88029C4.9023 10.0914 5.44845 10.2 6 10.2C7.11391 10.2 8.1822 9.7575 8.96985 8.96985C9.7575 8.1822 10.2 7.11391 10.2 6C10.2 4.88609 9.7575 3.8178 8.96985 3.03015C8.1822 2.2425 7.11391 1.8 6 1.8ZM6 9.15C5.86076 9.15 5.72723 9.09469 5.62877 8.99623C5.53031 8.89777 5.475 8.76424 5.475 8.625V4.95C5.475 4.88106 5.48858 4.81279 5.51496 4.74909C5.54135 4.6854 5.58002 4.62752 5.62877 4.57877C5.67752 4.53002 5.73539 4.49135 5.79909 4.46496C5.86279 4.43858 5.93106 4.425 6 4.425C6.06894 4.425 6.13721 4.43858 6.20091 4.46496C6.26461 4.49135 6.32248 4.53002 6.37123 4.57877C6.41998 4.62752 6.45865 4.6854 6.48504 4.74909C6.51142 4.81279 6.525 4.88106 6.525 4.95V8.625C6.525 8.76424 6.46969 8.89777 6.37123 8.99623C6.27277 9.09469 6.13924 9.15 6 9.15ZM6 3.9C5.92944 3.90272 5.85905 3.89117 5.79306 3.86606C5.72706 3.84094 5.66681 3.80277 5.61591 3.75383C5.56501 3.70489 5.5245 3.64618 5.49682 3.58122C5.46913 3.51626 5.45484 3.44638 5.45479 3.37576C5.45474 3.30515 5.46893 3.23525 5.49653 3.17025C5.52412 3.10525 5.56454 3.04649 5.61537 2.99747C5.6662 2.94846 5.7264 2.9102 5.79236 2.88499C5.85832 2.85978 5.92868 2.84813 5.99925 2.85075C6.13496 2.85578 6.26344 2.91321 6.35771 3.01097C6.45197 3.10873 6.50469 3.23921 6.50479 3.37501C6.50489 3.51082 6.45235 3.64138 6.35823 3.73927C6.2641 3.83716 6.1357 3.89477 6 3.9Z" />
              </svg>
            </p>

            {publishPlatforms.map((platform) => (
              <button
                key={platform.id}
                type="button"
                className={`publish-platform-card${selectedPublishPlatform === platform.name ? ' selected' : ''}`}
                aria-label={`选择${platform.name}`}
                aria-pressed={selectedPublishPlatform === platform.name}
                onClick={() => selectPublishPlatform(platform)}
              >
                <span className={`publish-platform-icon is-${platform.icon}`}>
                  {platform.icon === 'wechat' ? (
                    <svg viewBox="0 0 40 40" aria-hidden="true">
                      <path
                        d="M13.9102 8.83117L14.6268 10.0439C15.8518 12.1631 17.628 15.4583 19.9555 19.9295L22.2523 15.5747C23.3915 13.4249 24.5675 11.3118 25.7986 9.19867L26.0191 8.83117C30.2637 1.86712 34.4348 -0.356227 37.4483 3.50248C39.2857 6.01983 40.1126 11.2566 39.837 17.5959C39.708 23.0454 38.6065 28.428 36.5846 33.4901C34.1592 38.6902 30.1351 40.1234 26.4601 35.7502L26.111 35.3276C25.0637 34.0046 23.024 31.2117 19.9738 26.912L17.1074 30.9912C15.2699 33.4718 14.1123 35.0704 13.4324 35.8421C9.75745 40.2153 5.73337 38.7821 3.30789 33.582C1.26897 28.4922 0.161133 23.0775 0.0371806 17.5959C-0.183317 11.2566 0.57005 6.01983 2.48103 3.42898C5.54962 -0.429726 9.66557 1.86712 13.9102 8.83117Z"
                        fill="#FE9D13"
                      />
                    </svg>
                  ) : platform.icon === 'douyin' ? (
                    <svg viewBox="0 0 40 40" aria-hidden="true">
                      <path
                        d="M6.42726 -0.135254H33.5806C37.8628 -0.135254 40.0039 2.00586 40.0039 6.2881V33.4414C40.0039 37.7236 37.8628 39.8647 33.5806 39.8647H6.42726C2.14503 39.8647 0.00390625 37.7236 0.00390625 33.4414V6.2881C0.00390625 2.00586 2.14503 -0.135254 6.42726 -0.135254Z"
                        fill="#110A17"
                      />
                      <path
                        d="M5.21385 25.7006C5.21023 27.9544 5.99629 30.1371 7.43366 31.8647C5.9275 30.5985 4.84519 28.8959 4.33389 26.9884C3.82259 25.081 3.90712 23.0613 4.57598 21.2039C5.24484 19.3465 6.46558 17.7416 8.0722 16.6074C9.67883 15.4732 11.5934 14.8648 13.5556 14.8647C14.0404 14.8646 14.5246 14.9014 15.0039 14.9748V16.086H14.7656C12.2328 16.086 9.80373 17.0989 8.01252 18.9019C6.22131 20.7049 5.21463 23.1504 5.21385 25.7006Z"
                        fill="#6DC5CC"
                      />
                      <path
                        d="M30.0039 12.222V16.34H29.8575C27.3462 16.3477 24.893 15.5878 22.8297 14.163V23.5531C22.8531 23.8234 22.8663 24.0966 22.8663 24.3735C22.8665 26.1781 22.3498 27.9453 21.3767 29.468C20.4035 30.9907 19.0143 32.2057 17.372 32.9704C15.7297 33.7352 13.9023 34.0181 12.1041 33.7858C10.306 33.5536 8.61165 32.816 7.21982 31.6594C6.05769 30.2741 5.31651 28.5878 5.08319 26.7982C4.84986 25.0086 5.13407 23.1899 5.90249 21.5554C6.67091 19.9209 7.89167 18.5383 9.42162 17.5697C10.9516 16.6012 12.7273 16.0869 14.5405 16.0872H14.7784V20.3793C13.797 20.0273 12.7199 20.0456 11.7511 20.4307C10.7823 20.8159 9.98905 21.5412 9.52146 22.4693C9.05386 23.3975 8.94441 24.464 9.21383 25.4671C9.48324 26.4702 10.1128 27.3401 10.9834 27.9122C11.4615 28.633 12.1493 29.1914 12.9549 29.5127C13.7604 29.834 14.6453 29.9029 15.4913 29.7102C16.3373 29.5174 17.1039 29.0723 17.6889 28.4342C18.2738 27.7962 18.649 26.9956 18.7645 26.1396V4.86475H22.889C23.0925 6.49533 23.8048 8.04723 25.0237 9.19985C25.1916 9.3589 25.3676 9.50942 25.5507 9.65085C25.7577 9.9176 25.9848 10.1682 26.2301 10.4006C27.266 11.3852 28.5857 12.0222 30.0039 12.222Z"
                        fill="white"
                      />
                      <path
                        d="M31.0039 11.9403V17.2223H30.8574C28.3453 17.23 25.8913 16.4648 23.8273 15.0303V24.4835C23.8507 24.7557 23.8639 25.0308 23.8639 25.3096C23.8639 27.2725 23.2604 29.1877 22.1355 30.795C21.0107 32.4022 19.419 33.6234 17.5769 34.2925C15.7349 34.9616 13.7318 35.0461 11.8401 34.5346C9.94834 34.0232 8.25976 32.9404 7.00391 31.4337C8.3962 32.5983 10.0911 33.341 11.8898 33.5749C13.6886 33.8087 15.5166 33.5239 17.1595 32.7538C18.8023 31.9838 20.192 30.7605 21.1655 29.2273C22.1389 27.6941 22.6558 25.9147 22.6556 24.0977C22.6556 23.8189 22.6424 23.5438 22.619 23.2716V13.822C24.6833 15.2555 27.1373 16.0197 29.6491 16.0111H29.7956V11.8647C30.1956 11.9233 30.5997 11.9486 31.0039 11.9403Z"
                        fill="#E72852"
                      />
                    </svg>
                  ) : platform.icon === 'xiaohongshu' ? (
                    <svg viewBox="0 0 40 40" aria-hidden="true">
                      <path
                        d="M40 32.7343V7.26714C40 3.27 36.73 0 32.7329 0H7.26714C3.27 0 0 3.27 0 7.26714V32.7343C0 36.6914 3.20571 39.9371 7.15 40H32.85C36.7929 39.9371 40 36.6929 40 32.7343Z"
                        fill="#FF2442"
                      />
                      <path
                        d="M28.3935 14H30.6129V14.8147C30.6129 14.8797 30.6439 14.91 30.7045 14.9085C32.0206 14.8681 33.3466 14.9114 34.0258 16.2952C34.4302 17.1156 34.3471 18.3636 34.3245 19.3429C34.3231 19.4007 34.3499 19.4325 34.4034 19.4383C34.5584 19.4527 34.7092 19.4672 34.8558 19.4859C37.4725 19.808 36.9554 22.3372 36.9638 24.3248C36.968 25.0181 36.8919 25.5251 36.7383 25.8486C36.4142 26.5188 35.8337 26.9031 34.9967 26.9984H33.3649L32.5307 25.0137L34.3555 24.9227C34.4541 24.9227 34.5472 24.8794 34.6148 24.8043C34.6832 24.7286 34.7206 24.6287 34.7191 24.5255C34.7106 23.9189 34.7064 23.3137 34.7092 22.7084C34.7092 22.1639 34.4584 21.8851 33.9525 21.8707C33.3804 21.8562 32.2968 21.8562 30.7002 21.8736L30.6072 26.9984H28.3907L28.3836 21.9458H26.2262L26.1332 19.5538L28.2822 19.4469C28.3709 19.3947 28.381 19.3678 28.3808 19.34V17.4392C28.3816 17.4061 28.3696 17.374 28.3474 17.35L26.8956 14.9995L28.2962 14.9028L28.3949 14H28.3935ZM16.4511 19.6087C15.9156 19.6188 14.9476 19.7719 14.7362 19.0656C14.608 18.6438 14.8982 18.0559 15.0744 17.6443L16.5511 14.117H18.7705L17.5925 17.0593C17.5643 17.1272 17.5714 17.2037 17.608 17.2673H19.5921L18.0829 21.1918C18.0307 21.3146 18.0082 21.4056 18.0166 21.4633C18.035 21.589 18.104 21.6526 18.2224 21.654L19.3708 21.6612L18.6888 23.5534C17.3811 23.6675 16.5652 23.6675 16.1002 23.6459C15.3308 23.6098 15.142 22.9193 15.4408 22.2072L16.4962 19.6824L16.4511 19.6087ZM7.65108 26.9984H6.81969L6.00521 25.0383L7.2072 24.9473C7.47071 24.6656 7.50171 14.2701 7.50171 14.2701H9.57736C9.67036 14.1661 9.72673 17.8364 9.71827 24.696C9.71264 26.0913 9.08135 27.0446 7.65108 26.9984Z"
                        fill="white"
                      />
                    </svg>
                  ) : platform.icon === 'bilibili' ? (
                    <svg viewBox="0 0 40 40" aria-hidden="true">
                      <path
                        d="M7.85703 0H32.156C37.394 0 40.013 2.61901 40.013 7.85703V32.143C40.013 37.381 37.394 40 32.156 40H7.85703C2.61901 40 0 37.381 0 32.143V7.85703C0 2.61901 2.61901 0 7.85703 0Z"
                        fill="#F4518C"
                      />
                      <path
                        d="M12 12.4L9.4 9.8C9.05 9.45 9.05 8.9 9.4 8.55C9.75 8.2 10.3 8.2 10.65 8.55L14.5 12.4H25.5L29.35 8.55C29.7 8.2 30.25 8.2 30.6 8.55C30.95 8.9 30.95 9.45 30.6 9.8L28 12.4H30.4C33 12.4 35.2 14.55 35.2 17.2V27.2C35.2 29.85 33 32 30.4 32H9.6C7 32 4.8 29.85 4.8 27.2V17.2C4.8 14.55 7 12.4 9.6 12.4H12ZM10.2 15.6C9.05 15.6 8.1 16.55 8.1 17.7V26.7C8.1 27.85 9.05 28.8 10.2 28.8H29.8C30.95 28.8 31.9 27.85 31.9 26.7V17.7C31.9 16.55 30.95 15.6 29.8 15.6H10.2ZM14 21.2L18.3 22L17.8 24L13.5 23.2L14 21.2ZM26 21.2L26.5 23.2L22.2 24L21.7 22L26 21.2ZM16.2 25.1C16.55 25.6 17.15 26.1 17.9 26.1C18.75 26.1 19.25 25.45 20 24.7C20.75 25.45 21.25 26.1 22.1 26.1C22.85 26.1 23.45 25.6 23.8 25.1C24 24.8 24.4 24.7 24.7 24.9C25 25.1 25.1 25.5 24.9 25.8C24.25 26.85 23.25 27.45 22.1 27.45C21.25 27.45 20.55 27.1 20 26.55C19.45 27.1 18.75 27.45 17.9 27.45C16.75 27.45 15.75 26.85 15.1 25.8C14.9 25.5 15 25.1 15.3 24.9C15.6 24.7 16 24.8 16.2 25.1Z"
                        fill="white"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 40 40" aria-hidden="true">
                      <path
                        d="M34.6667 0H5.33333C2.38778 0 0 2.38778 0 5.33333V34.6667C0 37.6122 2.38778 40 5.33333 40H34.6667C37.6122 40 40 37.6122 40 34.6667V5.33333C40 2.38778 37.6122 0 34.6667 0ZM17.0296 6.66667C19.3756 6.66667 21.4231 7.964 22.4956 9.87844C23.4609 8.97333 24.7573 8.41733 26.1818 8.41733C29.1569 8.41733 31.5771 10.8378 31.5771 13.8127C31.5771 16.7876 29.1567 19.2078 26.1818 19.2078C24.3847 19.2078 22.7909 18.3236 21.8098 16.968C20.6602 18.3264 18.9444 19.1911 17.0296 19.1911C13.5764 19.1911 10.7673 16.3818 10.7673 12.9289C10.7673 9.476 13.5764 6.66667 17.0296 6.66667ZM31.6413 28.6127C31.6413 31.2158 29.5238 33.3333 26.9207 33.3333H20.1444C18.102 33.3333 16.3587 32.0293 15.7024 30.2098L11.8909 32.0502C11.4813 32.248 11.0671 32.348 10.6593 32.348H10.6591C9.32622 32.348 8.35867 31.2902 8.35867 29.8336V23.7324C8.35867 22.2751 9.32622 21.2176 10.6593 21.2176C11.0671 21.2176 11.4813 21.3178 11.8907 21.5156L15.6927 23.3513C16.3409 21.5171 18.0913 20.1989 20.1444 20.1989H26.9204C29.5236 20.1989 31.6411 22.3167 31.6411 24.9198V28.6127H31.6413Z"
                        fill="#FF4A08"
                      />
                      <path
                        d="M11 24.5125V28.2623C11 28.8901 11.4569 29.1728 12.0153 28.8905L15.5789 27.0895V25.6852L12.0155 23.884C11.4569 23.6017 11 23.8846 11 24.5125ZM26.1577 16.4375C27.7249 16.4375 29 15.1572 29 13.5833C29 12.0094 27.7249 10.7288 26.1577 10.7288C24.5906 10.7288 23.3158 12.0094 23.3158 13.5833C23.3158 15.1572 24.5906 16.4375 26.1577 16.4375ZM17.158 16.421C19.1953 16.421 20.8526 14.7565 20.8526 12.7105C20.8526 10.6646 19.1953 9 17.158 9C15.1207 9 13.4632 10.6646 13.4632 12.7105C13.4632 14.7565 15.1207 16.421 17.158 16.421Z"
                        fill="#FF4A08"
                      />
                    </svg>
                  )}
                </span>
                <span className="publish-platform-text">
                  <b>{platform.name}</b>
                  <em>{platform.desc}</em>
                </span>
                <svg className="publish-platform-check" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 0C4.5 0 0 4.5 0 10C0 15.5 4.5 20 10 20C15.5 20 20 15.5 20 10C20 4.5 15.5 0 10 0ZM16.375 7.25L8.875 14.75C8.75 14.875 8.375 15 8.125 15C7.875 15 7.625 14.875 7.375 14.75L2.875 10.25C2.5 9.875 2.5 9.125 2.875 8.75C3.25 8.375 4 8.375 4.375 8.75L8.125 12.5L14.875 5.75C15.25 5.375 16 5.375 16.375 5.75C16.875 6.125 16.875 6.75 16.375 7.25Z" />
                </svg>
              </button>
            ))}

            <button
              type="button"
              className="video-copy-link"
              disabled={!hasVideoUrl}
              onClick={copyPublishLink}
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M11.1327 0.872794L11.0847 0.824794C10.5537 0.296985 9.8354 0.000732422 9.0867 0.000732422C8.338 0.000732422 7.61971 0.296985 7.0887 0.824794L4.54143 3.37098C4.01355 3.90217 3.71727 4.62064 3.71727 5.36952C3.71727 6.1184 4.01355 6.83687 4.54143 7.36807L4.58834 7.41498C4.67997 7.50552 4.77815 7.58843 4.87743 7.66588L5.80906 6.73316C5.69997 6.66988 5.59743 6.59134 5.5047 6.49861L5.45779 6.45279C5.171 6.16544 5.00994 5.77604 5.00994 5.37007C5.00994 4.96409 5.171 4.57469 5.45779 4.28734L8.00615 1.74007C8.29313 1.45341 8.68217 1.2924 9.08779 1.2924C9.49341 1.2924 9.88244 1.45341 10.1694 1.74007L10.2163 1.78698C10.5031 2.07414 10.6641 2.46336 10.6641 2.86916C10.6641 3.27496 10.5031 3.66417 10.2163 3.95134L9.06543 5.10552C9.26506 5.60079 9.35997 6.12661 9.35015 6.65134L11.1327 4.86988C11.6608 4.33901 11.9572 3.62067 11.9572 2.87188C11.9572 2.12309 11.6608 1.40476 11.1327 0.873885V0.872794ZM7.36906 4.54261C7.27819 4.45243 7.18124 4.3686 7.07888 4.2917L6.14724 5.22334C6.25633 5.28879 6.35997 5.36516 6.4527 5.45898L6.5007 5.50588C6.78742 5.79305 6.94846 6.18227 6.94846 6.58807C6.94846 6.99387 6.78742 7.38308 6.5007 7.67025L3.95343 10.2175C3.66593 10.504 3.27659 10.6649 2.8707 10.6649C2.46481 10.6649 2.07547 10.504 1.78797 10.2175L1.74106 10.1695C1.45434 9.88235 1.2933 9.49314 1.2933 9.08734C1.2933 8.68154 1.45434 8.29233 1.74106 8.00516L2.89306 6.85425C2.69516 6.36334 2.59796 5.83765 2.60724 5.30843L0.824699 7.0877C0.296491 7.61895 0 8.33765 0 9.08679C0 9.83594 0.296491 10.5546 0.824699 11.0859L0.871608 11.1339C1.40294 11.6615 2.12136 11.9576 2.87015 11.9576C3.61895 11.9576 4.33736 11.6615 4.8687 11.1339L7.41597 8.58552C7.94358 8.05418 8.23968 7.33577 8.23968 6.58698C8.23968 5.83818 7.94358 5.11977 7.41597 4.58843L7.36906 4.54152V4.54261Z" />
              </svg>
              复制链接
            </button>
          </section>

          <div className="video-publish video-publish-floating">
            <button type="button" className="video-publish-main" onClick={() => publish()}>
              <img src={publishVideoIcon} alt="" aria-hidden="true" />
              一键发布
            </button>
            <button
              type="button"
              className="video-publish-arrow"
              aria-label="收起发布平台"
              onClick={togglePublishPanel}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M15.5651 10.8727L8.80146 3.47652C8.70157 3.36285 8.57858 3.27179 8.44071 3.20941C8.30284 3.14704 8.15325 3.11477 8.00193 3.11478C7.69584 3.11478 7.40459 3.24649 7.20239 3.47652L0.438797 10.8727C0.108594 11.2214 0.00656467 11.7297 0.177231 12.1787C0.347898 12.6276 0.759724 12.9411 1.23833 12.9838H14.76C15.2404 12.943 15.6541 12.6313 15.8248 12.1805C15.9973 11.7297 15.8953 11.2233 15.5651 10.8727Z" />
              </svg>
            </button>
          </div>
        </div>
      )}

    </section>
  )
}
