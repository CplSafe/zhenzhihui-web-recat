import { useId, useRef, useState } from 'react'
import { wrapStudioAngle } from '@/utils/canvasStudioControls'
import styles from './CanvasImageTools.module.css'

const presets = [
  { label: '倾斜视角', horizontal_angle: 45, vertical_angle: 20, zoom: 5 },
  { label: '正面俯拍', horizontal_angle: 0, vertical_angle: 30, zoom: 5 },
  { label: '正面仰拍', horizontal_angle: 0, vertical_angle: -20, zoom: 5 },
  { label: '全景俯拍', horizontal_angle: 0, vertical_angle: 45, zoom: 2 },
  { label: '背面视角', horizontal_angle: 180, vertical_angle: 0, zoom: 5 },
]

export default function CanvasAngleEditor({
  url,
  values,
  onChange,
  disabled = false,
  compact = false,
}: {
  url: string
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  disabled?: boolean
  compact?: boolean
}) {
  const clip = `angle-${useId().replace(/:/g, '')}`
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const yaw = Number(values.horizontal_angle ?? 0)
  const pitch = Number(values.vertical_angle ?? 0)
  const zoom = Number(values.zoom ?? 5)
  const a = (yaw * Math.PI) / 180
  const e = (pitch * Math.PI) / 180
  const distance = 91 - zoom * 2
  const marker = {
    x: 130 + Math.sin(a) * Math.cos(e) * distance,
    y: 130 - Math.sin(e) * distance + Math.cos(a) * Math.cos(e) * distance * 0.25,
  }
  const active = presets.find((p) => p.horizontal_angle === yaw && p.vertical_angle === pitch && p.zoom === zoom)
  const move = (horizontal: number, vertical: number) => {
    if (!disabled)
      onChange({
        ...values,
        horizontal_angle: wrapStudioAngle(horizontal),
        vertical_angle: Math.max(-30, Math.min(60, vertical)),
      })
  }
  return (
    <section className={styles.angleEditor} aria-label="多角度编辑器">
      <div className={`${styles.presets} ${compact ? styles.topPresets : ''}`} role="group" aria-label="镜头视角预设">
        <button type="button" aria-pressed={!active} disabled={disabled} onClick={() => move(0, 0)}>
          自定义
        </button>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={active === p}
            disabled={disabled}
            onClick={() =>
              onChange({
                ...values,
                horizontal_angle: p.horizontal_angle,
                vertical_angle: p.vertical_angle,
                zoom: p.zoom,
              })
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      <div
        className={styles.angleGlobe}
        role="application"
        aria-label="相机角度示意，拖动调整视角"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, y: event.clientY, yaw, pitch }
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          move(
            drag.current.yaw + (event.clientX - drag.current.x) * 0.8,
            drag.current.pitch - (event.clientY - drag.current.y) * 0.5,
          )
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onKeyDown={(event) => {
          const offsets: Record<string, [number, number]> = {
            ArrowLeft: [-5, 0],
            ArrowRight: [5, 0],
            ArrowUp: [0, 5],
            ArrowDown: [0, -5],
          }
          if (offsets[event.key]) {
            event.preventDefault()
            move(yaw + offsets[event.key][0], pitch + offsets[event.key][1])
          }
        }}
      >
        <svg viewBox="0 0 260 260" aria-hidden="true">
          <defs>
            <clipPath id={clip}>
              <rect x="101" y="94" width="58" height="72" rx="7" />
            </clipPath>
          </defs>
          <g fill="none" stroke="currentColor" opacity="0.32">
            <circle cx="130" cy="130" r="92" />
            {[24, 48, 72].map((r) => (
              <ellipse key={r} cx="130" cy="130" rx={r} ry="92" />
            ))}
            {[35, 65].map((r) => (
              <ellipse key={r} cx="130" cy="130" rx="92" ry={r} />
            ))}
            <path d="M38 130H222M130 38V222" />
          </g>
          <image
            href={url}
            x="101"
            y="94"
            width="58"
            height="72"
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clip})`}
          />
          <line x1="130" y1="130" x2={marker.x} y2={marker.y} stroke="#119c80" strokeDasharray="4 3" />
          <g transform={`translate(${marker.x}, ${marker.y})`}>
            <circle r="14" fill="#119c80" stroke="white" strokeWidth="2" />
            <path d="M-7-4H3V4H-7ZM3-2L8-5V5L3 2" fill="none" stroke="white" strokeWidth="1.5" />
          </g>
          <g fill="currentColor" fontSize="10" textAnchor="middle">
            <text x="130" y="20">
              俯拍 ↑
            </text>
            <text x="130" y="249">
              仰拍 ↓
            </text>
            <text x="18" y="134">
              ‹
            </text>
            <text x="242" y="134">
              ›
            </text>
          </g>
        </svg>
        <output className={styles.angleReadout}>
          {Math.round(yaw)}° 环绕 · {Math.round(pitch)}° 俯仰 · {zoom < 3.5 ? '远景' : zoom > 6.5 ? '近景' : '中景'}
        </output>
      </div>
      {!compact && (
        <>
          <p className={styles.hint}>拖动球面或使用方向键调整机位；右侧参数同步变化，生成后得到新的视角图片。</p>
          <label className={styles.anglePromptToggle}>
            <input type="checkbox" checked={showPrompt} onChange={(event) => setShowPrompt(event.target.checked)} />
            显示机位提示词
          </label>
          {showPrompt && (
            <p className={styles.anglePrompt}>
              以同一主体为中心，水平环绕 {Math.round(yaw)}°，{pitch > 0 ? '俯拍' : pitch < 0 ? '仰拍' : '平视'}{' '}
              {Math.abs(Math.round(pitch))}°，{zoom < 3.5 ? '远景' : zoom > 6.5 ? '近景' : '中景'}
              构图。保持主体身份、服装与场景一致。
            </p>
          )}
          <button
            className={styles.relightCompare}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...values, horizontal_angle: 0, vertical_angle: 0, zoom: 5 })}
          >
            重置机位
          </button>
        </>
      )}
    </section>
  )
}
