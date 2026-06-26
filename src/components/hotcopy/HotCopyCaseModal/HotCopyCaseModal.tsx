/**
 * HotCopyCaseModal — 爆款复制「同款翻拍 / 精准复刻」案例弹窗。
 * 内容 1:1 取自 Figma(同款翻拍案例 855:3049 / 精准复刻案例 863:4503)的弹窗画板整图,
 * 严格按图层还原:标题 + 说明 + 4 张「原视频/翻拍(复刻)视频」对照卡 + 输入素材缩略图。
 * 弹窗本身无交互(纯案例展示),故整卡作为一张图呈现;关闭走遮罩点击 / Esc / 右上角 ×。
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import remakeImg from '@/assets/hotcopy-cases/remake.jpg'
import replicaImg from '@/assets/hotcopy-cases/replica.jpg'

export type HotCopyCaseTab = 'remake' | 'replica'

export default function HotCopyCaseModal({ tab, onClose }: { tab: HotCopyCaseTab | null; onClose: () => void }) {
  useEffect(() => {
    if (!tab) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, onClose])

  if (!tab) return null
  const src = tab === 'replica' ? replicaImg : remakeImg

  return createPortal(
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        background: 'rgba(20, 20, 40, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 'min(880px, 94vw)',
          aspectRatio: '1200 / 840',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(20, 20, 50, 0.35)',
        }}
      >
        <img
          src={src}
          alt={tab === 'replica' ? '精准复刻案例' : '同款翻拍案例'}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {/* 右上角 × 命中区:精确盖在图内的关闭图标上(Figma 中 × 中心约在弹窗 96.25% / 7.14% 处) */}
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '7.1%',
            left: '96.2%',
            transform: 'translate(-50%, -50%)',
            width: '6%',
            height: '8.6%',
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>,
    document.body,
  )
}
