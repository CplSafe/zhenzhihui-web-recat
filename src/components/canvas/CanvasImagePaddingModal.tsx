import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Spin } from 'antd'
import { createPaddedCanvasImageFile, type CanvasPaddedImage } from '@/utils/canvasImagePadding'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import styles from './CanvasImagePaddingModal.module.css'

interface Props {
  sourceUrl: string
  title: string
  onClose: () => void
  onSave: (file: File, width: number, height: number, signal: AbortSignal) => Promise<void>
}

export default function CanvasImagePaddingModal({ sourceUrl, title, onClose, onSave }: Props) {
  const [preview, setPreview] = useState<(CanvasPaddedImage & { url: string }) | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const saveController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined

    async function loadPreview() {
      try {
        const response = await fetch(sourceUrl, { credentials: 'same-origin', signal: controller.signal })
        if (!response.ok) throw new Error('无法读取原图，请关闭窗口后重试')
        const padded = await createPaddedCanvasImageFile(await response.blob(), title, controller.signal)
        if (controller.signal.aborted) return
        url = URL.createObjectURL(padded.file)
        setPreview({ ...padded, url })
      } catch (reason) {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : '无法预览补边图')
      }
    }

    void loadPreview()
    return () => {
      controller.abort()
      saveController.current?.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [sourceUrl, title])

  async function save() {
    if (!preview || saveController.current) return
    const controller = new AbortController()
    saveController.current = controller
    setSaving(true)
    setSaveError('')
    try {
      await onSave(preview.file, preview.layout.width, preview.layout.height, controller.signal)
      if (!controller.signal.aborted) onClose()
    } catch (reason) {
      if (!controller.signal.aborted) setSaveError(reason instanceof Error ? reason.message : '保存补边图失败，请重试')
    } finally {
      saveController.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  return (
    <Modal
      open
      centered
      width={760}
      zIndex={2300}
      className={styles.modal}
      title="补边保留全图"
      modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
      keyboard={!saving}
      focusTriggerAfterClose={false}
      maskClosable={false}
      closable={!saving}
      onCancel={onClose}
      footer={
        <>
          <Button autoFocus disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" loading={saving} disabled={!preview} onClick={save}>
            另存并送审
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <p className={styles.description}>
          <strong>{title}</strong>
          <span>确认后另存为新素材并送审，原图保留。</span>
        </p>
        {!loadError && (
          <div className={styles.stage}>
            {preview ? (
              <img
                className={styles.preview}
                src={preview.url}
                alt="补边预览"
                width={preview.layout.width}
                height={preview.layout.height}
                draggable={false}
              />
            ) : (
              <Spin aria-label="正在生成补边预览" />
            )}
          </div>
        )}
        {preview && (
          <p className={styles.dimensions} role="status" aria-label="补边尺寸">
            <span>
              原图 {preview.originalSize.width} × {preview.originalSize.height} 像素
            </span>
            <strong>
              补边后 {preview.layout.width} × {preview.layout.height} 像素
            </strong>
            <span>
              {preview.layout.left || preview.layout.right
                ? `左 ${preview.layout.left} px，右 ${preview.layout.right} px`
                : `上 ${preview.layout.top} px，下 ${preview.layout.bottom} px`}
            </span>
          </p>
        )}
        {(loadError || saveError) && <Alert type="error" showIcon message={loadError || saveError} />}
      </div>
    </Modal>
  )
}
