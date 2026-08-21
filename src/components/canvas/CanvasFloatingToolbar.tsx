/**
 * 左侧浮动工具图标列
 *
 * 六个图标：添加(弹出节点菜单) / 平移(画布平移开关) / 拖拽(节点拖拽开关) / 搜索 / 素材库 / 历史记录
 * 平移与拖拽是两个独立开关，初始均开启（高亮），互不影响。
 */
import { memo, useState, useRef, useEffect } from 'react'
import styles from './CanvasFloatingToolbar.module.css'

interface CanvasFloatingToolbarProps {
  onAddNode: (type: string) => void
  /** 添加本地素材：打开文件选择框，选中的图片/视频上传后各自落成图片或视频节点 */
  onAddLocalImage: () => void
  /** 画布平移开关：true=可移动画布 */
  moveEnabled: boolean
  onMoveToggle: () => void
  /** 节点拖拽开关：true=可拖拽节点 */
  dragEnabled: boolean
  onDragToggle: () => void
  /** 打开节点搜索面板 */
  onOpenSearch: () => void
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
  onOpenSearch,
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
            {/*
              分成两组是因为它们回答的是两个不同的问题：
              上面一组「新建节点」创建的是空节点，内容还要靠生成；
              下面一组「添加素材」放进来的是已经存在的素材。
              以前素材库只挂在工具栏的独立按钮上，用户在「添加」菜单里根本看不到它，
              于是想加一张已有的图时只剩「本地上传」一条路——哪怕这张图就在素材库里。
            */}
            <span className={styles.addMenuGroup}>新建节点</span>
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
            <span className={styles.addMenuGroup}>添加素材</span>
            <button
              className={styles.addMenuItem}
              onClick={() => {
                onOpenAssets()
                setMenuOpen(false)
              }}
            >
              <span className={styles.addMenuIcon}>
                <LibraryTypeIcon />
              </span>
              <div className={styles.addMenuText}>
                <span className={styles.addMenuLabel}>素材库</span>
                <span className={styles.addMenuDesc}>选用本项目已有的图片或视频</span>
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
                <span className={styles.addMenuLabel}>本地上传</span>
                <span className={styles.addMenuDesc}>图片或视频，也可直接拖拽或 Ctrl+V 粘贴</span>
              </div>
            </button>
          </div>
        )}
      </div>

      {/*
        2. 画布平移（panOnDrag）
        文案要说的是这个按钮控制什么。它以前标「选择」，实际管的却是拖空白处平移画布——
        和隔壁管节点拖拽的按钮标「移动」正好互相串味，两个词都指不对自己的功能。
      */}
      <button
        className={`${styles.toolBtn} ${moveEnabled ? styles.toolBtnActive : ''}`}
        onClick={onMoveToggle}
        title="拖拽空白处平移画布"
        aria-pressed={moveEnabled}
      >
        <MoveIcon />
        <span className={styles.toolLabel}>平移</span>
      </button>

      {/* 3. 节点拖拽（nodesDraggable） */}
      <button
        className={`${styles.toolBtn} ${dragEnabled ? styles.toolBtnActive : ''}`}
        onClick={onDragToggle}
        title="允许拖动节点"
        aria-pressed={dragEnabled}
      >
        <DragIcon />
        <span className={styles.toolLabel}>拖拽</span>
      </button>

      {/* 4. 节点搜索：快捷键是 Ctrl/Cmd+F，但不能只有快捷键——没人会去猜 */}
      <button className={styles.toolBtn} onClick={onOpenSearch} title="搜索节点（Ctrl+F）">
        <SearchIcon />
        <span className={styles.toolLabel}>搜索</span>
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

function LibraryTypeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="5" width="14" height="14" rx="2" strokeLinejoin="round" />
      <path d="M17 8h3a1 1 0 0 1 1 1v9a3 3 0 0 1-3 3H8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 15l3-3 2.5 2.5 2-2L14 14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <line x1="16" y1="16" x2="21" y2="21" />
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
