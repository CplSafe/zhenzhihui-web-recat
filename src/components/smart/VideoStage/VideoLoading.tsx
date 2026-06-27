/**
 * VideoLoading — 「生成视频」等待态:
 *  - 背景(深紫渐变 + 星空)铺满播放器比例框(.vstagePlayer,随 --frame-ratio 变形),星空按框真实宽高实时绘制;
 *  - 光球 SiriOrb 用「固定大小」,不随框缩放;
 *  - 文字(视频生成中 + 说明 + 小技巧)放在框层,字号按框尺寸 clamp 自适应 →
 *    横屏/竖屏都清晰、不会像整体缩放那样在横屏被缩成很小。
 */
import { useEffect, useRef, useState } from 'react'
import SiriOrb from './SiriOrb'

// 光球固定直径(不随框变化)
const ORB_SIZE = 200

// 星空:按传入的真实宽高绘制微闪烁星点;宽高变化即重铺(实时同步框尺寸)
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
    const count = Math.max(40, Math.min(180, Math.round((w * h) / 7000)))
    const stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.4 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.6 + 0.3,
    }))
    let t = 0
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      t += 0.008
      for (const s of stars) {
        const a = 0.15 + Math.abs(Math.sin(t * s.speed + s.phase)) * 0.45
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(200,190,255,${a})`
        ctx.fill()
      }
      raf.current = requestAnimationFrame(draw)
    }
    raf.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf.current)
  }, [w, h])

  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}

// 三个跳动圆点
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

const clamp = (min: number, v: number, max: number) => Math.max(min, Math.min(max, v))

interface VideoLoadingProps {
  statusText?: string
  note?: string
  tip?: string
}

export default function VideoLoading({ statusText, note, tip }: VideoLoadingProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  // 框的真实宽高:星空据此绘制 + 文字字号据此 clamp 自适应
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // clamp 自适应字号:以框的短边为基准,夹在可读区间;横屏(短边=高)和竖屏(短边=宽)都不会过小
  const unit = Math.min(size.w || 400, size.h || 400)
  const statusSize = clamp(13, unit * 0.045, 20)
  const noteSize = clamp(12, unit * 0.038, 16)

  return (
    <div
      ref={frameRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: 'radial-gradient(ellipse 80% 60% at 50% 40%, #1a0d4a 0%, #0c0620 55%, #060210 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: '16px 20px',
        boxSizing: 'border-box',
        textAlign: 'center',
      }}
    >
      {/* 星空:按框真实宽高实时同步 */}
      <StarField w={size.w} h={size.h} />

      {/* 光球:固定大小,不随框缩放 */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <SiriOrb size={ORB_SIZE} />
      </div>

      {/* 文字:框层渲染,字号 clamp 自适应(横竖屏都清晰) */}
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
        <p
          style={{
            margin: '4px 0 0',
            color: 'rgba(210,190,255,0.7)',
            letterSpacing: '0.18em',
            fontSize: statusSize,
            fontWeight: 400,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', system-ui, sans-serif",
            whiteSpace: 'nowrap',
          }}
        >
          {statusText || '视频生成中'}
        </p>
        {note && (
          <p style={{ margin: 0, color: 'rgba(200,190,255,0.5)', fontSize: noteSize, lineHeight: 1.6, whiteSpace: 'nowrap' }}>
            {note}
          </p>
        )}
        {tip && (
          <p
            style={{
              margin: '6px 0 0',
              color: 'rgba(180,205,255,0.7)',
              fontSize: noteSize,
              lineHeight: 1.6,
              whiteSpace: 'nowrap',
              background: 'rgba(120,90,220,0.14)',
              border: '1px solid rgba(150,120,240,0.28)',
              borderRadius: 10,
              padding: '8px 14px',
            }}
          >
            💡 {tip}
          </p>
        )}
      </div>
    </div>
  )
}
