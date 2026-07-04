/**
 * SiriOrb — 炫彩「Siri 光球」加载动效(纯 Canvas + requestAnimationFrame,零第三方依赖)。
 * 移植自 Figma Make 导出的「视频加载动效设计」(dist/assets/anim/src/app/components/SiriOrb.tsx),
 * 用于「生成视频」等待态。深色主题、边缘羽化透明,适合铺在深色播放器占位区上。
 */
import { useEffect, useRef } from 'react'

function sn(t: number, seed: number): number {
  return (
    Math.sin(t * 1.27 + seed) * 0.42 +
    Math.sin(t * 2.83 + seed * 1.6) * 0.28 +
    Math.sin(t * 5.17 + seed * 2.3) * 0.16 +
    Math.sin(t * 0.39 + seed * 0.8) * 0.14
  )
}

function hex(h: string, a: number): string {
  const r = parseInt(h.slice(1, 3), 16)
  const g = parseInt(h.slice(3, 5), 16)
  const b = parseInt(h.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

interface ArmDef {
  color: string
  angle: number
  speed: number
  dist: number
  rx: number
  ry: number
  opacity: number
  seed: number
}

export default function SiriOrb({ size = 320 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const R = size * 0.38

    const arms: ArmDef[] = [
      { color: '#00d8ff', angle: 0.3, speed: 0.38, dist: 0.18, rx: 0.78, ry: 0.55, opacity: 0.92, seed: 0.0 },
      { color: '#6633ff', angle: 2.4, speed: -0.29, dist: 0.22, rx: 0.76, ry: 0.58, opacity: 0.88, seed: 2.1 },
      { color: '#ff2088', angle: 1.2, speed: 0.44, dist: 0.2, rx: 0.7, ry: 0.5, opacity: 0.82, seed: 4.4 },
      { color: '#00ffcc', angle: 3.8, speed: -0.33, dist: 0.16, rx: 0.65, ry: 0.46, opacity: 0.78, seed: 1.3 },
      { color: '#4488ff', angle: 5.2, speed: 0.27, dist: 0.14, rx: 0.72, ry: 0.52, opacity: 0.85, seed: 3.7 },
      { color: '#cc44ff', angle: 0.9, speed: -0.41, dist: 0.19, rx: 0.64, ry: 0.48, opacity: 0.8, seed: 5.2 },
      { color: '#ffffff', angle: 0.0, speed: 0.15, dist: 0.08, rx: 0.4, ry: 0.4, opacity: 0.5, seed: 6.1 },
    ]

    // 离屏画布(与主画布同尺寸):画球体本体,最后整体羽化裁切再贴回主画布
    const off = document.createElement('canvas')
    off.width = size * dpr
    off.height = size * dpr
    const oc = off.getContext('2d')!
    oc.scale(dpr, dpr)

    let startTime = 0

    const frame = (ts: number) => {
      if (!startTime) startTime = ts
      const t = (ts - startTime) * 0.001
      const pulse = 1 + Math.sin(t * 1.1) * 0.035

      // ── 离屏:球体本体 ──
      oc.clearRect(0, 0, size, size)

      const base = oc.createRadialGradient(cx, cy, 0, cx, cy, R * 1.05)
      base.addColorStop(0, '#2a1870')
      base.addColorStop(0.45, '#1a1050')
      base.addColorStop(0.78, '#0e0838')
      base.addColorStop(1, 'rgba(4,2,16,0)')
      oc.fillStyle = base
      oc.fillRect(0, 0, size, size)

      // 环境光填充:大范围柔和紫蓝,填满球体内部,消除色臂之间的黑缝
      oc.globalCompositeOperation = 'screen'
      const amb = oc.createRadialGradient(cx, cy, 0, cx, cy, R * 1.0)
      amb.addColorStop(0, 'rgba(80,50,200,0.55)')
      amb.addColorStop(0.5, 'rgba(50,30,150,0.30)')
      amb.addColorStop(0.85, 'rgba(30,15,100,0.12)')
      amb.addColorStop(1, 'rgba(0,0,0,0)')
      oc.fillStyle = amb
      oc.beginPath()
      oc.arc(cx, cy, R * 1.0, 0, Math.PI * 2)
      oc.fill()

      // 彩色光臂
      for (const arm of arms) {
        const angle = arm.angle + t * arm.speed + sn(t * 0.3, arm.seed) * 0.6
        const wobble = 1 + sn(t * 0.7, arm.seed + 1) * 0.15
        const bx = cx + Math.cos(angle) * R * arm.dist * wobble
        const by = cy + Math.sin(angle) * R * arm.dist * wobble

        oc.save()
        oc.translate(bx, by)
        oc.rotate(angle + Math.PI / 2 + sn(t * 0.5, arm.seed + 2) * 0.4)
        oc.scale(arm.rx * R, arm.ry * R)

        const g = oc.createRadialGradient(0, 0, 0, 0, 0, 1)
        g.addColorStop(0, hex(arm.color, arm.opacity))
        g.addColorStop(0.5, hex(arm.color, arm.opacity * 0.65))
        g.addColorStop(0.82, hex(arm.color, arm.opacity * 0.28))
        g.addColorStop(1, hex(arm.color, 0))
        oc.fillStyle = g
        oc.beginPath()
        oc.arc(0, 0, 1, 0, Math.PI * 2)
        oc.fill()
        oc.restore()
      }

      // 中心高亮核(脉动)
      const coreR = R * (0.28 + Math.sin(t * 1.8) * 0.04)
      const coreG = oc.createRadialGradient(cx, cy, 0, cx, cy, coreR)
      coreG.addColorStop(0, 'rgba(255,255,255,0.95)')
      coreG.addColorStop(0.3, 'rgba(200,220,255,0.50)')
      coreG.addColorStop(0.7, 'rgba(100,140,255,0.18)')
      coreG.addColorStop(1, 'rgba(60,80,200,0)')
      oc.fillStyle = coreG
      oc.beginPath()
      oc.arc(cx, cy, coreR, 0, Math.PI * 2)
      oc.fill()

      // 明暗与高光
      oc.globalCompositeOperation = 'source-over'

      const shadowG = oc.createRadialGradient(cx + R * 0.3, cy + R * 0.35, 0, cx, cy, R * 1.05)
      shadowG.addColorStop(0, 'rgba(0,0,0,0)')
      shadowG.addColorStop(0.58, 'rgba(0,0,0,0)')
      shadowG.addColorStop(1, 'rgba(0,0,0,0.45)')
      oc.fillStyle = shadowG
      oc.fillRect(0, 0, size, size)

      const hl1 = oc.createRadialGradient(cx - R * 0.28, cy - R * 0.32, 0, cx - R * 0.14, cy - R * 0.17, R * 0.7)
      hl1.addColorStop(0, 'rgba(255,255,255,0.22)')
      hl1.addColorStop(0.4, 'rgba(255,255,255,0.05)')
      hl1.addColorStop(1, 'rgba(255,255,255,0)')
      oc.fillStyle = hl1
      oc.fillRect(0, 0, size, size)

      const hl2 = oc.createRadialGradient(cx - R * 0.32, cy - R * 0.36, 0, cx - R * 0.32, cy - R * 0.36, R * 0.16)
      hl2.addColorStop(0, 'rgba(255,255,255,0.70)')
      hl2.addColorStop(0.5, 'rgba(255,255,255,0.15)')
      hl2.addColorStop(1, 'rgba(255,255,255,0)')
      oc.fillStyle = hl2
      oc.fillRect(0, 0, size, size)

      // ── 羽化 alpha 遮罩:0→0.76R 实心,0.76R→边缘渐隐,无硬边 ──
      oc.globalCompositeOperation = 'destination-in'
      const mask = oc.createRadialGradient(cx, cy, 0, cx, cy, cx)
      mask.addColorStop(0, 'rgba(0,0,0,1)')
      mask.addColorStop((R / cx) * 0.76, 'rgba(0,0,0,1)')
      mask.addColorStop((R / cx) * 0.92, 'rgba(0,0,0,0.6)')
      mask.addColorStop((R / cx) * 1.04, 'rgba(0,0,0,0.15)')
      mask.addColorStop(1, 'rgba(0,0,0,0)')
      oc.fillStyle = mask
      oc.fillRect(0, 0, size, size)
      oc.globalCompositeOperation = 'source-over'

      // ── 主画布:外发光 + 贴球体 ──
      ctx.clearRect(0, 0, size, size)

      // 外发光收紧(更实):halo 半径与不透明度降下来,球体本身更突出
      const lg0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.7 * pulse)
      lg0.addColorStop(0, 'rgba(0,0,0,0)')
      lg0.addColorStop(0.45, 'rgba(110,55,230,0.06)')
      lg0.addColorStop(0.75, 'rgba(80,40,200,0.03)')
      lg0.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = lg0
      ctx.fillRect(0, 0, size, size)

      const lg1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25 * pulse)
      lg1.addColorStop(0, 'rgba(0,0,0,0)')
      lg1.addColorStop(0.55, 'rgba(130,65,250,0.1)')
      lg1.addColorStop(0.85, 'rgba(100,45,220,0.05)')
      lg1.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = lg1
      ctx.fillRect(0, 0, size, size)

      ctx.drawImage(off, 0, 0, size * dpr, size * dpr, 0, 0, size, size)

      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  }, [size])

  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}
