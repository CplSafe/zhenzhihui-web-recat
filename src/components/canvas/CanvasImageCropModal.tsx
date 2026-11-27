import { useEffect, useId, useRef, useState } from 'react'
import { Modal, Button, Select, Alert } from 'antd'
import RatioLabel from '@/components/common/RatioLabel'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import type { CanvasSourceRef } from './CanvasNodePanel'
import {
  readLocalImageDimensions,
  videoReferenceImageIssue,
  VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO,
  VIDEO_REFERENCE_IMAGE_MAX_DIMENSION,
  VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO,
  VIDEO_REFERENCE_IMAGE_MIN_DIMENSION,
} from '@/utils/imageFile'
import styles from './CanvasImageCropModal.module.css'

export interface InvalidCanvasImage {
  ref: CanvasSourceRef
  url: string
  width: number
  height: number
  issue: string
}

type ImageUpdateMethod = 'upload' | 'crop'

export default function CanvasImageCropModal({
  images,
  onSave,
  onClose,
}: {
  images: InvalidCanvasImage[]
  onSave: (
    image: InvalidCanvasImage,
    file: File,
    width: number,
    height: number,
    options: { method: ImageUpdateMethod; signal: AbortSignal },
  ) => Promise<void>
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [cropOpen, setCropOpen] = useState(false)
  const [ratio, setRatio] = useState('1:1')
  const [x, setX] = useState(50)
  const [y, setY] = useState(50)
  const [method, setMethod] = useState<ImageUpdateMethod | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const operation = useRef<AbortController | null>(null)
  const cropId = useId()

  useEffect(() => () => operation.current?.abort(), [])

  const current = images[Math.min(index, images.length - 1)]
  if (!current) return null

  const [rw, rh] = ratio.split(':').map(Number)
  const cropWidth = Math.min(current.width, (current.height * rw) / rh)
  const cropHeight = (cropWidth * rh) / rw
  const left = ((current.width - cropWidth) * x) / 100
  const top = ((current.height - cropHeight) * y) / 100
  const busy = method !== null

  function close() {
    operation.current?.abort()
    onClose()
  }

  async function replaceImage(
    updateMethod: ImageUpdateMethod,
    prepare: (signal: AbortSignal) => Promise<{ file: File; width: number; height: number }>,
  ) {
    if (operation.current) return
    const controller = new AbortController()
    const { signal } = controller
    operation.current = controller
    setMethod(updateMethod)
    setError('')
    try {
      const result = await prepare(signal)
      signal.throwIfAborted()
      const issue = videoReferenceImageIssue(result)
      if (issue) throw new Error(issue)
      await onSave(current, result.file, result.width, result.height, { method: updateMethod, signal })
      if (!signal.aborted) setCropOpen(false)
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : '参考图更换失败，请重试')
    } finally {
      operation.current = null
      if (!signal.aborted) setMethod(null)
    }
  }

  function upload(file: File) {
    void replaceImage('upload', async () => {
      const dimensions = await readLocalImageDimensions(file).catch(() => {
        throw new Error('无法读取这张图片，请选择可打开的图片文件')
      })
      return { file, ...dimensions }
    })
  }

  function saveCrop() {
    void replaceImage('crop', async (signal) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          finish()
          image.removeAttribute('src')
          reject(signal.reason)
        }
        function finish() {
          signal.removeEventListener('abort', abort)
          image.onload = null
          image.onerror = null
        }
        image.onload = () => {
          finish()
          resolve()
        }
        image.onerror = () => {
          finish()
          reject(new Error('图片读取失败，请重试'))
        }
        signal.addEventListener('abort', abort, { once: true })
        image.src = current.url
      })
      signal.throwIfAborted()
      const scale = Math.max(
        VIDEO_REFERENCE_IMAGE_MIN_DIMENSION / Math.min(cropWidth, cropHeight),
        Math.min(1, VIDEO_REFERENCE_IMAGE_MAX_DIMENSION / Math.max(cropWidth, cropHeight)),
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(cropWidth * scale)
      canvas.height = Math.round(cropHeight * scale)
      const issue = videoReferenceImageIssue(canvas)
      if (issue) throw new Error(issue)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器无法裁切图片')
      context.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('裁切失败'))), 'image/png'),
      )
      return {
        file: new File([blob], 'cropped-reference.png', { type: 'image/png' }),
        width: canvas.width,
        height: canvas.height,
      }
    })
  }

  return (
    <Modal
      zIndex={2200}
      modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
      open
      title="参考图尺寸不符合要求"
      onCancel={close}
      maskClosable={false}
      footer={
        <>
          <Button onClick={close}>关闭，稍后生成</Button>
          {cropOpen && (
            <Button type="primary" loading={method === 'crop'} disabled={busy} onClick={saveCrop}>
              保存当前裁切
            </Button>
          )}
        </>
      }
      width={cropOpen ? 820 : 600}
    >
      <div className={styles.requirements}>
        <strong>
          宽和高各 {VIDEO_REFERENCE_IMAGE_MIN_DIMENSION}–{VIDEO_REFERENCE_IMAGE_MAX_DIMENSION} 像素
        </strong>
        <strong>
          宽高比（宽 ÷ 高）{VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO}–{VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO}
        </strong>
      </div>
      <ul className={styles.list} aria-label="尺寸不合规的参考图">
        {images.map((item, i) => (
          <li key={item.ref.edgeId}>
            <button
              type="button"
              disabled={busy}
              aria-pressed={item === current}
              onClick={() => {
                if (item === current) return
                setIndex(i)
                setCropOpen(false)
                setRatio('1:1')
                setX(50)
                setY(50)
                setError('')
              }}
            >
              <img src={item.url} alt="" />
              <span className={styles.details}>
                <span className={styles.summary}>
                  <strong>{item.ref.title || `参考图 ${i + 1}`}</strong>
                  <span className={styles.size}>
                    {item.width} × {item.height} 像素
                  </span>
                </span>
                <span className={styles.issue}>{item.issue}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.instructions}>
        在外部裁剪或调整尺寸后，上传图片以替换当前参考图。替换完毕后请重新点击生成。
      </p>
      <div className={styles.actions}>
        <Button
          type={cropOpen ? 'default' : 'primary'}
          loading={method === 'upload'}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          上传已处理图片
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          aria-label="上传已处理图片"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) upload(file)
          }}
        />
        <Button
          disabled={busy}
          aria-expanded={cropOpen}
          aria-controls={cropOpen ? cropId : undefined}
          onClick={() => {
            setCropOpen(!cropOpen)
            setError('')
          }}
        >
          {cropOpen ? '收起内置裁剪' : '使用内置裁剪'}
        </Button>
      </div>
      {error && <Alert className={styles.error} type="error" showIcon message={error} />}
      {cropOpen && (
        <div id={cropId} className={styles.crop}>
          <div className={styles.preview}>
            <div className={styles.image}>
              <img src={current.url} alt="原图与裁切区域" />
              <div
                className={styles.selection}
                style={{
                  left: `${(left / current.width) * 100}%`,
                  top: `${(top / current.height) * 100}%`,
                  width: `${(cropWidth / current.width) * 100}%`,
                  height: `${(cropHeight / current.height) * 100}%`,
                }}
              />
            </div>
          </div>
          <label className={styles.ratio}>
            裁切比例
            <Select
              aria-label="裁切比例"
              disabled={busy}
              value={ratio}
              onChange={setRatio}
              options={['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'].map((value) => ({
                value,
                label: <RatioLabel ratio={value} />,
              }))}
            />
          </label>
          <label className={styles.position}>
            水平位置
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={busy}
              aria-label="裁切水平位置"
              value={x}
              onChange={(event) => setX(event.currentTarget.valueAsNumber)}
            />
          </label>
          <label className={styles.position}>
            垂直位置
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={busy}
              aria-label="裁切垂直位置"
              value={y}
              onChange={(event) => setY(event.currentTarget.valueAsNumber)}
            />
          </label>
        </div>
      )}
    </Modal>
  )
}
