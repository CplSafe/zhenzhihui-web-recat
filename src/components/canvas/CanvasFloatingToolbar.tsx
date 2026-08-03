/**
 * 左侧浮动工具图标列
 *
 * 五个图标：Add(加号弹出菜单) / Select(选中模式) / Drag(拖拽模式) / 素材库 / 历史记录
 */
import { memo, useState, useRef, useEffect } from 'react'
import styles from './CanvasFloatingToolbar.module.css'

interface CanvasFloatingToolbarProps {
  onAddNode: (type: string) => void
  selectMode: boolean
  onSelectModeChange: (v: boolean) => void
  panMode: boolean
  onPanModeChange: (v: boolean) => void
  onOpenAssets: () => void
  onOpenHistory: () => void
  /** 打开抽屉前播放的收起动画标记 */
  leaving?: boolean
}

function CanvasFloatingToolbar({
  onAddNode,
  selectMode,
  onSelectModeChange,
  panMode,
  onPanModeChange,
  onOpenAssets,
  onOpenHistory,
  leaving = false,
}: CanvasFloatingToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <div
      className={[styles.toolbar, leaving ? styles.toolbarLeaving : ''].filter(Boolean).join(' ')}
      aria-hidden={leaving || undefined}
    >
      {/* 1. 加号 — 弹出节点类型菜单 */}
      <div className={styles.addBtnWrap} ref={menuRef}>
        <button
          className={`${styles.toolBtn} ${menuOpen ? styles.toolBtnActive : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          title="添加节点"
        >
          <PlusIcon />
        </button>
        {menuOpen && (
          <div className={styles.addMenu}>
            <button
              className={styles.addMenuItem}
              onClick={() => {
                onAddNode('text')
                setMenuOpen(false)
              }}
            >
              <span className={styles.addMenuIcon}>
                <TextTypeIcon />
              </span>
              <div className={styles.addMenuText}>
                <span className={styles.addMenuLabel}>文本节点</span>
                <span className={styles.addMenuDesc}>脚本、广告词、品牌文案</span>
              </div>
            </button>
            <button
              className={styles.addMenuItem}
              onClick={() => {
                onAddNode('image')
                setMenuOpen(false)
              }}
            >
              <span className={styles.addMenuIcon}>
                <ImageTypeIcon />
              </span>
              <div className={styles.addMenuText}>
                <span className={styles.addMenuLabel}>图片节点</span>
                <span className={styles.addMenuDesc}>宣传图、海报、封面</span>
              </div>
            </button>
            <button
              className={styles.addMenuItem}
              onClick={() => {
                onAddNode('video')
                setMenuOpen(false)
              }}
            >
              <span className={styles.addMenuIcon}>
                <VideoTypeIcon />
              </span>
              <div className={styles.addMenuText}>
                <span className={styles.addMenuLabel}>视频节点</span>
                <span className={styles.addMenuDesc}>宣传视频、动画、电影</span>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* 2. 选中模式 */}
      <button
        className={`${styles.toolBtn} ${selectMode ? styles.toolBtnActive : ''}`}
        onClick={() => onSelectModeChange(!selectMode)}
        title="选中"
      >
        <SelectIcon />
      </button>

      {/* 3. 拖拽模式 */}
      <button
        className={`${styles.toolBtn} ${panMode ? styles.toolBtnActive : ''}`}
        onClick={() => onPanModeChange(!panMode)}
        title="拖拽"
      >
        <DragIcon />
      </button>

      {/* 4. 素材库 */}
      <button className={styles.toolBtn} onClick={onOpenAssets} title="素材库">
        <GridIcon />
      </button>

      {/* 5. 历史记录 */}
      <button className={styles.toolBtn} onClick={onOpenHistory} title="历史记录">
        <ClockIcon />
      </button>
    </div>
  )
}

/* ---------- icons ---------- */

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SelectIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3l7.07 16.97 2.54-7.38 7.39-2.54z" strokeLinejoin="round" />
    </svg>
  )
}

function DragIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="6" r="1" fill="currentColor" />
      <circle cx="8" cy="12" r="1" fill="currentColor" />
      <circle cx="8" cy="18" r="1" fill="currentColor" />
      <circle cx="16" cy="6" r="1" fill="currentColor" />
      <circle cx="16" cy="12" r="1" fill="currentColor" />
      <circle cx="16" cy="18" r="1" fill="currentColor" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TextTypeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M9.7 10.3c.3 0 .6.2.6.6 0 .3-.2.6-.6.6H2c-.3 0-.6-.3-.6-.6 0-.3.3-.6.6-.6h7.7zM7.8 6.4c.3 0 .6.3.6.6 0 .3-.3.6-.6.6H2c-.3 0-.6-.3-.6-.6 0-.3.3-.6.6-.6h5.8zm4.2-3.8c.3 0 .5.3.5.6s-.2.6-.5.6H2c-.3 0-.6-.3-.6-.6s.3-.6.6-.6h9.9z"
        fill="currentColor"
      />
    </svg>
  )
}

function ImageTypeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="5" r="1.2" fill="currentColor" />
      <path
        d="M1 10l3.5-3.5 2.5 2.5 2-2L13 10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function VideoTypeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <polygon points="6,5 10,7 6,9" fill="currentColor" />
    </svg>
  )
}

export default memo(CanvasFloatingToolbar)
