/**
 * VideoLoading — 「生成视频」等待态。
 *
 * 视觉：深色舞台（与主流视频生成产品一致），配色取产品的薄荷绿 + 靛蓝。
 * 中心是品牌标记 + 渐变呼吸光晕，取代原先的 Siri 光球——等待画面用自家标记
 * 比通用光球更有辨识度；背景是极慢的极光位移，不再有星点闪烁和流星，
 * 那两样在等待场景里最抢眼，而用户此刻要看的是进度和还要等多久。
 *
 * 文案分层：标题 > 进度 > 已等待 > 说明/小技巧。说明与小技巧压到最低对比度，
 * 并允许换行（此前 nowrap + overflow:hidden 会把长句直接截断在框沿）。
 *
 * 进度锚定「生成开始时间戳」startedAt：切页面/刷新组件重挂也按真实流逝时间续算，
 * 从 1% 平滑逼近 99%；框太挤时自动收起说明与小技巧，保证主信息不被挤压。
 */
import { useEffect, useRef, useState } from 'react'
import { observeElementResize } from '@/utils/observeElementResize'
import brandMark from '@/assets/logo/splash-mark.png'

/** 舞台主色：与产品一致的薄荷绿，用于进度条与强调数字。 */
const BRAND_MINT = '#1fcfa9'
/** 辅助色：靛蓝，与 antd 主色同源，做极光的第二层。 */
const BRAND_INDIGO = '#5767e5'

/**
 * 极慢位移的极光背景。
 *
 * 用两团高斯模糊的品牌色替代原来的星空 + 流星：等待场景里，闪烁星点和划过的流星
 * 是最抢眼的动态元素，会把视线从进度上拽走；极光的位移周期在 20 秒以上，
 * 只提供「界面还活着」的暗示。纯 CSS 实现，省掉一个常驻的 canvas 动画循环。
 *
 * 尊重 prefers-reduced-motion：该偏好下停止位移，只保留静态光晕。
 */
function AuroraBackdrop() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
      <span className="video-loading-aurora video-loading-aurora--mint" />
      <span className="video-loading-aurora video-loading-aurora--indigo" />
      <style>{`
        .video-loading-aurora {
          position: absolute;
          border-radius: 50%;
          filter: blur(64px);
          opacity: 0.5;
          will-change: transform;
        }
        .video-loading-aurora--mint {
          width: 62%;
          height: 78%;
          left: -8%;
          top: -14%;
          background: radial-gradient(circle, ${BRAND_MINT} 0%, rgba(31, 207, 169, 0) 70%);
          animation: video-loading-drift-a 26s ease-in-out infinite;
        }
        .video-loading-aurora--indigo {
          width: 68%;
          height: 74%;
          right: -12%;
          bottom: -18%;
          background: radial-gradient(circle, ${BRAND_INDIGO} 0%, rgba(87, 103, 229, 0) 70%);
          animation: video-loading-drift-b 32s ease-in-out infinite;
        }
        @keyframes video-loading-drift-a {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50%      { transform: translate3d(12%, 8%, 0) scale(1.12); }
        }
        @keyframes video-loading-drift-b {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1.06); }
          50%      { transform: translate3d(-10%, -6%, 0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .video-loading-aurora { animation: none; }
        }
      `}</style>
    </div>
  )
}

/**
 * 品牌标记 + 渐变光晕，替代原先的 Siri 光球。
 *
 * 光晕在标记背后缓慢呼吸（缩放 + 明暗），配合标记自身极小幅度的浮动，
 * 传达「在处理」而不喧宾夺主；标记本身带薄荷绿→蓝渐变，光晕沿用同一色系。
 * 尺寸由外部按可用空间计算传入，横竖屏都不裁。
 */
function BrandPulse({ size }: { size: number }) {
  const markSize = Math.round(size * 0.52)
  return (
    <div
      style={{ position: 'relative', width: size, height: size, display: 'grid', placeItems: 'center' }}
      aria-hidden="true"
    >
      <span className="video-loading-halo" />
      {/*
        标记用 mask 而不是 <img>：位图只能显示烘焙好的静态配色，
        遮罩方式让渐变成为可动的背景层，能沿标记缓慢流动，也不受源图分辨率限制。
      */}
      <span
        className="video-loading-mark"
        style={{
          width: markSize,
          height: markSize,
          WebkitMaskImage: `url(${brandMark})`,
          maskImage: `url(${brandMark})`,
        }}
      />
      <style>{`
        .video-loading-halo {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(
            circle,
            rgba(31, 207, 169, 0.5) 0%,
            rgba(53, 199, 216, 0.3) 38%,
            rgba(87, 103, 229, 0.14) 62%,
            rgba(87, 103, 229, 0) 78%
          );
          filter: blur(20px);
          animation: video-loading-breathe 3.6s ease-in-out infinite;
        }
        .video-loading-mark {
          position: relative;
          z-index: 1;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-position: center;
          mask-position: center;
          -webkit-mask-size: contain;
          mask-size: contain;
          background: linear-gradient(
            120deg,
            ${BRAND_MINT} 0%,
            #35c7d8 28%,
            ${BRAND_INDIGO} 52%,
            #35c7d8 74%,
            ${BRAND_MINT} 100%
          );
          background-size: 280% 280%;
          animation: video-loading-flow 7s linear infinite;
        }
        @keyframes video-loading-breathe {
          0%, 100% { transform: scale(0.9); opacity: 0.7; }
          50%      { transform: scale(1.08); opacity: 1; }
        }
        /* 渐变沿标记流动，比整体缩放更安静，也更像「正在处理」 */
        @keyframes video-loading-flow {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .video-loading-halo,
          .video-loading-mark { animation: none; }
        }
      `}</style>
    </div>
  )
}

/** 生成状态标题旁的三点循环动效。 */
function LoadingDots() {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '80%',
            background: 'rgba(31,207,169,0.75)',
            animation: `siri-dot 1.4s ease-in-out ${i * 0.22}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes siri-dot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40%            { transform: scale(1.2); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

/** 将自适应尺寸限制在可读且不会溢出的区间。 */
const clamp = (min: number, v: number, max: number) => Math.max(min, Math.min(max, v))

/** 视频等待态的业务文案、提示与持久化开始时间。 */
interface VideoLoadingProps {
  statusText?: string
  note?: string
  tip?: string
  /** 生成开始时间戳(ms,持久化):进度锚定到它,切页面/刷新组件重挂也接着走,不从头来。 */
  startedAt?: number
  /** 主标题文案覆盖(缺省「视频生成中」);仅整体标题,不暴露内部阶段(如人脸脱敏)。 */
  title?: string
  /** 任务提交成功前不展示基于时间推算的虚拟进度。 */
  showProgress?: boolean
  /** 是否允许使用基于耗时的估算百分比；关闭后仅展示不定进度，避免被误认为后端真实进度。 */
  allowEstimatedProgress?: boolean
  /** 后端或业务阶段给出的明确百分比。传入后优先于耗时估算。 */
  progress?: number
  /** 百分比左侧标签，用于区分准备进度、真实生成进度和预计生成进度。 */
  progressLabel?: string
  /** 耗时估算只在这个区间内增长；完成态必须由后端确认。 */
  estimatedProgressMin?: number
  estimatedProgressMax?: number
}

/** 根据真实已流逝时间计算单调逼近 99% 的估算进度，不伪造完成终态。 */
function calcProgress(startedAt?: number): number {
  const T = 70 // 时间常数(秒):越大爬升越慢
  const base = startedAt && startedAt > 0 ? startedAt : Date.now()
  const elapsedSec = Math.max(0, (Date.now() - base) / 1000)
  return Math.max(1, Math.min(99, Math.round(99 * (1 - Math.exp(-elapsedSec / T)))))
}

/** 已等待时长（秒）；没有起始时间戳时返回 null，不去猜。 */
function calcElapsedSec(startedAt?: number): number | null {
  if (!startedAt || startedAt <= 0) return null
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
}

/** 把秒数写成「x 分 y 秒」；不足一分钟只显示秒。 */
function formatElapsed(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

/**
 * 超过这个时长就说明后端仍在处理、可以先离开。
 *
 * 估算进度是按耗时逼近 99% 的曲线，等够几分钟必然停在 99%，此后再久也不会变。
 * 只显示百分比会让长时间等待看起来像卡死，所以补上真实已等待时长和一句说明。
 */
const LONG_WAIT_HINT_SEC = 5 * 60

/** 自适应渲染生成等待视觉，并在页面重挂载后继续显示同一任务的时间进度。 */
export default function VideoLoading({
  statusText,
  note,
  tip,
  startedAt,
  title = '视频生成中',
  showProgress = true,
  allowEstimatedProgress = true,
  progress,
  progressLabel,
  estimatedProgressMin = 1,
  estimatedProgressMax = 99,
}: VideoLoadingProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    return observeElementResize(el, measure)
  }, [])

  // 进度:锚定到持久化的「生成开始时间戳」startedAt —— 切页面/刷新组件重挂,也按真实流逝时间续算,不从头来。
  // 缺省(无 startedAt)退化为按挂载时刻计。最低 1%(从 1 开始,不停在 0),按时间常数 T 平滑逼近 99%,单调不回退。
  // 关键:初始值直接按 startedAt 计算,避免切回页面重挂时先闪到 0%,看起来像从头开始。
  const [pct, setPct] = useState(() => calcProgress(startedAt))
  // 已等待时长与估算进度同源于 startedAt，但它是真实数据：进度停在 99% 后仍然继续走。
  const [elapsedSec, setElapsedSec] = useState<number | null>(() => calcElapsedSec(startedAt))
  useEffect(() => {
    setPct(calcProgress(startedAt))
    const tick = () => {
      setPct((p) => Math.max(p, calcProgress(startedAt)))
      setElapsedSec(calcElapsedSec(startedAt))
    }
    tick()
    const id = window.setInterval(tick, 400)
    return () => window.clearInterval(id)
  }, [startedAt])

  const hasExplicitProgress = Number.isFinite(progress)
  const estimatedMin = clamp(0, estimatedProgressMin, 99)
  const estimatedMax = clamp(estimatedMin, estimatedProgressMax, 99)
  const estimatedPct = Math.round(estimatedMin + (pct / 99) * (estimatedMax - estimatedMin))
  const displayedPct = hasExplicitProgress ? clamp(0, Number(progress), 100) : estimatedPct
  const showPercentage = hasExplicitProgress || allowEstimatedProgress

  const unit = Math.min(size.w || 400, size.h || 400)
  const statusSize = clamp(13, unit * 0.045, 20)
  const noteSize = clamp(12, unit * 0.038, 16)
  const barW = clamp(160, unit * 0.7, 320)
  // 光球随框自适应：不超过框宽，并给下方文字（圆点 + 标题 + 进度 + 已等待 + 说明/小技巧）留位。
  // 预留 260px 而非 230px：说明与小技巧改为可换行后，最多会各占两行。
  const orbSize = clamp(100, Math.min((size.w || 240) * 0.78, (size.h || 240) - 260), 240)
  // 放得下换行后的说明/小技巧才显示；空间不够时整块收起，优先保住标题与进度。
  const showExtras = (size.h || 0) - orbSize > 170 && (size.w || 0) > 380

  return (
    <div
      ref={frameRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        // 深色中性底 + 极轻的青绿偏色：与产品同色系，又不会把画面染成紫色
        background: 'radial-gradient(ellipse 80% 60% at 50% 40%, #16232a 0%, #0d161b 58%, #080f13 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '16px 20px',
        boxSizing: 'border-box',
        textAlign: 'center',
      }}
    >
      <AuroraBackdrop />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <BrandPulse size={orbSize} />
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          maxWidth: '100%',
        }}
      >
        <LoadingDots />
        {/* 不展示"人脸脱敏"等内部阶段,统一显示整体标题(默认「视频生成中」) */}
        <p
          style={{
            margin: '4px 0 0',
            color: 'rgba(240,252,249,0.92)',
            letterSpacing: '0.18em',
            fontSize: statusSize,
            fontWeight: 400,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', system-ui, sans-serif",
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </p>

        {showProgress ? (
          /* 只有后端任务已创建时才展示时间推算进度。 */
          <div style={{ width: barW, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: noteSize,
                color: 'rgba(214,232,227,0.72)',
              }}
            >
              <span>
                {progressLabel ||
                  (hasExplicitProgress
                    ? '当前进度'
                    : allowEstimatedProgress
                      ? '预计生成进度'
                      : statusText || '生成任务处理中')}
              </span>
              {showPercentage ? (
                <span style={{ fontVariantNumeric: 'tabular-nums', color: BRAND_MINT, fontWeight: 600 }}>
                  {displayedPct}%
                </span>
              ) : null}
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
              <div
                style={{
                  width: showPercentage ? `${displayedPct}%` : '100%',
                  height: '100%',
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${BRAND_MINT}, #35c7d8, ${BRAND_INDIGO})`,
                  opacity: showPercentage ? 1 : 0.65,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            {elapsedSec !== null && (
              // 百分比是估算值、会长时间停在 99%；已等待时长是真实的，用它说明「还在跑」而不是「卡死」。
              // 逐行排布：进度条只有 160–320px，两段并排会互相挤到断行（「48 分 57 / 秒」）。
              <div
                role="status"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  fontSize: noteSize,
                  lineHeight: 1.5,
                  color: 'rgba(214,232,227,0.55)',
                }}
              >
                <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  已等待 {formatElapsed(elapsedSec)}
                </span>
                {elapsedSec >= LONG_WAIT_HINT_SEC && <span>服务端仍在处理，可离开本页</span>}
              </div>
            )}
          </div>
        ) : (
          <p role="status" style={{ margin: 0, color: 'rgba(214,232,227,0.72)', fontSize: noteSize, lineHeight: 1.6 }}>
            {statusText || '正在提交视频任务…'}
          </p>
        )}

        {/* 说明与小技巧是最低优先级信息：压到最低对比度，且必须允许换行——
            此前 nowrap 配合容器的 overflow:hidden，长句会被直接截断在框沿。 */}
        {showExtras && (note || tip) && (
          <div
            style={{
              marginTop: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              maxWidth: Math.min(size.w ? size.w - 48 : 420, 420),
              fontSize: Math.max(11, noteSize - 2),
              lineHeight: 1.7,
              color: 'rgba(226,240,236,0.34)',
            }}
          >
            {note && <p style={{ margin: 0 }}>{note}</p>}
            {tip && <p style={{ margin: 0 }}>{tip}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
