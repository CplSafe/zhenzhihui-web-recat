/**
 * GuideOverlay — 新手引导覆盖层(聚光挖洞式蒙层,按 Figma 引导页)。
 * - 挖洞:一个盖在高亮目标上的透明块 + box-shadow 撑满全屏 → 目标处透出,其余 80% 黑(方案 A)。
 * - 气泡卡:白底圆角,标题 + 正文 + 底部「跳过(n/N) / 上一步 / 下一步·完成」;带指向目标的箭头。
 * - 目标用 data-guide 选择器定位;找不到则居中只显示文案。随窗口 resize/scroll 重算。
 * 全局挂载一次(App.tsx),由 stores/guide 驱动。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GUIDES, markGuideSeen, useGuideStore } from '@/stores/guide'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'
import './GuideOverlay.css'

const GAP = 14 // 目标与气泡卡的间距
const ARROW = 14 // 箭头方块边长
const PAD_DEFAULT = 8 // 挖洞外扩
const ANNO_GAP = 10 // 标注点线与元素之间的空隙

interface Pos {
  cardLeft: number
  cardTop: number
  arrowLeft: number
  arrowTop: number
}

export default function GuideOverlay() {
  const activeKey = useGuideStore((s) => s.activeKey)
  const stepIndex = useGuideStore((s) => s.stepIndex)
  const stageKey = useGuideStore((s) => s.stageKey)
  const waiting = useGuideStore((s) => s.waiting)
  const next = useGuideStore((s) => s.next)
  const prev = useGuideStore((s) => s.prev)
  const close = useGuideStore((s) => s.close)

  const def = activeKey ? GUIDES[activeKey] : null
  // 分阶段(智能成片)取当前阶段的 steps;扁平(首页)取 def.steps
  const steps = def ? (def.stages ? def.stages.find((s) => s.key === stageKey)?.steps || [] : def.steps || []) : []
  const step = !waiting ? steps[stepIndex] || null : null
  const total = steps.length
  const pad = step?.pad ?? PAD_DEFAULT

  const cardRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  // 气泡卡定位锚点(cardTarget);不设则用 target 的 rect
  const [cardRect, setCardRect] = useState<DOMRect | null>(null)
  // 打亮的透明洞(可多个:如 @ + SKILLS);空数组=整屏均匀压暗
  const [holes, setHoles] = useState<{ left: number; top: number; width: number; height: number }[]>([])
  const [pos, setPos] = useState<Pos | null>(null)
  // 标注:每条是从元素上/下沿引虚线到文字标签(dir=down 标签在下,up 标签在上)
  const [annos, setAnnos] = useState<{ x: number; y: number; label: string; dir: 'up' | 'down' }[]>([])

  // 结束(跳过/完成):标记该引导已看,再关闭
  const finish = () => {
    if (activeKey) markGuideSeen(activeKey, useWorkspaceSessionStore.getState().authSession?.user?.id)
    close()
  }
  const onNext = () => {
    const isLast = stepIndex + 1 >= total
    if (!isLast) {
      next()
      return
    }
    // 阶段末步:分阶段(智能成片)→ next() 转「等待下一阶段」;扁平(首页)→ 结束并标记已看
    if (def?.stages) next()
    else finish()
  }

  // 计算高亮目标的位置(随步骤/窗口变化重算)
  useEffect(() => {
    if (!step) return
    let raf = 0
    const measure = () => {
      const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null
      const r = el ? el.getBoundingClientRect() : null
      setRect(r)
      // 卡片锚点(可选,单独定位气泡卡)
      const cel = step.cardTarget ? (document.querySelector(step.cardTarget) as HTMLElement | null) : null
      setCardRect(cel ? cel.getBoundingClientRect() : null)
      // 计算打亮的洞:spots(多个,如 @/SKILLS)优先;否则 noSpot=无洞;否则主目标(含 spanTo)
      let hs: { left: number; top: number; width: number; height: number }[] = []
      if (step.spots?.length) {
        hs = step.spots
          .map((sel) => {
            const e = document.querySelector(sel) as HTMLElement | null
            if (!e) return null
            const b = e.getBoundingClientRect()
            return { left: b.left, top: b.top, width: b.width, height: b.height }
          })
          .filter(Boolean) as { left: number; top: number; width: number; height: number }[]
      } else if (!step.noSpot && r) {
        const endEl = step.spanTo ? (document.querySelector(step.spanTo) as HTMLElement | null) : null
        const er = endEl ? endEl.getBoundingClientRect() : null
        if (er && er.bottom > r.top) {
          const left = Math.min(r.left, er.left)
          const right = Math.max(r.right, er.right)
          hs = [{ left, top: r.top, width: right - left, height: er.bottom - r.top }]
        } else {
          hs = [{ left: r.left, top: r.top, width: r.width, height: r.height }]
        }
      }
      setHoles(hs)
      if (!r) return
      // 标注目标:down 取下沿(向下引线),up 取上沿(向上引线)
      const anns = (step.annotations || [])
        .map((a) => {
          const ael = document.querySelector(a.target) as HTMLElement | null
          if (!ael) return null
          const ar = ael.getBoundingClientRect()
          const dir = a.dir || 'down'
          return { x: ar.left + ar.width / 2, y: dir === 'down' ? ar.bottom : ar.top, label: a.label, dir }
        })
        .filter(Boolean) as { x: number; y: number; label: string; dir: 'up' | 'down' }[]
      setAnnos(anns)
    }
    measure()
    const onScrollResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', onScrollResize)
    window.addEventListener('scroll', onScrollResize, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onScrollResize)
      window.removeEventListener('scroll', onScrollResize, true)
    }
  }, [step, activeKey, stepIndex, stageKey])

  // 目标滚出视口时,滚动到可见(引导需能看到高亮元素)
  useEffect(() => {
    if (!step?.target) return
    const el = document.querySelector(step.target) as HTMLElement | null
    const r = el?.getBoundingClientRect()
    if (el && r && (r.top < 0 || r.bottom > window.innerHeight)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [step, stepIndex, stageKey])

  // 根据目标 rect + 卡片实测尺寸,算气泡卡与箭头位置(clamp 在视口内)
  useLayoutEffect(() => {
    if (!activeKey) {
      setPos(null)
      return
    }
    const card = cardRef.current
    if (!card) return
    const cw = card.offsetWidth
    const ch = card.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const M = 12 // 视口边距

    // 气泡卡锚点:优先 cardTarget,退回 target
    const anchor = cardRect ?? rect
    // 无目标 → 居中
    if (!anchor) {
      setPos({
        cardLeft: Math.round((vw - cw) / 2),
        cardTop: Math.round((vh - ch) / 2),
        arrowLeft: -999,
        arrowTop: -999,
      })
      return
    }

    const placement = step?.placement || 'bottom'
    const cx = anchor.left + anchor.width / 2
    const cy = anchor.top + anchor.height / 2
    let cardLeft = 0
    let cardTop = 0
    let arrowLeft = 0
    let arrowTop = 0

    if (placement === 'bottom' || placement === 'top') {
      cardLeft = cx - cw / 2
      cardTop = placement === 'bottom' ? anchor.bottom + pad + GAP : anchor.top - pad - GAP - ch
      cardLeft = Math.min(Math.max(cardLeft, M), vw - cw - M)
      const ax = Math.min(Math.max(cx, cardLeft + 18), cardLeft + cw - 18)
      arrowLeft = ax - ARROW / 2
      arrowTop = placement === 'bottom' ? cardTop - ARROW / 2 : cardTop + ch - ARROW / 2
    } else {
      cardTop = cy - ch / 2
      cardLeft = placement === 'right' ? anchor.right + pad + GAP : anchor.left - pad - GAP - cw
      cardTop = Math.min(Math.max(cardTop, M), vh - ch - M)
      const ay = Math.min(Math.max(cy, cardTop + 18), cardTop + ch - 18)
      arrowTop = ay - ARROW / 2
      arrowLeft = placement === 'right' ? cardLeft - ARROW / 2 : cardLeft + cw - ARROW / 2
    }
    // 气泡卡垂直微调(连同箭头一起偏移)
    const offY = step?.cardOffsetY ?? 0
    setPos({
      cardLeft: Math.round(cardLeft),
      cardTop: Math.round(cardTop + offY),
      arrowLeft: Math.round(arrowLeft),
      arrowTop: Math.round(arrowTop + offY),
    })
  }, [rect, cardRect, activeKey, stepIndex, step, pad])

  if (!activeKey || !step) return null

  const hasArrow = !!(cardRect ?? rect)
  const cardVisible = pos !== null
  // 标注标签基线(基于 target 下/上沿):down 在下方,up 在上方
  // up 基线离目标更远(-76),保证错层后较低那条(如「进入下一步」)的连线也有足够长度、两点不挤
  const annoBaseY = rect ? Math.round(rect.bottom + 34) : 0
  const annoTopY = rect ? Math.round(rect.top - 76) : 0

  return createPortal(
    <div className="guide-layer" role="dialog" aria-modal="true" aria-label="新手引导">
      {/* 压暗蒙层:SVG 遮罩,holes 里的每个矩形被挖成透明洞(打亮),其余压暗。支持多个洞(@ + SKILLS) */}
      <svg className="guide-dim-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id="guide-hole-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {holes.map((h, i) => (
              <rect
                key={i}
                x={Math.round(h.left - pad)}
                y={Math.round(h.top - pad)}
                width={Math.round(h.width + pad * 2)}
                height={Math.round(h.height + pad * 2)}
                rx="10"
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#guide-hole-mask)" />
      </svg>

      {/* down 标注(如 @ / SKILLS):竖直点线 + 错层,避免相邻标签重叠 */}
      {annos
        .filter((a) => a.dir === 'down')
        .map((a, i) => (
          <div key={`d${i}`} className="guide-anno" style={{ left: a.x, top: a.y + ANNO_GAP }}>
            <span className="guide-anno__dot" />
            <span className="guide-anno__line" style={{ height: Math.max(0, annoBaseY + i * 30 - (a.y + ANNO_GAP)) }} />
            <span className="guide-anno__dot" />
            <span className="guide-anno__label">{a.label}</span>
          </div>
        ))}

      {/* up 标注(底部按钮):肘形折线(下→横→下)+ 标签在上方水平带横向铺开,避免挨近的按钮标签重叠 */}
      {(() => {
        const ups = annos.filter((a) => a.dir === 'up')
        if (!ups.length) return null
        const labelH = 22
        const estW = (s: string) => s.length * 15 + 12
        const sorted = [...ups].sort((a, b) => a.x - b.x)
        let lastRight = -Infinity
        const items = sorted.map((a) => {
          const w = estW(a.label)
          let lx = a.x
          if (lx - w / 2 < lastRight + 16) lx = lastRight + 16 + w / 2 // 与左邻标签不重叠
          lastRight = lx + w / 2
          return { ...a, labelX: Math.round(lx) }
        })
        return (
          <>
            <svg className="guide-anno-svg" xmlns="http://www.w3.org/2000/svg">
              {items.map((a, i) => {
                const sy = annoTopY + labelH // 线起点(标签下方)
                const ey = a.y - ANNO_GAP // 线终点(按钮上方留空隙)
                const midY = Math.max(sy + 8, ey - 26) // 折线的横段高度
                const pts =
                  Math.abs(a.labelX - a.x) < 2
                    ? `${a.labelX},${sy} ${a.x},${ey}` // 对齐则直线
                    : `${a.labelX},${sy} ${a.labelX},${midY} ${a.x},${midY} ${a.x},${ey}` // 否则肘形
                return (
                  <g key={i}>
                    <polyline
                      points={pts}
                      fill="none"
                      stroke="#32c7a6"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray="1 6"
                    />
                    <circle cx={a.labelX} cy={sy} r="3.5" fill="#32c7a6" />
                    <circle cx={a.x} cy={ey} r="3.5" fill="#32c7a6" />
                  </g>
                )
              })}
            </svg>
            {items.map((a, i) => (
              <div key={i} className="guide-anno-label" style={{ left: a.labelX, top: annoTopY }}>
                {a.label}
              </div>
            ))}
          </>
        )
      })()}

      {hasArrow && cardVisible && <div className="guide-arrow" style={{ left: pos!.arrowLeft, top: pos!.arrowTop }} />}

      <div
        ref={cardRef}
        className="guide-card"
        style={{
          left: pos?.cardLeft ?? -9999,
          top: pos?.cardTop ?? -9999,
          visibility: cardVisible ? 'visible' : 'hidden',
        }}
      >
        <div className="guide-card__head">
          {step.icon && <img className="guide-card__icon" src={step.icon} alt="" />}
          <div className="guide-card__title">{step.title}</div>
        </div>
        {step.body.map((line, i) => (
          <p key={i} className="guide-card__body">
            {line}
          </p>
        ))}
        {step.cta ? (
          // 单动作步骤(如入口「开始创作」):只显示一个按钮
          <div className="guide-card__foot guide-card__foot--cta">
            <button type="button" className="guide-next" onClick={onNext}>
              {step.cta}
            </button>
          </div>
        ) : (
          <div className="guide-card__foot">
            <button type="button" className="guide-skip" onClick={finish}>
              跳过({stepIndex + 1}/{total})
            </button>
            <div className="guide-card__nav">
              {stepIndex > 0 && (
                <button type="button" className="guide-prev" onClick={prev}>
                  上一步
                </button>
              )}
              <button type="button" className="guide-next" onClick={onNext}>
                {stepIndex + 1 >= total ? '完成' : '下一步'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
