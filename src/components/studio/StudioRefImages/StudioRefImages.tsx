/**
 * 参考图上传区（图片模式的「参考生图」/ 视频模式的「首尾帧图」）。
 *
 * 本地选图后立即生成 objectURL 预览，真正的落库上传由父级在提交生成时通过
 * ensureAssetId 完成——避免用户只是试选素材就产生后端资源。
 * 组件卸载时回收 objectURL，防止内存泄漏。
 */
import { useEffect, useRef } from 'react'
import { MAX_REFERENCE_IMAGES } from '@/utils/studioParams'
import {
  REF_IMAGE_ACCEPT,
  type StudioRefImage,
  pickRefImages,
  releaseRefImage,
  releaseRefImages,
} from '@/utils/studioRefImage'
import styles from './StudioRefImages.module.less'

export type { StudioRefImage }

/** 参考图区的受控数据与变更回调。 */
export interface StudioRefImagesProps {
  title: string
  images: StudioRefImage[]
  onChange: (images: StudioRefImage[]) => void
  max?: number
  hint?: string
  disabled?: boolean
}

/** 渲染参考图缩略图网格与添加入口。 */
export default function StudioRefImages({
  title,
  images,
  onChange,
  max = MAX_REFERENCE_IMAGES,
  hint,
  disabled,
}: StudioRefImagesProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // 卸载时统一回收本组件创建的 objectURL；用 ref 保存最新列表，避免 effect 依赖 images 反复重建。
  const imagesRef = useRef(images)
  imagesRef.current = images
  useEffect(() => () => releaseRefImages(imagesRef.current), [])

  const pickFiles = (files: FileList | null) => {
    const picked = pickRefImages(files, Math.max(0, max - images.length))
    if (picked.length) onChange([...images, ...picked])
  }

  const removeAt = (id: string) => {
    releaseRefImage(images.find((image) => image.id === id))
    onChange(images.filter((image) => image.id !== id))
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          {title}
          <span className={styles.optional}>（可选）</span>
        </span>
        <span className={styles.count}>
          {images.length}/{max}
        </span>
      </div>

      <div className={styles.grid}>
        {images.map((image) => (
          <div key={image.id} className={styles.item}>
            <img className={styles.thumb} src={image.url} alt="参考图" />
            <button
              type="button"
              className={styles.itemRemove}
              aria-label="移除该参考图"
              disabled={disabled}
              onClick={() => removeAt(image.id)}
            >
              ✕
            </button>
          </div>
        ))}

        {images.length < max && (
          <button
            type="button"
            className={styles.add}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            aria-label={`添加${title}`}
          >
            <span className={styles.addIcon} aria-hidden="true">
              ＋
            </span>
            添加
          </button>
        )}
      </div>

      {hint && <p className={styles.hint}>{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={REF_IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          pickFiles(event.target.files)
          // 清空 value，保证连续选择同一个文件也能触发 change。
          event.target.value = ''
        }}
      />
    </div>
  )
}
