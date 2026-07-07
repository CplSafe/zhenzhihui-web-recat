/**
 * UserAvatar — 用户头像组件，内置图片加载失败回退。
 * 当 src 为空或图片加载失败时，显示用户名首字符作为文字头像。
 */
import { useEffect, useState } from 'react'

interface UserAvatarProps {
  /** 头像图片 URL */
  src: string
  /** 用户名，用于提取首字符作为文字回退 */
  name: string
  /** 传给 <img> 的 className */
  className?: string
  /** 传给回退 <span> 的 className（不传则复用 className） */
  fallbackClassName?: string
  /** img alt 属性 */
  alt?: string
}

export default function UserAvatar({ src, name, className, fallbackClassName, alt = '' }: UserAvatarProps) {
  const [failed, setFailed] = useState(false)

  // src 变化时重置错误状态（例如用户更换头像后新 URL 可能有效）
  useEffect(() => {
    setFailed(false)
  }, [src])

  const initial = String(name || '?')
    .trim()
    .charAt(0)
    .toUpperCase()

  // 无 src 或图片加载失败 → 文字回退
  if (!src || failed) {
    return <span className={fallbackClassName || className}>{initial}</span>
  }

  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />
}
