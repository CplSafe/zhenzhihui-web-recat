/**
 * 入口页背景(Canvas,对齐 UI 设计「背景颜色」的观感)。智能成片与爆款复制共用本实现,
 * 仅通过 `layers` 传入各自配色(智能成片青绿蓝紫;爆款复制粉紫)。
 *
 * 由三部分叠出:
 *   ① 底部:全宽「均匀」竖向渐变,铺满整宽、贴底、左右一致(下浓上淡);
 *   ② 中央光晕:中部一团带「光晕环」的扁椭圆;
 *   ③ 中央核:光晕中心更大更扁的一抹亮色。
 * 渐变本身柔和,无需 blur;仅在挂载/尺寸/配色变化时绘制一次,零每帧开销。
 * 切换 Tab 时按 `anim` 性格播放一次动画(Web Animations,纯 transform/opacity,GPU 合成):
 *   - 'glide'(智能成片):随所选 Tab 方向横向滑入 + 视差,精准克制;
 *   - 'bloom'(爆款复制):从被点击的 Tab 处放射绽放 + 轻微回弹,有张力。
 */
import { useEffect, useRef } from 'react'
import { observeElementResize } from '@/utils/observeElementResize'
import styles from './EntryCanvasBg.module.less'

// 内部渲染缩放(柔和渐变拉伸后无差别,越小越省)
const DOWNSCALE = 0.5

/** 三部分的渐变色标(offset, css color)。 */
export interface BgLayerStops {
  bottom: [number, string][] // ① 底部竖向线性渐变
  halo: [number, string][] // ② 中央光晕椭圆
  core: [number, string][] // ③ 中央核椭圆
}

/** 智能成片配色(默认):青绿底 + 蓝紫光晕 + 淡绿核。 */
export const SMART_LAYERS: BgLayerStops = {
  bottom: [
    [0, 'rgba(77,149,232,0)'],
    [0.38, 'rgba(77,149,232,0.12)'], // 蓝
    [0.72, 'rgba(96,224,196,0.16)'], // 过渡青绿
    [1, 'rgba(96,224,196,0.3)'], // 底部青绿
  ],
  halo: [
    [0, 'rgba(77,149,232,0.1)'], // 蓝核
    [0.45, 'rgba(90,92,224,0.12)'], // 蓝紫
    [0.78, 'rgba(59,56,218,0.11)'], // 紫环
    [1, 'rgba(59,56,218,0)'],
  ],
  core: [
    [0, 'rgba(58,227,97,0.14)'], // 淡绿
    [1, 'rgba(58,227,97,0)'],
  ],
}

/** 背景当前页签、动画性格与可替换配色配置。 */
interface EntryCanvasBgProps {
  /** 当前 Tab 序号(变化即触发一次切换动画;用于方向判断) */
  index: number
  /** Tab 总数(bloom 放射原点 = 第 index 个 Tab 的水平中心);默认 2 */
  count?: number
  /**
   * 切换动画性格:
   * - 'glide'(默认,智能成片):背景随所选 Tab 横向滑入 + 轻微视差,精准克制;
   * - 'bloom'(爆款复制):从被点击的 Tab 处放射绽放 + 轻微回弹,有张力。
   */
  anim?: 'glide' | 'bloom'
  /** 配色(缺省用智能成片配色) */
  layers?: BgLayerStops
}

/** 低分辨率静态绘制入口渐变，并在页签变化时仅用 GPU 合成属性播放过渡。 */
export default function EntryCanvasBg({ index, count = 2, anim = 'glide', layers = SMART_LAYERS }: EntryCanvasBgProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 1, h: 1 })
  const firstRef = useRef(true)
  const prevIndexRef = useRef(index)
  const layersRef = useRef(layers)
  layersRef.current = layers
  const redrawRef = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    // 画一团椭圆径向渐变(translate+scale 形成椭圆,渐变末段透明 → 边缘柔和,无需 blur)
    const ellipse = (cxf: number, cyf: number, rxf: number, ryf: number, stops: [number, string][]) => {
      const { w, h } = sizeRef.current
      const rx = rxf * w
      const ry = ryf * h
      ctx.save()
      ctx.translate(cxf * w, cyf * h)
      ctx.scale(1, ry / rx)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
      stops.forEach(([o, c]) => g.addColorStop(o, c))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, rx, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    const draw = () => {
      const { w, h } = sizeRef.current
      const L = layersRef.current
      ctx.clearRect(0, 0, w, h) // 透明底,露出页面 #f8f9fa

      // ① 底部:全宽「均匀」竖向渐变,左右一致、贴底
      const lg = ctx.createLinearGradient(0, h * 0.3, 0, h)
      L.bottom.forEach(([o, c]) => lg.addColorStop(o, c))
      ctx.fillStyle = lg
      ctx.fillRect(0, 0, w, h)

      // ② 中央光晕(扁椭圆)
      ellipse(0.5, 0.56, 0.56, 0.22, L.halo)

      // ③ 中央核(更大更扁,叠最上层)
      ellipse(0.5, 0.56, 0.4, 0.1, L.core)
    }
    redrawRef.current = draw

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      sizeRef.current = {
        w: Math.max(1, Math.round(rect.width * DOWNSCALE)),
        h: Math.max(1, Math.round(rect.height * DOWNSCALE)),
      }
      canvas.width = sizeRef.current.w
      canvas.height = sizeRef.current.h
      draw()
    }

    return observeElementResize(canvas, resize)
  }, [])

  // 配色变化时重绘(静态使用时仅挂载触发一次)
  useEffect(() => {
    redrawRef.current()
  }, [layers])

  // 切换 Tab:按 anim 性格播放一次切换动画(首次挂载不放)
  useEffect(() => {
    const prev = prevIndexRef.current
    prevIndexRef.current = index
    if (firstRef.current) {
      firstRef.current = false
      return
    }
    const canvas = canvasRef.current
    if (!canvas || typeof canvas.animate !== 'function') return

    let running: Animation
    if (anim === 'bloom') {
      // 爆款复制:从被点击的 Tab 水平位置放射「绽放」+ 轻微回弹
      const originX = ((index + 0.5) / Math.max(1, count)) * 100
      canvas.style.transformOrigin = `${originX}% 58%`
      running = canvas.animate(
        [
          { transform: 'scale(0.9)', opacity: 0.5, offset: 0 },
          { opacity: 1, offset: 0.45 },
          { transform: 'scale(1.03)', opacity: 1, offset: 0.62 }, // 过冲
          { transform: 'scale(1)', opacity: 1, offset: 1 }, // 回落
        ],
        { duration: 560, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)' },
      )
    } else {
      // 智能成片:随所选 Tab 方向横向滑入 + 轻微视差,精准克制
      const dir = Math.sign(index - prev) || 1
      canvas.style.transformOrigin = 'center bottom'
      running = canvas.animate(
        [
          { transform: `translateX(${dir * -4}%) translateY(1.6%)`, opacity: 0.78, offset: 0 },
          { opacity: 1, offset: 0.5 },
          { transform: 'translateX(0) translateY(0)', opacity: 1, offset: 1 },
        ],
        { duration: 720, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    }
    return () => running.cancel()
  }, [index, anim, count])

  return <canvas ref={canvasRef} className={styles.bgCanvas} aria-hidden="true" />
}
