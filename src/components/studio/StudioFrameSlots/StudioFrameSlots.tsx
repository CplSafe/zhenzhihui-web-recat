/**
 * 首尾帧槽位：两个具名方框（首帧 / 尾帧）+ 交换按钮。
 *
 * 相比通用的「0/2」网格，具名槽位让用户一眼看出哪张是首、哪张是尾——
 * 这两张图在提交时会被赋予不同的 role（first_frame / last_frame），
 * 顺序错了生成结果就反了，因此顺序必须在界面上可见、可纠正。
 *
 * 只传首帧是合法的（尾帧留空），只传尾帧则不允许——交换按钮会把它挪到首帧位。
 */
import { Fragment, useEffect, useRef } from 'react'
import {
  REF_IMAGE_ACCEPT,
  type StudioRefImage,
  pickRefImages,
  releaseRefImage,
  releaseRefImages,
} from '@/utils/studioRefImage'
import styles from './StudioFrameSlots.module.less'

/** 首尾帧槽位的受控数据与回调。 */
export interface StudioFrameSlotsProps {
  /** 按 [首帧, 尾帧] 顺序排列；长度 0~2。 */
  images: StudioRefImage[]
  onChange: (images: StudioRefImage[]) => void
  disabled?: boolean
}

/** 两个槽位的展示名。 */
const SLOT_LABELS = ['首帧', '尾帧'] as const

/** 渲染首尾帧槽位。 */
export default function StudioFrameSlots({ images, onChange, disabled }: StudioFrameSlotsProps) {
  // 每个槽位一个独立 input，才能把选中的文件放进指定位置。
  const inputRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  // 卸载时回收本组件产生的 objectURL；用 ref 读最新值，避免 effect 依赖 images 反复重建。
  const imagesRef = useRef(images)
  imagesRef.current = images
  useEffect(() => () => releaseRefImages(imagesRef.current), [])

  /** 把某个槽位替换为新选择的图片。 */
  const setSlot = (index: number, next: StudioRefImage | null) => {
    // 用定长两格数组承载「首帧空、尾帧有图」这类中间态，最后再压紧。
    const slots: (StudioRefImage | null)[] = [images[0] || null, images[1] || null]
    releaseRefImage(slots[index] || null)
    slots[index] = next
    // 首帧空、尾帧有图时前移：后端语义里第一张就是首帧，留空会让尾帧被当成首帧。
    if (!slots[0] && slots[1]) {
      slots[0] = slots[1]
      slots[1] = null
    }
    onChange(slots.filter((slot): slot is StudioRefImage => Boolean(slot)))
  }

  /** 交换首尾帧。 */
  const swap = () => {
    if (images.length < 2) return
    onChange([images[1], images[0]])
  }

  return (
    <div className={styles.panel}>
      <div className={styles.slots}>
        {SLOT_LABELS.map((label, index) => {
          const image = images[index]
          return (
            <Fragment key={label}>
              {/* 交换按钮夹在两个槽位之间 */}
              {index === 1 && (
                <button
                  type="button"
                  className={styles.swap}
                  aria-label="交换首帧和尾帧"
                  title="交换首帧和尾帧"
                  disabled={disabled || images.length < 2}
                  onClick={swap}
                >
                  ⇄
                </button>
              )}

              <button
                type="button"
                className={`${styles.slot}${image ? ` ${styles.isFilled}` : ''}`}
                disabled={disabled}
                aria-label={image ? `更换${label}` : `添加${label}`}
                onClick={() => inputRefs[index].current?.click()}
              >
                {image ? (
                  <>
                    <img className={styles.thumb} src={image.url} alt={label} />
                    <span className={styles.badge}>{label}</span>
                    <span
                      className={styles.remove}
                      role="button"
                      tabIndex={0}
                      aria-label={`移除${label}`}
                      onClick={(event) => {
                        // 阻止冒泡到槽位按钮，否则移除后又立刻弹出选图框。
                        event.stopPropagation()
                        setSlot(index, null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        setSlot(index, null)
                      }}
                    >
                      ✕
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.slotIcon} aria-hidden="true">
                      ⊞
                    </span>
                    {label}
                  </>
                )}
              </button>

              <input
                ref={inputRefs[index]}
                type="file"
                accept={REF_IMAGE_ACCEPT}
                hidden
                onChange={(event) => {
                  const [picked] = pickRefImages(event.target.files, 1)
                  if (picked) setSlot(index, picked)
                  // 清空 value，保证连续选择同一个文件也能触发 change。
                  event.target.value = ''
                }}
              />
            </Fragment>
          )
        })}
      </div>

      <p className={styles.hint}>
        输入 1 张图作为首帧生成视频，或输入 2 张图分别作为首帧和尾帧，让画面一镜到底无缝过渡。
      </p>
    </div>
  )
}
