import { useState } from 'react'
import { studioLightPosition, studioLightVector } from '@/utils/canvasStudioControls'
import styles from './CanvasImageTools.module.css'

/** 即时二维布光示意；不改动原始素材，也不代替模型生成的真实阴影。 */
export default function CanvasRelightPreview({
  src,
  title,
  values,
}: {
  src: string
  title: string
  values: Record<string, unknown>
}) {
  const [original, setOriginal] = useState(false)
  const [ratio, setRatio] = useState(1)
  const fallback = studioLightPosition(values.key_light)
  const finite = (value: unknown, defaultValue: number) =>
    Number.isFinite(Number(value)) ? Number(value) : defaultValue
  const [x, y, z] = studioLightVector(
    finite(values.light_azimuth, fallback.light_azimuth),
    finite(values.light_elevation, fallback.light_elevation),
  )
  const power = Math.max(0, Math.min(100, finite(values.brightness, 50))) / 100
  const color = /^#[0-9a-f]{6}$/i.test(String(values.color)) ? String(values.color) : '#fff4df'
  const position = `${50 + x * 60}% ${50 - y * 60}%`
  const back = Math.max(0, -z)
  return (
    <figure className={styles.sourcePreview}>
      <div className={styles.relightStage}>
        <div
          className={styles.relightPhoto}
          style={{ aspectRatio: ratio, width: `min(100%, clamp(${180 * ratio}px, ${26 * ratio}vh, ${260 * ratio}px))` }}
        >
          <img
            src={src}
            onLoad={(event) => {
              const image = event.currentTarget
              if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight)
            }}
            alt={`${original ? '原图' : '打光实时示意'}：${title}`}
            style={{ filter: original ? undefined : `brightness(${0.55 + power * 0.45 - back * 0.22})` }}
          />
          {!original && (
            <div aria-hidden="true" data-testid="relight-overlay" className={styles.relightOverlay}>
              <div
                style={{
                  background: `radial-gradient(ellipse at ${position}, ${color} 0%, transparent 75%)`,
                  opacity: power * (0.65 - back * 0.3),
                  mixBlendMode: 'screen',
                }}
              />
              <div
                style={{
                  background: `linear-gradient(${90 + (Math.atan2(y, x) * 180) / Math.PI}deg, rgba(0,0,0,${0.22 + back * 0.2}), transparent 75%)`,
                  mixBlendMode: 'multiply',
                }}
              />
              {(values.rim_light === true || back > 0) && (
                <div
                  style={{
                    background: `radial-gradient(ellipse at ${position}, transparent 48%, ${color} 100%)`,
                    opacity: power * (values.rim_light === true ? 0.45 : back * 0.35),
                    mixBlendMode: 'screen',
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <figcaption>
        <span>{original ? '原图' : '实时光影示意'}</span>
        <strong>{title}</strong>
        <button
          className={styles.relightCompare}
          type="button"
          aria-pressed={original}
          onClick={() => setOriginal(!original)}
        >
          {original ? '返回打光预览' : '对比原图'}
        </button>
      </figcaption>
      <p className={styles.relightNote}>灯位、亮度与颜色实时预览，不消耗积分；真实光影以生成结果为准。</p>
    </figure>
  )
}
