import { useEffect, useRef, useState, type FormEvent } from 'react'
import styles from './CanvasRenameNodeDialog.module.css'

interface CanvasRenameNodeDialogProps {
  currentName: string
  defaultName: string
  onClose: () => void
  onConfirm: (name: string) => void
}

/** 节点重命名弹窗：留空表示恢复节点类型的默认名称。 */
export default function CanvasRenameNodeDialog({
  currentName,
  defaultName,
  onClose,
  onConfirm,
}: CanvasRenameNodeDialogProps) {
  const [name, setName] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onConfirm(name.trim().slice(0, 40))
  }

  return (
    <div className={styles.mask} role="presentation" onMouseDown={onClose}>
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-rename-node-title"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div>
            <h2 id="canvas-rename-node-title" className={styles.title}>
              重命名节点
            </h2>
            <p className={styles.hint}>设置一个便于识别的名称，留空将恢复为“{defaultName}”。</p>
          </div>
          <button type="button" className={styles.close} aria-label="关闭重命名弹窗" onClick={onClose}>
            ×
          </button>
        </div>

        <label className={styles.label} htmlFor="canvas-node-name-input">
          节点名称
        </label>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            id="canvas-node-name-input"
            className={styles.input}
            value={name}
            maxLength={40}
            placeholder={defaultName}
            onChange={(event) => setName(event.target.value)}
          />
          <span className={styles.counter}>{name.length}/40</span>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={styles.confirm}>
            确认修改
          </button>
        </div>
      </form>
    </div>
  )
}
