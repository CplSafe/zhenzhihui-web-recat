import { useState } from 'react'
import { Modal, Button, Select, Slider, Alert } from 'antd'
import RatioLabel from '@/components/common/RatioLabel'
import type { CanvasSourceRef } from './CanvasNodePanel'
import { videoReferenceImageIssue } from '@/utils/imageFile'
import styles from './CanvasImageCropModal.module.css'

export interface InvalidCanvasImage {
  ref: CanvasSourceRef
  url: string
  width: number
  height: number
  issue: string
}

export default function CanvasImageCropModal({
  images,
  onSave,
  onClose,
}: {
  images: InvalidCanvasImage[]
  onSave: (image: InvalidCanvasImage, file: File, width: number, height: number) => Promise<void>
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [ratio, setRatio] = useState('1:1')
  const [x, setX] = useState(50)
  const [y, setY] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = images[Math.min(index, images.length - 1)]
  const [rw, rh] = ratio.split(':').map(Number)
  const cropWidth = Math.min(current.width, (current.height * rw) / rh)
  const cropHeight = (cropWidth * rh) / rw
  const left = ((current.width - cropWidth) * x) / 100
  const top = ((current.height - cropHeight) * y) / 100

  async function save() {
    setBusy(true)
    setError('')
    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('图片读取失败，请重试'))
        image.src = current.url
      })
      const scale = Math.max(256 / Math.min(cropWidth, cropHeight), Math.min(1, 5760 / Math.max(cropWidth, cropHeight)))
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
      await onSave(
        current,
        new File([blob], 'cropped-reference.png', { type: 'image/png' }),
        canvas.width,
        canvas.height,
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="参考图尺寸不符合要求"
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            关闭，稍后生成
          </Button>
          <Button type="primary" loading={busy} onClick={save}>
            保存当前裁切
          </Button>
        </>
      }
      width={820}
    >
      <p>请选择不通过的图片并裁切。宽高需为 256–5760px，比例需在 0.4–2.5 之间。全部保存后请重新点击生成。</p>
      <div className={styles.list}>
        {images.map((item, i) => (
          <button
            type="button"
            disabled={busy}
            aria-pressed={item === current}
            key={item.ref.edgeId}
            onClick={() => {
              setIndex(i)
              setX(50)
              setY(50)
              setError('')
            }}
          >
            <img src={item.url} alt={`待裁切图片 ${i + 1}`} />
            <span>
              {item.width} × {item.height}
            </span>
          </button>
        ))}
      </div>
      <Alert type="warning" message={current.issue} />
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
      <label>
        裁切比例{' '}
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
      <label>
        水平位置
        <Slider disabled={busy} aria-label="裁切水平位置" value={x} onChange={setX} />
      </label>
      <label>
        垂直位置
        <Slider disabled={busy} aria-label="裁切垂直位置" value={y} onChange={setY} />
      </label>
      {error ? <Alert type="error" message={error} /> : null}
    </Modal>
  )
}
