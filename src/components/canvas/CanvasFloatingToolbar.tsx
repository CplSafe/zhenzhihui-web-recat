/**
 * 左侧浮动工具图标列
 *
 * 五个图标：Add(加号弹出菜单) / Move(画布平移开关) / Drag(节点拖拽开关) / 素材库 / 历史记录
 * Move 与 Drag 为独立开关，初始均开启（高亮）：移动作用于画布平移，拖拽作用于节点拖拽。
 */
import { memo, useState, useRef, useEffect } from 'react'
import styles from './CanvasFloatingToolbar.module.css'

interface CanvasFloatingToolbarProps {
  onAddNode: (type: string) => void
  /** 添加本地图片：打开文件选择框，选中的图片上传后落成图片节点 */
  onAddLocalImage: () => void
  /** 画布平移开关：true=可移动画布 */
  moveEnabled: boolean
  onMoveToggle: () => void
  /** 节点拖拽开关：true=可拖拽节点 */
  dragEnabled: boolean
  onDragToggle: () => void
  onOpenAssets: () => void
  onOpenHistory: () => void
  /** 打开抽屉前播放的收起动画标记 */
  leaving?: boolean
}

function CanvasFloatingToolbar({
  onAddNode,
  onAddLocalImage,
  moveEnabled,
  onMoveToggle,
  dragEnabled,
  onDragToggle,
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
          <span className={styles.toolLabel}>添加</span>
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
            <button
              className={styles.addMenuItem}
              onClick={() => {
                onAddNode('timeline')
                setMenuOpen(false)
              }}
            >
              <span className={styles.addMenuIcon}>
                <TimelineTypeIcon />
              </span>
              <div className={styles.addMenuText}>
                <span className={styles.addMenuLabel}>视频剪辑</span>
                <span className={styles.addMenuDesc}>把多段视频串成一条成片</span>
              </div>
            </button>
            <button
              className={styles.addMenuItem}
              onClick={() => {
                onAddLocalImage()
                setMenuOpen(false)
              }}
            >
              <span className={styles.addMenuIcon}>
                <UploadTypeIcon />
              </span>
              <div className={styles.addMenuText}>
                <span className={styles.addMenuLabel}>本地图片</span>
                <span className={styles.addMenuDesc}>也可直接拖拽或 Ctrl+V 粘贴</span>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* 2. 移动（画布平移） */}
      <button
        className={`${styles.toolBtn} ${moveEnabled ? styles.toolBtnActive : ''}`}
        onClick={onMoveToggle}
        title="画布移动"
      >
        <MoveIcon />
        <span className={styles.toolLabel}>选择</span>
      </button>

      {/* 3. 拖拽（节点拖拽） */}
      <button
        className={`${styles.toolBtn} ${dragEnabled ? styles.toolBtnActive : ''}`}
        onClick={onDragToggle}
        title="节点拖拽"
      >
        <DragIcon />
        <span className={styles.toolLabel}>移动</span>
      </button>

      <button className={styles.toolBtn} onClick={onOpenAssets} title="素材库">
        <FolderIcon />
        <span className={styles.toolLabel}>素材</span>
      </button>

      <button className={styles.toolBtn} onClick={onOpenHistory} title="历史记录">
        <HistoryIcon />
        <span className={styles.toolLabel}>历史</span>
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

function MoveIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2v20M2 12h20" strokeLinecap="round" />
      <path d="M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
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

function FolderIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3.5 7.5h6l2 2h9v9.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5Z" strokeLinejoin="round" />
      <path d="M3.5 7.5V5A1.5 1.5 0 0 1 5 3.5h4l2 2h7A1.5 1.5 0 0 1 19.5 7v2.5" strokeLinejoin="round" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 5v5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.4 9.7A8 8 0 1 1 4.6 15" strokeLinecap="round" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
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

function UploadTypeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 16V4" strokeLinecap="round" />
      <path d="m6 10 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" strokeLinecap="round" />
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

/** 胶片格子：与「多段素材串成一条」的语义对应 */
function TimelineTypeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 3v8M9 3v8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export default memo(CanvasFloatingToolbar)
