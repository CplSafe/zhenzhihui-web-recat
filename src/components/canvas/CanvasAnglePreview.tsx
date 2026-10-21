import { useState } from 'react'
import { wrapStudioAngle } from '@/utils/canvasStudioControls'
import styles from './CanvasImageTools.module.css'

export default function CanvasAnglePreview({
  src,
  title,
  values,
}: {
  src: string
  title: string
  values: Record<string, unknown>
}) {
  const [original, setOriginal] = useState(false)
  const number = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
  const yaw = wrapStudioAngle(number(values.horizontal_angle, 0))
  const pitch = Math.max(-30, Math.min(60, number(values.vertical_angle, 0)))
  const zoom = Math.max(0, Math.min(10, number(values.zoom, 5)))
  const radians = (yaw * Math.PI) / 180
  // 单张图片以有限透视倾斜示意机位，不翻转正面伪造主体背面。
  const turn = Math.sin(radians) * -34
  const rear = yaw > 90 && yaw < 270
  const transform = original
    ? 'none'
    : `perspective(700px) rotateX(${pitch * 0.65}deg) rotateY(${turn}deg) scale(${0.82 + zoom * 0.036})`
  return (
    <figure className={styles.sourcePreview}>
      <div className={styles.anglePhotoStage}>
        <img src={src} alt={`${original ? '原图' : '多角度透视预览'}：${title}`} style={{ transform }} />
        {!original && (
          <span className={styles.anglePreviewBadge}>
            {Math.round(yaw)}° 环绕 · {Math.round(pitch)}° 俯仰 · {zoom < 3.5 ? '远景' : zoom > 6.5 ? '近景' : '中景'}
          </span>
        )}
      </div>
      <figcaption>
        <span>{original ? '原图' : '透视示意'}</span>
        <strong>{title}</strong>
        <button
          type="button"
          className={styles.relightCompare}
          aria-pressed={original}
          onClick={() => setOriginal(!original)}
        >
          {original ? '返回角度预览' : '对比原图'}
        </button>
      </figcaption>
      <p className={styles.relightNote}>
        {!original && rear
          ? '当前机位位于主体背后；单张图无法展示背面，仅保留正面参考。'
          : '实时预览图片透视与景别，不消耗积分；真实新视角以生成结果为准。'}
      </p>
    </figure>
  )
}
