/**
 * VideoLoading — 「生成视频」等待态:
 *  - 背景:深紫渐变 + 星空(缓慢漂移 + 偶尔流星,看得出在动),按框真实宽高实时绘制;
 *  - 光球 SiriOrb 随框自适应(横屏矮框自动缩小,给文字留位,横竖屏都不裁);
 *  - 文字 + 进度:框层渲染,字号 clamp 自适应;进度锚定「生成开始时间戳」startedAt(切页面/刷新组件重挂也按真实
 *    流逝时间续算,不从头来),从 1% 平滑逼近 99%;框太挤时只留「光球 + 视频生成中 + 进度」,说明/小技巧自动收起。
 */
import { useEffect, useRef, useState } from 'react'
import { observeElementResize } from '@/utils/observeElementResize'
import SiriOrb from './SiriOrb'

/** 按容器真实尺寸绘制缓慢漂移、闪烁并偶发流星的星空背景。 */
function StarField({ w, h }: { w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const raf = useRef<number>(0)

  useEffect(() => {
    const c = ref.current
    if (!c || w <= 0 || h <= 0) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = w * dpr
    c.height = h * dpr
    ctx.scale(dpr, dpr)
    const count = Math.max(50, Math.min(220, Math.round((w * h) / 6000)))
    const stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.7 + 0.4,
      phase: Math.random() * Math.PI * 2,
      tw: Math.random() * 0.7 + 0.3, // 闪烁速度
      vx: (Math.random() - 0.5) * 0.22, // 缓慢漂移
      vy: (Math.random() - 0.5) * 0.22,
      base: Math.random() * 0.45 + 0.4, // 基础亮度(分层)
    }))
    // 流星:不常出现,从上方斜划而过
    let shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null
    let cooldown = 120 // 帧数冷却

    let t = 0
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      t += 0.012
      for (const s of stars) {
        // 漂移 + 环绕
        s.x += s.vx
        s.y += s.vy
        if (s.x < -2) s.x = w + 2
        else if (s.x > w + 2) s.x = -2
        if (s.y < -2) s.y = h + 2
        else if (s.y > h + 2) s.y = -2
        const a = (0.22 + Math.abs(Math.sin(t * s.tw + s.phase)) * 0.55) * s.base
        // 大星点带柔光晕,层次更强
        if (s.r > 1.3) {
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3)
          g.addColorStop(0, `rgba(210,200,255,${a * 0.5})`)
          g.addColorStop(1, 'rgba(210,200,255,0)')
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(225,218,255,${a})`
        ctx.fill()
      }
      // 流星
      cooldown -= 1
      if (!shoot && cooldown <= 0 && Math.random() < 0.02) {
        const sx = Math.random() * w * 0.8
        shoot = { x: sx, y: -10, vx: 3 + Math.random() * 2, vy: 4 + Math.random() * 2, life: 60 }
        cooldown = 180 + Math.floor(Math.random() * 180)
      }
      if (shoot) {
        const tailX = shoot.x - shoot.vx * 6
        const tailY = shoot.y - shoot.vy * 6
        const grad = ctx.createLinearGradient(tailX, tailY, shoot.x, shoot.y)
        grad.addColorStop(0, 'rgba(180,200,255,0)')
        grad.addColorStop(1, `rgba(220,225,255,${Math.min(1, shoot.life / 40)})`)
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(tailX, tailY)
        ctx.lineTo(shoot.x, shoot.y)
        ctx.stroke()
        shoot.x += shoot.vx
        shoot.y += shoot.vy
        shoot.life -= 1
        if (shoot.life <= 0 || shoot.x > w + 20 || shoot.y > h + 20) shoot = null
      }
      raf.current = requestAnimationFrame(draw)
    }
    raf.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf.current)
  }, [w, h])

  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
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
            background: 'rgba(160,120,255,0.7)',
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
}

/** 根据真实已流逝时间计算单调逼近 99% 的估算进度，不伪造完成终态。 */
function calcProgress(startedAt?: number): number {
  const T = 70 // 时间常数(秒):越大爬升越慢
  const base = startedAt && startedAt > 0 ? startedAt : Date.now()
  const elapsedSec = Math.max(0, (Date.now() - base) / 1000)
  return Math.max(1, Math.min(99, Math.round(99 * (1 - Math.exp(-elapsedSec / T)))))
}

/** 自适应渲染生成等待视觉，并在页面重挂载后继续显示同一任务的时间进度。 */
export default function VideoLoading({ note, tip, startedAt, title = '视频生成中' }: VideoLoadingProps) {
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
  useEffect(() => {
    setPct(calcProgress(startedAt))
    const tick = () => {
      setPct((p) => Math.max(p, calcProgress(startedAt)))
    }
    tick()
    const id = window.setInterval(tick, 400)
    return () => window.clearInterval(id)
  }, [startedAt])

  const unit = Math.min(size.w || 400, size.h || 400)
  const statusSize = clamp(13, unit * 0.045, 20)
  const noteSize = clamp(12, unit * 0.038, 16)
  const barW = clamp(160, unit * 0.7, 320)
  // 光球随框自适应:不超过框宽,且给下方文字(圆点+视频生成中+进度+说明+小技巧)留 ~230px,横竖屏都不裁。
  const orbSize = clamp(100, Math.min((size.w || 240) * 0.78, (size.h || 240) - 230), 240)
  // 框够放下说明/小技巧(单行不换行)就显示;只有非常挤时才收起,保证不溢出。
  const showExtras = (size.h || 0) - orbSize > 140 && (size.w || 0) > 380

  return (
    <div
      ref={frameRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: 'radial-gradient(ellipse 80% 60% at 50% 42%, #241353 0%, #0e0828 56%, #070213 100%)',
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
      <StarField w={size.w} h={size.h} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <SiriOrb size={orbSize} />
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
            color: 'rgba(215,200,255,0.9)',
            letterSpacing: '0.18em',
            fontSize: statusSize,
            fontWeight: 400,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', system-ui, sans-serif",
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </p>

        {/* 进度:百分比 + 细进度条 */}
        <div style={{ width: barW, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: noteSize,
              color: 'rgba(200,200,255,0.75)',
            }}
          >
            <span>生成进度</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(160,210,255,0.95)' }}>{pct}%</span>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                borderRadius: 999,
                background: 'linear-gradient(90deg, #00d8ff, #6633ff, #ff2088)',
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>

        {showExtras && note && (
          <p
            style={{
              margin: '2px 0 0',
              color: 'rgba(190,185,225,0.4)',
              fontSize: noteSize - 1,
              lineHeight: 1.6,
              whiteSpace: 'nowrap',
            }}
          >
            {note}
          </p>
        )}
        {showExtras && tip && (
          <p
            style={{
              margin: '2px 0 0',
              color: 'rgba(170,195,240,0.45)',
              fontSize: noteSize - 1,
              lineHeight: 1.6,
              whiteSpace: 'nowrap',
            }}
          >
            💡 {tip}
          </p>
        )}
      </div>
    </div>
  )
}
