import { useState } from 'react'
import { Modal } from 'antd'
import animationPreview from '@/assets/canvas-styles/animation.webp'
import celAnimePreview from '@/assets/canvas-styles/cel-anime.webp'
import cinematicPreview from '@/assets/canvas-styles/cinematic.webp'
import clayPreview from '@/assets/canvas-styles/clay.webp'
import comicPreview from '@/assets/canvas-styles/comic.webp'
import cyberpunkPreview from '@/assets/canvas-styles/cyberpunk.webp'
import filmPreview from '@/assets/canvas-styles/film.webp'
import gongbiPreview from '@/assets/canvas-styles/gongbi.webp'
import inkPreview from '@/assets/canvas-styles/ink.webp'
import noirPreview from '@/assets/canvas-styles/noir.webp'
import pixelPreview from '@/assets/canvas-styles/pixel.webp'
import watercolorPreview from '@/assets/canvas-styles/watercolor.webp'
import styles from './CanvasPromptStylePicker.module.css'

export interface CanvasPromptStyle {
  id: string
  label: string
  prompt: string
}

const presets: readonly (CanvasPromptStyle & { preview: string })[] = [
  {
    id: 'cinematic',
    label: '电影写实',
    preview: cinematicPreview,
    prompt: '电影写实风格，使用自然光影、层次分明的构图和克制的色彩。',
  },
  {
    id: 'comic',
    label: '漫剧',
    preview: comicPreview,
    prompt: '漫剧风格，轮廓清晰，表情和动作鲜明，画面具有连贯的镜头叙事。',
  },
  {
    id: 'ink',
    label: '水墨',
    preview: inkPreview,
    prompt: '中国水墨风格，使用墨色浓淡、宣纸质感和有层次的留白。',
  },
  {
    id: 'animation',
    label: '三维动画',
    preview: animationPreview,
    prompt: '三维动画风格，突出清晰的材质、柔和光照和连贯的空间关系。',
  },
  {
    id: 'cel-anime',
    label: '日系赛璐珞',
    preview: celAnimePreview,
    prompt: '日系赛璐珞动画风格，采用清晰轮廓、分层平涂明暗和手绘背景，强调构图与光线节奏。',
  },
  {
    id: 'clay',
    label: '黏土定格',
    preview: clayPreview,
    prompt: '黏土定格动画风格，保留手塑纹理、微缩布景和柔软边缘，运用柔和的影棚光。',
  },
  {
    id: 'film',
    label: '复古胶片',
    preview: filmPreview,
    prompt: '复古彩色胶片风格，保留可见颗粒、温暖的高光和略微褪色的色调，呈现自然曝光。',
  },
  {
    id: 'noir',
    label: '黑白电影',
    preview: noirPreview,
    prompt: '黑白电影风格，采用强烈明暗对比、侧逆光和深暗阴影，运用清晰的剪影组织画面。',
  },
  {
    id: 'watercolor',
    label: '绘本水彩',
    preview: watercolorPreview,
    prompt: '绘本水彩风格，使用透明叠色、自然晕染和可见纸纹，以柔和色彩与留白营造层次。',
  },
  {
    id: 'pixel',
    label: '像素艺术',
    preview: pixelPreview,
    prompt: '复古像素艺术风格，使用明确的方形像素、有限色板与阶梯状轮廓，保持像素大小一致。',
  },
  {
    id: 'cyberpunk',
    label: '赛博霓虹',
    preview: cyberpunkPreview,
    prompt: '赛博朋克霓虹风格，使用冷暖霓虹反差、深色环境和有层次的反射光，表现潮湿夜景。',
  },
  {
    id: 'gongbi',
    label: '国风工笔',
    preview: gongbiPreview,
    prompt: '中国工笔风格，使用细密精确的勾线、层叠矿物色与有节制的留白，保留绢本与设色质感。',
  },
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
        <Modal title={editing ? '自定义风格' : '风格库'} open zIndex={1800} width={600} footer={null} onCancel={close}>
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
            <div className={styles.list}>
              <div className={styles.actions}>
                <button type="button" aria-pressed={!selected} onClick={() => choose(null)}>
                  暂不使用
                </button>
                <button type="button" onClick={() => setEditing(true)}>
                  自定义风格
                </button>
                {customStyles.map((style) => (
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
              <div className={styles.presets} role="group" aria-label="内置风格">
                {presets.map(({ preview, ...style }) => (
                  <button
                    type="button"
                    key={style.id}
                    className={styles.card}
                    aria-pressed={selected?.id === style.id}
                    title={style.prompt}
                    onClick={() => choose(style)}
                  >
                    <img src={preview} alt="" width={320} height={284} loading="lazy" />
                    <span>{style.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
