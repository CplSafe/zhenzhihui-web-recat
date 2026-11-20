import { useState } from 'react'
import { Modal } from 'antd'
import styles from './CanvasPromptStylePicker.module.css'

export interface CanvasPromptStyle {
  id: string
  label: string
  prompt: string
}

const presets: readonly CanvasPromptStyle[] = [
  { id: 'cinematic', label: '电影写实', prompt: '电影写实风格，使用自然光影、层次分明的构图和克制的色彩。' },
  { id: 'comic', label: '漫剧', prompt: '漫剧风格，轮廓清晰，表情和动作鲜明，画面具有连贯的镜头叙事。' },
  { id: 'ink', label: '水墨', prompt: '中国水墨风格，使用墨色浓淡、宣纸质感和有层次的留白。' },
  { id: 'animation', label: '三维动画', prompt: '三维动画风格，突出清晰的材质、柔和光照和连贯的空间关系。' },
]

function loadCustomStyles(key: string): CanvasPromptStyle[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(saved)
      ? saved.filter(
          (style): style is CanvasPromptStyle =>
            typeof style?.id === 'string' &&
            style.id.startsWith('custom:') &&
            typeof style.label === 'string' &&
            Boolean(style.label.trim()) &&
            typeof style.prompt === 'string' &&
            Boolean(style.prompt.trim()),
        )
      : []
  } catch {
    return []
  }
}

export default function CanvasPromptStylePicker({
  userId,
  selected,
  onChange,
  disabled,
  buttonClassName,
}: {
  userId: string | number
  selected: CanvasPromptStyle | null
  onChange: (style: CanvasPromptStyle | null) => void
  disabled?: boolean
  buttonClassName: string
}) {
  const key = `zzh:canvas:prompt-styles:${userId}`
  const [customStyles, setCustomStyles] = useState<CanvasPromptStyle[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')

  const close = () => {
    setOpen(false)
    setEditing(false)
    setName('')
    setPrompt('')
    setError('')
  }
  const choose = (style: CanvasPromptStyle | null) => {
    onChange(style)
    close()
  }
  const save = () => {
    const label = name.trim()
    const value = prompt.trim()
    if (!label || !value) return
    const latest = loadCustomStyles(key)
    if ([...latest, ...presets].some((style) => style.label === label) || ['暂不使用', '自定义风格'].includes(label)) {
      setError('已有同名风格，请换一个名称')
      return
    }
    const style = { id: `custom:${crypto.randomUUID()}`, label, prompt: value }
    try {
      localStorage.setItem(key, JSON.stringify([style, ...latest]))
      choose(style)
    } catch {
      setError('保存失败，请检查浏览器的本地存储设置')
    }
  }

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        aria-label="风格库"
        title={selected?.label || '风格库'}
        disabled={disabled}
        onClick={() => {
          setCustomStyles(loadCustomStyles(key))
          setOpen(true)
        }}
      >
        {selected?.label || '风格库'}
      </button>
      {open && (
        <Modal title={editing ? '自定义风格' : '风格库'} open zIndex={1800} width={520} footer={null} onCancel={close}>
          {editing ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault()
                save()
              }}
            >
              <label>
                风格名称
                <input value={name} maxLength={32} autoFocus onChange={(event) => setName(event.target.value)} />
              </label>
              <label>
                风格提示词
                <textarea
                  value={prompt}
                  maxLength={2000}
                  rows={4}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
              <p>风格库保存在当前账号的此浏览器中。选用风格后，提示词会用于估价和生成。</p>
              {error && <p role="alert">{error}</p>}
              <div className={styles.formActions}>
                <button type="button" onClick={() => setEditing(false)}>
                  返回
                </button>
                <button type="submit" disabled={!name.trim() || !prompt.trim()}>
                  保存并使用
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.list} aria-label="生成风格">
              <button type="button" aria-pressed={!selected} onClick={() => choose(null)}>
                暂不使用
              </button>
              <button type="button" onClick={() => setEditing(true)}>
                自定义风格
              </button>
              {[...customStyles, ...presets].map((style) => (
                <button
                  type="button"
                  key={style.id}
                  aria-pressed={selected?.id === style.id}
                  title={style.prompt}
                  onClick={() => choose(style)}
                >
                  {style.label}
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
