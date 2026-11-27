import { useEffect, useRef, useState } from 'react'
import { Modal } from 'antd'
import {
  isSupportedVideoReferenceImageAspectRatio,
  isSupportedVideoReferenceImageDimensions,
  readLocalImageDimensions,
  videoReferenceImageAspectRatioError,
  videoReferenceImageIssue,
  VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO,
  VIDEO_REFERENCE_IMAGE_MAX_DIMENSION,
  VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO,
  VIDEO_REFERENCE_IMAGE_MIN_DIMENSION,
  type ImageDimensions,
} from '@/utils/imageFile'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import styles from './CanvasSeedanceAspectRatioDialog.module.css'

export interface CanvasSeedanceAspectRatioImage {
  assetId: number
  title: string
  width: number
  height: number
  url: string
  nodeId?: string
  videoInput?: boolean
}

interface CanvasSeedanceAspectRatioDialogProps {
  images: CanvasSeedanceAspectRatioImage[]
  onClose: () => void
  onPad: (image: CanvasSeedanceAspectRatioImage) => void
  onLocateAndCrop: (image: CanvasSeedanceAspectRatioImage) => void
  onReplace: (
    image: CanvasSeedanceAspectRatioImage,
    file: File,
    size: ImageDimensions,
    signal: AbortSignal,
  ) => Promise<void>
}

function formatAspectRatio({ width, height }: CanvasSeedanceAspectRatioImage): string {
  const ratio = width / height
  const displayed = Number(ratio.toFixed(3))
  if (ratio < VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO && displayed >= VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO) {
    return `低于 ${VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO}`
  }
  if (ratio > VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO && displayed <= VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO) {
    return `高于 ${VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO}`
  }
  return String(displayed)
}

export default function CanvasSeedanceAspectRatioDialog({
  images,
  onClose,
  onPad,
  onLocateAndCrop,
  onReplace,
}: CanvasSeedanceAspectRatioDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const chosenImage = useRef<CanvasSeedanceAspectRatioImage | null>(null)
  const upload = useRef<AbortController | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => upload.current?.abort(), [])

  const displayPixelLimits = images.some(({ videoInput }) => videoInput)
  const invalidPixels = images.some((image) => image.videoInput && !isSupportedVideoReferenceImageDimensions(image))

  async function replaceImage(image: CanvasSeedanceAspectRatioImage, file: File) {
    if (upload.current) return
    const controller = new AbortController()
    upload.current = controller
    setUploading(true)
    setError('')
    try {
      const size = await readLocalImageDimensions(file)
      controller.signal.throwIfAborted()
      const issue = image.videoInput
        ? videoReferenceImageIssue(size)
        : isSupportedVideoReferenceImageAspectRatio(size)
          ? ''
          : videoReferenceImageAspectRatioError(size)
      if (issue) throw new Error(issue)
      await onReplace(image, file, size, controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '替换图片失败，请重试')
    } finally {
      upload.current = null
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  return (
    <Modal
      open
      centered
      width="min(520px, calc(100vw - 32px))"
      zIndex={2300}
      className={styles.modal}
      title={invalidPixels ? '参考图尺寸不符合要求' : '图片宽高比不符合送审要求'}
      onCancel={onClose}
      footer={null}
      modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
    >
      <div className={styles.limit}>
        {displayPixelLimits && (
          <div>
            宽和高各{' '}
            <strong>
              {VIDEO_REFERENCE_IMAGE_MIN_DIMENSION}–{VIDEO_REFERENCE_IMAGE_MAX_DIMENSION} 像素
            </strong>
          </div>
        )}
        <div>
          宽高比（宽 ÷ 高）{' '}
          <strong>
            {VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO}–{VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO}
          </strong>
        </div>
      </div>
      <p className={styles.help}>可用其他软件裁剪或调整尺寸，再上传处理后的图片。也可以在画布里补边或裁剪。</p>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="image/*"
        aria-label="上传已处理图片"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file && chosenImage.current) void replaceImage(chosenImage.current, file)
        }}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {uploading && (
        <p className={styles.help} role="status">
          正在替换图片…
        </p>
      )}
      <ul className={styles.items} aria-label="待处理的参考图">
        {images.map((image) => {
          const action = image.nodeId ? '定位并裁剪' : '裁剪'
          return (
            <li className={styles.item} key={`${image.assetId}:${image.nodeId ?? ''}`}>
              <img className={styles.thumbnail} src={image.url} alt="" />
              <div className={styles.details}>
                <strong className={styles.name}>{image.title}</strong>
                <span
                  className={
                    image.videoInput && !isSupportedVideoReferenceImageDimensions(image) ? styles.ratio : undefined
                  }
                >
                  {image.width} × {image.height} px
                </span>
                <span className={isSupportedVideoReferenceImageAspectRatio(image) ? undefined : styles.ratio}>
                  宽高比 {formatAspectRatio(image)}
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  className={`${styles.action} ${styles.primary}`}
                  type="button"
                  disabled={uploading}
                  aria-label={images.length > 1 ? `上传已处理图片「${image.title}」` : undefined}
                  onClick={() => {
                    chosenImage.current = image
                    inputRef.current?.click()
                  }}
                >
                  上传已处理图片
                </button>
                <button
                  className={styles.action}
                  type="button"
                  disabled={uploading}
                  aria-label={images.length > 1 ? `补边保留全图「${image.title}」` : undefined}
                  onClick={() => onPad(image)}
                >
                  补边保留全图
                </button>
                <button
                  className={styles.action}
                  type="button"
                  disabled={uploading}
                  aria-label={images.length > 1 ? `${action}「${image.title}」` : undefined}
                  onClick={() => onLocateAndCrop(image)}
                >
                  {action}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
