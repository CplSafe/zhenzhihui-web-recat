/**
 * 时间线播放器：把多段视频当成一条连续的片子播放。
 *
 * 用两个 video 元素交替（双缓冲）：当前段在播时，另一个已经把下一段加载好并 seek 到起点，
 * 到达片段边界时直接切换显示的那一个。单个 video 换 src 会有一次加载空档，
 * 画面黑一下就会露馅——那样看起来还是「两条视频」，而不是一条。
 *
 * 只负责播放与定位，不修改时间线：裁剪/排序由上层完成。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetStreamUrl } from '@/utils/assetUrl'
import { acquireSeekableSource, type SeekableSourceHandle } from '@/utils/seekableMediaSource'
import { buildFilmstrip, getCachedFilmstrip } from '@/utils/videoFilmstrip'
import {
  buildTimelineTicks,
  formatTimelineTime,
  getClipDuration,
  getClipOffsets,
  getTimelineDuration,
  locateTimelineTime,
  type TimelineClip,
} from '@/utils/timelineClips'
import styles from './CanvasTimelinePlayer.module.css'

interface CanvasTimelinePlayerProps {
  clips: readonly TimelineClip[]
  workspaceId: number
  /** 紧凑模式：画布节点内嵌使用，控件更小、不显示片段序号。 */
  compact?: boolean
  /** 受控播放头；不传则由播放器自己维护（节点内嵌就是这种）。 */
  playheadSec?: number
  onPlayheadChange?: (seconds: number) => void
  /** 提供后片段块上出现移除按钮；不提供则轨道是只读的。 */
  onRemoveClip?: (clipId: string) => void
  /** 提供后轨道末尾出现「+」，空时间线也显示居中的添加入口。 */
  onAddClip?: () => void
  /**
   * 隐藏内置的刻度尺与片段轨道，只留画面与播放键。
   * 给剪辑编辑器用：那里自己画一条可编辑的轨道，再叠一条只读轨道就是两套时间轴。
   */
  hideTimeline?: boolean
  className?: string
}

/** 判定「本段已放完」的容差：timeupdate 的回报精度有限，卡死在最后几毫秒会让播放停住。 */
const CLIP_END_EPSILON_SEC = 0.05

/**
 * 把 MediaError 翻成用户能据此行动的说明。
 *
 * 不做这层翻译时，素材加载失败、解码失败、地址失效全都只表现为一片黑，
 * 用户和排查的人都无从判断是「还在加载」还是「这条素材根本放不了」。
 */
function describeMediaError(video: HTMLVideoElement): string {
  const error = video.error
  if (!error) return '这段素材没能显示画面，请稍后重试'
  switch (error.code) {
    case 1:
      return '素材加载被中断'
    case 2:
      return '素材加载失败：网络异常或地址已失效'
    case 3:
      return '素材解码失败：这条视频的编码格式当前浏览器放不了'
    case 4:
      return '素材无法播放：地址不可用或格式不受支持'
    default:
      return '这段素材没能显示画面，请稍后重试'
  }
}

/** 播放头保留到毫秒即可：timeupdate 的原始浮点值会让受控父级每帧都收到一个新值。 */
const roundedPlayhead = (seconds: number) => Math.round(seconds * 1000) / 1000

export default function CanvasTimelinePlayer({
  clips,
  workspaceId,
  compact = false,
  playheadSec: controlledPlayheadSec,
  onPlayheadChange,
  onRemoveClip,
  onAddClip,
  hideTimeline = false,
  className,
}: CanvasTimelinePlayerProps) {
  const slotRefs = [useRef<HTMLVideoElement | null>(null), useRef<HTMLVideoElement | null>(null)]
  const [activeSlot, setActiveSlot] = useState(0)
  const [innerPlayheadSec, setInnerPlayheadSec] = useState(0)
  const [playing, setPlaying] = useState(false)

  const controlled = controlledPlayheadSec !== undefined
  const playheadSec = controlled ? controlledPlayheadSec : innerPlayheadSec
  const setPlayheadSec = useCallback(
    (next: number) => {
      if (!controlled) setInnerPlayheadSec(next)
      onPlayheadChange?.(next)
    },
    [controlled, onPlayheadChange],
  )

  /** 当前段的播放故障说明；为空表示正常。切段或重新定位后清空。 */
  const [mediaError, setMediaError] = useState('')
  const state = useMemo(() => ({ clips: [...clips] }), [clips])
  const totalSec = getTimelineDuration(state)
  const offsets = useMemo(() => getClipOffsets(state), [state])
  const located = useMemo(() => locateTimelineTime(state, playheadSec), [state, playheadSec])

  /**
   * 每条素材的本地可跳转副本。
   *
   * 素材的 /download 不支持 Range，直接当 src 用时 currentTime 会被抹回 0——
   * 「拖到第 6 秒却从头播」正是这个原因。画布视频节点一直是抓整片到本地再播的，
   * 时间线预览必须走同一条路，否则任意定位根本不成立。
   */
  const [seekableByAsset, setSeekableByAsset] = useState<Record<number, string>>({})
  const assetIdsKey = useMemo(
    () => [...new Set(clips.map((clip) => clip.assetId).filter((assetId) => assetId > 0))].sort().join(','),
    [clips],
  )
  useEffect(() => {
    const assetIds = assetIdsKey ? assetIdsKey.split(',').map(Number) : []
    // 释放认句柄而不是地址：同一地址可能先后存在多个 entry，按地址释放会误伤后来者
    const handles: SeekableSourceHandle[] = []
    let cancelled = false
    for (const assetId of assetIds) {
      const remote = assetStreamUrl(assetId, workspaceId)
      if (!remote) continue
      const handle = acquireSeekableSource(remote)
      handles.push(handle)
      void handle.ready.then(({ url, local }) => {
        if (cancelled || !local) return
        setSeekableByAsset((current) => (current[assetId] === url ? current : { ...current, [assetId]: url }))
      })
    }
    return () => {
      cancelled = true
      for (const handle of handles) handle.release()
    }
  }, [assetIdsKey, workspaceId])

  const urlOf = useCallback(
    (clip: TimelineClip | undefined) =>
      clip ? seekableByAsset[clip.assetId] || assetStreamUrl(clip.assetId, workspaceId) : '',
    [seekableByAsset, workspaceId],
  )

  /**
   * 把 video 定位到指定时刻。
   *
   * force 用于「元数据刚就绪」这一刻：此时必须真的走一次 seek，否则元素停在 HAVE_METADATA——
   * 时长读得到，但一帧都没解码，画面是纯黑。而截取自 0 秒的片段目标时刻恰好等于 currentTime，
   * 按差值判断会直接跳过，永远出不来首帧；所以相等时补一个极小偏移，逼浏览器真的解码一帧。
   */
  const seekSlot = useCallback((video: HTMLVideoElement, sourceTimeSec: number, force = false) => {
    const target = Math.max(0, Number(sourceTimeSec) || 0)
    const current = video.currentTime || 0
    if (!force && Math.abs(current - target) <= 0.05) {
      // 本来就在位：顺手撤掉上一次的目标，留着它会被当成「还没定位好」而拦住起播
      video.removeAttribute('data-seek-target')
      return
    }
    // 记下目标：元数据未就绪时写 currentTime 会被浏览器直接忽略，而绑定副作用不会因此再跑一次，
    // 定位就永远停在第一帧。把目标挂在元素上，等 loadedmetadata / canplay 时补一次。
    video.setAttribute('data-seek-target', String(target))
    try {
      video.currentTime = force && Math.abs(current - target) < 1e-3 ? target + 0.001 : target
    } catch {
      /* 元数据未就绪，applyPendingSeek 会在可定位之后补上 */
    }
  }, [])

  /**
   * 把记下的目标真正落到元素上。
   *
   * 在 loadedmetadata 与 canplay 两个时机都调一次：前者保证元数据一到就定位，
   * 后者兜住「元数据已有但那次写入仍被忽略」的情况——只挂一个事件不足以覆盖各浏览器的差异。
   */
  const applyPendingSeek = useCallback((video: HTMLVideoElement) => {
    const raw = video.getAttribute('data-seek-target')
    if (raw === null) return
    const target = Number(raw)
    if (!Number.isFinite(target)) return
    // 已经落到位就把目标撤掉：留着它会变成陈旧值，往后播了十秒仍被当成「还没定位好」
    if (Math.abs((video.currentTime || 0) - target) <= 0.05) {
      video.removeAttribute('data-seek-target')
      return
    }
    try {
      video.currentTime = target
    } catch {
      /* 仍不可定位，下一个事件再试 */
    }
  }, [])

  /**
   * 定位真的落到位之后才起播。
   *
   * 直接在 seek 之后紧接着 play() 是不行的：readyState 低时那次 currentTime 写入会被浏览器忽略，
   * 元素仍停在 0 秒，而 play() 已经开始了——于是从片段起点之前放起来，
   * 被裁掉的那段画面（字幕是烧进画面的，跟着一起出现）和声音全都漏出来，
   * 一直放到裁切点，进度条和画面才对上。这正是「裁掉的音频字幕又响一遍」的成因。
   *
   * 没落到位就先记账，等 seeked / canplay 时再回到这里，收敛后才真正播。
   */
  const playWhenPositioned = useCallback(
    (video: HTMLVideoElement) => {
      const raw = video.getAttribute('data-seek-target')
      const target = raw === null ? Number.NaN : Number(raw)
      if (Number.isFinite(target) && Math.abs((video.currentTime || 0) - target) > CLIP_END_EPSILON_SEC) {
        video.setAttribute('data-resume', '1')
        return
      }
      video.removeAttribute('data-resume')
      const played = video.play()
      if (played && typeof played.catch === 'function') played.catch(() => setPlaying(false))
    },
    [setPlaying],
  )

  /** 把某个 video 元素对齐到指定片段的起点；已经是同一段则只校正时间。 */
  const bindSlot = useCallback(
    (slot: number, clip: TimelineClip | undefined, sourceTimeSec: number) => {
      const video = slotRefs[slot].current
      if (!video || !clip) return
      const url = urlOf(clip)
      if (!url) return
      video.setAttribute('data-clip', clip.id)
      // 换 src 只看地址变没变，不能嵌在「换片段」判断里。
      // 本地可跳转副本是异步抓回来的：首次绑定用的还是远端地址，副本就绪后 clip.id 没变，
      // 嵌套判断会整段跳过，元素就一直用着不支持 Range 的远端地址——拖到哪都停在第一帧。
      //
      // 反过来也要拦住：分割出来的两段共用同一条素材，地址相同就不能 load()，
      // 否则 currentTime 被打回 0、readyState 归零，这一段会从头播而不是从自己的 inSec 开始。
      if (video.getAttribute('data-src') !== url) {
        // 换源会让元素暂停并丢掉进度，正在播的必须在 canplay 时接上，不能停在原地
        if (!video.paused) video.setAttribute('data-resume', '1')
        video.setAttribute('data-src', url)
        video.src = url
        // 首段首次挂载时浏览器不会总是主动开始解码，显式 load 可避免预览区黑屏；
        // 后备槽位复用时同样保证元数据事件必然触发。
        video.load()
      }
      video.muted = clip.muted === true
      seekSlot(video, sourceTimeSec)
    },
    // slotRefs 是两个稳定的 ref 容器，逐个列出会让依赖数组每次渲染都变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urlOf, seekSlot],
  )

  // 当前段绑定到活动槽位，下一段预加载到备用槽位——切换时才不会黑一帧
  useEffect(() => {
    if (!located) return
    // 备用槽位已经装着要放的这一段（拖动跨过段落边界时的常见情况）：
    // 直接换显示哪一个，不要给活动槽位重设 src——那会重新加载，画面黑一下才回来。
    // 换完之后本副作用会因 activeSlot 变化再跑一次，那时新的活动槽位已持有该段，不会再换，不会来回摆。
    const standby = slotRefs[1 - activeSlot].current
    if (standby?.getAttribute('data-clip') === located.clip.id) {
      setActiveSlot((slot) => 1 - slot)
      return
    }
    bindSlot(activeSlot, located.clip, located.sourceTimeSec)
    const next = state.clips[located.index + 1]
    if (next) bindSlot(1 - activeSlot, next, next.inSec)
    // slotRefs 是两个稳定的 ref 容器，逐个列出会让依赖数组每次渲染都变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, activeSlot, state, bindSlot])

  // 片段被删除或时长变短后，播放头不能停在已经不存在的位置上
  useEffect(() => {
    if (playheadSec > totalSec) setPlayheadSec(totalSec)
  }, [playheadSec, totalSec, setPlayheadSec])

  const playActive = useCallback(() => {
    const video = slotRefs[activeSlot].current
    if (!video) return
    // 起播前必须对齐到播放头所指的那一刻。
    // 判据只能是「元素位置 vs 播放头位置」——按「是否落在片段区间内」判断是错的：
    // 播放头拖到 20 秒时元素仍停在 0 秒，而 0 秒同样在 [0,30] 区间内，
    // 于是判定「无需 seek」，一按播放就从第一帧重新开始。
    if (located) {
      const current = video.currentTime || 0
      if (Math.abs(current - located.sourceTimeSec) > CLIP_END_EPSILON_SEC) {
        seekSlot(video, located.sourceTimeSec, true)
      }
    }
    playWhenPositioned(video)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlot, located, seekSlot, playWhenPositioned])

  const pauseAll = useCallback(() => {
    slotRefs.forEach((ref) => ref.current?.pause())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const togglePlay = useCallback(() => {
    if (!state.clips.length) return
    if (playing) {
      setPlaying(false)
      pauseAll()
      return
    }
    // 已经放到结尾时再点播放：从头开始
    if (playheadSec >= totalSec) setPlayheadSec(0)
    setPlaying(true)
    playActive()
  }, [playing, playheadSec, totalSec, state.clips.length, pauseAll, playActive, setPlayheadSec])

  /** 当前段播到尾：切到备用槽位继续，最后一段则停在结尾。 */
  const handleTimeUpdate = useCallback(() => {
    if (!located) return
    const video = slotRefs[activeSlot].current
    if (!video) return

    const current = video.currentTime || 0
    // 元素跑到了片段起点之前——它正在播放「已经被裁掉」的那一段：声音会漏出来，
    // 而进度看似停住只是因为被 clamp 成了 0。这里必须把它拉回区间内，
    // 而不是把 0 当成真实进度上报（那正是「裁掉的音频还在响」的成因）。
    if (current < located.clip.inSec - CLIP_END_EPSILON_SEC) {
      // 先停下再纠正：不停的话这几百毫秒里裁掉的声音和画面（字幕烧在画面上）仍在往外放
      const wasPlaying = !video.paused
      video.pause()
      seekSlot(video, located.sourceTimeSec, true)
      if (wasPlaying) video.setAttribute('data-resume', '1')
      return
    }

    const played = current - located.clip.inSec
    const duration = getClipDuration(located.clip)

    if (played >= duration - CLIP_END_EPSILON_SEC) {
      const nextOffset = offsets[located.index + 1]
      if (nextOffset === undefined) {
        pauseAll()
        setPlaying(false)
        setPlayheadSec(totalSec)
        return
      }
      video.pause()
      setActiveSlot((slot) => 1 - slot)
      setPlayheadSec(nextOffset)
      return
    }
    // 暂停态下的 timeupdate 只是一次 seek 的回声，不是播放进度。
    // 照样回写会和用户拖动播放头打架：拖动 → seek → 回声写回旧位置 → 白线弹回原处。
    if (!playing) return
    setPlayheadSec(roundedPlayhead((offsets[located.index] || 0) + played))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, activeSlot, offsets, totalSec, playing, pauseAll, setPlayheadSec, seekSlot])

  /*
   * 切换槽位后如果处于播放态，立刻让新的活动槽位接着放。
   *
   * 只在 activeSlot / playing 真正跳变时触发，playActive 走 ref。
   * 直接把 playActive 放进依赖数组会变成「每次渲染都调一次 play()」：
   * playActive 依赖 located，而 located = useMemo(..., [state, playheadSec])，
   * 播放中每个 timeupdate 都会更新 playheadSec → 新的 located → 新的 playActive。
   * 实测一次播放调了约 45 次 play()（≈4 次/秒）。对正在播的元素调 play() 本身是空操作，
   * 但每次都挂一个 .catch(() => setPlaying(false))——4 次/秒里只要有一次瞬时拒绝，
   * 播放就会莫名停住，而且极难复现。
   */
  const playActiveRef = useRef(playActive)
  playActiveRef.current = playActive
  useEffect(() => {
    if (playing) playActiveRef.current()
  }, [activeSlot, playing])

  const seekTo = useCallback(
    (seconds: number) => {
      const next = Math.min(Math.max(0, seconds), totalSec)
      setPlayheadSec(next)
    },
    [totalSec, setPlayheadSec],
  )

  /**
   * 拖动轨道逐帧定位。
   *
   * 轨道之前只有「点某一段跳到该段起点」，拖动完全没有反应——想看某一帧只能靠播过去。
   * 这里按指针在轨道上的横向位置直接换算成成片时刻，拖动过程中持续 seek，画面实时跟着走。
   */
  const trackRef = useRef<HTMLDivElement>(null)
  const scrubbingRef = useRef(false)
  const resumeAfterScrubRef = useRef(false)

  /**
   * 刻度密度要按轨道真实像素宽度算，不能按片段数拍脑袋——
   * 同样一条 40 秒的时间线，放在画布节点里和放在编辑器弹窗里可用宽度差好几倍。
   */
  const [trackWidth, setTrackWidth] = useState(0)
  useEffect(() => {
    const element = trackRef.current
    if (!element) return
    setTrackWidth(element.getBoundingClientRect().width || 0)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      setTrackWidth(entries[0]?.contentRect?.width || 0)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const ticks = useMemo(() => buildTimelineTicks(totalSec, trackWidth), [totalSec, trackWidth])
  const progressPercent = totalSec > 0 ? Math.min(100, Math.max(0, (playheadSec / totalSec) * 100)) : 0

  /**
   * 每条素材的缩略帧，铺在片段块上当胶片条。
   *
   * 抽帧要 seek + 解码，只在片段进入轨道后异步补上；没取到就保持纯色底，
   * 不让轨道因为某条坏素材一直空着。
   */
  const [filmstrips, setFilmstrips] = useState<Record<number, string[]>>({})
  useEffect(() => {
    let cancelled = false
    const assetIds = [...new Set(state.clips.map((clip) => clip.assetId).filter((assetId) => assetId > 0))]
    for (const assetId of assetIds) {
      const url = assetStreamUrl(assetId, workspaceId)
      if (!url) continue
      const cached = getCachedFilmstrip(url)
      if (cached) {
        setFilmstrips((current) => (current[assetId] ? current : { ...current, [assetId]: cached }))
        continue
      }
      void buildFilmstrip(url).then((frames) => {
        if (cancelled || !frames.length) return
        setFilmstrips((current) => ({ ...current, [assetId]: frames }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [state.clips, workspaceId])

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0 || !(totalSec > 0)) return
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      setPlayheadSec(roundedPlayhead(ratio * totalSec))
    },
    [totalSec, setPlayheadSec],
  )

  const handleScrubStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      scrubbingRef.current = true
      // 拖动期间先暂停：一边播一边 seek 会互相打架，画面反而跟不上手
      resumeAfterScrubRef.current = playing
      if (playing) {
        pauseAll()
        setPlaying(false)
      }
      seekFromClientX(event.clientX)
    },
    [playing, pauseAll, seekFromClientX],
  )

  const handleScrubMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbingRef.current) return
      seekFromClientX(event.clientX)
    },
    [seekFromClientX],
  )

  const handleScrubEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    // 拖动前在播就接着播，拖动前是暂停就停在松手的位置
    if (resumeAfterScrubRef.current) setPlaying(true)
    resumeAfterScrubRef.current = false
  }, [])

  if (!state.clips.length) {
    return (
      <div className={`${styles.player} ${styles.empty}${className ? ` ${className}` : ''}`}>
        {onAddClip ? (
          <button type="button" className={`${styles.emptyAdd} nodrag nopan`} onClick={onAddClip} aria-label="添加视频">
            ＋
          </button>
        ) : null}
        <span>把画布上的视频拖进来，或点 ＋ 选取</span>
      </div>
    )
  }

  return (
    <div className={`${styles.player}${compact ? ` ${styles.compact}` : ''}${className ? ` ${className}` : ''}`}>
      <div className={styles.stage}>
        {[0, 1].map((slot) => (
          <video
            key={slot}
            ref={slotRefs[slot]}
            className={`${styles.video}${slot === activeSlot ? ` ${styles.videoActive}` : ''}`}
            playsInline
            preload="auto"
            controls={false}
            aria-hidden={slot !== activeSlot}
            aria-label={slot === activeSlot ? '时间线预览' : undefined}
            onTimeUpdate={slot === activeSlot ? handleTimeUpdate : undefined}
            // 只报活动槽位的故障：备用槽位在后台预载，它的失败不该打断当前观看
            onError={() => {
              const video = slotRefs[slot].current
              if (!video || slot !== activeSlot) return
              setMediaError(describeMediaError(video))
            }}
            // 定位成功、画面已解出来 → 清掉上一次的故障提示
            onSeeked={() => {
              const video = slotRefs[slot].current
              if (!video) return
              if (slot === activeSlot) setMediaError('')
              // 落位后撤掉目标；仍有偏差则这里会再写一次，由下一次 seeked 收敛
              applyPendingSeek(video)
              // 起播被推迟到这一刻：位置已经对上，可以放了。仍没对上时会再记一次账，
              // 下一次 seeked 再来——绝不在落到 inSec 之前就开始出声出画。
              if (video.getAttribute('data-resume') === '1' && slot === activeSlot && playing) {
                playWhenPositioned(video)
              }
            }}
            onLoadedData={() => {
              if (slot === activeSlot) setMediaError('')
            }}
            onLoadedMetadata={() => {
              // 元数据就绪后必须强制 seek 一次：src 刚设置时 readyState 为 0，之前那次
              // currentTime 写入被忽略；而只加载元数据的 video 一帧都没解码，画面是纯黑。
              // 备用槽位同样要逼出首帧，否则切过去的瞬间会黑一下。
              //
              // 定位目标按「这个槽位实际持有哪一段」决定，不能按 activeSlot / located.index+1 推断：
              // 元数据可能在播放头已经越过这一段之后才回来，那时按下标去取会取空，
              // 这一段就永远停在 0 秒，切过去便是从头播。
              const video = slotRefs[slot].current
              if (!video) return
              const boundId = video.getAttribute('data-clip')
              const bound = state.clips.find((clip) => clip.id === boundId)
              if (!bound) return
              const target = located?.clip.id === boundId ? located.sourceTimeSec : bound.inSec
              seekSlot(video, target, true)
              // 某些浏览器在 loadedmetadata 回调结束时尚未绘制首帧，
              // 再补一次异步定位，解决第一段拖动/播放不稳定。
              requestAnimationFrame(() => seekSlot(video, target, true))
            }}
            // 元数据已就绪但那次写入仍被忽略时，canplay 是最后一次补定位的机会
            onCanPlay={() => {
              const video = slotRefs[slot].current
              if (!video) return
              applyPendingSeek(video)
              // 换源或起播被推迟：定位补完后接着播。仍未落位则继续等 seeked，
              // 不能在这里无条件 play()——那等于又从被裁掉的片段头部放起
              if (video.getAttribute('data-resume') === '1' && slot === activeSlot && playing) {
                playWhenPositioned(video)
              }
            }}
          />
        ))}
        {/* 故障说明盖在画面上：黑屏本身不传达任何信息，必须说出到底怎么了 */}
        {mediaError ? (
          <div className={styles.mediaError} role="alert">
            {mediaError}
          </div>
        ) : null}
      </div>

      {/* 控制区与画面同处一块深色面板，中间不留缝——分成两块不同底色的区域会显得是拼上去的 */}
      <div className={`${styles.bar} nodrag nopan`}>
        <div className={styles.transport}>
          <button type="button" className={styles.play} onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <span className={styles.time}>
            <b>{formatTimelineTime(playheadSec)}</b> / {formatTimelineTime(totalSec)}
          </span>
        </div>

        {/* 刻度尺与片段轨道共用一条时间轴，播放头贯穿两者；宽度也从这里量 */}
        <div
          className={styles.timeline}
          ref={trackRef}
          aria-label="时间线轨道"
          {...(hideTimeline ? { hidden: true } : {})}
        >
          <div className={styles.ruler} aria-hidden="true">
            {ticks.map((tick) => (
              <i
                key={tick.sec}
                className={tick.major ? styles.tickMajor : styles.tick}
                style={{ left: `${(tick.sec / totalSec) * 100}%` }}
              />
            ))}
            {!compact &&
              ticks
                .filter((tick) => tick.major && tick.sec > 0)
                .map((tick) => (
                  <span
                    key={`label-${tick.sec}`}
                    className={styles.rulerLabel}
                    style={{ left: `${(tick.sec / totalSec) * 100}%` }}
                  >
                    {formatTimelineTime(tick.sec)}
                  </span>
                ))}
          </div>

          <div className={styles.track}>
            {state.clips.map((clip, index) => {
              const frames = filmstrips[clip.assetId] || []
              return (
                <div
                  key={clip.id}
                  className={`${styles.clip}${located?.index === index ? ` ${styles.clipActive}` : ''}`}
                  style={{ flexGrow: Math.max(getClipDuration(clip), 0.1) }}
                >
                  {/* 胶片条：均匀取样的几帧铺满片段块，扫一眼就知道这段拍的是什么 */}
                  {frames.length > 0 && (
                    <span className={styles.clipFilm} aria-hidden="true">
                      {frames.map((frame, frameIndex) => (
                        <img key={frameIndex} src={frame} alt="" draggable={false} />
                      ))}
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.clipSeek}
                    onClick={() => seekTo(offsets[index] || 0)}
                    aria-label={`跳到片段 ${index + 1}`}
                    title={`片段 ${index + 1} · ${getClipDuration(clip).toFixed(1)}s`}
                  >
                    <span className={styles.clipIndex}>{index + 1}</span>
                    <span className={styles.clipTime}>{getClipDuration(clip).toFixed(1)}s</span>
                  </button>
                  {onRemoveClip && (
                    <button
                      type="button"
                      className={styles.clipRemove}
                      aria-label={`移除片段 ${index + 1}`}
                      onClick={() => onRemoveClip(clip.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
            {/* 「+」贴在轨道末尾，是添加片段最直觉的位置 */}
            {onAddClip && (
              <button type="button" className={styles.trackAdd} onClick={onAddClip} aria-label="添加视频">
                ＋
              </button>
            )}
          </div>

          {/* 已播区间：一层淡覆盖，真正指示位置的是播放头 */}
          <span className={styles.progress} style={{ width: `${progressPercent}%` }} aria-hidden="true" />
          {/* 播放头贯穿刻度尺与片段轨道，两段素材在视觉上就是一条时间轴 */}
          <span className={styles.playhead} style={{ left: `${progressPercent}%` }} aria-hidden="true" />
          {/*
            拖动层盖在整条时间轴上：鼠标/触摸交互统一走「按位置定位」，比「跳到段首」精确得多。
            下面片段块里的按钮保留下来作为键盘与读屏的跳转通道。
          */}
          <div
            className={styles.scrub}
            onPointerDown={handleScrubStart}
            onPointerMove={handleScrubMove}
            onPointerUp={handleScrubEnd}
            onPointerCancel={handleScrubEnd}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  )
}
