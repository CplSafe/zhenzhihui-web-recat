/**
 * 左侧浮动工具图标列
 *
 * 五个图标：添加(弹出节点菜单) / 锁定(节点拖拽开关) / 搜索 / 素材库 / 历史记录
 *
 * 这里以前还有「平移」「框选」两个模式开关。它们让用户替程序管状态：想框选先去点一下按钮，
 * 框完再点回来才能拖画布。现在平移与框选靠手势区分（空白处左键拖=框选，空格/中键/右键拖=平移，
 * 滚轮平移），不再需要切模式；只留下「锁定节点」——那是个明确的意图，不是模式。
 */
import { memo, useState, useRef, useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Keyboard, Plus } from 'lucide-react'
import {
  CANVAS_MOD,
  DEFAULT_CANVAS_SHORTCUTS,
  formatCanvasShortcut,
  type CanvasShortcutBindings,
} from '@/utils/canvasKeyboard'
import { CANVAS_AUDIO_NODES_ENABLED } from '@/utils/canvasFeatureFlags'
import styles from './CanvasFloatingToolbar.module.css'

interface CanvasFloatingToolbarProps {
  shortcuts?: CanvasShortcutBindings
  onAddNode: (type: string) => void
  /** 添加本地素材：打开文件选择框，选中的图片/视频上传后各自落成图片或视频节点 */
  onAddLocalImage: () => void
  /** 抓手模式：true=左键拖空白处平移画布（框选改为按住 Shift 拖）；false=左键拖空白处框选 */
  panModeEnabled: boolean
  onPanModeToggle: () => void
  /** 节点拖拽开关：true=可拖拽节点 */
  dragEnabled: boolean
  onDragToggle: () => void
  /** 打开节点搜索面板 */
  onOpenSearch: () => void
  onOpenAssets: () => void
  onOpenHelp: () => void
  onOpenHistory: () => void
  /** 打开抽屉前播放的收起动画标记 */
  leaving?: boolean
}

function CanvasFloatingToolbar({
  shortcuts = DEFAULT_CANVAS_SHORTCUTS,
  onAddNode,
  onAddLocalImage,
  panModeEnabled,
  onPanModeToggle,
  dragEnabled,
  onDragToggle,
  onOpenSearch,
  onOpenAssets,
  onOpenHistory,
  onOpenHelp,
  leaving = false,
}: CanvasFloatingToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [addSink, setAddSink] = useState(false)
  const addPressTimerRef = useRef<number | null>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)
  const reduceMotion = useReducedMotion()
  const menuRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const pointerDownRef = useRef(false)

  const nearestTool = (clientX: number) => {
    const buttons = toolbarRef.current?.querySelectorAll<HTMLButtonElement>(`.${styles.toolBtn}`)
    if (!buttons?.length) return null
    let nearest = 0
    let distance = Number.POSITIVE_INFINITY
    buttons.forEach((button, index) => {
      const rect = button.getBoundingClientRect()
      const nextDistance = Math.abs(clientX - (rect.left + rect.width / 2))
      if (nextDistance < distance) {
        distance = nextDistance
        nearest = index
      }
    })
    return nearest === 0 ? null : nearest
  }

  const renderGlyph = (icon: ReactNode, index: number) => {
    const distance = hoverIndex === null ? Number.POSITIVE_INFINITY : Math.abs(index - hoverIndex)
    const falloff = distance > 2 ? 0 : (1 + Math.cos((Math.PI * distance) / 3)) / 2
    const scale = 1 + (1.14 - 1) * falloff
    return (
      <span
        className={styles.toolGlyph}
        style={{ transform: `translateY(${-13 * falloff}px) scale(${scale})` }}
        aria-hidden="true"
      >
        {icon}
      </span>
    )
  }

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

  useEffect(() => {
    if (!menuOpen) return
    addTriggerRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  useEffect(
    () => () => {
      if (addPressTimerRef.current !== null) window.clearTimeout(addPressTimerRef.current)
    },
    [],
  )

  const pressAdd = () => {
    setAddSink(true)
    if (addPressTimerRef.current !== null) window.clearTimeout(addPressTimerRef.current)
    addPressTimerRef.current = window.setTimeout(
      () => {
        addPressTimerRef.current = null
        setAddSink(false)
        setHoverIndex(null)
        setMenuOpen(true)
      },
      reduceMotion ? 0 : 60,
    )
  }

  const menuWidth = Math.max(44, Math.min(290, window.innerWidth - 32))
  const shapeTransition = reduceMotion
    ? { duration: 0.01 }
    : {
        width: { type: 'spring' as const, stiffness: 420, damping: 30, mass: 0.5 },
        height: { type: 'spring' as const, stiffness: 420, damping: 30, mass: 0.5 },
        borderRadius: { type: 'spring' as const, stiffness: 420, damping: 30, mass: 0.5 },
        opacity: { duration: 0.12 },
      }

  return (
    <div
      ref={toolbarRef}
      className={[styles.toolbar, menuOpen ? styles.toolbarMenuOpen : '', leaving ? styles.toolbarLeaving : '']
        .filter(Boolean)
        .join(' ')}
      aria-hidden={leaving || undefined}
      onPointerDownCapture={(event) => {
        pointerDownRef.current = true
        if (event.pointerType !== 'mouse') setHoverIndex(nearestTool(event.clientX))
      }}
      onPointerMoveCapture={(event) => {
        if (event.pointerType === 'mouse' || pointerDownRef.current) setHoverIndex(nearestTool(event.clientX))
      }}
      onPointerUpCapture={(event) => {
        pointerDownRef.current = false
        if (event.pointerType !== 'mouse') setHoverIndex(null)
      }}
      onPointerCancelCapture={() => {
        pointerDownRef.current = false
        setHoverIndex(null)
      }}
      onPointerLeave={() => {
        if (!pointerDownRef.current) setHoverIndex(null)
      }}
    >
      {/* 1. 加号 — 弹出节点类型菜单 */}
      <div className={`${styles.addBtnWrap} ${menuOpen ? styles.addBtnWrapOpen : ''}`} ref={menuRef}>
        <motion.button
          ref={addTriggerRef}
          className={`${styles.toolBtn} ${menuOpen ? styles.toolBtnActive : ''}`}
          onClick={pressAdd}
          title={menuOpen ? undefined : '添加节点'}
          aria-label="添加节点"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="canvas-add-menu"
          animate={{ scale: addSink ? 0.94 : 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0.01 } : { scale: { duration: 0.11 }, opacity: { duration: 0.12 } }}
        >
          <Plus size={24} strokeWidth={1.8} aria-hidden="true" />
          {!menuOpen && <span className={styles.toolLabel}>添加</span>}
        </motion.button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              id="canvas-add-menu"
              className={styles.addMenu}
              role="menu"
              aria-label="创建或添加节点"
              initial={{ width: 44, height: 44, borderRadius: 22, opacity: 1 }}
              animate={{ width: menuWidth, height: 'auto', borderRadius: 28, opacity: 1 }}
              exit={{ width: 44, height: 44, borderRadius: 22, opacity: 0 }}
              transition={shapeTransition}
            >
              {/*
              分成两组是因为它们回答的是两个不同的问题：
              上面一组「新建节点」创建的是空节点，内容还要靠生成；
              下面一组「添加素材」放进来的是已经存在的素材。
              以前素材库只挂在工具栏的独立按钮上，用户在「添加」菜单里根本看不到它，
              于是想加一张已有的图时只剩「本地上传」一条路——哪怕这张图就在素材库里。
            */}
              <span className={styles.addMenuGroup}>新建节点</span>
              {CANVAS_AUDIO_NODES_ENABLED && (
                <motion.button
                  className={styles.addMenuItem}
                  role="menuitem"
                  initial={{ opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.07 }}
                  onClick={() => {
                    onAddNode('audio')
                    setMenuOpen(false)
                  }}
                >
                  <span className={styles.addMenuIcon}>♫</span>
                  <div className={styles.addMenuText}>
                    <span className={styles.addMenuLabel}>音频节点</span>
                    <span className={styles.addMenuDesc}>配音、背景音乐、音效</span>
                  </div>
                </motion.button>
              )}
              {CANVAS_AUDIO_NODES_ENABLED && (
                <motion.button
                  className={styles.addMenuItem}
                  role="menuitem"
                  initial={{ opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.105 }}
                  onClick={() => {
                    onAddNode('audio-editor')
                    setMenuOpen(false)
                  }}
                >
                  <span className={styles.addMenuIcon}>♫</span>
                  <div className={styles.addMenuText}>
                    <span className={styles.addMenuLabel}>音频编辑</span>
                    <span className={styles.addMenuDesc}>裁剪、音量、淡入淡出</span>
                  </div>
                </motion.button>
              )}
              <motion.button
                className={styles.addMenuItem}
                role="menuitem"
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.14 }}
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
              </motion.button>
              <motion.button
                className={styles.addMenuItem}
                role="menuitem"
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.175 }}
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
              </motion.button>
              <motion.button
                className={styles.addMenuItem}
                role="menuitem"
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.21 }}
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
              </motion.button>
              <motion.button
                className={styles.addMenuItem}
                role="menuitem"
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.245 }}
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
              </motion.button>
              <span className={styles.addMenuGroup}>添加素材</span>
              <motion.button
                className={styles.addMenuItem}
                role="menuitem"
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.28 }}
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
              </motion.button>
              <motion.button
                className={styles.addMenuItem}
                role="menuitem"
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.315 }}
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
                  <span className={styles.addMenuDesc}>图片或视频，也可直接拖拽或 {CANVAS_MOD} + V 粘贴</span>
                </div>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/*
        2. 抓手（平移模式）。默认左键拖空白是框选，平移走空格/中键/右键/滚轮；
        习惯「左键就是拖画布」的用户点亮这个，左键拖空白改为平移，框选改为按住 Shift 拖。
      */}
      <button
        className={`${styles.toolBtn} ${panModeEnabled ? styles.toolBtnActive : ''}`}
        onClick={onPanModeToggle}
        title={
          panModeEnabled
            ? '抓手模式：左键拖空白处平移画布（按住 Shift 拖可框选）。点击切回框选'
            : `切到抓手模式：左键拖空白处平移画布。当前左键拖空白是框选，平移用${formatCanvasShortcut(shortcuts.panHold)}/中键/右键拖或滚轮`
        }
        aria-pressed={panModeEnabled}
      >
        {renderGlyph(<HandIcon />, 1)}
        <span className={styles.toolLabel}>拖动</span>
      </button>

      {/*
        3. 锁定节点（nodesDraggable 取反）。
        高亮表示「锁着」：这是一个偏离默认的状态，亮着才提醒用户为什么拖不动。
        以前这颗按钮默认高亮表示「可拖拽」，和隔壁默认不亮的框选开关放一起，两种语义打架。
      */}
      <button
        className={`${styles.toolBtn} ${dragEnabled ? '' : styles.toolBtnActive}`}
        onClick={onDragToggle}
        title={dragEnabled ? '锁定节点位置：锁定后节点不可拖动，只能平移画布' : '解除锁定，恢复节点拖动'}
        aria-pressed={!dragEnabled}
      >
        {renderGlyph(dragEnabled ? <UnlockIcon /> : <LockIcon />, 2)}
        <span className={styles.toolLabel}>{dragEnabled ? '锁定' : '已锁'}</span>
      </button>

      {/* 4. 节点搜索/定位：快捷键是 Ctrl/Cmd+F，但不能只有快捷键——没人会去猜 */}
      <button
        className={styles.toolBtn}
        onClick={onOpenSearch}
        title={`搜索 / 定位节点（${formatCanvasShortcut(shortcuts.search)}）`}
      >
        {renderGlyph(<SearchIcon />, 3)}
        <span className={styles.toolLabel}>搜索</span>
      </button>

      <button className={styles.toolBtn} onClick={onOpenAssets} title="素材库">
        {renderGlyph(<FolderIcon />, 4)}
        <span className={styles.toolLabel}>素材</span>
      </button>

      <button
        type="button"
        className={styles.toolBtn}
        onClick={onOpenHelp}
        title="快捷键说明（?）"
        aria-label="打开快捷键说明"
      >
        {renderGlyph(<Keyboard className={styles.keyboardGlyph} aria-hidden="true" />, 5)}
        <span className={styles.toolLabel}>快捷键</span>
      </button>
      <button className={styles.toolBtn} onClick={onOpenHistory} title="历史记录">
        {renderGlyph(<HistoryIcon />, 6)}
        <span className={styles.toolLabel}>历史</span>
      </button>
    </div>
  )
}

/* ---------- icons ---------- */

/** 抓手：设计工具里「平移画布」的通用图标 */
function HandIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M14 12V6.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M17 13v-1.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.8-2.4L4.6 14.7a1.5 1.5 0 0 1 2.4-1.8L8 14.5" />
    </svg>
  )
}

function UnlockIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
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
