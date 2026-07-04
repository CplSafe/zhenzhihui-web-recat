/**
 * 素材选择弹窗:为某个主体「准备素材」时,可从已上传素材里选,或上传新素材。
 * (素材市场/库的接入后续可加;当前列出本次已上传的素材 + 本地上传。)
 */
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './MaterialPickerDialog.module.less'

interface MaterialPickerDialogProps {
  open: boolean
  /** 已上传/可选的素材(objectURL) */
  materials: string[]
  onClose: () => void
  onPick: (url: string) => void
}

export default function MaterialPickerDialog({ open, materials, onClose, onPick }: MaterialPickerDialogProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  if (!open) return null

  const handleFile = (files: FileList | null) => {
    if (!files?.length) return
    onPick(URL.createObjectURL(files[0]))
    onClose()
  }

  return createPortal(
    <div
      className={styles.mpickMask}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.mpick} role="dialog" aria-label="选择素材">
        <div className={styles.mpickHead}>
          <span className={styles.mpickTitle}>选择素材</span>
          <button type="button" className={styles.mpickX} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.mpickBody}>
          <div className={styles.mpickSectionTitle}>从已上传素材中选择</div>
          {materials.length ? (
            <div className={styles.mpickGrid}>
              {materials.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  className={styles.mpickItem}
                  onClick={() => {
                    onPick(url)
                    onClose()
                  }}
                >
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.mpickEmpty}>暂无已上传素材</div>
          )}
        </div>

        <div className={styles.mpickFoot}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              handleFile(e.target.files)
              e.target.value = ''
            }}
          />
          <button type="button" className={`${styles.mpickBtn} ${styles.mpickBtnGhost}`} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.mpickBtn} ${styles.mpickBtnPrimary}`}
            onClick={() => fileRef.current?.click()}
          >
            上传新素材
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
